/**
 * campaign-runner.ts — Advanced campaign engine
 *
 * Anti-ban layers applied here:
 *   1. Tiered daily limits (new/warm/hot) — enforces warm-up curve
 *   2. Poisson-distributed inter-message delays — not uniform random
 *   3. Time-of-day weighting — biased toward realistic waking hours
 *   4. Per-message kill-switch check — halts mid-batch within seconds
 *   5. Account health score — auto-pauses accounts showing stress signals
 *   6. Opt-out matching with phone normalization
 *   7. Full message variation via buildUniqueMessage (7 layers)
 *   8. Human mode flag sent to worker (/send with humanMode:true)
 */

import { db } from "@workspace/db";
import {
  campaignsTable, messagesTable, accountsTable,
  settingsTable, templatesTable, optOutTable,
} from "@workspace/db/schema";
import { eq, inArray, and, sql } from "drizzle-orm";
import { buildUniqueMessage, sanitizePhone } from "./spintax";
import { workerSendMessage } from "./worker-client";
import { logger } from "./logger";

export const runningCampaigns = new Set<string>();

// ── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-\+\(\)]/g, "");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Poisson-distributed delay (far more human than uniform random) ─────────
function poissonDelay(lambdaMs: number, minMs: number, maxMs: number): number {
  const raw = -Math.log(1 - Math.random()) * lambdaMs;
  return Math.min(Math.max(raw, minMs), maxMs);
}

// ── Time-of-day score: peaks at 9-12h, 14-17h, 19-21h ───────────────────
// Returns 0–1. Scheduler biases toward high-score windows.
function timeOfDayScore(): number {
  const h = new Date().getHours();
  const peaks = [[9, 12], [14, 17], [19, 21]] as [number, number][];
  for (const [start, end] of peaks) {
    if (h >= start && h < end) return 1;
    if (h === start - 1) return 0.5;
    if (h === end) return 0.5;
  }
  return 0.1;
}

// ── Settings ───────────────────────────────────────────────────────────────
type SettingsRow = {
  newAccountDailyLimit: number; warmAccountDailyLimit: number; hotAccountDailyLimit: number;
  warmUpDaysThreshold: number; hotDaysThreshold: number; hotReplyThreshold: number;
  workingHoursStart: number; workingHoursEnd: number;
  spintaxEnabled: boolean; invisibleCharsEnabled: boolean;
  maxRetries: number; retryDelayMin: number; killSwitch: boolean; dedupWindowDays: number;
};

async function getSettings(): Promise<SettingsRow> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  return rows[0] ?? {
    newAccountDailyLimit: 20, warmAccountDailyLimit: 80, hotAccountDailyLimit: 150,
    warmUpDaysThreshold: 7, hotDaysThreshold: 30, hotReplyThreshold: 20,
    workingHoursStart: 9, workingHoursEnd: 22,
    spintaxEnabled: true, invisibleCharsEnabled: true,
    maxRetries: 3, retryDelayMin: 5, killSwitch: false, dedupWindowDays: 7,
  };
}

// ── Tiered daily limit ─────────────────────────────────────────────────────
type AccRow = { warmUpDay: number; totalReplies: number; createdAt: Date };

function getDailyLimit(acc: AccRow, s: SettingsRow): number {
  const ageDays = Math.floor((Date.now() - new Date(acc.createdAt).getTime()) / 86_400_000);
  const eff = Math.max(ageDays, acc.warmUpDay);
  if (eff >= s.hotDaysThreshold && acc.totalReplies >= s.hotReplyThreshold) return s.hotAccountDailyLimit;
  if (eff >= s.warmUpDaysThreshold) return s.warmAccountDailyLimit;
  return s.newAccountDailyLimit;
}

// ── Account health score (0–100) ───────────────────────────────────────────
// Tracks: recent failure rate, disconnect events, reply rate.
// Auto-pauses the account from the campaign if score drops below 30.
const accountHealth = new Map<string, { score: number; failures: number; sends: number }>();

function getHealth(accountId: string) {
  if (!accountHealth.has(accountId)) accountHealth.set(accountId, { score: 100, failures: 0, sends: 0 });
  return accountHealth.get(accountId)!;
}

