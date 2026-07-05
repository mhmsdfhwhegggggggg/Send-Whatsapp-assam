import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Security headers (helmet) ───────────────────────────────────────────────
// يُضيف HTTP security headers لكل الاستجابات:
// X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, إلخ.
app.use(
  helmet({
    // content-security-policy نُعطّله هنا — الـ frontend يُدار بشكل منفصل
    contentSecurityPolicy: false,
    // HSTS — فعّاله في production فقط
    strictTransportSecurity: process.env.NODE_ENV === "production"
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  }),
);

// ── CORS ────────────────────────────────────────────────────────────────────
// Production: قيّد الـ origin بـ CORS_ORIGIN env var
// Development: اسمح لكل origin
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : null;

app.use(cors({
  origin: allowedOrigins
    ? (origin, cb) => {
        if (!origin) return cb(null, true);        // curl/Postman/mobile
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      }
    : true,
  credentials: true,
}));

// ── HTTP logging ────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

// ── Body parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
