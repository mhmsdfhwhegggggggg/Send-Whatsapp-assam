/**
 * campaign-runner.ts — PRODUCTION HARDENED v2
 *
 * Anti-ban layers applied here:
 *   1. Tiered daily limits (new/warm/hot) — enforces warm-up curve
 *   2. Poisson-distributed inter-message delays — not uniform random
 *   3. Time-of-day weighting — biased toward realistic waking hours
 *   4. Per-message kill-switch check — halts mid-batch within seconds
 *   5. Persistent account health score (DB-backed, survives restarts)
 *   6. Opt-out matching with phone normalization
 *   7. Full message variation via buildUniqueMessage (7 layers)
 *   8. Human mode flag sent to worker (/send with humanMode:true)
 *   9. [NEW v2] Phone validation before send (workerCheckPhone)
 *  10. [NEW v2] Spam score gate: blocks high-risk messages pre-send
 *  11. [NEW v2] Organic breathing between messages (presence toggle)
 *  12. [NEW v2] Account events logged to DB for early-warning system
 *  13. [NEW v2] Account suspension check (suspendedUntil column)
 *  14. [NEW v2] Contextual personalization (city, university, serviceType)
 */

import { db } from "@workspace/db";
import {
  campaignsTable, messagesTable, accountsTable,
  settingsTable, templatesTable, optOutTable, studentsTable,
} from "@workspace/db/schema";
import { eq, inArray, and, sql, or } from "drizzle-orm";
import { buildUniqueMessage, sanitizePhone, calculateSpamScore } from "./spintax";
import { workerSendMessage, workerCheckPhone } from "./worker-client";
import { logAccountEvent, updateHealthScore, hasHighDisconnectRate } from "./warm-up";
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

// ── Poisson-distributed delay ──────────────────────────────────────────────
function poissonDelay(lambdaMs: number, minMs: number, maxMs: number): number {
  const raw = -Math.log(1 - Math.random()) * lambdaMs;
  return Math.min(Math.max(raw, minMs), maxMs);
}

// ── Time-of-day score: peaks at 9-12h, 14-17h, 19-21h ───────────────────
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
  phoneValidationEnabled: boolean; healthScoreThreshold: number; cooldownHours: number;
};

async function getSettings(): Promise<SettingsRow> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  return rows[0] ?? {
    newAccountDailyLimit: 20, warmAccountDailyLimit: 80, hotAccountDailyLimit: 150,
    warmUpDaysThreshold: 7, hotDaysThreshold: 30, hotReplyThreshold: 20,
    workingHoursStart: 9, workingHoursEnd: 22,
    spintaxEnabled: true, invisibleCharsEnabled: true,
    maxRetries: 3, retryDelayMin: 5, killSwitch: false, dedupWindowDays: 7,
    phoneValidationEnabled: true, healthScoreThreshold: 40, cooldownHours: 24,
  };
}

// ── Tiered daily limit ─────────────────────────────────────────────────────
type AccRow = {
  warmUpDay: number; totalReplies: number; createdAt: Date;
  healthScore: number; suspendedUntil: Date | null;
};

function getDailyLimit(acc: AccRow, s: SettingsRow): number {
  const ageDays = Math.floor((Date.now() - new Date(acc.createdAt).getTime()) / 86_400_000);
  const eff = Math.max(ageDays, acc.warmUpDay);
  if (eff >= s.hotDaysThreshold && acc.totalReplies >= s.hotReplyThreshold) return s.hotAccountDailyLimit;
  if (eff >= s.warmUpDaysThreshold) return s.warmAccountDailyLimit;
  return s.newAccountDailyLimit;
}

// ── Account suspension check ───────────────────────────────────────────────
function isSuspended(acc: AccRow): boolean {
  if (!acc.suspendedUntil) return false;
  return new Date(acc.suspendedUntil) > new Date();
}

// ── Account health score (persistent + cache) ─────────────────────────────
// Source of truth: accountsTable.healthScore (persisted in DB).
// In-memory cache used only to reduce DB reads per message.
// CRITICAL: cache is ALWAYS seeded from DB on first access — never defaults
// to 100. This ensures degraded accounts stay degraded across server restarts.
const sessionHealthCache = new Map<string, number>();

/**
 * Hydrate cache from DB for an account if not already cached.
 * Must be called before any health read/write for correctness after restart.
 */
