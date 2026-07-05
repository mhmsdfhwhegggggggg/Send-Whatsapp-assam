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
  return (await db.select().from(settingsTable).where(eq(settingsTable.id, 1)))[0]!;
}

router.get("/settings", async (_req, res) => {
  const s = await ensureSettings();
  res.json({
    // Tiered daily limits
    new_account_daily_limit:  s.newAccountDailyLimit,
    warm_account_daily_limit: s.warmAccountDailyLimit,
    hot_account_daily_limit:  s.hotAccountDailyLimit,
    // Warm-up thresholds
    warm_up_days_threshold:   s.warmUpDaysThreshold,
    hot_days_threshold:       s.hotDaysThreshold,
    hot_reply_threshold:      s.hotReplyThreshold,
    // Working hours
    working_hours_start:      s.workingHoursStart,
    working_hours_end:        s.workingHoursEnd,
    // Retry settings
    max_retries:              s.maxRetries,
    retry_delay_min:          s.retryDelayMin,
    // Anti-ban toggles
    spintax_enabled:          s.spintaxEnabled,
    invisible_chars_enabled:  s.invisibleCharsEnabled,
    // Emergency stop
    kill_switch:              s.killSwitch,
    // Dedup
    dedup_window_days:        s.dedupWindowDays,
  });
});

router.put("/settings", async (req, res) => {
  const body = req.body as {
    new_account_daily_limit?:  number;
    warm_account_daily_limit?: number;
    hot_account_daily_limit?:  number;
    warm_up_days_threshold?:   number;
    hot_days_threshold?:       number;
    hot_reply_threshold?:      number;
    working_hours_start?:      number;
    working_hours_end?:        number;
    max_retries?:              number;
    retry_delay_min?:          number;
    spintax_enabled?:          boolean;
    invisible_chars_enabled?:  boolean;
    kill_switch?:              boolean;
    dedup_window_days?:        number;
  };

  await ensureSettings();

  const [updated] = await db
    .update(settingsTable)
    .set({
      newAccountDailyLimit:  body.new_account_daily_limit,
      warmAccountDailyLimit: body.warm_account_daily_limit,
      hotAccountDailyLimit:  body.hot_account_daily_limit,
      warmUpDaysThreshold:   body.warm_up_days_threshold,
      hotDaysThreshold:      body.hot_days_threshold,
      hotReplyThreshold:     body.hot_reply_threshold,
      workingHoursStart:     body.working_hours_start,
      workingHoursEnd:       body.working_hours_end,
      maxRetries:            body.max_retries,
      retryDelayMin:         body.retry_delay_min,
      spintaxEnabled:        body.spintax_enabled,
      invisibleCharsEnabled: body.invisible_chars_enabled,
      killSwitch:            body.kill_switch,
      dedupWindowDays:       body.dedup_window_days,
    })
    .where(eq(settingsTable.id, 1))
    .returning();

  res.json({
    new_account_daily_limit:  updated.newAccountDailyLimit,
    warm_account_daily_limit: updated.warmAccountDailyLimit,
    hot_account_daily_limit:  updated.hotAccountDailyLimit,
    warm_up_days_threshold:   updated.warmUpDaysThreshold,
    hot_days_threshold:       updated.hotDaysThreshold,
    hot_reply_threshold:      updated.hotReplyThreshold,
    working_hours_start:      updated.workingHoursStart,
    working_hours_end:        updated.workingHoursEnd,
    max_retries:              updated.maxRetries,
    retry_delay_min:          updated.retryDelayMin,
    spintax_enabled:          updated.spintaxEnabled,
    invisible_chars_enabled:  updated.invisibleCharsEnabled,
    kill_switch:              updated.killSwitch,
    dedup_window_days:        updated.dedupWindowDays,
  });
});

export default router;
