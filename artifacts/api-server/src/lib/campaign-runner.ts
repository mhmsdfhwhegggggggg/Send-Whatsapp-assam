import { db } from "@workspace/db";
import {
  campaignsTable,
  messagesTable,
  accountsTable,
  settingsTable,
  templatesTable,
  optOutTable,
} from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import {
  applySpintax,
  fillVars,
  addInvisibleChars,
  sanitizePhone,
} from "./spintax";
import { workerSendMessage } from "./worker-client";
import { logger } from "./logger";

export const runningCampaigns = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isWorkingHour(start: number, end: number): boolean {
  const h = new Date().getHours();
  return h >= start && h < end;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normalize phone to pure digits for consistent matching */
function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-\+\(\)]/g, "");
}

/* ── Settings loader ─────────────────────────────────────────────────── */
async function getSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  return rows[0] ?? {
    newAccountDailyLimit:  20,
    warmAccountDailyLimit: 80,
    hotAccountDailyLimit:  150,
    warmUpDaysThreshold:   7,
    hotDaysThreshold:      30,
    hotReplyThreshold:     20,
    dailyLimitPerAccount:  80,
    workingHoursStart:     9,
    workingHoursEnd:       22,
    spintaxEnabled:        true,
    invisibleCharsEnabled: true,
    maxRetries:            3,
    retryDelayMin:         5,
    killSwitch:            false,
    dedupWindowDays:       7,
  };
}

/* ── Tiered daily limit per account ──────────────────────────────────────
 *  NEW  (< warmUpDaysThreshold days)                 → newAccountDailyLimit  (default 20)
 *  WARM (≥ warmUpDaysThreshold days)                 → warmAccountDailyLimit (default 80)
 *  HOT  (≥ hotDaysThreshold days + hotReplyThreshold replies) → hotAccountDailyLimit (150)
 * ─────────────────────────────────────────────────────────────────────── */