async function hydrateHealthCache(accountId: string): Promise<number> {
  if (sessionHealthCache.has(accountId)) return sessionHealthCache.get(accountId)!;
  const [acc] = await db.select({ healthScore: accountsTable.healthScore })
    .from(accountsTable).where(eq(accountsTable.id, accountId));
  const score = acc?.healthScore ?? 100;
  sessionHealthCache.set(accountId, score);
  return score;
}

function getCachedHealth(accountId: string): number {
  // Cache must already be hydrated (via hydrateHealthCache) before calling this.
  return sessionHealthCache.get(accountId) ?? 100;
}

async function recordSuccess(accountId: string, settings: SettingsRow): Promise<void> {
  // Ensure we start from the real persisted score, not 100
  const current  = await hydrateHealthCache(accountId);
  const newScore = Math.min(100, current + 0.5);
  sessionHealthCache.set(accountId, newScore);
  // Persist every ~10 successes to reduce DB writes
  if (Math.random() < 0.1) {
    await updateHealthScore(accountId, +0.5, settings);
    await logAccountEvent(accountId, "send_ok");
  }
}

async function recordFailure(accountId: string, settings: SettingsRow, error?: string): Promise<void> {
  // Ensure we start from the real persisted score, not 100
  const current  = await hydrateHealthCache(accountId);
  const failRate = 1 - (current / 100);
  const delta    = failRate > 0.3 ? -10 : -3;
  const newScore = Math.max(0, current + delta);
  sessionHealthCache.set(accountId, newScore);

  // Always persist failures immediately (high-signal events)
  await updateHealthScore(accountId, delta, settings);
  await logAccountEvent(accountId, "send_fail", error);

  logger.warn({
    accountId, health: newScore, failRate: failRate.toFixed(2), error,
  }, "account health degraded");
}

