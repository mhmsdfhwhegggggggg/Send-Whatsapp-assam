/**
 * campaign-runner.ts — PRODUCTION HARDENED v5
 *
 * إصلاحات v5:
 *   1. [إصلاح] getCachedHealth — argument واحد فقط (bug fix)
 *   2. [إصلاح] organicBreathe — presence signals حقيقية عبر workerSetPresence
 *   3. [إصلاح] timezone — currentHourInTz() يستخدم SEND_TIMEZONE
 *   4. [جديد]  dedup check — فحص الإرسال لنفس الرقم خلال dedupWindowDays
 *   5. [إصلاح] retry — يستبعد الحساب الفاشل من المحاولة التالية
 *   6. [جديد]  hourly limits — حد أقصى للرسائل في الساعة لكل حساب حسب الـ tier
 *              NEW=4/h, WARM=20/h, HOT=40/h — أهم إصلاح لمنع الحظر
 */

import { db } from "@workspace/db";
import {
  campaignsTable, messagesTable, accountsTable,
  settingsTable, templatesTable, optOutTable, studentsTable,
} from "@workspace/db/schema";
import { eq, inArray, and, sql, gte } from "drizzle-orm";
import { buildUniqueMessage, sanitizePhone, calculateSpamScore } from "./spintax";
import { workerSendMessage, workerCheckPhone, workerSetPresence } from "./worker-client";
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

// ── إصلاح: Timezone صحيح لساعات العمل ────────────────────────────────────
const SEND_TIMEZONE = process.env.SEND_TIMEZONE ?? "Asia/Riyadh";

function currentHourInTz(timezone = SEND_TIMEZONE): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", hour12: false,
    }).format(new Date());
    return parseInt(formatted, 10);
  } catch {
    return new Date().getHours();
  }
}

// ── Poisson delay ──────────────────────────────────────────────────────────
function poissonDelay(lambdaMs: number, minMs: number, maxMs: number): number {
  const raw = -Math.log(1 - Math.random()) * lambdaMs;
  return Math.min(Math.max(raw, minMs), maxMs);
}

