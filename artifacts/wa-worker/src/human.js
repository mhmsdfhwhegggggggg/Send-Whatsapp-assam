/**
 * human.js — PRODUCTION HARDENED v2
 *
 * Human-behaviour simulation for WhatsApp sessions.
 *
 * Changes in v2:
 *   - Arabic typing speed corrected: 0.18–0.35 chars/sec (was 0.45–0.80, 2× too fast)
 *   - Presence cycle start staggered up to 60 minutes (prevents all-accounts sync)
 *   - organicBreathe() exported for campaign-runner inter-message organic actions
 *   - Multi-phase typing: compose → review → micro-hesitation → send
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Poisson-distributed random delay ──────────────────────────────────────
// Real humans don't wait a uniform random time. Poisson is much more natural.
export function poissonDelay(lambdaMs, minMs = 0, maxMs = Infinity) {
  const raw = -Math.log(1 - Math.random()) * lambdaMs;
  return Math.min(Math.max(raw, minMs), maxMs);
}

// ── Typing duration model — CORRECTED for Arabic mobile ──────────────────
// Measured Arabic mobile typing speed: 15–25 chars/minute = 0.25–0.42 chars/sec.
// With autocorrect interruptions real effective rate is 0.18–0.35 chars/sec.
// Previous value (0.45–0.80) was nearly 2× too fast and detectable.
function typingDurationMs(text) {
  const charCount = text.length;

  // Phase 1: Actual typing time
  const charsPerSec = 0.18 + Math.random() * 0.17; // 0.18–0.35 chars/sec
  const rawTypingMs = (charCount / charsPerSec) * 1000;

  // Phase 2: "Think before typing" — opening hesitation
  const thinkBeforeMs = 800 + Math.random() * 2200;

  // Phase 3: Mid-message pause (longer messages get a "re-read" pause)
  const midPauseMs = charCount > 80
    ? (1500 + Math.random() * 3500)
    : (0);

  // Phase 4: Review pause — reading what you typed before sending
  const reviewMs = 600 + Math.random() * 1400;

  const total = thinkBeforeMs + rawTypingMs + midPauseMs + reviewMs;

  // Clamp: minimum 5s for any message, maximum 30s
  return Math.min(Math.max(total, 5000), 30000);
}

// ── Human send: multi-phase typing + pause + send ─────────────────────────
// Mimics what a real person does:
//   1. Opens the chat (mark as read) — seen receipt before typing
//   2. Think-before-typing pause (decides what to write)
//   3. Starts typing indicator
//   4. Types (duration proportional to message length at realistic Arabic speed)
//   5. Mid-message pause for long messages (re-reads, adjusts)
//   6. Stops typing
//   7. Short review hesitation ("is this ok?")
//   8. Actually sends
export async function humanSend(client, chatId, text) {
  const chat = await client.getChatById(chatId).catch(() => null);

  if (chat) {
    // 1. Mark as read before typing (human opens chat and reads first)
    await chat.sendSeen().catch(() => {});

    // 2. Think-before-typing: 800ms–3s (deciding what to write)
    await sleep(800 + Math.random() * 2200);

    // 3. Start typing indicator
    await chat.sendStateTyping().catch(() => {});

    // 4. Typing phase — realistic Arabic mobile speed
    const charsPerSec    = 0.18 + Math.random() * 0.17;
    const typingDuration = (text.length / charsPerSec) * 1000;
    const clampedTyping  = Math.min(Math.max(typingDuration, 3000), 22000);

    // 5. For long messages: mid-pause (re-reads, adjusts text)
    if (text.length > 80 && clampedTyping > 8000) {
      const firstHalf = clampedTyping * (0.4 + Math.random() * 0.2);
      await sleep(firstHalf);
      // Brief stop-and-restart (realistic correction behaviour)
      await chat.clearState().catch(() => {});
      await sleep(400 + Math.random() * 800);
      await chat.sendStateTyping().catch(() => {});
      await sleep(clampedTyping - firstHalf);
    } else {
      await sleep(clampedTyping);
    }

    // 6. Stop typing (reviewing what was typed)
    await chat.clearState().catch(() => {});

    // 7. Review hesitation: 400ms–1.8s (the "is this ok?" moment)
    await sleep(400 + Math.random() * 1400);
  }

  // 8. Send
  await client.sendMessage(chatId, text);
}

// ── Online presence lifecycle ─────────────────────────────────────────────
// Real phones are not permanently online. They go offline and come back.
//
// CRITICAL FIX v2: Start delay is now up to 60 minutes (was 3 minutes).
// Previously all accounts started their presence cycle within 3 minutes of
// each other (server restart), creating a detectable synchronized pattern.
// Now each account starts at a random offset across a 60-minute window.
export function startPresenceCycle(client, sessionId, log) {
  let running = true;
  let timer   = null;

  async function cycle() {
    if (!running) return;

    // Online for 5–35 minutes (increased variance)
    const onlineDuration = (5 + Math.random() * 30) * 60 * 1000;
    try { await client.sendPresenceAvailable?.(); } catch {}
    log('debug', 'presence: online', { sessionId, durationMin: Math.round(onlineDuration / 60000) });

    await sleep(onlineDuration);
    if (!running) return;

    // Offline for 8–60 minutes (longer offline = more natural, real people put down their phones)
    const offlineDuration = (8 + Math.random() * 52) * 60 * 1000;
    try { await client.sendPresenceUnavailable?.(); } catch {}
    log('debug', 'presence: offline', { sessionId, durationMin: Math.round(offlineDuration / 60000) });

    await sleep(offlineDuration);
    if (!running) return;

    timer = setTimeout(cycle, 0);
  }

  // CRITICAL: Stagger start across 0–60 minutes so accounts don't all go
  // online/offline in sync (server restart causes all to start together).
  const staggerMs = Math.random() * 60 * 60 * 1000;
  log('debug', 'presence: stagger start', { sessionId, staggerMin: Math.round(staggerMs / 60000) });
  timer = setTimeout(cycle, staggerMs);

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

// ── Time-of-day guard ─────────────────────────────────────────────────────
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

// ── Organic breathing ─────────────────────────────────────────────────────
// Called between messages in the campaign runner to simulate the account
// "doing other things" on WhatsApp between sends.
// Returns after completing the organic action (or doing nothing).
export async function organicBreathe(client, log) {
  const r = Math.random();

  if (r < 0.08) {
    // 8%: Toggle presence (go offline briefly, come back) — realistic phone use
    log('debug', 'organic: presence toggle');
    try { await client.sendPresenceUnavailable?.(); } catch {}
    await sleep(15000 + Math.random() * 45000); // 15–60s offline
    try { await client.sendPresenceAvailable?.(); } catch {}

  } else if (r < 0.14) {
    // 6%: Extended pause — phone put down, then picked up again
    log('debug', 'organic: extended pause (phone down)');
    try { await client.sendPresenceUnavailable?.(); } catch {}
    await sleep(3 * 60000 + Math.random() * 7 * 60000); // 3–10 min
    try { await client.sendPresenceAvailable?.(); } catch {}

  } else if (r < 0.18) {
    // 4%: Brief online ping only
    log('debug', 'organic: brief ping');
    try { await client.sendPresenceAvailable?.(); } catch {}
    await sleep(2000 + Math.random() * 5000);
  }
  // 82%: Do nothing — just continue
}
