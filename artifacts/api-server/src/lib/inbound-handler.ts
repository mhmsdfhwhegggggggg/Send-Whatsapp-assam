/**
 * inbound-handler.ts - STOP keyword detection + reply tracking
 */
import { db } from "@workspace/db";
import { optOutTable, inboundMessagesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { workerSendMessage } from "./worker-client";
import { recordReply } from "./warm-up";
import { logger } from "./logger";

const STOP_KEYWORDS = new Set([
  "stop","unsubscribe","remove me","remove","opt out","opt-out",
  "no thanks","no","cancel","end","quit","block","spam",
  "wqf","وقف","ايقاف","إيقاف","الغاء","إلغاء","إلغاء الاشتراك",
  "توقف","لا","اخرجني","احذفني","حذف",
  "توقف عن الارسال","لا شكرا","لا شكراً","بلوك","ابلغ","بلغ","لا اريد",
]);

function containsStopKeyword(body: string): string | null {
  const lower = body.trim().toLowerCase();
  for (const kw of STOP_KEYWORDS) {
    if (lower === kw || lower.includes(kw)) return kw;
  }
  return null;
}

export interface InboundPayload { phone: string; body: string; accountId: string; }

export async function handleInboundMessage(payload: InboundPayload): Promise<void> {
  const { phone, body, accountId } = payload;

  await db.insert(inboundMessagesTable).values({ phone, accountId, body, isStopWord: false })
    .onConflictDoNothing();

  const stopKeyword = containsStopKeyword(body);

  if (stopKeyword) {
    logger.info({ phone, keyword: stopKeyword }, "STOP keyword — opting out");
    await db.insert(optOutTable).values({ phone, keyword: stopKeyword, accountId }).onConflictDoNothing();
    await db.update(inboundMessagesTable).set({ isStopWord: true }).where(eq(inboundMessagesTable.phone, phone));

    const confirmMsg = "تم الغاء اشتراكك بنجاح. لن تصلك رسائل منا مستقبلاً ✅\nللعودة للاشتراك: أرسل (انضم)";
    try { await workerSendMessage(accountId, phone, confirmMsg); }
    catch (e: any) { logger.warn({ phone }, "opt-out confirmation failed: " + e?.message); }
  } else {
    await recordReply(accountId);
    logger.debug({ phone, accountId }, "reply recorded");
  }
}