// ── Time-of-day multiplier ─────────────────────────────────────────────────
function timeOfDayScore(): number {
  const h = currentHourInTz();
  const peaks = [[9, 12], [14, 17], [19, 21]] as [number, number][];
  for (const [s, e] of peaks) {
    if (h >= s && h < e) return 1;
    if (h === s - 1 || h === e) return 0.5;
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

// ── Tier + daily limit ─────────────────────────────────────────────────────
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

// ── [جديد v5] Hourly limits — أهم ميزة لمنع الحظر ────────────────────────
// WhatsApp يكتشف الـ automation بسرعة الإرسال في الساعة أكثر من المجموع اليومي.
// حسابات جديدة تُحظر فوراً إذا أرسلت > 5 رسائل/ساعة في الأسبوع الأول.
//
// الحدود الآمنة (بناءً على تحليل حالات الحظر):
//   NEW  (0–7 أيام):   4 رسائل/ساعة
//   WARM (7–30 أيام): 20 رسائل/ساعة
//   HOT  (30+ يوم):   40 رسائل/ساعة
interface HourlyEntry { count: number; hourStart: number }
const hourlySentMap = new Map<string, HourlyEntry>();

function getHourlyLimitForTier(acc: AccRow, s: SettingsRow): number {
  const ageDays = Math.floor((Date.now() - new Date(acc.createdAt).getTime()) / 86_400_000);
  const eff = Math.max(ageDays, acc.warmUpDay);
  if (eff >= s.hotDaysThreshold && acc.totalReplies >= s.hotReplyThreshold) return 40;
  if (eff >= s.warmUpDaysThreshold) return 20;
  return 4;   // new accounts: max 4/hour — ultra-conservative
}

function getHourlySent(accountId: string): number {
  const now   = Date.now();
  const entry = hourlySentMap.get(accountId);
  if (!entry || now - entry.hourStart >= 3_600_000) return 0;
  return entry.count;
}

function incHourlySent(accountId: string): void {
  const now   = Date.now();
  const entry = hourlySentMap.get(accountId);
  if (!entry || now - entry.hourStart >= 3_600_000) {
    hourlySentMap.set(accountId, { count: 1, hourStart: now });
  } else {
    entry.count++;
  }
}

function msUntilNextHour(accountId: string): number {
  const entry = hourlySentMap.get(accountId);
  if (!entry) return 0;
  return Math.max(0, 3_600_000 - (Date.now() - entry.hourStart));
}

// ── Account suspension ─────────────────────────────────────────────────────
function isSuspended(acc: AccRow): boolean {
  if (!acc.suspendedUntil) return false;
  return new Date(acc.suspendedUntil) > new Date();
}

// ── Health score (memory + DB) ─────────────────────────────────────────────
const sessionHealthCache = new Map<string, number>();

async function hydrateHealthCache(accountId: string): Promise<number> {
  if (sessionHealthCache.has(accountId)) return sessionHealthCache.get(accountId)!;
  const [acc] = await db.select({ healthScore: accountsTable.healthScore })
    .from(accountsTable).where(eq(accountsTable.id, accountId));
  const score = acc?.healthScore ?? 100;
  sessionHealthCache.set(accountId, score);
  return score;
}

function getCachedHealth(accountId: string): number {
  return sessionHealthCache.get(accountId) ?? 100;
}

async function recordSuccess(accountId: string, settings: SettingsRow): Promise<void> {
  const current  = await hydrateHealthCache(accountId);
  const newScore = Math.min(100, current + 0.5);
  sessionHealthCache.set(accountId, newScore);
  if (Math.random() < 0.1) {
    await updateHealthScore(accountId, +0.5, settings);
    await logAccountEvent(accountId, "send_ok");
  }
}

async function recordFailure(accountId: string, settings: SettingsRow, error?: string): Promise<void> {
  const current  = await hydrateHealthCache(accountId);
  const failRate = 1 - (current / 100);
  const delta    = failRate > 0.3 ? -10 : -3;
  const newScore = Math.max(0, current + delta);
  sessionHealthCache.set(accountId, newScore);
  await updateHealthScore(accountId, delta, settings);
  await logAccountEvent(accountId, "send_fail", error);
  logger.warn({ accountId, health: newScore, error }, "account health degraded");
}

async function isHealthy(accountId: string, dbScore: number, threshold: number): Promise<boolean> {
  if (!sessionHealthCache.has(accountId)) sessionHealthCache.set(accountId, dbScore);
  return getCachedHealth(accountId) >= threshold;
}

// ── Daily reset ────────────────────────────────────────────────────────────
async function resetIfNeeded(accountId: string) {
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) return;
  const today = todayStr();
  if (acc.lastResetDate !== today) {
    await db.update(accountsTable).set({ sentToday: 0, lastResetDate: today })
      .where(eq(accountsTable.id, accountId));
  }
}

// ── Dedup check ────────────────────────────────────────────────────────────
async function isRecentlySent(phone: string, dedupWindowDays: number): Promise<boolean> {
  if (dedupWindowDays <= 0) return false;
  const since = new Date(Date.now() - dedupWindowDays * 86_400_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.phone, phone),
      eq(messagesTable.status, "sent"),
      gte(messagesTable.sentAt, since),
    ));
  return (row?.count ?? 0) > 0;
}

