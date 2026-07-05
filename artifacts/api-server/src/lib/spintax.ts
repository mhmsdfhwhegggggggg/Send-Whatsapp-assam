/**
 * spintax.ts — Advanced message variation engine — PRODUCTION HARDENED v2
 *
 * Layers applied in order:
 *   1. Multi-level spintax {a|b|{c|d}}
 *   2. Fill named variables (name, university, discount, serviceType, city)
 *   3. Arabic diacritics (tashkeel) variation
 *   4. Unicode Arabic homoglyphs (invisible substitution)
 *   5. Emoji injection at random positions
 *   6. Multi-point invisible zero-width characters
 *   7. Sentence-level structural variation (optional postscript)
 *
 * New in v2:
 *   - calculateSpamScore(): pre-send content risk assessment
 *   - Extended fillVars with city variable
 *   - More diacritics patterns
 */

// ── 1. Multi-level Spintax ─────────────────────────────────────────────────
export function applySpintax(text: string): string {
  let prev = "";
  let current = text;
  while (current !== prev) {
    prev = current;
    current = current.replace(/\{([^{}]+)\}/g, (_, options: string) => {
      const parts = options.split("|");
      return parts[Math.floor(Math.random() * parts.length)];
    });
  }
  return current;
}

// ── 2. Variable substitution ───────────────────────────────────────────────
export function fillVars(
  text: string,
  vars: Record<string, string | undefined>,
): string {
  return text
    .replace(/\{اسم\}/g,      vars.name        ?? "")
    .replace(/\{جامعة\}/g,    vars.university  ?? "")
    .replace(/\{تخفيض\}/g,    vars.discount    ?? "")
    .replace(/\{خدمة\}/g,     vars.serviceType ?? "")
    .replace(/\{مدينة\}/g,    vars.city        ?? "")
    .replace(/\{name\}/gi,    vars.name        ?? "")
    .replace(/\{city\}/gi,    vars.city        ?? "");
}

// ── 3. Arabic diacritics variation ────────────────────────────────────────
const DIACRITICS_MAP: [RegExp, string[]][] = [
  [/مرحبا/g,    ["مرحباً", "مرحبا", "مَرحبًا"]],
  [/شكرا/g,     ["شكراً", "شكرا", "شُكراً"]],
  [/اهلا/g,     ["أهلاً", "اهلا", "أَهلاً"]],
  [/سلام/g,     ["سلام", "سَلام"]],
  [/يوم/g,      ["يوم", "يَوم"]],
  [/طيب/g,      ["طيب", "طَيِّب"]],
  [/كريم/g,     ["كريم", "كَريم"]],
  [/عزيز/g,     ["عزيز", "عَزيز"]],
  [/صباح/g,     ["صباح", "صَباح"]],
  [/مساء/g,     ["مساء", "مَساء"]],
];

export function applyDiacriticsVariation(text: string): string {
  let result = text;
  for (const [pattern, variants] of DIACRITICS_MAP) {
    if (Math.random() < 0.4) {
      const pick = variants[Math.floor(Math.random() * variants.length)];
      result = result.replace(pattern, pick);
    }
  }
  return result;
}

// ── 4. Arabic homoglyphs (visually identical substitutions) ────────────────
const HOMOGLYPHS: [string, string][] = [
  ["ك", "\u06A9"],   // Arabic Farsi Keh
  ["ي", "\u06CC"],   // Arabic Farsi Yeh
  ["ه", "\u06BE"],   // Arabic Heh Dochashmi
];

export function applyHomoglyphs(text: string): string {
  let result = text;
  for (const [original, replacement] of HOMOGLYPHS) {
    if (Math.random() < 0.3) {
      result = result.replace(new RegExp(original, "g"), (char) =>
        Math.random() < 0.3 ? replacement : char,
      );
    }
  }
  return result;
}

// ── 5. Emoji injection ─────────────────────────────────────────────────────
const EMOJI_POOL = ["✨", "💡", "📌", "🎯", "✅", "🌟", "👋", "📋", "🔔", "💼", "📞", "🤝"];

export function injectEmoji(text: string): string {
  if (Math.random() > 0.6) return text;
  const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  const lines = text.split("\n");
  if (Math.random() < 0.5 && lines.length > 0) {
    lines[0] = `${lines[0]} ${emoji}`;
  } else {
    lines[lines.length - 1] = `${emoji} ${lines[lines.length - 1]}`;
  }
  return lines.join("\n");
}

// ── 6. Multi-point invisible characters ──────────────────────────────────
const ZW_CHARS = ["\u200B", "\u200C", "\u200D", "\uFEFF", "\u2060", "\u180E"];