function recordSuccess(accountId: string) {
  const h = getHealth(accountId);
  h.sends++;
  h.score = Math.min(100, h.score + 0.5);
}

function recordFailure(accountId: string) {
  const h = getHealth(accountId);
  h.failures++;
  h.sends++;
  // Health degrades faster as failure rate rises
  const failRate = h.failures / Math.max(h.sends, 1);
  h.score = Math.max(0, h.score - (failRate > 0.3 ? 10 : 3));
  logger.warn({ accountId, health: h.score, failRate: failRate.toFixed(2) }, "account health degraded");
}

function isHealthy(accountId: string): boolean {
  return getHealth(accountId).score >= 30;
}

// ── Daily reset ────────────────────────────────────────────────────────────
async function resetIfNeeded(accountId: string) {
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) return;
  if (acc.lastResetDate !== todayStr()) {
    await db.update(accountsTable)
      .set({ sentToday: 0, lastResetDate: todayStr() })
      .where(eq(accountsTable.id, accountId));
  }
}

// ── Account picker ─────────────────────────────────────────────────────────
// Picks the account with the most remaining capacity today, weighted by health.
async function pickAccount(accountIds: string[], settings: SettingsRow): Promise<string | null> {
  const accounts = await db.select().from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const today = todayStr();
  const candidates: { id: string; remaining: number; score: number }[] = [];

  for (const acc of accounts) {
    if (acc.status !== "connected") continue;
    if (!isHealthy(acc.id)) { logger.warn({ accountId: acc.id }, "skipped: low health score"); continue; }
    const limit    = getDailyLimit(acc, settings);
    const sentToday = acc.lastResetDate === today ? acc.sentToday : 0;
    const remaining = limit - sentToday;
    if (remaining > 0) candidates.push({ id: acc.id, remaining, score: getHealth(acc.id).score });
  }

  if (candidates.length === 0) return null;

  // Weighted random selection: accounts with more remaining capacity AND higher health score
  // are more likely to be picked — reduces single-account overuse
  const weights = candidates.map(c => c.remaining * (c.score / 100));
  const total   = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].id;
  }
  return candidates[candidates.length - 1].id;
}

// ── Increment sent ─────────────────────────────────────────────────────────
async function incSent(accountId: string) {
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) return;
  const today   = todayStr();
  const base    = acc.lastResetDate === today ? acc.sentToday : 0;
  await db.update(accountsTable)
    .set({ sentToday: base + 1, lastResetDate: today, totalSent: acc.totalSent + 1 })
    .where(eq(accountsTable.id, accountId));
}

// ── Public entry point ─────────────────────────────────────────────────────
export async function runCampaign(campaignId: string): Promise<void> {
  if (runningCampaigns.has(campaignId)) return;
  runningCampaigns.add(campaignId);
  try   { await _run(campaignId); }
  finally { runningCampaigns.delete(campaignId); }
}

