import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  workerCreateSession,
  workerDeleteSession,
  workerGetSession,
  workerGetAllSessions,
} from "../lib/worker-client";
import { getDailyLimitForAccount } from "../lib/warm-up";

const router = Router();
router.use(requireAuth);

/* ── Session status cache (5s TTL) ─────────────────────────────────── */
let sessionCache: Record<string, { status: string; qr?: string; phone?: string; ts: number }> = {};
const CACHE_TTL = 5_000;

async function getSessionsCached(): Promise<Record<string, { status: string; qr?: string; phone?: string }>> {
  const now = Date.now();
  const stale = Object.values(sessionCache).some((v) => now - v.ts > CACHE_TTL);
  if (stale || Object.keys(sessionCache).length === 0) {
    const fresh = await workerGetAllSessions();
    sessionCache = Object.fromEntries(
      Object.entries(fresh).map(([k, v]) => [k, { ...v, ts: now }]),
    );
  }
  return sessionCache;
}

/* ── GET /accounts ──────────────────────────────────────────────────── */
router.get("/accounts", async (_req, res) => {
  const accounts = await db
    .select()
    .from(accountsTable)
    .orderBy(accountsTable.createdAt);

  const sessions = await getSessionsCached();

  const result = accounts.map((a) => {
    const s = sessions[a.id];
    const ageDays = Math.floor(
      (Date.now() - new Date(a.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    const tier =
      ageDays >= 30 && a.totalReplies >= 20 ? "hot"
      : ageDays >= 7 ? "warm"
      : "new";

    const isSuspended = a.suspendedUntil
      ? new Date(a.suspendedUntil) > new Date()
      : false;

    return {
      ...a,
      proxy: a.proxy ?? null,
      // Mask proxy credentials before sending to frontend
      proxyMasked: a.proxy
        ? a.proxy.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@")
        : null,
      hasProxy: !!a.proxy,
      status: s?.status ?? a.status,
      phoneNumber: s?.phone ?? a.phoneNumber,
      warmUpTier: tier,
      warmUpDay: a.warmUpDay,
      healthScore: a.healthScore ?? 100,
      isSuspended,
      suspendedUntil: a.suspendedUntil ?? null,
    };
  });

  res.json(result);
});

/* ── POST /accounts ─────────────────────────────────────────────────── */
router.post("/accounts", async (req, res) => {
  const { label, proxy } = req.body as { label?: string; proxy?: string };
  if (!label?.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  // Proxy is strongly recommended — warn but don't block if omitted.
  // In production, every account MUST have its own residential proxy
  // (different IP per account) to avoid multi-account detection.
  // Format: http://user:pass@host:port
  const proxyWarning = !proxy?.trim()
    ? "⚠️ لم يتم تقديم proxy. يُوصى بشدة باستخدام proxy سكني مستقل لكل حساب لتجنب الحظر."
    : null;

  if (proxy?.trim()) {
    // Basic proxy URL validation
    try {
      const url = new URL(proxy.trim());
      if (!["http:", "https:", "socks5:"].includes(url.protocol)) {
        res.status(400).json({ error: "Proxy يجب أن يكون بصيغة http://user:pass@host:port" });
        return;
      }
    } catch {
      res.status(400).json({ error: "صيغة Proxy غير صحيحة. يجب أن تكون: http://user:pass@host:port" });
      return;
    }
  }

  const [acc] = await db
    .insert(accountsTable)
    .values({
      label: label.trim(),
      proxy: proxy?.trim() || null,
    })
    .returning();

  try {
    await workerCreateSession(acc.id, acc.proxy ?? null);
  } catch (err) {
    req.log.warn({ err, accountId: acc.id }, "worker unreachable on account create");
  }

  sessionCache = {};
  res.status(201).json({ ...acc, warning: proxyWarning });
});

/* ── GET /accounts/:id/qr ───────────────────────────────────────────── */
router.get("/accounts/:id/qr", async (req, res) => {
  const { id } = req.params;
  const [acc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, id));
  if (!acc) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const s = await workerGetSession(id);
  if (s.status === "connected" && s.phone) {
    await db
      .update(accountsTable)
      .set({ status: "connected", phoneNumber: s.phone })
      .where(eq(accountsTable.id, id));
  }

  res.json({ qr: s.qr ?? null, status: s.status });
});

/* ── DELETE /accounts/:id ───────────────────────────────────────────── */
router.delete("/accounts/:id", async (req, res) => {
  const rows = await db
    .delete(accountsTable)
    .where(eq(accountsTable.id, req.params.id))
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  await workerDeleteSession(req.params.id);
  sessionCache = {};
  res.json({ ok: true });
});

/* ── POST /accounts/:id/unsuspend ───────────────────────────────────── */
// Manually clear a suspension (admin override)
router.post("/accounts/:id/unsuspend", async (req, res) => {
  const rows = await db
    .update(accountsTable)
    .set({ suspendedUntil: null, healthScore: 60 }) // Restore to 60 (still degraded but usable)
    .where(eq(accountsTable.id, req.params.id))
    .returning();

  if (rows.length === 0) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json({ ok: true, message: "تم رفع الإيقاف — تم إعادة تعيين درجة الصحة إلى 60" });
});

export default router;
