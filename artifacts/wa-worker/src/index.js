/**
 * wa-worker/src/index.js  — WhatsApp Worker  (maximum anti-ban edition v3)
 *
 * Anti-ban layers:
 *   1. puppeteer-extra + stealth plugin
 *   2. Full fingerprint stack (v3: noiseSeed حتمي من sessionId)
 *   3. Deterministic device profile per session
 *   4. Local webVersionCache
 *   5. Session init queue — max 1 concurrent init, 5–12 s gap
 *   6. Human send — multi-phase typing + hesitation
 *   7. Presence lifecycle — random online/offline cycles
 *   8. Shared-secret authentication on all endpoints
 *   9. [NEW v3] POST /presence — ضبط presence من campaign-runner
 */

import { createServer }            from "http";
import { mkdirSync, existsSync }   from "fs";
import path                        from "path";
import { fileURLToPath }           from "url";
import { execSync }                from "child_process";
import { timingSafeEqual }         from "crypto";

import { buildFingerprintScript, pickProfile } from "./fingerprint.js";
import { humanSend, startPresenceCycle, interMessageDelayMs } from "./human.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const PORT         = parseInt(process.env.WA_WORKER_PORT ?? "8088", 10);
const API_URL      = process.env.API_SERVER_URL ?? "http://localhost:8080";
const WORKER_SECRET = process.env.WORKER_SECRET ?? null;

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

// ── Logger ─────────────────────────────────────────────────────────────────
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }));
}

if (!WORKER_SECRET) {
  log("warn", "WORKER_SECRET not set — worker is open. Set in production.");
}

// ── Auth ───────────────────────────────────────────────────────────────────
function verifySecret(req) {
  if (!WORKER_SECRET) return true;
  const h = req.headers["x-worker-secret"];
  if (!h) return false;
  try {
    // timingSafeEqual requires same-length buffers
    const a = Buffer.from(h, "utf8");
    const b = Buffer.from(WORKER_SECRET, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

// ── Chromium discovery ─────────────────────────────────────────────────────
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ].filter(Boolean);
  try { candidates.push(execSync("which chromium 2>/dev/null").toString().trim()); } catch {}
  for (const p of candidates) { try { if (existsSync(p)) return p; } catch {} }
  return null;
}
const CHROMIUM_PATH = findChromium();
log("info", "Chromium path", { path: CHROMIUM_PATH ?? "not found" });

// ── Module singletons ──────────────────────────────────────────────────────
let _pex = null, _wwejs = null;

async function loadPuppeteerExtra() {
  if (_pex) return _pex;
  try {
    const pex         = (await import("puppeteer-extra")).default;
    const Stealth     = (await import("puppeteer-extra-plugin-stealth")).default;
    pex.use(Stealth());
    _pex = pex;
    log("info", "puppeteer-extra + stealth ✓");
    return pex;
  } catch (e) {
    log("warn", "puppeteer-extra unavailable, falling back to bare puppeteer", { err: e.message });
    try {
      _pex = (await import("puppeteer")).default;
      log("warn", "CAUTION: running without stealth — sessions may be detected as bots");
      return _pex;
    } catch {
      log("error", "Neither puppeteer-extra nor puppeteer available");
      return null;
    }
  }
}

async function loadWWebJS() {
  if (_wwejs) return _wwejs;
  try {
    const m       = await import("whatsapp-web.js");
    const Client  = m.Client   ?? m.default?.Client;
    const LocalAuth = m.LocalAuth ?? m.default?.LocalAuth;
    const QRCode  = (await import("qrcode")).default;
    if (!Client || !LocalAuth) throw new Error("exports missing");
    _wwejs = { Client, LocalAuth, QRCode };
    log("info", "whatsapp-web.js ✓");
    return _wwejs;
  } catch (e) {
    log("error", "whatsapp-web.js load failed", { err: e.message });
    return null;
  }
}

// ── Session init queue ─────────────────────────────────────────────────────
let _queue = Promise.resolve();
let activeInits = 0;

function enqueueInit(fn) {
  _queue = _queue.then(async () => {
    activeInits++;
    try { return await fn(); }
    finally {
      activeInits--;
      const gap = 5000 + Math.random() * 7000;
      log("info", `init-queue: gap ${Math.round(gap / 1000)}s`);
      await new Promise(r => setTimeout(r, gap));
    }
  });
  return _queue;
}

// ── Sessions ───────────────────────────────────────────────────────────────
const sessions = new Map();

// ── Forward inbound to API server ──────────────────────────────────────────
async function forwardInbound(sessionId, phone, body) {
  try {
    const accountId = sessions.get(sessionId)?.accountId ?? sessionId;
    const headers = { "Content-Type": "application/json" };
    if (WORKER_SECRET) headers["X-Worker-Secret"] = WORKER_SECRET;
    const res = await fetch(`${API_URL}/api/inbound`, {
      method: "POST", headers,
      body: JSON.stringify({ phone, body, accountId }),
    });
    if (!res.ok) log("warn", "inbound forward failed", { status: res.status });
  } catch (e) { log("warn", "inbound forward error", { err: e.message }); }
}

// ── Create session ─────────────────────────────────────────────────────────
async function createSession(sessionId, accountId = null, proxy = null) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  const state = { id: sessionId, status: "initializing", qr: null, phone: null,
                  client: null, browser: null, presenceCycle: null, accountId, proxy };
  sessions.set(sessionId, state);
  enqueueInit(() => _doInit(state)).catch(e => {
    log("error", "session init failed", { sessionId, err: e.message });
    state.status = "error";
  });
  return state;
}

