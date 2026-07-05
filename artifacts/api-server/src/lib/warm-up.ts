/**
 * warm-up.ts — PRODUCTION HARDENED v2
 *
 * Dynamic daily limit: NEW=20/day, WARM=80/day, HOT=150/day
 *
 * New in v2:
 *   - Persistent health score (stored in DB, survives server restarts)
 *   - logAccountEvent() for the account_events audit trail
 *   - Early warning: suspend accounts that show stress signals
 *   - performWarmUpActions() for organic WhatsApp behaviour during warm-up
 */
import { db } from "@workspace/db";
import { accountsTable, accountEventsTable } from "@workspace/db/schema";
import { eq, sql, and, gte, desc } from "drizzle-orm";
import { logger } from "./logger";

export interface WarmUpSettings {
  newAccountDailyLimit:   number;
  warmAccountDailyLimit:  number;
  hotAccountDailyLimit:   number;
  warmUpDaysThreshold:    number;
  hotDaysThreshold:       number;
  hotReplyThreshold:      number;
  healthScoreThreshold:   number;
  cooldownHours:          number;
}

export type AccountRow = {
  id: string; warmUpDay: number; totalReplies: number; totalSent: number;
  createdAt: Date; healthScore: number; suspendedUntil: Date | null;
};

// ── Tier classification ────────────────────────────────────────────────────
export function getDailyLimitForAccount(account: AccountRow, settings: WarmUpSettings): number {
  const ageDays = Math.floor((Date.now() - new Date(account.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays < settings.warmUpDaysThreshold || account.warmUpDay < settings.warmUpDaysThreshold)
    return settings.newAccountDailyLimit;
  if (ageDays >= settings.hotDaysThreshold && account.totalReplies >= settings.hotReplyThreshold)
    return settings.hotAccountDailyLimit;
  return settings.warmAccountDailyLimit;
}

export function getAccountTier(account: AccountRow, settings: WarmUpSettings): "new" | "warm" | "hot" {
  const ageDays = Math.floor((Date.now() - new Date(account.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays < settings.warmUpDaysThreshold || account.warmUpDay < settings.warmUpDaysThreshold) return "new";
  if (ageDays >= settings.hotDaysThreshold && account.totalReplies >= settings.hotReplyThreshold) return "hot";
  return "warm";
}

// ── Daily warm-up tick ─────────────────────────────────────────────────────
export async function tickWarmUpDays(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.update(accountsTable)
    .set({ warmUpDay: sql`warm_up_day + 1` })
    .where(sql`last_reset_date != ${today} OR last_reset_date IS NULL`)
    .returning({ id: accountsTable.id });
  logger.info({ count: result.length }, "warm-up: ticked warmUpDay");
}

// ── Reply tracking ─────────────────────────────────────────────────────────
export async function recordReply(accountId: string): Promise<void> {
  await db.update(accountsTable)
    .set({ totalReplies: sql`total_replies + 1` })
    .where(eq(accountsTable.id, accountId));
}

// ── Account event logging ──────────────────────────────────────────────────
// Persists every significant account lifecycle event for monitoring and
// early-warning analysis. Survives server restarts unlike in-memory maps.
export async function logAccountEvent(
  accountId: string,
  eventType: "connected" | "disconnected" | "qr_requested" | "logged_out" |
             "send_ok" | "send_fail" | "health_warning" | "suspended",
  detail?: string,
): Promise<void> {
  try {
    await db.insert(accountEventsTable).values({ accountId, eventType, detail });
  } catch (e) {
    // Non-critical — don't crash the caller
    logger.warn({ e, accountId, eventType }, "logAccountEvent failed");
  }
}

// ── Persistent health score update ────────────────────────────────────────
export async function updateHealthScore(
  accountId: string,
  delta: number,
  settings: WarmUpSettings,
): Promise<number> {
  const [acc] = await db.select({ healthScore: accountsTable.healthScore })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!acc) return 100;

  const newScore = Math.min(100, Math.max(0, (acc.healthScore ?? 100) + delta));
  await db.update(accountsTable)
    .set({ healthScore: newScore })
    .where(eq(accountsTable.id, accountId));

  // Trigger suspension if score falls below threshold
  if (newScore < settings.healthScoreThreshold) {
    const suspendedUntil = new Date(Date.now() + settings.cooldownHours * 3600 * 1000);
    await db.update(accountsTable)
      .set({ suspendedUntil })
      .where(eq(accountsTable.id, accountId));
    await logAccountEvent(accountId, "suspended",
      JSON.stringify({ score: newScore, cooldownHours: settings.cooldownHours }));
    logger.warn({ accountId, score: newScore, suspendedUntil }, "account suspended: health critical");
  }

  return newScore;
}

// ── Early warning: disconnect rate check ──────────────────────────────────
// Returns true if the account shows too many disconnects in the past 2 hours.
export async function hasHighDisconnectRate(accountId: string): Promise<boolean> {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  const events = await db.select({ eventType: accountEventsTable.eventType })
    .from(accountEventsTable)
    .where(and(
      eq(accountEventsTable.accountId, accountId),
      gte(accountEventsTable.createdAt, twoHoursAgo),
    ))
    .orderBy(desc(accountEventsTable.createdAt))
    .limit(20);

  const disconnects = events.filter(e => e.eventType === "disconnected").length;
  return disconnects >= 3; // 3+ disconnects in 2h = stress signal
}

// ── Organic warm-up actions ────────────────────────────────────────────────
// During warm-up phase, perform WhatsApp status updates to simulate genuine
// account use beyond just sending messages.
// Call this once per day during the Seed and Sprout phases.
export async function performWarmUpActions(
  client: any,
  account: AccountRow,
  log: (level: string, msg: string, extra?: object) => void,
): Promise<void> {
  const ageDays = Math.floor((Date.now() - new Date(account.createdAt).getTime()) / 86400000);

  if (ageDays <= 3) {
    // Seed phase: just check state — confirm session is alive
    try {
      const state = await client.getState();
      log("info", "warm-up organic: state check", { accountId: account.id, state });
    } catch {}

  } else if (ageDays <= 7) {
    // Sprout phase: update "About" status to simulate real usage
    const statuses = [
      "متاح", "مشغول الآن", "في الاجتماع", "🎓 طالب جامعي",
      "📚 أتعلم", "يمكنك التواصل معي", "دائماً هنا",
    ];
    const picked = statuses[Math.floor(Math.random() * statuses.length)];
    try {
      await (client as any).setStatus(picked);
      log("info", "warm-up organic: updated status", { accountId: account.id, status: picked });
    } catch (e) {
      log("debug", "warm-up organic: setStatus skipped", { accountId: account.id });
    }

  } else if (ageDays <= 14) {
    // Grow phase: mark a random past chat as read (simulate scrolling through chats)
    try {
      const chats = await client.getChats();
      const unread = chats.filter((c: any) => c.unreadCount > 0).slice(0, 3);
      for (const chat of unread) {
        await chat.sendSeen();
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }
      log("info", "warm-up organic: read chats", { accountId: account.id, count: unread.length });
    } catch {}
  }
}
