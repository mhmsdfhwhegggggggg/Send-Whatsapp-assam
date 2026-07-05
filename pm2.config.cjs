// pm2.config.cjs — إعداد PM2 لتشغيل AlMossah في production
// تشغيل: pm2 start pm2.config.cjs --env production

const path = require("path");
const ROOT  = __dirname;

module.exports = {
  apps: [
    // ── API Server ──────────────────────────────────────────────────────────
    {
      name:         "almossah-api",
      script:       path.join(ROOT, "artifacts/api-server/dist/index.mjs"),
      cwd:          ROOT,
      interpreter:  "node",
      node_args:    "--enable-source-maps",

      // البيئة
      env_production: {
        NODE_ENV: "production",
      },

      // الاستقرار
      instances:         1,          // API server يجب أن يكون instance واحد (shared campaign state)
      exec_mode:         "fork",
      restart_delay:     5000,       // انتظر 5 ثواني قبل إعادة التشغيل
      max_restarts:      10,
      min_uptime:        "30s",

      // الذاكرة
      max_memory_restart: "512M",

      // السجلات
      out_file:    "/var/log/almossah/api-out.log",
      error_file:  "/var/log/almossah/api-err.log",
      merge_logs:  true,
      time:        true,

      // ملف .env
      env_file: path.join(ROOT, ".env"),

      // Watch (disabled in production)
      watch: false,
    },

    // ── WhatsApp Worker ─────────────────────────────────────────────────────
    {
      name:         "almossah-worker",
      script:       path.join(ROOT, "artifacts/wa-worker/src/index.js"),
      cwd:          path.join(ROOT, "artifacts/wa-worker"),
      interpreter:  "node",
      node_args:    "--experimental-vm-modules",

      env_production: {
        NODE_ENV: "production",
      },

      // الاستقرار — Worker يحتاج restart أطول (Chromium + WhatsApp sessions)
      instances:         1,
      exec_mode:         "fork",
      restart_delay:     15000,      // 15 ثانية (WhatsApp يكشف الـ reconnects السريعة)
      max_restarts:      5,
      min_uptime:        "60s",

      // الذاكرة — Chromium يستهلك ذاكرة كبيرة
      max_memory_restart: "2G",

      // السجلات
      out_file:   "/var/log/almossah/worker-out.log",
      error_file: "/var/log/almossah/worker-err.log",
      merge_logs: true,
      time:       true,

      env_file: path.join(ROOT, ".env"),
      watch:    false,
    },
  ],
};
