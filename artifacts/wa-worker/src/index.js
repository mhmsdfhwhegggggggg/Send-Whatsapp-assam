import { createServer } from "http";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const PORT = parseInt(process.env.WA_WORKER_PORT ?? "8088", 10);

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }));
}

// Find chromium executable
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ].filter(Boolean);

  // Try `which chromium`
  try {
    const p = execSync("which chromium 2>/dev/null").toString().trim();
    if (p) candidates.push(p);
  } catch {}

  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }
  return null;
}

const CHROMIUM_PATH = findChromium();
log("info", "Chromium path", { path: CHROMIUM_PATH });

// sessions map: sessionId -> { id, status, qr, phone, client }
const sessions = new Map();

let wwebjsModule = null;

async function loadWWebJS() {
  if (wwebjsModule) return wwebjsModule;
  try {
    const m = await import("whatsapp-web.js");
    // Handle both ESM and CJS export shapes
    const Client = m.Client ?? m.default?.Client;
    const LocalAuth = m.LocalAuth ?? m.default?.LocalAuth;
    const QRCode = (await import("qrcode")).default;

    if (!Client || !LocalAuth) {
      throw new Error(`Client=${typeof Client}, LocalAuth=${typeof LocalAuth} — exports missing`);
    }

    wwebjsModule = { Client, LocalAuth, QRCode };
    log("info", "whatsapp-web.js loaded OK");
    return wwebjsModule;
  } catch (e) {
    log("error", "Failed to load whatsapp-web.js", { err: e.message });
    return null;
  }
}

async function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const state = { id: sessionId, status: "initializing", qr: null, phone: null, client: null };
  sessions.set(sessionId, state);

  const mod = await loadWWebJS();
  if (!mod) { state.status = "error"; return state; }

  const { Client, LocalAuth, QRCode } = mod;

  const puppeteerArgs = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-breakpad",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-hang-monitor",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--safebrowsing-disable-auto-update",
      "--password-store=basic",
      "--use-mock-keychain",
    ],
  };

  if (CHROMIUM_PATH) {
    puppeteerArgs.executablePath = CHROMIUM_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
    puppeteer: puppeteerArgs,
    webVersionCache: { type: "none" },
  });

  state.client = client;

  client.on("qr", async (qr) => {
    try {
      state.qr = await QRCode.toDataURL(qr);
      state.status = "qr";
      log("info", "QR ready", { sessionId });
    } catch (e) {
      log("error", "QR gen failed", { sessionId, err: e.message });
    }
  });

  client.on("ready", () => {
    state.status = "connected";
    state.qr = null;
    state.phone = client.info?.wid?.user ?? null;
    log("info", "Client ready", { sessionId, phone: state.phone });
  });

  client.on("disconnected", (reason) => {
    log("warn", "Disconnected", { sessionId, reason });
    state.status = "disconnected";
    state.client = null;
    sessions.delete(sessionId);
    // Auto-reconnect after 10s
    setTimeout(() => createSession(sessionId), 10_000);
  });

  client.on("auth_failure", (msg) => {
    log("warn", "Auth failure", { sessionId, msg });
    state.status = "logged_out";
    state.client = null;
    sessions.delete(sessionId);
  });

  log("info", "Initializing client", { sessionId });
  client.initialize().catch((e) => {
    log("error", "Client init error", { sessionId, err: e.message });
    state.status = "error";
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
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // GET /healthz
    if (req.method === "GET" && parts[0] === "healthz") {
      respond(res, 200, { status: "ok", sessions: sessions.size, chromium: CHROMIUM_PATH ?? "not found" });
      return;
    }

    // GET /sessions
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      const all = {};
      for (const [id, s] of sessions) {
        all[id] = { status: s.status, qr: s.qr, phone: s.phone };
      }
      respond(res, 200, all);
      return;
    }

    // POST /sessions/:id
    if (req.method === "POST" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      await createSession(parts[1]);
      respond(res, 201, { ok: true });
      return;
    }

    // GET /sessions/:id
    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const s = sessions.get(parts[1]);
      if (!s) { respond(res, 404, { error: "Session not found" }); return; }
      respond(res, 200, { status: s.status, qr: s.qr, phone: s.phone });
      return;
    }

    // DELETE /sessions/:id
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1]) {
      await deleteSession(parts[1]);
      respond(res, 200, { ok: true });
      return;
    }

    // POST /send
    if (req.method === "POST" && parts[0] === "send") {
      const body = await bodyJson(req);
      const { sessionId, phone, text } = body;

      if (!sessionId || !phone || !text) {
        respond(res, 400, { error: "sessionId, phone, text required" });
        return;
      }

      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.client) {
        respond(res, 503, { error: "session_not_connected", status: s?.status });
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
  // Pre-load whatsapp-web.js in background so first session is faster
  loadWWebJS();
});