// ── Account picker ─────────────────────────────────────────────────────────
async function pickAccount(
  accountIds: string[],
  settings: SettingsRow,
  excludeIds: Set<string> = new Set(),
): Promise<string | null> {
  const accounts = await db.select().from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const today = todayStr();
  const candidates: { id: string; remaining: number; hourlyRemaining: number; score: number }[] = [];

  for (const acc of accounts) {
    if (excludeIds.has(acc.id)) continue;
    if (acc.status !== "connected") continue;
    if (isSuspended(acc)) { logger.info({ accountId: acc.id, until: acc.suspendedUntil }, "skipped: suspended"); continue; }

    const dbScore = acc.healthScore ?? 100;
    if (!(await isHealthy(acc.id, dbScore, settings.healthScoreThreshold))) {
      logger.warn({ accountId: acc.id, score: dbScore }, "skipped: low health"); continue;
    }

    if (await hasHighDisconnectRate(acc.id)) {
      logger.warn({ accountId: acc.id }, "skipped: high disconnect rate");
      await logAccountEvent(acc.id, "health_warning", "high disconnect rate");
      continue;
    }

    const dailyLimit   = getDailyLimit(acc, settings);
    const sentToday    = acc.lastResetDate === today ? acc.sentToday : 0;
    const dailyLeft    = dailyLimit - sentToday;

    // [جديد v5] تحقق من الحد الساعي
    const hourlyLimit  = getHourlyLimitForTier(acc, settings);
    const hourlySent   = getHourlySent(acc.id);
    const hourlyLeft   = hourlyLimit - hourlySent;

    if (dailyLeft > 0 && hourlyLeft > 0) {
      const score = getCachedHealth(acc.id);
      candidates.push({ id: acc.id, remaining: dailyLeft, hourlyRemaining: hourlyLeft, score });
    } else if (hourlyLeft <= 0) {
      logger.info({
        accountId: acc.id,
        hourlySent,
        hourlyLimit,
        nextHourIn: `${Math.round(msUntilNextHour(acc.id) / 60000)}min`,
      }, "skipped: hourly limit reached");
    }
  }

  if (candidates.length === 0) return null;

  // وزن: daily_remaining × hourly_remaining × health
  const weights = candidates.map(c =>
    Math.sqrt(c.remaining) * Math.sqrt(c.hourlyRemaining) * (c.score / 100),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].id;
  }
  return candidates[candidates.length - 1].id;
}

// ── Increment sent (daily + hourly) ───────────────────────────────────────
async function incSent(accountId: string) {
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) return;
  const today = todayStr();
  const base  = acc.lastResetDate === today ? acc.sentToday : 0;
  await db.update(accountsTable)
    .set({ sentToday: base + 1, lastResetDate: today, totalSent: (acc.totalSent ?? 0) + 1 })
    .where(eq(accountsTable.id, accountId));
  // [جديد v5] تحديث العداد الساعي في الذاكرة
  incHourlySent(accountId);
}

// ── Organic breathing — presence signals حقيقية ───────────────────────────
async function organicBreathe(accountId: string): Promise<void> {
  const r = Math.random();
  if (r < 0.08) {
    logger.debug({ accountId }, "organic: brief offline");
    await workerSetPresence(accountId, false);
    await sleep(20000 + Math.random() * 40000);
    await workerSetPresence(accountId, true);
  } else if (r < 0.13) {
    logger.debug({ accountId }, "organic: extended pause");
    await workerSetPresence(accountId, false);
    await sleep(2 * 60000 + Math.random() * 3 * 60000);
    await workerSetPresence(accountId, true);
  }
}