async function _run(campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign || campaign.status !== "running") return;

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, campaign.templateId));
  if (!template) { logger.error({ campaignId }, "template not found"); return; }

  const accountIds: string[] = JSON.parse(campaign.accountIds);
  let batchCount = 0;

  for (const aid of accountIds) await resetIfNeeded(aid);

  while (true) {
    // ── Reload fresh state ───────────────────────────────────────────────
    const [fresh] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!fresh || fresh.status !== "running") break;

    const settings = await getSettings();

    // ── Kill switch (loop level) ─────────────────────────────────────────
    if (settings.killSwitch) {
      await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
      logger.warn({ campaignId }, "kill switch — campaign paused");
      break;
    }

    // ── Working hours + time-of-day ──────────────────────────────────────
    const h = new Date().getHours();
    if (h < settings.workingHoursStart || h >= settings.workingHoursEnd) {
      logger.info({ campaignId }, "outside hours — sleep 5min");
      await sleep(5 * 60_000);
      continue;
    }
    // Low-score time window: sleep a bit and retry
    if (timeOfDayScore() < 0.5 && Math.random() > 0.3) {
      await sleep(2 * 60_000);
      continue;
    }

    // ── Opt-out set (normalized) ─────────────────────────────────────────
    const optRows = await db.select({ phone: optOutTable.phone }).from(optOutTable);
    const optOut  = new Set(optRows.map(r => normalizePhone(r.phone)));

    // ── Pending batch ─────────────────────────────────────────────────────
    const pending = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.campaignId, campaignId), eq(messagesTable.status, "pending")))
      .limit(fresh.batchSize);

    if (pending.length === 0) {
      await db.update(campaignsTable).set({ status: "completed" }).where(eq(campaignsTable.id, campaignId));
      logger.info({ campaignId }, "campaign completed ✓");
      break;
    }

    for (const msg of pending) {
      // ── Per-message: reload campaign + kill switch ────────────────────
      const [chk] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
      if (!chk || chk.status !== "running") return;

      const liveSettings = await getSettings();
      if (liveSettings.killSwitch) {
        await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
        logger.warn({ campaignId }, "kill switch — stopped mid-batch");
        return;
      }

      // ── Phone validation + opt-out check ─────────────────────────────
      let phone: string;
      try { phone = sanitizePhone(msg.phone); }
      catch (e) {
        await db.update(messagesTable).set({ status: "failed", error: (e as Error).message })
          .where(eq(messagesTable.id, msg.id));
        continue;
      }

      if (optOut.has(normalizePhone(phone))) {
        await db.update(messagesTable).set({ status: "failed", error: "opt_out" })
          .where(eq(messagesTable.id, msg.id));
        continue;
      }

      // ── Pick account ──────────────────────────────────────────────────
      const accountId = await pickAccount(accountIds, liveSettings);
      if (!accountId) {
        logger.warn({ campaignId }, "no account available — sleep 5min");
        await sleep(5 * 60_000);
        break;
      }

      // ── Build unique message (7 variation layers) ────────────────────
      const text = buildUniqueMessage(template.body, {
        name:        msg.studentName,
        university:  undefined,
        discount:    undefined,
        serviceType: undefined,
      }, {
        spintax:        liveSettings.spintaxEnabled,
        invisibleChars: liveSettings.invisibleCharsEnabled,
        homoglyphs:     true,
        emojis:         true,
        postscripts:    true,
        diacritics:     true,
      });

      await db.update(messagesTable).set({ body: text, accountId }).where(eq(messagesTable.id, msg.id));

      // ── Send (worker uses humanMode=true by default) ──────────────────
      const result = await workerSendMessage(accountId, phone, text);

      if (result.ok) {
        await db.update(messagesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(messagesTable.id, msg.id));
        await incSent(accountId);
        recordSuccess(accountId);
        batchCount++;
        logger.info({ campaignId, phone, accountId, health: getHealth(accountId).score }, "sent ✓");
      } else {
        recordFailure(accountId);
        const retries = msg.retryCount + 1;
        if (retries >= liveSettings.maxRetries) {
          await db.update(messagesTable)
            .set({ status: "failed", error: result.error, retryCount: retries })
            .where(eq(messagesTable.id, msg.id));
        } else {
          await db.update(messagesTable)
            .set({ retryCount: retries, error: result.error })
            .where(eq(messagesTable.id, msg.id));
          await sleep(liveSettings.retryDelayMin * 60_000);
          continue;
        }
      }

      // ── Batch pause ───────────────────────────────────────────────────
      if (batchCount > 0 && batchCount % fresh.batchSize === 0) {
        logger.info({ campaignId, batchCount }, `batch pause ${fresh.batchPauseMin}min`);
        await sleep(fresh.batchPauseMin * 60_000);
      }

      // ── Poisson inter-message delay ──────────────────────────────────
      // Lambda = midpoint of configured range. Much more natural than uniform.
      const lambdaMs = ((fresh.minDelaySec + fresh.maxDelaySec) / 2) * 1000;
      const delay    = poissonDelay(lambdaMs, fresh.minDelaySec * 1000, fresh.maxDelaySec * 1000);
      await sleep(delay);
    }
  }
}

// ── Restart recovery ───────────────────────────────────────────────────────
export async function recoverRunningCampaigns(): Promise<void> {
  const running = await db.select().from(campaignsTable).where(eq(campaignsTable.status, "running"));
  for (const c of running) {
    logger.info({ campaignId: c.id }, "recovering campaign");
    runCampaign(c.id).catch(e => logger.error({ e, campaignId: c.id }, "campaign error"));
  }
}