async function _doInit(state) {
  const { id: sessionId, proxy } = state;

  const profile = pickProfile(sessionId);
  log("info", "device profile selected", { sessionId, ua: profile.ua.slice(0, 60) });

  const mod = await loadWWebJS();
  if (!mod) { state.status = "error"; return; }
  const { Client, LocalAuth, QRCode } = mod;

  const pex = await loadPuppeteerExtra();
  let wsEndpoint = null;

  // ── Launch stealth browser ─────────────────────────────────────────────
  if (pex) {
    try {
      const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        `--window-size=${profile.screen.width},${profile.screen.height}`,
        `--lang=${profile.languages[0]}`,
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-crash-reporter",
        "--no-first-run",
        `--tz=${profile.timezone}`,
      ];
      if (proxy) launchArgs.push(`--proxy-server=${proxy}`);

      const launchOpts = {
        headless: true,
        args: launchArgs,
        ignoreHTTPSErrors: true,
      };
      if (CHROMIUM_PATH) launchOpts.executablePath = CHROMIUM_PATH;

      const browser = await pex.launch(launchOpts);

      // إصلاح v3: نمرر sessionId إلى buildFingerprintScript لضمان noiseSeed حتمي
      const fpScript = buildFingerprintScript(profile, sessionId);

      browser.on("targetcreated", async target => {
        try {
          const page = await target.page();
          if (!page) return;
          await page.setUserAgent(profile.ua);
          await page.evaluateOnNewDocument(fpScript);
          await page.setViewport({
            width: profile.screen.width,
            height: profile.screen.height,
            deviceScaleFactor: profile.dpr ?? 2.625,
            isMobile: true,
            hasTouch: true,
          }).catch(() => {});
        } catch {}
      });

      wsEndpoint = browser.wsEndpoint();
      state.browser = browser;
      log("info", "stealth browser launched ✓", { sessionId });
    } catch (e) {
      log("warn", "stealth browser launch failed, will fall back", { sessionId, err: e.message });
      wsEndpoint = null;
    }
  }

  // ── Build wwejs client ─────────────────────────────────────────────────
  const clientOpts = {
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
    webVersionCache: { type: "local" },
  };

  if (wsEndpoint) {
    clientOpts.puppeteer = { browserWSEndpoint: wsEndpoint };
  } else {
    const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
                  "--disable-blink-features=AutomationControlled", "--disable-gpu"];
    if (proxy) args.push(`--proxy-server=${proxy}`);
    const opts = { headless: true, args, ignoreHTTPSErrors: true };
    if (CHROMIUM_PATH) opts.executablePath = CHROMIUM_PATH;
    clientOpts.puppeteer = opts;
  }

  const client = new Client(clientOpts);
  state.client = client;

  // ── Events ────────────────────────────────────────────────────────────
  client.on("qr", async qr => {
    try { state.qr = await QRCode.toDataURL(qr); state.status = "qr"; }
    catch (e) { log("error", "QR gen failed", { sessionId, err: e.message }); }
  });

  client.on("authenticated", () => { state.qr = null; });

  client.on("ready", async () => {
    state.status = "connected";
    state.qr = null;
    state.phone = client.info?.wid?.user ?? null;
    log("info", "session connected ✓", { sessionId, phone: state.phone });

    // Human pause after connecting (4–12 s)
    await new Promise(r => setTimeout(r, 4000 + Math.random() * 8000));

    state.presenceCycle = startPresenceCycle(client, sessionId, log);
  });

  client.on("auth_failure", msg => {
    state.status = "logged_out";
    log("error", "auth failure", { sessionId, msg });
  });
  client.on("disconnected", reason => {
    state.status = "disconnected";
    state.presenceCycle?.stop();
    log("warn", "disconnected", { sessionId, reason });
  });

  client.on("message", async msg => {
    if (!msg.fromMe && msg.from !== "status@broadcast") {
      await forwardInbound(sessionId, msg.from.replace("@c.us", ""), msg.body);
    }
  });

  await client.initialize();
}

