import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { settingsTable, campaignsTable, optOutTable, inboundMessagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { handleInboundMessage } from "../lib/inbound-handler";
import { runningCampaigns } from "../lib/campaign-runner";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

const WORKER_SECRET = process.env.WORKER_SECRET ?? null;

/**
 * التحقق من WORKER_SECRET لمسارات الـ worker-to-API.
 * يُستخدم فقط على /inbound الذي يُستدعى من الـ worker لا من المتصفح.
 */
function verifyWorkerSecret(req: import("express").Request): boolean {
  if (!WORKER_SECRET) {
    // في حالة عدم ضبط WORKER_SECRET — سجّل تحذيراً لكن اسمح في dev
    if (process.env.NODE_ENV === "production") return false;
    logger.warn("WORKER_SECRET not set — /inbound is open. Set in production.");
    return true;
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

// ─────────────────────────────────────────────────────────────────────────
// POST /api/inbound { phone, body, accountId } — من WA Worker
// لا يحتاج JWT (يُستدعى من worker) لكن يحتاج WORKER_SECRET
// ─────────────────────────────────────────────────────────────────────────
router.post("/inbound", (req, res) => {
  if (!verifyWorkerSecret(req)) {
    res.status(401).json({ error: "Unauthorized — invalid or missing X-Worker-Secret" });
    return;
  }

  const { phone, body, accountId } = req.body as { phone: string; body: string; accountId: string };
  if (!phone || !body || !accountId) {
    res.status(400).json({ error: "phone, body, accountId required" });
    return;
  }

  // رد فوري ثم معالجة async (لا نُبطئ الـ worker)
  res.json({ ok: true });
  handleInboundMessage({ phone, body, accountId }).catch(e =>
    logger.error({ err: e, phone, accountId }, "handleInboundMessage failed"),
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Kill-switch — يتطلب JWT (admin only)
// ─────────────────────────────────────────────────────────────────────────
router.post("/kill-switch", requireAuth, async (req, res) => {
  const { active } = req.body as { active: boolean };
  await db.update(settingsTable).set({ killSwitch: active }).where(eq(settingsTable.id, 1));
  if (active) {
    await db.update(campaignsTable)
      .set({ status: "paused" })
      .where(eq(campaignsTable.status, "running"));
    runningCampaigns.clear();
  }
  logger.warn({ active }, "kill-switch toggled");
  res.json({
    ok: true,
    killSwitch: active,
    message: active ? "All campaigns paused" : "Kill switch lifted",
  });
});

router.get("/kill-switch", requireAuth, async (_req, res) => {
  const rows = await db
    .select({ killSwitch: settingsTable.killSwitch })
    .from(settingsTable)
    .where(eq(settingsTable.id, 1));
  res.json({ killSwitch: rows[0]?.killSwitch ?? false });
});

// ─────────────────────────────────────────────────────────────────────────
// Opt-out management — يتطلب JWT
// ─────────────────────────────────────────────────────────────────────────
router.get("/opt-out", requireAuth, async (_req, res) => {
  const rows = await db.select().from(optOutTable).orderBy(desc(optOutTable.addedAt));
  res.json({ count: rows.length, items: rows });
});

router.post("/opt-out", requireAuth, async (req, res) => {
  const { phone, keyword = "manual" } = req.body as { phone: string; keyword?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  await db.insert(optOutTable).values({ phone, keyword }).onConflictDoNothing();
  res.json({ ok: true, phone });
});

router.delete("/opt-out/:phone", requireAuth, async (req, res) => {
  await db.delete(optOutTable).where(eq(optOutTable.phone, req.params.phone));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Inbound stats — يتطلب JWT
// ─────────────────────────────────────────────────────────────────────────
router.get("/inbound-stats", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(inboundMessagesTable)
    .orderBy(desc(inboundMessagesTable.receivedAt))
    .limit(50);
  res.json({
    total:     rows.length,
    stopWords: rows.filter(r => r.isStopWord).length,
    recent:    rows.slice(0, 10),
  });
});

export default router;
