import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  messagesTable,
  studentsTable,
  groupsTable,
  accountsTable,
} from "@workspace/db/schema";
import { eq, inArray, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { runCampaign } from "../lib/campaign-runner";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

router.get("/campaigns", async (_req, res) => {
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(campaignsTable.createdAt);

  const withStats = await Promise.all(
    campaigns.map(async (c) => {
      const [stats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          sent: sql<number>`sum(case when ${messagesTable.status}='sent' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${messagesTable.status}='failed' then 1 else 0 end)::int`,
          pending: sql<number>`sum(case when ${messagesTable.status}='pending' then 1 else 0 end)::int`,
        })
        .from(messagesTable)
        .where(eq(messagesTable.campaignId, c.id));

      return {
        ...c,
        total: stats?.total ?? 0,
        sent: stats?.sent ?? 0,
        failed: stats?.failed ?? 0,
        pending: stats?.pending ?? 0,
      };
    }),
  );

  res.json(withStats);
});

router.post("/campaigns", async (req, res) => {
  const {
    name,
    template_id,
    group_ids,
    account_ids,
    min_delay_sec = 5,
    max_delay_sec = 25,
    batch_size = 50,
    batch_pause_min = 5,
  } = req.body as {
    name: string;
    template_id: string;
    group_ids: string[];
    account_ids: string[];
    min_delay_sec?: number;
    max_delay_sec?: number;
    batch_size?: number;
    batch_pause_min?: number;
  };

  if (!name || !template_id || !group_ids?.length || !account_ids?.length) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const students = await db
    .select()
    .from(studentsTable)
    .where(inArray(studentsTable.groupId, group_ids));

  if (students.length === 0) {
    res.status(400).json({ error: "No students in selected groups" });
    return;
  }

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      name,
      templateId: template_id,
      groupIds: JSON.stringify(group_ids),
      accountIds: JSON.stringify(account_ids),
      status: "running",
      minDelaySec: min_delay_sec,
      maxDelaySec: max_delay_sec,
      batchSize: batch_size,
      batchPauseMin: batch_pause_min,
      totalMessages: students.length,
    })
    .returning();

  await db.insert(messagesTable).values(
    students.map((s) => ({
      campaignId: campaign.id,
      studentId: s.id,
      studentName: s.name,
      phone: s.phone,
      body: "",
    })),
  );

  runCampaign(campaign.id).catch((err) =>
    logger.error({ err, campaignId: campaign.id }, "campaign runner error"),
  );

  res.status(201).json(campaign);
});

router.get("/campaigns/:id", async (req, res) => {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, req.params.id));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.campaignId, campaign.id))
    .orderBy(messagesTable.createdAt)
    .limit(500);

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`sum(case when ${messagesTable.status}='sent' then 1 else 0 end)::int`,
      failed: sql<number>`sum(case when ${messagesTable.status}='failed' then 1 else 0 end)::int`,
      pending: sql<number>`sum(case when ${messagesTable.status}='pending' then 1 else 0 end)::int`,
    })
    .from(messagesTable)
    .where(eq(messagesTable.campaignId, campaign.id));

  res.json({
    ...campaign,
    total: stats?.total ?? 0,
    sent: stats?.sent ?? 0,
    failed: stats?.failed ?? 0,
    pending: stats?.pending ?? 0,
    messages: messages.map((m) => ({
      id: m.id,
      name: m.studentName,
      phone: m.phone,
      status: m.status,
      sentAt: m.sentAt,
      error: m.error,
    })),
  });
});

router.post("/campaigns/:id/pause", async (req, res) => {
  const rows = await db
    .update(campaignsTable)
    .set({ status: "paused" })
    .where(
      and(
        eq(campaignsTable.id, req.params.id),
        eq(campaignsTable.status, "running"),
      ),
    )
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Campaign not found or not running" });
    return;
  }
  res.json({ ok: true });
});

router.post("/campaigns/:id/start", async (req, res) => {
  const rows = await db
    .update(campaignsTable)
    .set({ status: "running" })
    .where(
      and(
        eq(campaignsTable.id, req.params.id),
        eq(campaignsTable.status, "paused"),
      ),
    )
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Campaign not found or not paused" });
    return;
  }
  runCampaign(req.params.id).catch((err) =>
    logger.error({ err, campaignId: req.params.id }, "resume error"),
  );
  res.json({ ok: true });
});

router.delete("/campaigns/:id", async (req, res) => {
  const rows = await db
    .delete(campaignsTable)
    .where(eq(campaignsTable.id, req.params.id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
