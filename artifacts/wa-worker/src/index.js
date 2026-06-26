import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const PORT = parseInt(process.env.WA_WORKER_PORT ?? "8088", 10);

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

const logger = pino({ level: "info" });

let makeWASocket, DisconnectReason, useMultiFileAuthState;
try {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket = baileys.default ?? baileys.makeWASocket ?? baileys;
  DisconnectReason = baileys.DisconnectReason;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
} catch (e) {
  logger.error({ err: e }, "Failed to load Baileys — running in stub mode");
}

let QRCode;
try {
  QRCode = (await import("qrcode")).default;
} catch (e) {
  logger.warn("qrcode not available");
}

const sessions = new Map();

async function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  if (!existsSync(sessionPath)) mkdirSync(sessionPath, { recursive: true });

  const state = {
    id: sessionId,
    status: "initializing",
    qr: null,
    phone: null,
    sock: null,
  };
  sessions.set(sessionId, state);

  if (!makeWASocket || !useMultiFileAuthState || !DisconnectReason) {
    state.status = "disconnected";
    logger.warn({ sessionId }, "Baileys not loaded — stub session");
    return state;
  }

  const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["AlMossah", "Chrome", "124.0.0"],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 30_000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 3,
  });

  state.sock = sock;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        state.qr = QRCode
          ? await QRCode.toDataURL(qr)
          : `data:text/plain;base64,${Buffer.from(qr).toString("base64")}`;
        state.status = "qr";
        logger.info({ sessionId }, "QR ready");
      } catch (e) {
        logger.error({ err: e }, "QR generation failed");
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason;
      if (code === reason.loggedOut) {
        state.status = "logged_out";
        state.sock = null;
        sessions.delete(sessionId);
        logger.info({ sessionId }, "Logged out");
      } else {
        state.status = "disconnected";
        logger.warn({ sessionId, code }, "Disconnected — reconnecting");
        setTimeout(() => createSession(sessionId), 5000);
      }
    }

    if (connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.phone = sock.user?.id?.split(":")[0] ?? null;
      logger.info({ sessionId, phone: state.phone }, "Connected");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return state;
}

async function deleteSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s?.sock) {
    try {
      await s.sock.logout();
    } catch {}
  }
  sessions.delete(sessionId);
}

function respond(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && parts[0] === "healthz") {
      respond(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      const all = {};
      for (const [id, s] of sessions) {
        all[id] = { status: s.status, qr: s.qr, phone: s.phone };
      }
      respond(res, 200, all);
      return;
    }

    if (req.method === "POST" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const sessionId = parts[1];
      await createSession(sessionId);
      respond(res, 201, { ok: true });
      return;
    }

    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const s = sessions.get(parts[1]);
      if (!s) {
        respond(res, 404, { error: "Session not found" });
        return;
      }
      respond(res, 200, { status: s.status, qr: s.qr, phone: s.phone });
      return;
    }

    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1]) {
      await deleteSession(parts[1]);
      respond(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && parts[0] === "send") {
      const body = await bodyJson(req);
      const { sessionId, phone, text } = body;

      if (!sessionId || !phone || !text) {
        respond(res, 400, { error: "sessionId, phone, and text are required" });
        return;
      }

      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.sock) {
        respond(res, 503, { error: "session_not_connected" });
        return;
      }

      const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      await s.sock.sendMessage(jid, { text });
      respond(res, 200, { ok: true });
      return;
    }

    respond(res, 404, { error: "Not found" });
  } catch (err) {
    logger.error({ err }, "Request error");
    respond(res, 500, { error: err.message ?? "Internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, "WhatsApp Worker listening");
});
