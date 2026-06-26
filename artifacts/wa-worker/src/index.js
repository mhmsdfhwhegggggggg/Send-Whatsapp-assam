import { createServer } from "http";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const PORT = parseInt(process.env.WA_WORKER_PORT ?? "8088", 10);

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }));
}

// sessions map: sessionId -> { id, status, qr, phone, client }
const sessions = new Map();

// Lazy-load heavy deps so server starts fast even if puppeteer is slow
let Client, LocalAuth, QRCode, puppeteerLoaded = false;

async function loadDeps() {
  if (puppeteerLoaded) return true;
  try {
    const wwebjs = await import("whatsapp-web.js");
    Client = wwebjs.Client;
    LocalAuth = wwebjs.LocalAuth;
    QRCode = (await import("qrcode")).default;
    puppeteerLoaded = true;
    log("info", "whatsapp-web.js loaded");
    return true;
  } catch (e) {
    log("error", "Failed to load whatsapp-web.js", { err: e.message });
    return false;
  }
}

async function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const state = { id: sessionId, status: "initializing", qr: null, phone: null, client: null };
  sessions.set(sessionId, state);

  const ok = await loadDeps();
  if (!ok) { state.status = "disconnected"; return state; }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--no-first-run", "--no-zygote", "--single-process",
      ],
    },
    webVersionCache: { type: "none" },
  });

  state.client = client;

  client.on("qr", async (qr) => {
    try {
      state.qr = await QRCode.toDataURL(qr);
      state.status = "qr";
      log("info", "QR ready", { sessionId });
    } catch (e) { log("error", "QR gen failed", { err: e.message }); }
  });

  client.on("ready", () => {
    state.status = "connected";
    state.qr = null;
    state.phone = client.info?.wid?.user ?? null;
    log("info", "Client ready", { sessionId, phone: state.phone });
  });

  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    state.client = null;
    log("warn", "Disconnected", { sessionId, reason });
    // reconnect after 10 seconds
    setTimeout(() => {
      sessions.delete(sessionId);
      createSession(sessionId);
    }, 10_000);
  });

  client.on("auth_failure", () => {
    state.status = "logged_out";
    state.client = null;
    sessions.delete(sessionId);
    log("warn", "Auth failure", { sessionId });
  });

  client.initialize().catch(e => {
    log("error", "init failed", { sessionId, err: e.message });
    state.status = "disconnected";
  });

  return state;
}

async function deleteSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s?.client) {
    try { await s.client.destroy(); } catch {}
  }
  sessions.delete(sessionId);
}

function respond(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // GET /healthz
    if (req.method === "GET" && parts[0] === "healthz") {
      respond(res, 200, { status: "ok", sessions: sessions.size });
      return;
    }

    // GET /sessions — list all
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      const all = {};
      for (const [id, s] of sessions) all[id] = { status: s.status, qr: s.qr, phone: s.phone };
      respond(res, 200, all);
      return;
    }

    // POST /sessions/:id — create/start session
    if (req.method === "POST" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      await createSession(parts[1]);
      respond(res, 201, { ok: true });
      return;
    }

    // GET /sessions/:id — status
    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const s = sessions.get(parts[1]);
      if (!s) { respond(res, 404, { error: "Session not found" }); return; }
      respond(res, 200, { status: s.status, qr: s.qr, phone: s.phone });
      return;
    }

    // DELETE /sessions/:id — logout
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1]) {
      await deleteSession(parts[1]);
      respond(res, 200, { ok: true });
      return;
    }

    // POST /send — send message
    if (req.method === "POST" && parts[0] === "send") {
      const body = await bodyJson(req);
      const { sessionId, phone, text } = body;
      if (!sessionId || !phone || !text) {
        respond(res, 400, { error: "sessionId, phone, and text are required" });
        return;
      }
      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.client) {
        respond(res, 503, { error: "session_not_connected" });
        return;
      }
      const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
      await s.client.sendMessage(chatId, text);
      respond(res, 200, { ok: true });
      return;
    }

    respond(res, 404, { error: "Not found" });
  } catch (err) {
    log("error", "Request error", { err: err.message });
    respond(res, 500, { error: err.message ?? "Internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log("info", "WhatsApp Worker listening", { port: PORT });
  // Pre-load deps in background
  loadDeps();
});
