const INVISIBLE_CHARS = ["\u200B", "\u200C", "\u200D", "\uFEFF"];

export function applySpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, options: string) => {
    const parts = options.split("|");
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

export function fillVars(
  text: string,
  vars: Record<string, string | undefined>,
): string {
  return text
    .replace(/\{اسم\}/g, vars.name ?? "")
    .replace(/\{جامعة\}/g, vars.university ?? "")
    .replace(/\{تخفيض\}/g, vars.discount ?? "")
    .replace(/\{خدمة\}/g, vars.serviceType ?? "");
}

export function addInvisibleChars(text: string): string {
  const char = INVISIBLE_CHARS[Math.floor(Math.random() * INVISIBLE_CHARS.length)];
  const insertAt = Math.floor(text.length / 2);
  return text.slice(0, insertAt) + char + text.slice(insertAt);
}

export function sanitizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-\+]/g, "");
  if (!/^\d{9,15}$/.test(digits)) {
    throw new Error(`Invalid phone number: ${raw}`);
  }
  return digits;
}
