import { Router } from "express";
import { sign } from "../lib/jwt";
import { logger } from "../lib/logger";

const router = Router();

const ADMIN_USER = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASS) {
  throw new Error("ADMIN_PASSWORD env var is required.");
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_ATTEMPTS) return false;
  record.count++;
  return true;
}

router.post("/auth/login", (req, res) => {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ??
    req.socket.remoteAddress ??
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = sign({ sub: username, role: "admin" });
    loginAttempts.delete(ip);
    res.json({ token });
    return;
  }

  req.log.warn({ ip }, "failed login attempt");
  res.status(401).json({ error: "Invalid credentials" });
});

export default router;
