/**
 * human.js
 *
 * Human-behaviour simulation for WhatsApp sessions.
 *
 * Implements:
 *   - humanSend()       — typing indicator → realistic pause → send
 *   - presenceCycle()   — periodic online/offline cycling
 *   - poissonDelay()    — Poisson-distributed inter-message delays
 *   - timeOfDayOk()     — only send during realistic waking hours
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Poisson-distributed random delay ──────────────────────────────────────
// Real humans don't wait a uniform random time. Poisson is much more natural.
// λ = mean delay in ms
export function poissonDelay(lambdaMs, minMs = 0, maxMs = Infinity) {
  // Poisson inter-arrival: -ln(U) * λ
  const raw = -Math.log(1 - Math.random()) * lambdaMs;
  return Math.min(Math.max(raw, minMs), maxMs);
}

// ── Typing duration model ─────────────────────────────────────────────────
// Real Arabic typing: ~25-35 chars/min on mobile
// We calculate realistic duration then clamp to 3-18 seconds.
function typingDurationMs(text) {
  const charCount = text.length;
  const charsPerSec = 0.45 + Math.random() * 0.35;   // 0.45–0.80 chars/sec
  const rawMs = (charCount / charsPerSec) * 1000;
  // Add think time: 1–4 seconds
  const thinkMs = (1000 + Math.random() * 3000);
  return Math.min(Math.max(rawMs + thinkMs, 3000), 18000);
}

// ── Human send: typing + pause + send ────────────────────────────────────
// This mimics what a real person does:
//   1. Opens the chat (mark as read)
//   2. Starts typing
//   3. Finishes (stop typing) after realistic time
//   4. Tiny hesitation
//   5. Actually sends
export async function humanSend(client, chatId, text) {
  const chat = await client.getChatById(chatId).catch(() => null);

  if (chat) {
    // 1. Mark as read (seen) before typing — human behaviour
    await chat.sendSeen().catch(() => {});

    // 2. Start typing indicator
    await chat.sendStateTyping().catch(() => {});

    // 3. Wait for realistic typing duration
    const typeDuration = typingDurationMs(text);
    await sleep(typeDuration);

    // 4. Stop typing (pause ~300–1200ms — the "reviewing what I typed" moment)
    await chat.clearState().catch(() => {});
    await sleep(300 + Math.random() * 900);
  }

  // 5. Send
  await client.sendMessage(chatId, text);
}

// ── Online presence lifecycle ─────────────────────────────────────────────
// Real phones are not permanently online. They go offline and come back.
// This creates a realistic "available" signal without triggering bot detection.
export function startPresenceCycle(client, sessionId, log) {
  let running = true;
  let timer = null;

  async function cycle() {
    if (!running) return;

    // Online for 3–25 minutes
    const onlineDuration = (3 + Math.random() * 22) * 60 * 1000;
    try { await client.sendPresenceAvailable?.(); } catch {}
    log('debug', 'presence: online', { sessionId, durationMin: Math.round(onlineDuration / 60000) });

    await sleep(onlineDuration);
    if (!running) return;

    // Offline for 5–45 minutes (longer offline = more natural)
    const offlineDuration = (5 + Math.random() * 40) * 60 * 1000;
    try { await client.sendPresenceUnavailable?.(); } catch {}
    log('debug', 'presence: offline', { sessionId, durationMin: Math.round(offlineDuration / 60000) });

    await sleep(offlineDuration);
    if (!running) return;

    timer = setTimeout(cycle, 0);
  }

  // Start after a random delay so all accounts don't sync
  setTimeout(cycle, Math.random() * 3 * 60 * 1000);

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

// ── Time-of-day guard ─────────────────────────────────────────────────────
// Bias sends toward times people actually use WhatsApp.
// Returns true if current time is within the configured window.
export function isWorkingHour(startHour, endHour) {
  const h = new Date().getHours();
  return h >= startHour && h < endHour;
}

// ── Inter-message delay ───────────────────────────────────────────────────
// Returns ms to wait between messages.
// Uses Poisson so delays cluster around the mean but have a long tail.
export function interMessageDelayMs(minSec, maxSec) {
  const meanMs = ((minSec + maxSec) / 2) * 1000;
  const delay  = poissonDelay(meanMs, minSec * 1000, maxSec * 1000);
  // Additional micro-variation: ±5% jitter
  const jitter = delay * (0.95 + Math.random() * 0.1);
  return Math.round(jitter);
}
