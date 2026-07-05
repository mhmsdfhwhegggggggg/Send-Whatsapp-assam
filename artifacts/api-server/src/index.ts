import app from "./app";
import { logger } from "./lib/logger";
import { recoverRunningCampaigns } from "./lib/campaign-runner";
import { tickWarmUpDays } from "./lib/warm-up";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  recoverRunningCampaigns().catch((e) =>
    logger.error({ err: e }, "Failed to recover running campaigns"),
  );

  // ── Daily warm-up scheduler ─────────────────────────────────────────────
  // يُشغَّل tickWarmUpDays مرة كل 24 ساعة لترقية الحسابات تلقائياً.
  // إصلاح حرج: كانت هذه الوظيفة معرَّفة لكن غير مُستدعاة → الحسابات تبقى "new"
  // إلى الأبد ولا ترتقي إلى warm/hot.
  scheduleDailyWarmUpTick();
});

/**
 * يُجدوِل tickWarmUpDays لتشغيله عند منتصف الليل (UTC) ثم كل 24 ساعة.
 * استخدام midnight بدلاً من setInterval(86400000) يضمن التزامن مع تقويم الأيام.
 */
function scheduleDailyWarmUpTick(): void {
  // شغّل مرة عند الإقلاع لتحديث أي حسابات فاتها اليوم
  runWarmUpTick();

  // احسب الوقت المتبقي حتى منتصف الليل التالي
  function msUntilNextMidnight(): number {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);   // منتصف الليل UTC التالي
    return next.getTime() - now.getTime();
  }

  // الجدولة: انتظر حتى منتصف الليل ثم كرر كل 24 ساعة
  function schedule(): void {
    const delay = msUntilNextMidnight();
    logger.info(
      { nextTickIn: `${Math.round(delay / 60000)} min` },
      "warm-up: next daily tick scheduled",
    );
    setTimeout(() => {
      runWarmUpTick();
      // كرر كل 24 ساعة بعدها
      setInterval(runWarmUpTick, 24 * 60 * 60 * 1000);
    }, delay);
  }

  schedule();
}

async function runWarmUpTick(): Promise<void> {
  try {
    await tickWarmUpDays();
    logger.info("warm-up: daily tick completed");
  } catch (e) {
    logger.error({ err: e }, "warm-up: daily tick failed");
  }
}
