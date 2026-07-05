import { createServer } from "http";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createHmac, timingSafeEqual } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const PORT = parseInt(process.env.WA_WORKER_PORT ?? "8088", 10);
const API_SERVER_URL = process.env.API_SERVER_URL ?? "http://localhost:8080";

/**
 * WORKER_SECRET: shared secret between API server and WA worker.
 * All incoming requests to the worker MUST present this in the
 * X-Worker-Secret header. Set the same value in both services.
 * If not set, the worker falls back to logging a warning (dev mode only).
 */
const WORKER_SECRET = process.env.WORKER_SECRET ?? null;
if (!WORKER_SECRET) {
  log("warn", "WORKER_SECRET not set — worker is open to any caller on the network. Set this in production.");
}

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ── Shared-secret auth ─────────────────────────────────────────────── */
function verifyWorkerSecret(req) {
  if (!WORKER_SECRET) return true; // dev mode: allow all
  const presented = req.headers["x-worker-secret"];
  if (!presented) return false;
  try {
    return timingSafeEqual(
      Buffer.from(presented, "utf8"),
      Buffer.from(WORKER_SECRET, "utf8"),
    );
  } catch {
    return false;
  }
}

// ============================================================
// Chromium discovery
// ============================================================
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ].filter(Boolean);
  try {
    const p = execSync("which chromium 2>/dev/null").toString().trim();
    if (p) candidates.push(p);
  } catch {}
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return null;
}

const CHROMIUM_PATH = findChromium();
log("info", "Chromium path", { path: CHROMIUM_PATH ?? "not found" });

// ============================================================
// Realistic User-Agent pool (Android Chrome — what real phones send)
// ============================================================
const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; SM-A526B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; OnePlus 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ============================================================
// Build safe Puppeteer launch args
// Key: NO --single-process, NO --disable-extensions, NO bot flags
// ============================================================
function buildLaunchArgs(proxy) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    // Anti-detection: removes the most obvious Puppeteer fingerprint
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    // Realistic window size
    "--window-size=1280,800",
    // Language matching typical Arab phone
    "--lang=ar-SA,ar",
    // GPU/stability flags (no red flags)
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-crash-reporter",
    "--no-first-run",
  ];

  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
  }

  return args;
}

// ============================================================
// Module singletons
// ============================================================
let _puppeteerExtra = null;
let _wwejs = null;

async function loadPuppeteerExtra() {
  if (_puppeteerExtra) return _puppeteerExtra;
  try {
    const pex = (await import("puppeteer-extra")).default;
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    pex.use(StealthPlugin());
    _puppeteerExtra = pex;
    log("info", "puppeteer-extra + stealth plugin loaded ✓");
    return pex;
  } catch (e) {
    log("warn", "puppeteer-extra unavailable, falling back to bare puppeteer", { err: e.message });
    try {
      const pup = (await import("puppeteer")).default;
      _puppeteerExtra = pup;
      return pup;
    } catch (e2) {
      log("error", "puppeteer also unavailable", { err: e2.message });
      return null;
    }
  }
}

async function loadWWebJS() {
  if (_wwejs) return _wwejs;
  try {
    const m = await import("whatsapp-web.js");
    const Client = m.Client ?? m.default?.Client;
    const LocalAuth = m.LocalAuth ?? m.default?.LocalAuth;
    const QRCode = (await import("qrcode")).default;
    if (!Client || !LocalAuth) throw new Error("exports missing");
    _wwejs = { Client, LocalAuth, QRCode };
    log("info", "whatsapp-web.js loaded ✓");
    return _wwejs;
  } catch (e) {
    log("error", "Failed to load whatsapp-web.js", { err: e.message });
    return null;
  }
}

// ============================================================
// Session init queue — MAX 1 concurrent init
// Prevents multiple Chromium instances launching simultaneously from same IP
// Each init is separated by a 5–12s human-like gap
// ============================================================
let _initQueue = Promise.resolve();
let activeInits = 0;

function enqueueInit(fn) {
  _initQueue = _initQueue.then(async () => {
    activeInits++;
    try {
      return await fn();
    } finally {
      activeInits--;
      // Always wait between inits — looks human, avoids IP-level rate-limiting
      const gap = randomBetween(5000, 12000);
      log("info", `Init queue: waiting ${gap}ms before next session`);
      await sleep(gap);
    }
  });
  return _initQueue;
}

// ============================================================
// Sessions map
// ============================================================
const sessions = new Map();

// ============================================================
// Forward inbound messages to API server
// ============================================================
async function forwardInbound(sessionId, phone, body) {
  try {
    const s = sessions.get(sessionId);
    const accountId = s?.accountId ?? sessionId;
    const headers = { "Content-Type": "application/json" };
    if (WORKER_SECRET) headers["X-Worker-Secret"] = WORKER_SECRET;
    const res = await fetch(`${API_SERVER_URL}/api/inbound`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, body, accountId }),
    });
    if (!res.ok) log("warn", "inbound forward failed", { status: res.status });
  } catch (e) {
    log("warn", "inbound forward error", { err: e.message });
  }
}

// ============================================================
// Create a new WhatsApp session
// ============================================================
async function createSession(sessionId, accountId = null, proxy = null) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const state = {
    id: sessionId,
    status: "initializing",
    qr: null,
    phone: null,
    client: null,
    browser: null,
    accountId,
    proxy,
  };
  sessions.set(sessionId, state);

  enqueueInit(() => _doInit(state)).catch((e) => {
    log("error", "Session init failed", { sessionId, err: e.message });
    state.status = "error";
  });

  return state;
}

