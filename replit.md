# AlMossah — نظام إرسال واتساب الجماعي

نظام متكامل لإرسال رسائل واتساب بالجملة لمئات الآلاف من المستفيدين مع حماية من الحظر.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — تشغيل الـ API (port 8080 via /api)
- `PORT=18130 BASE_PATH=/ pnpm --filter @workspace/frontend run dev` — تشغيل الواجهة
- `cd artifacts/wa-worker && node src/index.js` — تشغيل WhatsApp Worker (port 8088)
- `pnpm run typecheck` — فحص الأنواع لكل الحزم
- `pnpm --filter @workspace/db run push` — تطبيق تغييرات الـ DB Schema

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, base path `/api`)
- Frontend: React + Vite (port 18130, base path `/`)
- WA Worker: Node.js + whatsapp-web.js (port 8088, internal only)
- DB: PostgreSQL + Drizzle ORM
- Auth: JWT (HS256) with rate limiting (10 req/15min)

## Workflow Commands (Replit)

- **API Server**: `fuser -k 8080/tcp 2>/dev/null; sleep 1; PORT=8080 pnpm --filter @workspace/api-server run dev`
- **AlMossah Dashboard**: `PORT=18130 BASE_PATH=/ pnpm --filter @workspace/frontend run dev`
- **WA Worker**: `cd artifacts/wa-worker && node src/index.js`

## Where Things Live

- `lib/db/src/schema/almossah.ts` — كل جداول DB (source of truth)
- `artifacts/api-server/src/routes/` — جميع API routes
- `artifacts/api-server/src/lib/campaign-runner.ts` — منطق الحملات والإرسال
- `artifacts/api-server/src/lib/worker-client.ts` — التواصل مع WA Worker
- `artifacts/frontend/src/pages/` — 8 صفحات React
- `artifacts/wa-worker/src/index.js` — خادم واتساب (HTTP API)

## DB Tables

`groups`, `students`, `templates`, `accounts`, `campaigns`, `messages`, `settings`

## API Endpoints

- `POST /api/auth/login` — دخول بـ ADMIN_USERNAME / ADMIN_PASSWORD
- `GET/POST/PUT/DELETE /api/students` — مع `POST /api/students/import` لـ CSV
- `GET/POST/DELETE /api/groups`
- `GET/POST/PUT/DELETE /api/templates`
- `GET/POST/DELETE /api/accounts` + `GET /api/accounts/:id/qr`
- `GET/POST/DELETE /api/campaigns` + start/pause + detail
- `GET/PUT /api/settings`
- `GET /api/stats`

## Anti-Ban Features

- Account Rotation — توزيع الإرسال على عدة حسابات
- Spintax — `{مرحباً|أهلاً}` لتنويع النصوص
- Invisible Characters (zero-width) — لتنويع البصمة الرقمية
- Random Delay — تأخير عشوائي بين الرسائل
- Working Hours — لا إرسال خارج ساعات العمل
- Daily Limit — حد يومي لكل حساب
- Batch Pause — راحة بعد كل دفعة
- Retry with Backoff — إعادة المحاولة تلقائياً

## Credentials (Development)

- Username: `admin`
- Password: `AlMossah@2025!`
- يُنصح بتغيير كلمة المرور قبل النشر في الإنتاج

## Architecture Decisions

- WA Worker مفصول عن الـ API تماماً — يتواصل معه فقط عبر HTTP داخلي
- الحملات تُنفَّذ في background على الـ API server مباشرة (لا queue خارجي)
- كل الجداول تستخدم UUID كـ Primary Key
- الأسرار (JWT_SECRET, ADMIN_PASSWORD) في Replit Secrets وليس في الكود

## Gotchas

- API server يحتاج `PORT` صريح — الـ artifact.toml لا يُمرره للـ dev script تلقائياً
- عند إعادة تشغيل الـ workflow، يجب قتل العملية القديمة أولاً (`fuser -k 8080/tcp`)
- whatsapp-web.js يستخدم Puppeteer — يحتاج وقتاً لتهيئة الـ browser
- @whiskeysockets/baileys محظورة بسياسة الأمان في Replit (استخدم whatsapp-web.js)

## User Preferences

_مستخدم عربي — الواجهة كاملاً بالعربية مع RTL_

## Pointers

- See the `pnpm-workspace` skill for workspace structure