async function isHealthy(accountId: string, dbScore: number, threshold: number): Promise<boolean> {
  // Hydrate from DB score on cache miss — never assume 100
  if (!sessionHealthCache.has(accountId)) sessionHealthCache.set(accountId, dbScore);
  return getCachedHealth(accountId) >= threshold;
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
async function pickAccount(accountIds: string[], settings: SettingsRow): Promise<string | null> {
  const accounts = await db.select().from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const today = todayStr();
  const candidates: { id: string; remaining: number; score: number }[] = [];

  for (const acc of accounts) {
    if (acc.status !== "connected") continue;
    if (isSuspended(acc)) {
      logger.info({ accountId: acc.id, until: acc.suspendedUntil }, "skipped: account suspended");
      continue;
    }
    const dbScore = acc.healthScore ?? 100;
    if (!(await isHealthy(acc.id, dbScore, settings.healthScoreThreshold))) {
      logger.warn({ accountId: acc.id, score: dbScore }, "skipped: low health score");
      continue;
    }

    // Check disconnect rate (early warning signal)
    const highDisconnect = await hasHighDisconnectRate(acc.id);
    if (highDisconnect) {
      logger.warn({ accountId: acc.id }, "skipped: high disconnect rate in past 2h");
      await logAccountEvent(acc.id, "health_warning", "high disconnect rate");
      continue;
    }

    const limit     = getDailyLimit(acc, settings);
    const sentToday = acc.lastResetDate === today ? acc.sentToday : 0;
    const remaining = limit - sentToday;
    const score     = getCachedHealth(acc.id, dbScore);
    if (remaining > 0) candidates.push({ id: acc.id, remaining, score });
  }

  if (candidates.length === 0) return null;

  // Weighted random: accounts with more remaining capacity AND higher health
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
  const today = todayStr();
  const base  = acc.lastResetDate === today ? acc.sentToday : 0;
  await db.update(accountsTable)
    .set({ sentToday: base + 1, lastResetDate: today, totalSent: acc.totalSent + 1 })
    .where(eq(accountsTable.id, accountId));
}

// ── Organic breathing ──────────────────────────────────────────────────────
// 15% chance between messages to do something "organic" on WhatsApp.
// This simulates the account being a real person who does other things.
async function organicBreathe(accountId: string): Promise<void> {
  const r = Math.random();
  if (r < 0.08) {
    // 8%: brief offline moment (phone put down, picked up)
    logger.debug({ accountId }, "organic: brief offline");
    await sleep(20000 + Math.random() * 40000); // 20–60 seconds
  } else if (r < 0.13) {
    // 5%: extended pause (2–5 min, phone on table)
    logger.debug({ accountId }, "organic: extended pause");
    await sleep(2 * 60000 + Math.random() * 3 * 60000);
  }
  // 87%: just continue normally
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

  // Pre-validate: check spam score on base template
  const baseSpamScore = calculateSpamScore(template.body);
  if (baseSpamScore.risk === "high") {
    logger.warn({ campaignId, score: baseSpamScore.score, reasons: baseSpamScore.reasons },
      "campaign BLOCKED: base template has high spam score");
    await db.update(campaignsTable)
      .set({ status: "paused" })
      .where(eq(campaignsTable.id, campaignId));
    return;
  }

  while (true) {
    // ── Reload fresh state ───────────────────────────────────────────────
    const [fresh] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!fresh || fresh.status !== "running") break;

    const settings = await getSettings();

    // ── Kill switch ──────────────────────────────────────────────────────
    if (settings.killSwitch) {
      await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
      logger.warn({ campaignId }, "kill switch — campaign paused");
      break;
    }

    // ── Working hours ────────────────────────────────────────────────────
    const h = new Date().getHours();
    if (h < settings.workingHoursStart || h >= settings.workingHoursEnd) {
      logger.info({ campaignId }, "outside hours — sleep 5min");
      await sleep(5 * 60_000);
      continue;
    }
    // Low-score time window: sleep briefly and retry
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

      // ── WhatsApp phone validation (NEW v2) ───────────────────────────
      // Only send to numbers that are actually on WhatsApp.
      // Sending to non-WA numbers raises error rate and triggers spam detection.
      if (liveSettings.phoneValidationEnabled) {
        const check = await workerCheckPhone(accountId, phone);
        if (!check.registered) {
          logger.info({ campaignId, phone }, "skipping: not on WhatsApp");
          await db.update(messagesTable)
            .set({ status: "failed", error: "not_on_whatsapp", phoneVerified: false })
            .where(eq(messagesTable.id, msg.id));
          continue;
        }
        // Mark as verified
        await db.update(messagesTable)
          .set({ phoneVerified: true })
          .where(eq(messagesTable.id, msg.id));
      }

      // ── Fetch student data for contextual personalization ─────────────
      let studentVars: Record<string, string | undefined> = { name: msg.studentName };
      if (msg.studentId) {
        const [student] = await db.select().from(studentsTable)
          .where(eq(studentsTable.id, msg.studentId));
        if (student) {
          studentVars = {
            name:        student.name,
            university:  student.university  ?? undefined,
            discount:    student.discount    ?? undefined,
            serviceType: student.serviceType ?? undefined,
            city:        student.city        ?? undefined,
          };
        }
      }

      // ── Build unique message (7 variation layers) ────────────────────
      const text = buildUniqueMessage(template.body, studentVars, {
        spintax:        liveSettings.spintaxEnabled,
        invisibleChars: liveSettings.invisibleCharsEnabled,
        homoglyphs:     true,
        emojis:         true,
        postscripts:    true,
        diacritics:     true,
      });

      // ── Spam score gate (NEW v2) ─────────────────────────────────────
      // Check the final composed message, not just the template.
      const spamScore = calculateSpamScore(text);
      if (spamScore.risk === "high") {
        logger.warn({ campaignId, phone, score: spamScore.score, reasons: spamScore.reasons },
          "message skipped: high spam score");
        // Don't fail permanently — just skip this iteration, adjust template
        await sleep(5000);
        continue;
      }

      await db.update(messagesTable).set({ body: text, accountId }).where(eq(messagesTable.id, msg.id));

      // ── Organic breathing (NEW v2) ───────────────────────────────────
      // Occasionally do "other things" before sending the next message.
      await organicBreathe(accountId);

      // ── Send ─────────────────────────────────────────────────────────
      const result = await workerSendMessage(accountId, phone, text);

      if (result.ok) {
        await db.update(messagesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(messagesTable.id, msg.id));
        await incSent(accountId);
        await recordSuccess(accountId, liveSettings);
        batchCount++;
        logger.info({
          campaignId, phone, accountId,
          health: getCachedHealth(accountId),
          spamScore: spamScore.score,
        }, "sent ✓");
      } else {
        await recordFailure(accountId, liveSettings, result.error);
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