export function addInvisibleChars(text: string): string {
  const numInserts = 2 + Math.floor(Math.random() * 3);
  let result = text;
  for (let i = 0; i < numInserts; i++) {
    const char = ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)];
    const pos  = Math.floor(Math.random() * result.length);
    result     = result.slice(0, pos) + char + result.slice(pos);
  }
  return result;
}

// ── 7. Optional Arabic postscripts ────────────────────────────────────────
const POSTSCRIPTS = [
  "\n\nنتطلع للتواصل معك 🤝",
  "\n\nلأي استفسار نحن هنا 📞",
  "\n\nبالتوفيق دائماً ✨",
  "\n\nيسعدنا خدمتك",
  "\n\nللمزيد من المعلومات تواصل معنا",
  "\n\nنحن في خدمتك دائماً",
  "",  // No postscript — included 3× to reduce frequency
  "",
  "",
];

export function applyPostscript(text: string): string {
  const ps = POSTSCRIPTS[Math.floor(Math.random() * POSTSCRIPTS.length)];
  return text + ps;
}

// ── Spam score calculator ─────────────────────────────────────────────────
// Pre-send risk assessment: estimate likelihood WhatsApp ML flags this message.
// Returns score 0–100. Score > 60 = high risk, reject send.
// Score 40–60 = moderate, proceed with caution.
export interface SpamScoreResult {
  score: number;
  reasons: string[];
  risk: "low" | "moderate" | "high";
}

export function calculateSpamScore(text: string): SpamScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // URL presence — major signal
  if (/https?:\/\//i.test(text)) {
    score += 25;
    reasons.push("contains URL (+25)");
  }

  // Multiple URLs
  const urlCount = (text.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > 1) {
    score += 15;
    reasons.push(`multiple URLs × ${urlCount} (+15)`);
  }

  // Sales/marketing keywords
  const salesWords = /عرض|خصم|مجاني|مجانا|احصل|اشترك|سارع|محدود|فرصة|ترقية|تخفيض|وفر/i;
  if (salesWords.test(text)) {
    score += 15;
    reasons.push("marketing keywords (+15)");
  }

  // All-caps segments
  if (/[A-Z]{5,}/.test(text)) {
    score += 10;
    reasons.push("ALL CAPS block (+10)");
  }

  // Excessive exclamation/question marks
  const punctCount = (text.match(/[!?]{2,}/g) ?? []).length;
  if (punctCount > 0) {
    score += punctCount * 5;
    reasons.push(`repeated punctuation ×${punctCount} (+${punctCount * 5})`);
  }

  // Message too long
  if (text.length > 600) {
    score += 15;
    reasons.push(`too long (${text.length} chars, +15)`);
  } else if (text.length > 400) {
    score += 8;
    reasons.push(`long message (+8)`);
  }

  // Phone numbers in text
  if (/\b\d{9,14}\b/.test(text)) {
    score += 20;
    reasons.push("phone number in text (+20)");
  }

  // Too many emojis
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  if (emojiCount > 5) {
    score += 10;
    reasons.push(`emoji overload ×${emojiCount} (+10)`);
  }

  // Forwarded content markers
  if (/تمت إعادة التوجيه|forwarded|تمت اعادة/i.test(text)) {
    score += 20;
    reasons.push("forwarded message marker (+20)");
  }

  const risk: SpamScoreResult["risk"] = score >= 60 ? "high" : score >= 40 ? "moderate" : "low";

  return { score: Math.min(score, 100), reasons, risk };
}

// ── Sanitize phone number ──────────────────────────────────────────────────
export function sanitizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-\+\(\)]/g, "");
  if (!/^\d{9,15}$/.test(digits)) {
    throw new Error(`Invalid phone number: ${raw}`);
  }
  return digits;
}

// ── Master function: apply all layers ─────────────────────────────────────
export function buildUniqueMessage(
  template: string,
  vars: Record<string, string | undefined>,
  options: {
    spintax:        boolean;
    invisibleChars: boolean;
    homoglyphs?:    boolean;
    emojis?:        boolean;
    postscripts?:   boolean;
    diacritics?:    boolean;
  },
): string {
  let text = template;

  if (options.spintax)        text = applySpintax(text);
                              text = fillVars(text, vars);
  if (options.diacritics)     text = applyDiacriticsVariation(text);
  if (options.homoglyphs)     text = applyHomoglyphs(text);
  if (options.emojis)         text = injectEmoji(text);
  if (options.postscripts)    text = applyPostscript(text);
  if (options.invisibleChars) text = addInvisibleChars(text);

  return text;
}
