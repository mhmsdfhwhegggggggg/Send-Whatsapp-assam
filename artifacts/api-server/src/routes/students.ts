import { Router } from "express";
import { db } from "@workspace/db";
import {
  studentsTable,
  groupsTable,
  insertStudentSchema,
} from "@workspace/db/schema";
import { eq, like, or, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sanitizePhone } from "../lib/spintax";
import multer from "multer";
import { parse } from "csv-parse/sync";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireAuth);

router.get("/students", async (req, res) => {
  const { q, group_id } = req.query as { q?: string; group_id?: string };
  let query = db.select().from(studentsTable).$dynamic();
  const filters = [];
  if (group_id) filters.push(eq(studentsTable.groupId, group_id));
  if (q) {
    filters.push(
      or(
        like(studentsTable.name, `%${q}%`),
        like(studentsTable.phone, `%${q}%`),
      ),
    );
  }
  if (filters.length > 0) query = query.where(and(...filters));
  const rows = await query.orderBy(studentsTable.createdAt);
  res.json(rows);
});

router.post("/students", async (req, res) => {
  const parsed = insertStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  try {
    const phone = sanitizePhone(parsed.data.phone);
    const [row] = await db
      .insert(studentsTable)
      .values({ ...parsed.data, phone })
      .returning();
    res.status(201).json(row);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique")) {
      res.status(409).json({ error: "Phone number already exists" });
    } else {
      res.status(400).json({ error: msg });
    }
  }
});

router.put("/students/:id", async (req, res) => {
  const { id } = req.params;
  const data = req.body as Record<string, unknown>;
  if (data.phone) {
    try {
      data.phone = sanitizePhone(String(data.phone));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
  }
  const rows = await db
    .update(studentsTable)
    .set(data)
    .where(eq(studentsTable.id, id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json(rows[0]);
});

router.delete("/students/:id", async (req, res) => {
  const rows = await db
    .delete(studentsTable)
    .where(eq(studentsTable.id, req.params.id))
    .returning();
  if (rows.length === 0) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json({ ok: true });
});

router.post(
  "/students/import",
  upload.single("file"),
  async (req, res) => {
    const buf = req.file?.buffer;
    if (!buf) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let records: Record<string, string>[];
    try {
      records = parse(buf, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch {
      res.status(400).json({ error: "Invalid CSV" });
      return;
    }

    if (records.length > 10_000) {
      res.status(400).json({ error: "CSV too large (max 10000 rows)" });
      return;
    }

    let imported = 0;
    let skipped = 0;
    for (const row of records) {
      const name = row.name ?? row["الاسم"] ?? "";
      const rawPhone = row.phone ?? row["الهاتف"] ?? "";
      if (!name || !rawPhone) { skipped++; continue; }
      try {
        const phone = sanitizePhone(rawPhone);
        await db
          .insert(studentsTable)
          .values({
            name,
            phone,
            university: row.university ?? row["الجامعة"],
            serviceType: row.service_type ?? row["الخدمة"],
            discount: row.discount ?? row["التخفيض"],
          })
          .onConflictDoNothing();
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped });
  },
);

export default router;