function getDailyLimit(
  acc: { warmUpDay: number; totalReplies: number; createdAt: Date },
  settings: Awaited<ReturnType<typeof getSettings>>,
): number {
  const ageDays = Math.floor(
    (Date.now() - new Date(acc.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const effectiveDay = Math.max(ageDays, acc.warmUpDay);

  if (
    effectiveDay >= settings.hotDaysThreshold &&
    acc.totalReplies >= settings.hotReplyThreshold
  ) {
    return settings.hotAccountDailyLimit;
  }
  if (effectiveDay >= settings.warmUpDaysThreshold) {
    return settings.warmAccountDailyLimit;
  }
  return settings.newAccountDailyLimit;
}

/* ── Daily counter reset ────────────────────────────────────────────── */
async function resetDailyCountIfNeeded(accountId: string) {
  const today = todayStr();
  const [acc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!acc) return;
  if (acc.lastResetDate !== today) {
    await db
      .update(accountsTable)
      .set({ sentToday: 0, lastResetDate: today })
      .where(eq(accountsTable.id, accountId));
  }
}

/* ── Account picker — enforces tiered limits ────────────────────────── */
async function pickAccount(
  accountIds: string[],
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<string | null> {
  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  for (const acc of accounts) {
    if (acc.status !== "connected") continue;

    const dailyLimit = getDailyLimit(acc, settings);
    const today = todayStr();
    const sentToday = acc.lastResetDate === today ? acc.sentToday : 0;

    if (sentToday < dailyLimit) {
      logger.debug(
        { accountId: acc.id, sentToday, dailyLimit, warmUpDay: acc.warmUpDay },
        "account selected",
      );
      return acc.id;
    }
  }
  return null;
}

/* ── Increment sent counter ─────────────────────────────────────────── */
async function incrementSentToday(accountId: string) {
  const [acc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!acc) return;
  const today = todayStr();
  const base = acc.lastResetDate === today ? acc.sentToday : 0;
  await db
    .update(accountsTable)
    .set({
      sentToday:     base + 1,
      lastResetDate: today,
      totalSent:     acc.totalSent + 1,
    })
    .where(eq(accountsTable.id, accountId));
}

/* ── Public: run campaign ───────────────────────────────────────────── */
export async function runCampaign(campaignId: string): Promise<void> {
  if (runningCampaigns.has(campaignId)) return;
  runningCampaigns.add(campaignId);
  try {
    await _runCampaign(campaignId);
  } finally {
    runningCampaigns.delete(campaignId);
  }
}

async function _runCampaign(campaignId: string): Promise<void> {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign || campaign.status !== "running") return;

  const [template] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, campaign.templateId));
  if (!template) {
    logger.error({ campaignId }, "template not found");
    return;
  }

  const accountIds = JSON.parse(campaign.accountIds) as string[];
  let batchCount = 0;

  // Reset daily counters for all accounts at start
  for (const accountId of accountIds) {
    await resetDailyCountIfNeeded(accountId);
  }

  while (true) {
    // ── Reload fresh campaign state ──
    const [fresh] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    if (!fresh || fresh.status !== "running") break;

    // ── Reload settings (picks up live changes + kill switch) ──
    const settings = await getSettings();

    // ── Kill switch: checked per-iteration ──
    if (settings.killSwitch) {
      logger.warn({ campaignId }, "kill switch active — pausing campaign");
      await db
        .update(campaignsTable)
        .set({ status: "paused" })
        .where(eq(campaignsTable.id, campaignId));
      break;
    }

    // ── Working hours check ──
    if (!isWorkingHour(settings.workingHoursStart, settings.workingHoursEnd)) {
      logger.info({ campaignId }, "outside working hours — sleeping 5min");
      await sleep(5 * 60 * 1000);
      continue;
    }

    // ── Load opt-out phones (normalized) ──
    const optOutRows = await db.select({ phone: optOutTable.phone }).from(optOutTable);
    const optOutPhones = new Set(optOutRows.map((r) => normalizePhone(r.phone)));

    // ── Fetch next pending batch ──
    const pending = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.campaignId, campaignId),
          eq(messagesTable.status, "pending"),
        ),
      )
      .limit(fresh.batchSize);

    if (pending.length === 0) {
      await db
        .update(campaignsTable)
        .set({ status: "completed" })
        .where(eq(campaignsTable.id, campaignId));
      logger.info({ campaignId }, "campaign completed");
      break;
    }

    for (const msg of pending) {
      // ── Per-message: reload campaign status ──
      const [chk] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId));
      if (!chk || chk.status !== "running") return;

      // ── Per-message: kill switch check (catches mid-batch toggles) ──
      const perMsgSettings = await getSettings();
      if (perMsgSettings.killSwitch) {
        logger.warn({ campaignId }, "kill switch — stopping mid-batch");
        await db
          .update(campaignsTable)
          .set({ status: "paused" })
          .where(eq(campaignsTable.id, campaignId));
        return;
      }

      // ── Sanitize + normalize phone ──
      let phone: string;
      try {
        phone = sanitizePhone(msg.phone);
      } catch (e) {
        await db
          .update(messagesTable)
          .set({ status: "failed", error: (e as Error).message })
          .where(eq(messagesTable.id, msg.id));
        continue;
      }

      // ── Skip opt-out numbers (normalized comparison) ──
      if (optOutPhones.has(normalizePhone(phone))) {
        await db
          .update(messagesTable)
          .set({ status: "failed", error: "opt_out" })
          .where(eq(messagesTable.id, msg.id));
        logger.info({ campaignId, phone }, "skipped: opt-out");
        continue;
      }

      // ── Pick available account ──
      const accountId = await pickAccount(accountIds, perMsgSettings);
      if (!accountId) {
        logger.warn({ campaignId }, "no account available — sleeping 5min");
        await sleep(5 * 60 * 1000);
        break;
      }

      // ── Build message text ──
      let text = template.body;
      if (perMsgSettings.spintaxEnabled) text = applySpintax(text);
      text = fillVars(text, {
        name:        msg.studentName,
        university:  undefined,
        discount:    undefined,
        serviceType: undefined,
      });
      if (perMsgSettings.invisibleCharsEnabled) text = addInvisibleChars(text);

      // ── Persist body + accountId, then send ──
      await db
        .update(messagesTable)
        .set({ body: text, accountId })
        .where(eq(messagesTable.id, msg.id));

      const result = await workerSendMessage(accountId, phone, text);

      if (result.ok) {
        await db
          .update(messagesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(messagesTable.id, msg.id));
        await incrementSentToday(accountId);
        batchCount++;
        logger.info({ campaignId, phone, accountId }, "message sent ✓");
      } else {
        const retries = msg.retryCount + 1;
        if (retries >= perMsgSettings.maxRetries) {
          await db
            .update(messagesTable)
            .set({ status: "failed", error: result.error, retryCount: retries })
            .where(eq(messagesTable.id, msg.id));
          logger.warn({ campaignId, msgId: msg.id }, "message failed permanently");
        } else {
          await db
            .update(messagesTable)
            .set({ retryCount: retries, error: result.error })
            .where(eq(messagesTable.id, msg.id));
          logger.warn({ campaignId, msgId: msg.id, retries }, "will retry");
          await sleep(perMsgSettings.retryDelayMin * 60 * 1000);
          continue;
        }
      }

      // ── Batch pause ──
      if (batchCount > 0 && batchCount % fresh.batchSize === 0) {
        logger.info({ campaignId, batchCount }, `batch pause ${fresh.batchPauseMin}min`);
        await sleep(fresh.batchPauseMin * 60 * 1000);
      }

      // ── Random inter-message delay ──
      const delay = randomBetween(fresh.minDelaySec, fresh.maxDelaySec) * 1000;
      await sleep(delay);
    }
  }
}

/* ── Recovery on server restart ─────────────────────────────────────── */
export async function recoverRunningCampaigns(): Promise<void> {
  const running = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.status, "running"));

  for (const c of running) {
    logger.info({ campaignId: c.id }, "recovering running campaign");
    runCampaign(c.id).catch((err) =>
      logger.error({ err, campaignId: c.id }, "campaign runner error"),
    );
  }
}