// ── Public entry points ────────────────────────────────────────────────────
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

  for (const aid of accountIds) await resetIfNeeded(aid);

  // فحص spam على القالب الأساسي
  const baseSpam = calculateSpamScore(template.body);
  if (baseSpam.risk === "high") {
    logger.warn({ campaignId, score: baseSpam.score }, "BLOCKED: high spam score template");
    await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
    return;
  }

  while (true) {
    const [fresh] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!fresh || fresh.status !== "running") break;

    const settings = await getSettings();

    if (settings.killSwitch) {
      await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
      logger.warn({ campaignId }, "kill switch — paused");
      break;
    }

    // ── Working hours ────────────────────────────────────────────────────
    const currentHour = currentHourInTz();
    if (currentHour < settings.workingHoursStart || currentHour >= settings.workingHoursEnd) {
      logger.info({ campaignId, currentHour, timezone: SEND_TIMEZONE }, "outside hours — sleep 5min");
      await sleep(5 * 60_000);
      continue;
    }

    if (timeOfDayScore() < 0.5 && Math.random() > 0.3) {
      await sleep(2 * 60_000);
      continue;
    }

    // ── Opt-out ──────────────────────────────────────────────────────────
    const optRows = await db.select({ phone: optOutTable.phone }).from(optOutTable);
    const optOut  = new Set(optRows.map(r => normalizePhone(r.phone)));

    // ── Pending batch ────────────────────────────────────────────────────
    const pending = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.campaignId, campaignId), eq(messagesTable.status, "pending")))
      .limit(fresh.batchSize);

    if (pending.length === 0) {
      await db.update(campaignsTable).set({ status: "completed" }).where(eq(campaignsTable.id, campaignId));
      logger.info({ campaignId }, "campaign completed ✓");
      break;
    }

    for (const msg of pending) {
      const [chk] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
      if (!chk || chk.status !== "running") return;

      const liveSettings = await getSettings();
      if (liveSettings.killSwitch) {
        await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaignId));
        return;
      }

      // ── Phone validation ──────────────────────────────────────────────
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

      // ── Dedup ─────────────────────────────────────────────────────────
      if (liveSettings.dedupWindowDays > 0) {
        if (await isRecentlySent(phone, liveSettings.dedupWindowDays)) {
          await db.update(messagesTable)
            .set({ status: "failed", error: `dedup: sent within last ${liveSettings.dedupWindowDays} days` })
            .where(eq(messagesTable.id, msg.id));
          continue;
        }
      }

      // ── Pick account (مع استبعاد الحسابات الفاشلة في هذه الرسالة) ────
      const failedAccountsThisMsg = new Set<string>();
      let accountId = await pickAccount(accountIds, liveSettings, failedAccountsThisMsg);

      if (!accountId) {
        // قد يكون كل الحسابات وصلت حدها الساعي أو اليومي.
        // إصلاح: كان break يُنهي الحملة بالكامل — الصح هو continue (انتظار ثم إعادة المحاولة)
        // نحسب أقصر وقت انتظار قبل أن تُفتح نافذة ساعية لأي حساب.
        const minWait = Math.min(
          ...[...hourlySentMap.entries()]
            .filter(([id]) => accountIds.includes(id))
            .map(([, entry]) => Math.max(0, 3_600_000 - (Date.now() - entry.hourStart))),
          2 * 60_000,  // fallback: دقيقتان
        );
        logger.warn({ campaignId, waitMs: minWait },
          "no account available (hourly/daily limits?) — sleeping until a slot opens");
        await sleep(minWait + 5000); // +5s هامش أمان
        continue; // أعد الـ while loop (لا تُنهِ الحملة)
      }

      // ── WhatsApp phone check ──────────────────────────────────────────
      if (liveSettings.phoneValidationEnabled) {
        const check = await workerCheckPhone(accountId, phone);
        if (!check.registered) {
          await db.update(messagesTable)
            .set({ status: "failed", error: "not_on_whatsapp", phoneVerified: false })
            .where(eq(messagesTable.id, msg.id));
          continue;
        }
        await db.update(messagesTable).set({ phoneVerified: true }).where(eq(messagesTable.id, msg.id));
      }

      // ── Student vars ──────────────────────────────────────────────────
      let studentVars: Record<string, string | undefined> = { name: msg.studentName };
      if (msg.studentId) {
        const [student] = await db.select().from(studentsTable)
          .where(eq(studentsTable.id, msg.studentId));
        if (student) studentVars = {
          name: student.name, university: student.university ?? undefined,
          discount: student.discount ?? undefined, serviceType: student.serviceType ?? undefined,
          city: student.city ?? undefined,
        };
      }

      // ── Build message ─────────────────────────────────────────────────
      const text = buildUniqueMessage(template.body, studentVars, {
        spintax: liveSettings.spintaxEnabled,
        invisibleChars: liveSettings.invisibleCharsEnabled,
        homoglyphs: true, emojis: true, postscripts: true, diacritics: true,
      });

      const spamScore = calculateSpamScore(text);
      if (spamScore.risk === "high") {
        logger.warn({ campaignId, phone, score: spamScore.score }, "msg skipped: high spam score");
        await sleep(5000);
        continue;
      }

      await db.update(messagesTable).set({ body: text, accountId })
        .where(eq(messagesTable.id, msg.id));

      // ── Organic breathing ─────────────────────────────────────────────
      await organicBreathe(accountId);

      // ── Send — مع retry بحساب مختلف ──────────────────────────────────
      let result = await workerSendMessage(accountId, phone, text);

      if (!result.ok && liveSettings.maxRetries > 1) {
        failedAccountsThisMsg.add(accountId);
        for (let attempt = 1; attempt < liveSettings.maxRetries && !result.ok; attempt++) {
          const altAccount = await pickAccount(accountIds, liveSettings, failedAccountsThisMsg);
          if (!altAccount) break;

          logger.info({ campaignId, phone, failedAccount: accountId, retryAccount: altAccount, attempt },
            "retrying with different account");

          await recordFailure(accountId, liveSettings, result.error);
          await sleep(liveSettings.retryDelayMin * 60_000);

          const [recheck] = await db.select().from(campaignsTable)
            .where(eq(campaignsTable.id, campaignId));
          if (!recheck || recheck.status !== "running") return;

          accountId = altAccount;
          await db.update(messagesTable).set({ accountId }).where(eq(messagesTable.id, msg.id));
          result = await workerSendMessage(accountId, phone, text);
          if (!result.ok) failedAccountsThisMsg.add(accountId);
        }
      }

      if (result.ok) {
        await db.update(messagesTable).set({ status: "sent", sentAt: new Date() })
          .where(eq(messagesTable.id, msg.id));
        await incSent(accountId);  // daily + hourly
        await recordSuccess(accountId, liveSettings);
        logger.info({
          campaignId, phone, accountId,
          health: getCachedHealth(accountId),
          hourlySent: getHourlySent(accountId),
          spamScore: spamScore.score,
        }, "sent ✓");
      } else {
        await recordFailure(accountId, liveSettings, result.error);
        await db.update(messagesTable)
          .set({ status: "failed", error: result.error, retryCount: msg.retryCount + failedAccountsThisMsg.size })
          .where(eq(messagesTable.id, msg.id));
      }

      // ── Batch pause ───────────────────────────────────────────────────
      if (
        fresh.batchSize > 0 &&
        (await db.select({ count: sql<number>`count(*)::int` })
          .from(messagesTable)
          .where(and(
            eq(messagesTable.campaignId, campaignId),
            eq(messagesTable.status, "sent"),
          ))
        ).then(rows => rows[0]?.count ?? 0)
          .then(c => c % fresh.batchSize === 0 && c > 0)
          .catch(() => false)
      ) {
        logger.info({ campaignId }, `batch pause ${fresh.batchPauseMin}min`);
        await sleep(fresh.batchPauseMin * 60_000);
      }

      // ── Poisson inter-message delay ──────────────────────────────────
      const lambdaMs = ((fresh.minDelaySec + fresh.maxDelaySec) / 2) * 1000;
      await sleep(poissonDelay(lambdaMs, fresh.minDelaySec * 1000, fresh.maxDelaySec * 1000));
    }
  }
}

// ── Recovery ───────────────────────────────────────────────────────────────
export async function recoverRunningCampaigns(): Promise<void> {
  const running = await db.select().from(campaignsTable).where(eq(campaignsTable.status, "running"));
  for (const c of running) {
    logger.info({ campaignId: c.id }, "recovering campaign");
    runCampaign(c.id).catch(e => logger.error({ e, campaignId: c.id }, "campaign error"));
  }
}
