import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable, campaignsTable, optOutTable, inboundMessagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { handleInboundMessage } from "../lib/inbound-handler";
import { runningCampaigns } from "../lib/campaign-runner";

const router = Router();

// POST /api/kill-switch { active: boolean } — EMERGENCY HALT
router.post("/kill-switch", async (req, res) => {
  const { active } = req.body as { active: boolean };
  await db.update(settingsTable).set({ killSwitch: active }).where(eq(settingsTable.id, 1));
  if (active) {
    await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.status, "running"));
    runningCampaigns.clear();
  }
  res.json({ ok: true, killSwitch: active, message: active ? "All campaigns paused" : "Kill switch lifted" });
});

router.get("/kill-switch", async (_req, res) => {
  const rows = await db.select({ killSwitch: settingsTable.killSwitch }).from(settingsTable).where(eq(settingsTable.id, 1));
  res.json({ killSwitch: rows[0]?.killSwitch ?? false });
});

// POST /api/inbound { phone, body, accountId } — from WA Worker
router.post("/inbound", async (req, res) => {
  const { phone, body, accountId } = req.body as { phone: string; body: string; accountId: string };
  if (!phone || !body || !accountId) { res.status(400).json({ error: "phone, body, accountId required" }); return; }
  res.json({ ok: true });
  handleInboundMessage({ phone, body, accountId }).catch(console.error);
});

router.get("/opt-out", async (_req, res) => {
  const rows = await db.select().from(optOutTable).orderBy(desc(optOutTable.addedAt));
  res.json({ count: rows.length, items: rows });
});

router.post("/opt-out", async (req, res) => {
  const { phone, keyword = "manual" } = req.body as { phone: string; keyword?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  await db.insert(optOutTable).values({ phone, keyword }).onConflictDoNothing();
  res.json({ ok: true, phone });
});

router.delete("/opt-out/:phone", async (req, res) => {
  await db.delete(optOutTable).where(eq(optOutTable.phone, req.params.phone));
  res.json({ ok: true });
});

router.get("/inbound-stats", async (_req, res) => {
  const rows = await db.select().from(inboundMessagesTable).orderBy(desc(inboundMessagesTable.receivedAt)).limit(50);
  res.json({ total: rows.length, stopWords: rows.filter(r => r.isStopWord).length, recent: rows.slice(0, 10) });
});

export default router;