// ── Delete session ─────────────────────────────────────────────────────────
async function deleteSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.presenceCycle?.stop();
  try {
    if (s.client)  await s.client.destroy().catch(() => {});
    if (s.browser) await s.browser.close().catch(() => {});
  } catch {}
  sessions.delete(sessionId);
  log("info", "session deleted", { sessionId });
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function respond(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", d => (buf += d));
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url   = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // GET /healthz — no auth (probes)
    if (req.method === "GET" && parts[0] === "healthz") {
      respond(res, 200, {
        ok: true, sessions: sessions.size, activeInits,
        chromium: CHROMIUM_PATH ?? "not found",
      });
      return;
    }

    // All other endpoints require shared secret
    if (!verifySecret(req)) { respond(res, 401, { error: "Unauthorized" }); return; }

    // GET /sessions
    if (req.method === "GET" && parts[0] === "sessions" && !parts[1]) {
      const all = {};
      for (const [id, s] of sessions)
        all[id] = { status: s.status, qr: s.qr, phone: s.phone };
      respond(res, 200, all);
      return;
    }

    // POST /sessions/:id
    if (req.method === "POST" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const body = await readBody(req);
      await createSession(parts[1], body.accountId ?? null, body.proxy ?? null);
      respond(res, 201, { ok: true });
      return;
    }

    // GET /sessions/:id
    if (req.method === "GET" && parts[0] === "sessions" && parts[1] && !parts[2]) {
      const s = sessions.get(parts[1]);
      if (!s) { respond(res, 404, { error: "not found" }); return; }
      respond(res, 200, { status: s.status, qr: s.qr, phone: s.phone });
      return;
    }

    // DELETE /sessions/:id
    if (req.method === "DELETE" && parts[0] === "sessions" && parts[1]) {
      await deleteSession(parts[1]);
      respond(res, 200, { ok: true });
      return;
    }

    // POST /send  { sessionId, phone, text, humanMode? }
    if (req.method === "POST" && parts[0] === "send") {
      const body = await readBody(req);
      const { sessionId, phone, text, humanMode = true } = body;
      if (!sessionId || !phone || !text) {
        respond(res, 400, { error: "sessionId, phone, text required" }); return;
      }
      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.client) {
        respond(res, 503, { error: "session_not_connected", status: s?.status }); return;
      }
      const chatId = phone.includes("@") ? phone : `${phone}@c.us`;

      if (humanMode) {
        await humanSend(s.client, chatId, text);
      } else {
        await s.client.sendMessage(chatId, text);
      }
      respond(res, 200, { ok: true });
      return;
    }

    // POST /check-phone  { sessionId, phone }
    if (req.method === "POST" && parts[0] === "check-phone") {
      const body = await readBody(req);
      const { sessionId, phone } = body;
      if (!sessionId || !phone) {
        respond(res, 400, { error: "sessionId, phone required" }); return;
      }
      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.client) {
        respond(res, 200, { registered: true, reason: "session_not_connected" }); return;
      }
      try {
        const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
        const contact = await s.client.getNumberId(chatId);
        respond(res, 200, { registered: !!contact });
      } catch (e) {
        log("warn", "check-phone error", { phone, err: e.message });
        respond(res, 200, { registered: true, reason: "check_error" });
      }
      return;
    }

    // POST /presence  { sessionId, available: boolean }
    // [جديد v3] يُستدعى من campaign-runner لضبط الـ presence فعلياً
    if (req.method === "POST" && parts[0] === "presence") {
      const body = await readBody(req);
      const { sessionId, available } = body;
      if (!sessionId || available === undefined) {
        respond(res, 400, { error: "sessionId, available required" }); return;
      }
      const s = sessions.get(sessionId);
      if (!s || s.status !== "connected" || !s.client) {
        respond(res, 200, { ok: true, skipped: true, reason: "session_not_connected" }); return;
      }
      try {
        if (available) {
          await s.client.sendPresenceAvailable?.();
        } else {
          await s.client.sendPresenceUnavailable?.();
        }
        respond(res, 200, { ok: true, available });
      } catch (e) {
        log("warn", "presence set error", { sessionId, err: e.message });
        respond(res, 200, { ok: true, skipped: true, reason: "presence_error" });
      }
      return;
    }

    respond(res, 404, { error: "Not found" });
  } catch (err) {
    log("error", "request error", { err: err.message, stack: err.stack?.split("\n")[1] });
    respond(res, 500, { error: err.message ?? "Internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log("info", "WA Worker listening", { port: PORT });
  Promise.all([loadWWebJS(), loadPuppeteerExtra()]).catch(() => {});
});
