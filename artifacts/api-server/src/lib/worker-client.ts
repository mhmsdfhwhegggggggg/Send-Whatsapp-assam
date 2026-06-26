import { logger } from "./logger";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8088";
const TIMEOUT_MS = 10_000;

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

export async function workerCreateSession(sessionId: string): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, { method: "POST" });
}

export async function workerDeleteSession(sessionId: string): Promise<void> {
  await workerFetch(`/sessions/${sessionId}`, { method: "DELETE" }).catch(
    (e) => logger.warn({ err: e }, "worker delete session failed"),
  );
}

export interface SessionStatus {
  status: "initializing" | "qr" | "connected" | "disconnected" | "logged_out";
  qr?: string;
  phone?: string;
}

export async function workerGetSession(
  sessionId: string,
): Promise<SessionStatus> {
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
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
