import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentsTable,
  groupsTable,
  accountsTable,
  templatesTable,
  campaignsTable,
  messagesTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/stats", async (_req, res) => {
  const [[students], [accounts], [groups], [templates], [msgStats], [campaigns]] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(studentsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(accountsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(groupsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(templatesTable),
      db.select({
        sent: sql<number>`sum(case when ${messagesTable.status}='sent' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${messagesTable.status}='failed' then 1 else 0 end)::int`,
        pending: sql<number>`sum(case when ${messagesTable.status}='pending' then 1 else 0 end)::int`,
      }).from(messagesTable),
      db.select({ count: sql<number>`count(*)::int` }).from(campaignsTable).where(eq(campaignsTable.status, "running")),
    ]);

  res.json({
    students: students.count,
    accounts: accounts.count,
    groups: groups.count,
    templates: templates.count,
    messages_sent: msgStats.sent ?? 0,
    messages_failed: msgStats.failed ?? 0,
    messages_pending: msgStats.pending ?? 0,
    campaigns_running: campaigns.count,
  });
});

export default router;
