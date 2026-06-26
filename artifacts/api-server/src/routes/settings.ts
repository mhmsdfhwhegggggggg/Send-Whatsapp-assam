import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

async function ensureSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (rows.length === 0) {
    await db.insert(settingsTable).values({ id: 1 });
  }
  return (await db.select().from(settingsTable).where(eq(settingsTable.id, 1)))[0];
}

router.get("/settings", async (_req, res) => {
  const s = await ensureSettings();
  res.json({
    daily_limit_per_account: s.dailyLimitPerAccount,
    working_hours_start: s.workingHoursStart,
    working_hours_end: s.workingHoursEnd,
    spintax_enabled: s.spintaxEnabled,
    invisible_chars_enabled: s.invisibleCharsEnabled,
    max_retries: s.maxRetries,
    retry_delay_min: s.retryDelayMin,
  });
});

router.put("/settings", async (req, res) => {
  const body = req.body as {
    daily_limit_per_account?: number;
    working_hours_start?: number;
    working_hours_end?: number;
    spintax_enabled?: boolean;
    invisible_chars_enabled?: boolean;
    max_retries?: number;
    retry_delay_min?: number;
  };

  await ensureSettings();
  const [updated] = await db
    .update(settingsTable)
    .set({
      dailyLimitPerAccount: body.daily_limit_per_account,
      workingHoursStart: body.working_hours_start,
      workingHoursEnd: body.working_hours_end,
      spintaxEnabled: body.spintax_enabled,
      invisibleCharsEnabled: body.invisible_chars_enabled,
      maxRetries: body.max_retries,
      retryDelayMin: body.retry_delay_min,
    })
    .where(eq(settingsTable.id, 1))
    .returning();

  res.json({
    daily_limit_per_account: updated.dailyLimitPerAccount,
    working_hours_start: updated.workingHoursStart,
    working_hours_end: updated.workingHoursEnd,
    spintax_enabled: updated.spintaxEnabled,
    invisible_chars_enabled: updated.invisibleCharsEnabled,
    max_retries: updated.maxRetries,
    retry_delay_min: updated.retryDelayMin,
  });
});

export default router;
