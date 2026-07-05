import { logger } from "./logger";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8088";
const TIMEOUT_MS = 15_000;

async function workerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Create a new WhatsApp session in the worker.
 * @param sessionId  - account UUID used as session ID
 * @param proxy      - optional per-account proxy, e.g. "http://user:pass@host:port"
 *                     Every account should ideally have its own residential proxy
 *                     to avoid WhatsApp detecting multiple sessions from the same IP.
 */
export async function workerCreateSession(
  sessionId: string,
  proxy?: string | null,
): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: sessionId, proxy: proxy ?? null }),
  });
}

export async function workerDeleteSession(sessionId: string): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, { method: "DELETE" }).catch(
    (e) => logger.warn({ err: e }, "worker delete session failed"),
  );
}

export interface SessionStatus {
  status: "initializing" | "qr" | "connected" | "disconnected" | "logged_out" | "error";
  qr?: string | null;
  phone?: string | null;
}

export async function workerGetSession(sessionId: string): Promise<SessionStatus> {
  try {
    const res = await workerFetch(`/sessions/${sessionId}`);
    if (!res.ok) return { status: "disconnected" };
    return (await res.json()) as SessionStatus;
  } catch {
    return { status: "disconnected" };
  }
}

export async function workerGetAllSessions(): Promise<
  Record<string, SessionStatus>
> {
  try {
    const res = await workerFetch("/sessions");
    if (!res.ok) return {};
    return (await res.json()) as Record<string, SessionStatus>;
  } catch {
    return {};
  }
}

export async function workerSendMessage(
  sessionId: string,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await workerFetch("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, phone, text }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
