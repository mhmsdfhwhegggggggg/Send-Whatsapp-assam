/**
 * spintax.ts — Advanced message variation engine
 *
 * Layers applied in order:
 *   1. Multi-level spintax {a|b|{c|d}}
 *   2. Fill named variables
 *   3. Arabic diacritics (tashkeel) variation
 *   4. Unicode Arabic homoglyphs (invisible substitution)
 *   5. Emoji injection at random positions
 *   6. Multi-point invisible zero-width characters
 *   7. Sentence-level structural variation (optional postscript)
 *
 * Every combination of these produces a message that is character-unique
 * — two messages will almost never produce the same hash.
 */

// ── 1. Multi-level Spintax ─────────────────────────────────────────────────
export function applySpintax(text: string): string {
  // Repeatedly resolve nested {a|b} groups until none remain
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
    .replace(/\{اسم\}/g,    vars.name        ?? "")
    .replace(/\{جامعة\}/g,  vars.university  ?? "")
    .replace(/\{تخفيض\}/g,  vars.discount    ?? "")
    .replace(/\{خدمة\}/g,   vars.serviceType ?? "");
}

// ── 3. Arabic diacritics variation ────────────────────────────────────────
// Some common Arabic words have multiple valid spellings with/without tashkeel.
// Randomly swap between them to create unique visual output.
const DIACRITICS_MAP: [RegExp, string[]][] = [
  [/مرحبا/g,    ["مرحباً", "مرحبا", "مَرحبًا"]],
  [/شكرا/g,     ["شكراً", "شكرا", "شُكراً"]],
  [/اهلا/g,     ["أهلاً", "اهلا", "أَهلاً"]],
  [/سلام/g,     ["سلام", "سَلام"]],
  [/يوم/g,      ["يوم", "يَوم"]],
  [/طيب/g,      ["طيب", "طَيِّب"]],
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
// Replace some Arabic chars with visually identical Unicode chars.
// The message *looks* the same to a human but has a different byte hash.
const HOMOGLYPHS: [string, string][] = [
  ["ك", "\u06A9"],   // Arabic Farsi Keh (looks identical)
  ["ي", "\u06CC"],   // Arabic Farsi Yeh
  ["ه", "\u06BE"],   // Arabic Heh Dochashmi
];

export function applyHomoglyphs(text: string): string {
  let result = text;
  for (const [original, replacement] of HOMOGLYPHS) {
    // Only replace ~30% of occurrences and only 30% of the time
    if (Math.random() < 0.3) {
      result = result.replace(new RegExp(original, "g"), (char) =>
        Math.random() < 0.3 ? replacement : char,
      );
    }
  }
  return result;
}

// ── 5. Emoji injection ─────────────────────────────────────────────────────
// Context-appropriate Arabic messaging emojis
const EMOJI_POOL = ["✨", "💡", "📌", "🎯", "✅", "🌟", "👋", "📋", "🔔", "💼", "📞", "🤝"];

export function injectEmoji(text: string): string {
  if (Math.random() > 0.6) return text; // 60% chance of injection
  const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  const lines = text.split("\n");
  // Prefer to add to end of first line or beginning of last line
  if (Math.random() < 0.5 && lines.length > 0) {
    lines[0] = `${lines[0]} ${emoji}`;
  } else {
    lines[lines.length - 1] = `${emoji} ${lines[lines.length - 1]}`;
  }
  return lines.join("\n");
}

// ── 6. Multi-point invisible characters ──────────────────────────────────
// More sophisticated than a single char: insert at multiple points
// with session-unique characters to make each message cryptographically unique.
const ZW_CHARS = ["\u200B", "\u200C", "\u200D", "\uFEFF", "\u2060", "\u180E"];

export function addInvisibleChars(text: string): string {
  const numInserts = 2 + Math.floor(Math.random() * 3); // 2–4 insertions
  let result = text;
  for (let i = 0; i < numInserts; i++) {
    const char = ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)];
    const pos  = Math.floor(Math.random() * result.length);
    result     = result.slice(0, pos) + char + result.slice(pos);
  }
  return result;
}

// ── 7. Optional Arabic postscripts ────────────────────────────────────────
// Randomly append a short culturally-appropriate closing phrase.
// These are common in Arabic messaging and reduce "copy-paste" detection.
const POSTSCRIPTS = [
  "\n\nنتطلع للتواصل معك 🤝",
  "\n\nلأي استفسار نحن هنا 📞",
  "\n\nبالتوفيق دائماً ✨",
  "\n\nيسعدنا خدمتك",
  "\n\nللمزيد من المعلومات تواصل معنا",
  "",  // Empty = no postscript (included multiple times to reduce frequency)
  "",
  "",
];

export function applyPostscript(text: string): string {
  const ps = POSTSCRIPTS[Math.floor(Math.random() * POSTSCRIPTS.length)];
  return text + ps;
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
    spintax:       boolean;
    invisibleChars: boolean;
    homoglyphs?:   boolean;
    emojis?:       boolean;
    postscripts?:  boolean;
    diacritics?:   boolean;
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
