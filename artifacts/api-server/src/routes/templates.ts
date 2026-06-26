import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable, insertTemplateSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/templates", async (_req, res) => {
  const rows = await db
    .select()
    .from(templatesTable)
    .orderBy(templatesTable.createdAt);
  res.json(rows);
});

router.post("/templates", async (req, res) => {
  const parsed = insertTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const [row] = await db.insert(templatesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.put("/templates/:id", async (req, res) => {
  const rows = await db
    .update(templatesTable)
    .set(req.body as Partial<typeof templatesTable.$inferInsert>)
    .where(eq(templatesTable.id, req.params.id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(rows[0]);
});

router.delete("/templates/:id", async (req, res) => {
  const rows = await db
    .delete(templatesTable)
    .where(eq(templatesTable.id, req.params.id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
