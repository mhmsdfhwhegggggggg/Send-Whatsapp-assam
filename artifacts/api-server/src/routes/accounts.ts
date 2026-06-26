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

const router = Router();
router.use(requireAuth);

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

router.get("/accounts", async (_req, res) => {
  const accounts = await db
    .select()
    .from(accountsTable)
    .orderBy(accountsTable.createdAt);

  const sessions = await getSessionsCached();

  const result = accounts.map((a) => {
    const s = sessions[a.id];
    return {
      ...a,
      status: s?.status ?? a.status,
      phoneNumber: s?.phone ?? a.phoneNumber,
    };
  });

  res.json(result);
});

router.post("/accounts", async (req, res) => {
  const { label } = req.body as { label?: string };
  if (!label?.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  const [acc] = await db
    .insert(accountsTable)
    .values({ label: label.trim() })
    .returning();

  try {
    await workerCreateSession(acc.id);
  } catch (err) {
    req.log.warn({ err, accountId: acc.id }, "worker unreachable on account create");
  }

  sessionCache = {};
  res.status(201).json(acc);
});

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

export default router;
