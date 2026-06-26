import { db } from "@workspace/db";
import {
  campaignsTable,
  messagesTable,
  accountsTable,
  settingsTable,
  studentsTable,
  groupsTable,
  templatesTable,
} from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import {
  applySpintax,
  fillVars,
  addInvisibleChars,
  sanitizePhone,
} from "./spintax";
import { workerSendMessage } from "./worker-client";
import { logger } from "./logger";

const runningCampaigns = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isWorkingHour(start: number, end: number): boolean {
  const h = new Date().getHours();
  return h >= start && h < end;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  return rows[0] ?? {
    dailyLimitPerAccount: 500,
    workingHoursStart: 9,
    workingHoursEnd: 21,
    spintaxEnabled: true,
    invisibleCharsEnabled: true,
    maxRetries: 3,
    retryDelayMin: 2,
  };
}

async function resetDailyCountIfNeeded(accountId: string) {
  const today = todayStr();
  const [acc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!acc) return;
  if (acc.lastResetDate !== today) {
    await db
      .update(accountsTable)
      .set({ sentToday: 0, lastResetDate: today })
      .where(eq(accountsTable.id, accountId));
  }
}

async function pickAccount(
  accountIds: string[],
  dailyLimit: number,
): Promise<string | null> {
  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  for (const acc of accounts) {
    if (acc.status !== "connected") continue;
    const today = todayStr();
    const sentToday =
      acc.lastResetDate === today ? acc.sentToday : 0;
    if (sentToday < dailyLimit) return acc.id;
  }
  return null;
}

async function incrementSentToday(accountId: string) {
  const [acc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!acc) return;
  const today = todayStr();
  const base = acc.lastResetDate === today ? acc.sentToday : 0;
  await db
    .update(accountsTable)
    .set({ sentToday: base + 1, lastResetDate: today })
    .where(eq(accountsTable.id, accountId));
}

export async function runCampaign(campaignId: string): Promise<void> {
  if (runningCampaigns.has(campaignId)) return;
  runningCampaigns.add(campaignId);

  try {
    await _runCampaign(campaignId);
  } finally {
    runningCampaigns.delete(campaignId);
  }
}

async function _runCampaign(campaignId: string): Promise<void> {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign || campaign.status !== "running") return;

  const [template] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, campaign.templateId));
  if (!template) {
    logger.error({ campaignId }, "template not found");
    return;
  }

  const settings = await getSettings();
  const accountIds = JSON.parse(campaign.accountIds) as string[];
  let batchCount = 0;

  for (const accountId of accountIds) {
    await resetDailyCountIfNeeded(accountId);
  }

  while (true) {
    const [fresh] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    if (!fresh || fresh.status !== "running") break;

    const pending = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.campaignId, campaignId),
          eq(messagesTable.status, "pending"),
        ),
      )
      .limit(1);

    if (pending.length === 0) {
      await db
        .update(campaignsTable)
        .set({ status: "completed" })
        .where(eq(campaignsTable.id, campaignId));
      break;
    }

    if (!isWorkingHour(settings.workingHoursStart, settings.workingHoursEnd)) {
      logger.info({ campaignId }, "outside working hours, waiting 5min");
      await sleep(5 * 60 * 1000);
      continue;
    }

    const accountId = await pickAccount(accountIds, settings.dailyLimitPerAccount);
    if (!accountId) {
      logger.warn({ campaignId }, "no available account, waiting 10min");
      await sleep(10 * 60 * 1000);
      continue;
    }

    const msg = pending[0];

    let body = template.body;
    if (settings.spintaxEnabled) body = applySpintax(body);

    body = fillVars(body, {
      name: msg.studentName,
      university: undefined,
      discount: undefined,
      serviceType: undefined,
    });

    if (settings.invisibleCharsEnabled) body = addInvisibleChars(body);

    const result = await workerSendMessage(accountId, msg.phone, body);

    if (result.ok) {
      await db
        .update(messagesTable)
        .set({
          status: "sent",
          accountId,
          sentAt: new Date(),
          body,
        })
        .where(eq(messagesTable.id, msg.id));
      await incrementSentToday(accountId);
      batchCount++;
    } else {
      const retries = msg.retryCount + 1;
      if (retries >= settings.maxRetries) {
        await db
          .update(messagesTable)
          .set({
            status: "failed",
            error: result.error,
            retryCount: retries,
          })
          .where(eq(messagesTable.id, msg.id));
      } else {
        await db
          .update(messagesTable)
          .set({ retryCount: retries, error: result.error })
          .where(eq(messagesTable.id, msg.id));
        logger.warn({ campaignId, msgId: msg.id, retries }, "will retry");
        await sleep(settings.retryDelayMin * 60 * 1000);
        continue;
      }
    }

    if (batchCount > 0 && batchCount % campaign.batchSize === 0) {
      logger.info(
        { campaignId, batchCount },
        `batch pause ${campaign.batchPauseMin}min`,
      );
      await sleep(campaign.batchPauseMin * 60 * 1000);
    }

    const delay =
      randomBetween(campaign.minDelaySec, campaign.maxDelaySec) * 1000;
    await sleep(delay);
  }
}

export async function recoverRunningCampaigns(): Promise<void> {
  const running = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.status, "running"));

  for (const c of running) {
    logger.info({ campaignId: c.id }, "recovering running campaign");
    runCampaign(c.id).catch((err) =>
      logger.error({ err, campaignId: c.id }, "campaign runner error"),
    );
  }
}

export { runningCampaigns };