async function _doInit(state) {
  const { id: sessionId, proxy } = state;
  log("info", "Starting session init", { sessionId, hasProxy: !!proxy });

  const mod = await loadWWebJS();
  if (!mod) { state.status = "error"; return; }
  const { Client, LocalAuth, QRCode } = mod;

  const pex = await loadPuppeteerExtra();
  let wsEndpoint = null;

  // ── APPROACH: launch stealth browser, pass WSEndpoint to wwejs ──
  // Stealth patches are applied at browser level BEFORE WhatsApp loads JS.
  if (pex) {
    try {
      const ua = randomUA();
      const launchOpts = {
        headless: true,
        args: buildLaunchArgs(proxy),
        ignoreHTTPSErrors: true,
      };
      if (CHROMIUM_PATH) launchOpts.executablePath = CHROMIUM_PATH;

      const browser = await pex.launch(launchOpts);

      // Patch every page in this browser instance
      browser.on("targetcreated", async (target) => {
        try {
          const page = await target.page();
          if (!page) return;
          await page.setUserAgent(ua);
          await page.evaluateOnNewDocument(() => {
            // Remove webdriver flag — most important single check
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
            // Remove Puppeteer/CDP artifacts
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
            // Realistic plugin count (0 plugins = headless red flag)
            Object.defineProperty(navigator, "plugins", {
              get: () => [1, 2, 3, 4, 5],
            });
            // Realistic language matching our UA
            Object.defineProperty(navigator, "languages", {
              get: () => ["ar-SA", "ar", "en-US", "en"],
            });
          });
        } catch {}
      });

      wsEndpoint = browser.wsEndpoint();
      state.browser = browser;
      log("info", "Stealth browser launched ✓", { sessionId, ua: ua.slice(0, 60) });
    } catch (e) {
      log("warn", "Stealth browser launch failed, falling back", { sessionId, err: e.message });
      wsEndpoint = null;
    }
  }

  const clientOpts = {
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
    // LOCAL cache — real browsers cache WA Web assets; "none" is a fingerprint
    webVersionCache: { type: "local" },
  };

  if (wsEndpoint) {
    clientOpts.puppeteer = { browserWSEndpoint: wsEndpoint };
  } else {
    // Fallback: wwejs launches its own browser with safe args
    const opts = {
      headless: true,
      args: buildLaunchArgs(proxy),
      ignoreHTTPSErrors: true,
    };
    if (CHROMIUM_PATH) opts.executablePath = CHROMIUM_PATH;
    clientOpts.puppeteer = opts;
  }

  const client = new Client(clientOpts);
  state.client = client;

  client.on("qr", async (qr) => {
    try {
      state.qr = await QRCode.toDataURL(qr);
      state.status = "qr";
      log("info", "QR ready", { sessionId });
    } catch (e) {
      log("error", "QR generation failed", { sessionId, err: e.message });
    }
  });

  client.on("authenticated", () => {
    log("info", "Authenticated ✓", { sessionId });
    state.qr = null;
  });

  client.on("ready", async () => {
    state.status = "connected";
    state.qr = null;
    const info = client.info;
    state.phone = info?.wid?.user ?? null;
    log("info", "Session connected ✓", { sessionId, phone: state.phone });
    // Human-like pause — simulates a person picking up the phone
    const humanPause = randomBetween(4000, 12000);
    await sleep(humanPause);
  });

  client.on("auth_failure", (msg) => {
    log("error", "Auth failure", { sessionId, msg });
    state.status = "logged_out";
  });

  client.on("disconnected", (reason) => {
    log("warn", "Disconnected", { sessionId, reason });
    state.status = "disconnected";
  });

  client.on("message", async (msg) => {
    if (!msg.fromMe && msg.from !== "status@broadcast") {
      await forwardInbound(sessionId, msg.from.replace("@c.us", ""), msg.body);
    }
  });

  await client.initialize();
}

// ============================================================
// Delete session
// ============================================================
async function deleteSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    if (s.client) await s.client.destroy().catch(() => {});
    if (s.browser) await s.browser.close().catch(() => {});
  } catch (e) {
    log("warn", "Error destroying session", { sessionId, err: e.message });
  }
  sessions.delete(sessionId);
  log("info", "Session deleted", { sessionId });
}

// ============================================================
// HTTP helpers
// ============================================================
function respond(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => (buf += d));
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

// ============================================================
// HTTP Server — every non-health endpoint requires WORKER_SECRET
// ============================================================
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // GET /healthz — no auth (monitoring/k8s probes)
    if (req.method === "GET" && parts[0] === "healthz") {
      respond(res, 200, {
        status: "ok",
        sessions: sessions.size,
        activeInits,
        chromium: CHROMIUM_PATH ?? "not found",
      });
      return;
    }

    // All other endpoints require shared secret
    if (!verifyWorkerSecret(req)) {
      respond(res, 401, { error: "Unauthorized" });
      return;
    }

    // GET /sessions — list all
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      const all = {};
      for (const [id, s] of sessions) {
        all[id] = { status: s.status, qr: s.qr, phone: s.phone };
      }
      respond(res, 200, all);
      return;
    }

    // POST /sessions/:id — create session
    if (req.method === "POST" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const body = await bodyJson(req);
      await createSession(parts[1], body.accountId ?? null, body.proxy ?? null);
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

    // DELETE /sessions/:id
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1]) {
      await deleteSession(parts[1]);
      respond(res, 200, { ok: true });
      return;
    }

    // POST /send — send a message
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
  Promise.all([loadWWebJS(), loadPuppeteerExtra()]).catch(() => {});
});
