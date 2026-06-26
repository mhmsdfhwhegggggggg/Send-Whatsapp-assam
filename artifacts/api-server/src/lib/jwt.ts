import { createHmac, timingSafeEqual } from "crypto";

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error(
    "JWT_SECRET env var is required. Set it to a strong random string.",
  );
}

function base64url(buf: Buffer | string): string {
  const b =
    typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(payload: object, expiresInHours = 24 * 7): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body = base64url(JSON.stringify({ ...payload, exp }));
  const data = `${header}.${body}`;
  const sig = base64url(
    createHmac("sha256", secret!).update(data).digest(),
  );
  return `${data}.${sig}`;
}

function verify(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const data = `${header}.${body}`;
    const expected = base64url(
      createHmac("sha256", secret!).update(data).digest(),
    );
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export { sign, verify };
