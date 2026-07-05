import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable, campaignsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  workerCreateSession,
  workerDeleteSession,
  workerGetSession,
  workerGetAllSessions,
} from "../lib/worker-client";
import { logAccountEvent } from "../lib/warm-up";
import { runningCampaigns } from "../lib/campaign-runner";
import { logger } from "../lib/logger";
import { timingSafeEqual } from "crypto";

const router = Router();

const WORKER_SECRET  = process.env.WORKER_SECRET  ?? null;
const REQUIRE_PROXY  = process.env.REQUIRE_PROXY  === "true";

// ── Worker-secret auth helper ────────────────────────────────────────────────
function verifyWorkerSecret(req: import("express").Request): boolean {
  if (!WORKER_SECRET) {
    if (process.env.NODE_ENV === "production") return false;
    return true; // dev-only: allow without secret
  }
  const h = req.headers["x-worker-secret"];
  if (!h || typeof h !== "string") return false;
  try {
    const a = Buffer.from(h, "utf8");
    const b = Buffer.from(WORKER_SECRET, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

/* ── Session status cache (5 s TTL) ─────────────────────────────────────── */
let sessionCache: Record<string, { status: string; qr?: string; phone?: string; ts: number }> = {};
const CACHE_TTL = 5_000;

async function getSessionsCached() {
  const now   = Date.now();
  const stale = Object.values(sessionCache).some(v => now - v.ts > CACHE_TTL);
  if (stale || Object.keys(sessionCache).length === 0) {
    const fresh = await workerGetAllSessions();
    sessionCache = Object.fromEntries(
      Object.entries(fresh).map(([k, v]) => [k, { ...v, ts: now }]),
    );
  }
  return sessionCache;
}

/* ── GET /accounts ──────────────────────────────────────────────────────── */
router.get("/accounts", requireAuth, async (_req, res) => {
  const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
  const sessions = await getSessionsCached();

  const result = accounts.map(a => {
    const s       = sessions[a.id];
    const ageDays = Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86_400_000);
    const tier    = ageDays >= 30 && (a.totalReplies ?? 0) >= 20 ? "hot"
                  : ageDays >= 7 ? "warm" : "new";
    const isSuspended = a.suspendedUntil ? new Date(a.suspendedUntil) > new Date() : false;

    return {
      ...a,
      proxy:       undefined,
      proxyMasked: a.proxy ? a.proxy.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@") : null,
      hasProxy:    !!a.proxy,
      status:      s?.status ?? a.status,
      phoneNumber: s?.phone  ?? a.phoneNumber,
      warmUpTier:  tier,
      warmUpDay:   a.warmUpDay,
      healthScore: a.healthScore ?? 100,
      isSuspended,
      suspendedUntil: a.suspendedUntil ?? null,
    };
  });

  res.json(result);
});

/* ── GET /accounts/connected — للـ Worker فقط (session recovery on startup) */
// يُعيد جميع الحسابات التي كانت "connected" في آخر session
// يُستدعى من الـ worker عند إعادة التشغيل لاستعادة الـ sessions
router.get("/accounts/connected", (req, res) => {
  if (!verifyWorkerSecret(req)) {
    res.status(401).json({ error: "Unauthorized — X-Worker-Secret required" });
    return;
  }

  db.select({
    id:    accountsTable.id,
    proxy: accountsTable.proxy,
    label: accountsTable.label,
  })
    .from(accountsTable)
    .where(eq(accountsTable.status, "connected"))
    .then(rows => {
      // لا نُرسل proxy للـ frontend — لكن الـ worker يحتاجه
      res.json(rows);
    })
    .catch(err => {
      logger.error({ err }, "/accounts/connected failed");
      res.status(500).json({ error: "DB error" });
    });
});

/* ── POST /accounts ──────────────────────────────────────────────────────── */
router.post("/accounts", requireAuth, async (req, res) => {
  const { label, proxy } = req.body as { label?: string; proxy?: string };
  if (!label?.trim()) { res.status(400).json({ error: "label is required" }); return; }

  const proxyTrimmed = proxy?.trim() || null;

  if (REQUIRE_PROXY && !proxyTrimmed) {
    res.status(400).json({
      error: "proxy مطلوب في وضع الإنتاج. يجب لكل حساب proxy سكني مستقل.",
      hint: "صيغة: http://user:pass@host:port",
    });
    return;
  }

  if (proxyTrimmed) {
    try {
      const url = new URL(proxyTrimmed);
      if (!["http:", "https:", "socks5:"].includes(url.protocol)) {
        res.status(400).json({ error: "Proxy يجب أن يكون بصيغة http://user:pass@host:port" }); return;
      }
      if (!url.username || !url.password) {
        res.status(400).json({ error: "يجب أن يحتوي الـ proxy على اسم مستخدم وكلمة مرور" }); return;
      }
    } catch {
      res.status(400).json({ error: "صيغة Proxy غير صحيحة" }); return;
    }
  }

  const [acc] = await db.insert(accountsTable).values({ label: label.trim(), proxy: proxyTrimmed }).returning();

  try { await workerCreateSession(acc.id, acc.proxy ?? null); }
  catch (err) { req.log.warn({ err, accountId: acc.id }, "worker unreachable on account create"); }

  sessionCache = {};
  const { proxy: _omit, ...safeAcc } = acc;
  res.status(201).json({
    ...safeAcc,
    hasProxy: !!acc.proxy,
    warning: !proxyTrimmed ? "⚠️ لا يوجد proxy — خطر حظر جماعي للحسابات." : null,
  });
});

/* ── GET /accounts/:id/qr ───────────────────────────────────────────────── */
router.get("/accounts/:id/qr", requireAuth, async (req, res) => {
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, req.params.id));
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }

  const s = await workerGetSession(req.params.id);
  if (s.status === "connected" && s.phone) {
    await db.update(accountsTable).set({ status: "connected", phoneNumber: s.phone })
      .where(eq(accountsTable.id, req.params.id));
  }
  res.json({ qr: s.qr ?? null, status: s.status });
});

