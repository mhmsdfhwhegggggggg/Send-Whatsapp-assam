/**
 * warm-up.ts - Dynamic daily limit: NEW=20/day, WARM=80/day, HOT=150/day
 */
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export interface WarmUpSettings {
  newAccountDailyLimit: number;
  warmAccountDailyLimit: number;
  hotAccountDailyLimit: number;
  warmUpDaysThreshold: number;
  hotDaysThreshold: number;
  hotReplyThreshold: number;
}

export type AccountRow = {
  id: string; warmUpDay: number; totalReplies: number; totalSent: number; createdAt: Date;
};

export function getDailyLimitForAccount(account: AccountRow, settings: WarmUpSettings): number {
  const ageDays = Math.floor((Date.now() - new Date(account.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays < settings.warmUpDaysThreshold || account.warmUpDay < settings.warmUpDaysThreshold)
    return settings.newAccountDailyLimit;
  if (ageDays >= settings.hotDaysThreshold && account.totalReplies >= settings.hotReplyThreshold)
    return settings.hotAccountDailyLimit;
  return settings.warmAccountDailyLimit;
}

export async function tickWarmUpDays(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.update(accountsTable)
    .set({ warmUpDay: sql`warm_up_day + 1` })
    .where(sql`last_reset_date != ${today} OR last_reset_date IS NULL`)
    .returning({ id: accountsTable.id });
  logger.info({ count: result.length }, "warm-up: ticked warmUpDay");
}

export async function recordReply(accountId: string): Promise<void> {
  await db.update(accountsTable)
    .set({ totalReplies: sql`total_replies + 1` })
    .where(eq(accountsTable.id, accountId));
}
