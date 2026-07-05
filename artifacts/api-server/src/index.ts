import app from "./app";
import { logger } from "./lib/logger";
import { recoverRunningCampaigns, runningCampaigns } from "./lib/campaign-runner";
import { tickWarmUpDays } from "./lib/warm-up";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = app.listen(port, (err?: Error) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port, env: process.env.NODE_ENV ?? "development" }, "Server listening");
  recoverRunningCampaigns().catch(e => logger.error({ err: e }, "Failed to recover campaigns"));
  scheduleDailyWarmUpTick();
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
// [إصلاح إنتاجي] SIGTERM/SIGINT → أوقف قبول طلبات جديدة، انتظر الطلبات الجارية
// ثم أغلق الاتصال بدون فقدان بيانات.
function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received");

  // أوقف الـ campaigns الجارية بشكل نظيف
  runningCampaigns.clear();

  // أوقف قبول اتصالات جديدة
  server.close(err => {
    if (err) logger.error({ err }, "Error during shutdown");
    logger.info("Server closed — bye");
    process.exit(err ? 1 : 0);
  });

  // Timeout: أجبر على الإغلاق بعد 15 ثانية إذا تعثّر
  setTimeout(() => {
    logger.warn("Forced shutdown after 15s timeout");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", err => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

// ── Daily warm-up scheduler ──────────────────────────────────────────────────
// [إصلاح إنتاجي] يُشغّل tickWarmUpDays عند منتصف الليل UTC كل 24 ساعة.
function scheduleDailyWarmUpTick(): void {
  runWarmUpTick(); // تشغيل فوري عند الإقلاع

  function msUntilNextMidnight(): number {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    return next.getTime() - now.getTime();
  }

  const delay = msUntilNextMidnight();
  logger.info({ nextTickIn: `${Math.round(delay / 60000)} min` }, "warm-up: next tick scheduled");

  setTimeout(() => {
    runWarmUpTick();
    setInterval(runWarmUpTick, 24 * 60 * 60 * 1000);
  }, delay);
}

async function runWarmUpTick(): Promise<void> {
  try { await tickWarmUpDays(); logger.info("warm-up: daily tick ✓"); }
  catch (e) { logger.error({ err: e }, "warm-up: daily tick failed"); }
}