/* ── DELETE /accounts/:id ───────────────────────────────────────────────── */
router.delete("/accounts/:id", requireAuth, async (req, res) => {
  const rows = await db.delete(accountsTable).where(eq(accountsTable.id, req.params.id)).returning();
  if (rows.length === 0) { res.status(404).json({ error: "Account not found" }); return; }
  await workerDeleteSession(req.params.id);
  sessionCache = {};
  res.json({ ok: true });
});

/* ── POST /accounts/:id/unsuspend ────────────────────────────────────────── */
router.post("/accounts/:id/unsuspend", requireAuth, async (req, res) => {
  const rows = await db.update(accountsTable)
    .set({ suspendedUntil: null, healthScore: 60 })
    .where(eq(accountsTable.id, req.params.id))
    .returning();
  if (rows.length === 0) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({ ok: true, message: "تم رفع الإيقاف — درجة الصحة: 60" });
});

/* ── POST /accounts/:id/ban — للـ Worker فقط ─────────────────────────────
 * يُستدعى تلقائياً من الـ worker عند حدوث auth_failure (WhatsApp حظر الحساب).
 * [جديد v5] يُوقف الحساب للأبد ويُوقف جميع campaigns تستخدمه.
 */
router.post("/accounts/:id/ban", async (req, res) => {
  if (!verifyWorkerSecret(req)) {
    res.status(401).json({ error: "Unauthorized — X-Worker-Secret required" });
    return;
  }

  const { reason = "auth_failure" } = req.body as { reason?: string };
  const accountId = req.params.id;

  // 1. أوقف الحساب بصورة دائمة (suspendedUntil = بعد سنة)
  //    healthScore = 0 لمنعه من الاختيار في pickAccount
  const farFuture = new Date(Date.now() + 365 * 86_400_000);
  const rows = await db.update(accountsTable)
    .set({
      status:        "logged_out",
      healthScore:   0,
      suspendedUntil: farFuture,
    })
    .where(eq(accountsTable.id, accountId))
    .returning();

  if (rows.length === 0) { res.status(404).json({ error: "Account not found" }); return; }

  // 2. سجّل الحدث
  await logAccountEvent(accountId, "suspended", `BANNED: ${reason}`).catch(() => {});

  // 3. أوقف جميع campaigns الجارية التي تستخدم هذا الحساب
  //    — find all running campaigns where accountIds JSON includes this account
  const runningInDB = await db.select({ id: campaignsTable.id, accountIds: campaignsTable.accountIds })
    .from(campaignsTable)
    .where(eq(campaignsTable.status, "running"));

  const affected: string[] = [];
  for (const c of runningInDB) {
    const ids: string[] = JSON.parse(c.accountIds);
    if (ids.includes(accountId)) {
      affected.push(c.id);
      // Remove from in-memory running set
      runningCampaigns.delete(c.id);
    }
  }

  if (affected.length > 0) {
    // إصلاح: نُوقف الـ campaign في DB فقط — لا نُزيل من runningCampaigns في الذاكرة.
    // حلقة _run() ستكتشف status="paused" من DB في التكرار التالي وتخرج بشكل نظيف.
    // إزالة قسرية من runningCampaigns خطرة — تسمح بإعادة دخول runCampaign
    // قبل أن تُنهي _run() تنظيفها الداخلي.
    await db.update(campaignsTable)
      .set({ status: "paused" })
      .where(inArray(campaignsTable.id, affected));
    logger.warn({ accountId, reason, affectedCampaigns: affected.length },
      "ACCOUNT BANNED — campaigns marked paused in DB (runner will self-exit on next loop)");
  }

  sessionCache = {};

  logger.error({ accountId, reason, farFuture },
    "🚫 Account permanently suspended due to WhatsApp ban signal");

  res.json({
    ok: true,
    accountId,
    reason,
    suspendedUntil: farFuture,
    pausedCampaigns: affected.length,
  });
});

export default router;
