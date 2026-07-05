import { logger } from "./logger";

const WORKER_URL    = process.env.WORKER_URL    ?? "http://localhost:8088";
const WORKER_SECRET = process.env.WORKER_SECRET ?? null;
const TIMEOUT_MS    = 20_000;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_SECRET) h["X-Worker-Secret"] = WORKER_SECRET;
  return h;
}

async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: { ...workerHeaders(), ...(init?.headers as Record<string, string> ?? {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export async function workerCreateSession(sessionId: string, proxy?: string | null): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({ accountId: sessionId, proxy: proxy ?? null }),
  });
}

export async function workerDeleteSession(sessionId: string): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, { method: "DELETE" })
    .catch(e => logger.warn({ err: e }, "worker delete session failed"));
}

export interface SessionStatus {
  status: "initializing" | "qr" | "connected" | "disconnected" | "logged_out" | "error";
  qr?:    string | null;
  phone?: string | null;
}

export async function workerGetSession(sessionId: string): Promise<SessionStatus> {
  try {
    const res = await workerFetch(`/sessions/${sessionId}`);
    if (!res.ok) return { status: "disconnected" };
    return (await res.json()) as SessionStatus;
  } catch { return { status: "disconnected" }; }
}

export async function workerGetAllSessions(): Promise<Record<string, SessionStatus>> {
  try {
    const res = await workerFetch("/sessions");
    if (!res.ok) return {};
    return (await res.json()) as Record<string, SessionStatus>;
  } catch { return {}; }
}

/**
 * Check if a phone number is registered on WhatsApp.
 * Call this BEFORE sending to avoid error spikes on invalid numbers.
 * Returns true = registered, false = not on WhatsApp or worker unavailable.
 *
 * This is one of the most important anti-ban signals: sending to non-WA
 * numbers raises your error rate and triggers spam detection faster.
 */
export async function workerCheckPhone(
  sessionId: string,
  phone: string,
): Promise<{ registered: boolean; error?: string }> {
  try {
    const res = await workerFetch("/check-phone", {
      method: "POST",
      body: JSON.stringify({ sessionId, phone }),
    });
    if (!res.ok) return { registered: true }; // Fail open: don't block on worker issues
    const body = await res.json() as { registered: boolean };
    return body;
  } catch (e) {
    // Worker unreachable — fail open (don't block the campaign)
    logger.warn({ sessionId, phone, err: (e as Error).message }, "check-phone: worker unreachable");
    return { registered: true };
  }
}

/**
 * Send a message through the worker.
 * humanMode=true (default) tells the worker to:
 *   1. Mark the chat as read
 *   2. Show typing indicator for realistic duration (corrected Arabic speed)
 *   3. Multi-phase typing simulation with mid-message pause for long texts
 *   4. Brief review hesitation
 *   5. Then actually send
 */
export async function workerSendMessage(
  sessionId: string,
  phone:     string,
  text:      string,
  humanMode = true,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await workerFetch("/send", {
      method: "POST",
      body: JSON.stringify({ sessionId, phone, text, humanMode }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
