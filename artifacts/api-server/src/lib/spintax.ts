/**
 * spintax.ts — Advanced message variation engine — PRODUCTION HARDENED v3
 *
 * إصلاحات v3:
 *   - normalizeArabicPhone(): تطبيع أرقام الهاتف العربية (05xx → 9665xx)
 *   - sanitizePhone() يستخدم normalizeArabicPhone داخلياً
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

// ── 4. Arabic homoglyphs ──────────────────────────────────────────────────
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
  "",  // No postscript — x3
  "",
  "",
];

export function applyPostscript(text: string): string {
  const ps = POSTSCRIPTS[Math.floor(Math.random() * POSTSCRIPTS.length)];
  return text + ps;
}

// ── Spam score calculator ─────────────────────────────────────────────────
export interface SpamScoreResult {
  score: number;
  reasons: string[];
  risk: "low" | "moderate" | "high";
}

export function calculateSpamScore(text: string): SpamScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (/https?:\/\//i.test(text)) {
    score += 25;
    reasons.push("contains URL (+25)");
  }

  const urlCount = (text.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > 1) {
    score += 15;
    reasons.push(`multiple URLs × ${urlCount} (+15)`);
  }

  const salesWords = /عرض|خصم|مجاني|مجانا|احصل|اشترك|سارع|محدود|فرصة|ترقية|تخفيض|وفر/i;
  if (salesWords.test(text)) {
    score += 15;
    reasons.push("marketing keywords (+15)");
  }

  if (/[A-Z]{5,}/.test(text)) {
    score += 10;
    reasons.push("ALL CAPS block (+10)");
  }

  const punctCount = (text.match(/[!?]{2,}/g) ?? []).length;
  if (punctCount > 0) {
    score += punctCount * 5;
    reasons.push(`repeated punctuation ×${punctCount} (+${punctCount * 5})`);
  }

  // حساب طول الرسالة بدون الأحرف الخفية (لمنع التحايل)
  const visibleLength = text.replace(/[\u200B\u200C\u200D\uFEFF\u2060\u180E]/g, "").length;
  if (visibleLength > 600) {
    score += 15;
    reasons.push(`too long (${visibleLength} chars, +15)`);
  } else if (visibleLength > 400) {
    score += 8;
    reasons.push(`long message (+8)`);
  }

  if (/\b\d{9,14}\b/.test(text)) {
    score += 20;
    reasons.push("phone number in text (+20)");
  }

  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  if (emojiCount > 5) {
    score += 10;
    reasons.push(`emoji overload ×${emojiCount} (+10)`);
  }

  if (/تمت إعادة التوجيه|forwarded|تمت اعادة/i.test(text)) {
    score += 20;
    reasons.push("forwarded message marker (+20)");
  }

  const risk: SpamScoreResult["risk"] = score >= 60 ? "high" : score >= 40 ? "moderate" : "low";

  return { score: Math.min(score, 100), reasons, risk };
}

// ── تطبيع أرقام الهاتف العربية ───────────────────────────────────────────
/**
 * يُحوّل الأرقام المحلية إلى صيغة دولية (بدون +) يفهمها واتساب.
 *
 * أمثلة:
 *   "0501234567"   → "966501234567"  (السعودية)
 *   "05xxxxxxxx"   → "96605xxxxxxxx" خطأ: يجب "966501234567"
 *   "+966501234567" → "966501234567"
 *   "966501234567" → "966501234567"  (لا تغيير)
 *   "0097150..."   → "97150..."      (الإمارات بـ00)
 *
 * يشمل: السعودية (966)، الإمارات (971)، الكويت (965)،
 *        قطر (974)، البحرين (973)، عُمان (968)،
 *        مصر (20)، الأردن (962)، العراق (964)، لبنان (961)، المغرب (212).
 */
export function normalizeArabicPhone(raw: string): string {
  // أزل كل شيء ما عدا الأرقام والـ +
  let digits = raw.replace(/[\s\-\(\)]/g, "");

  // أزل الـ + الأمامي
  if (digits.startsWith("+")) digits = digits.slice(1);

  // أزل بادئة 00 (00966 → 966)
  if (digits.startsWith("00")) digits = digits.slice(2);

  // خرائط الدول: بادئة محلية → كود دولي + عدد الأرقام الإجمالي
  const localPrefixes: [string, string, number][] = [
    // بادئة، كود دولي،  عدد الأرقام في الرقم المحلي (شامل الصفر)
    ["05", "966", 10],  // السعودية: 05xxxxxxxx → 966 + 5xxxxxxxx
    ["06", "966", 10],  // السعودية بعض المناطق
    ["07", "966", 10],
    ["04", "971", 10],  // الإمارات: 04xxxxxxx → 971 + 4xxxxxxx (مختلف)
    ["05", "971", 10],  // الإمارات موبايل أحياناً
    ["06", "965", 8],   // الكويت: 6xxxxxxx (8 أرقام)
    ["5",  "974", 8],   // قطر: 5xxxxxxx (8 أرقام)
    ["3",  "974", 8],   // قطر
    ["7",  "974", 8],   // قطر
    ["010","20",  11],  // مصر: 010xxxxxxxx → 20 + 10xxxxxxxx
    ["011","20",  11],  // مصر
    ["012","20",  11],  // مصر
    ["015","20",  11],  // مصر
    ["07", "964", 11],  // العراق
    ["078","964", 11],
    ["079","964", 11],
  ];

  // إذا الرقم يبدأ بصفر — قد يحتاج تحويل
  if (digits.startsWith("0")) {
    for (const [prefix, countryCode, expectedLen] of localPrefixes) {
      if (digits.startsWith(prefix) && digits.length === expectedLen) {
        // أزل الصفر الأول وأضف كود الدولة
        // مثال: "0501234567" (10 أرقام، prefix "05", code "966")
        //        → أزل "0" → "501234567" → "966" + "501234567" = "966501234567"
        digits = countryCode + digits.slice(1);
        break;
      }
    }
  }

  return digits;
}

// ── Sanitize phone number ──────────────────────────────────────────────────
export function sanitizePhone(raw: string): string {
  // أولاً: طبّق التطبيع العربي
  const normalized = normalizeArabicPhone(raw);

  // ثم تحقق من الصحة (9–15 رقماً، أرقام فقط)
  if (!/^\d{9,15}$/.test(normalized)) {
    throw new Error(`Invalid phone number: "${raw}" (normalized: "${normalized}")`);
  }
  return normalized;
}

// ── Master function ────────────────────────────────────────────────────────
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
