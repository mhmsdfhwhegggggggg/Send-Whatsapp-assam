import { Router } from "express";
import { db } from "@workspace/db";
import {
  groupsTable,
  studentsTable,
  insertGroupSchema,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/groups", async (_req, res) => {
  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      description: groupsTable.description,
      createdAt: groupsTable.createdAt,
      count: sql<number>`count(${studentsTable.id})::int`,
    })
    .from(groupsTable)
    .leftJoin(studentsTable, eq(studentsTable.groupId, groupsTable.id))
    .groupBy(groupsTable.id)
    .orderBy(groupsTable.createdAt);
  res.json(rows);
});

router.post("/groups", async (req, res) => {
  const parsed = insertGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const [row] = await db.insert(groupsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.delete("/groups/:id", async (req, res) => {
  const rows = await db
    .delete(groupsTable)
    .where(eq(groupsTable.id, req.params.id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
