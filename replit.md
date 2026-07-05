# AlMossah — نظام إرسال واتساب الجماعي

نظام متكامل لإرسال رسائل واتساب بالجملة لمئات الآلاف من المستفيدين مع حماية متقدمة من الحظر.

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
- `artifacts/api-server/src/lib/spintax.ts` — محرك تنويع الرسائل + spam scorer
- `artifacts/api-server/src/lib/warm-up.ts` — منطق الـ warm-up + account events
- `artifacts/frontend/src/pages/` — 8 صفحات React
- `artifacts/wa-worker/src/index.js` — خادم واتساب (HTTP API)
- `artifacts/wa-worker/src/fingerprint.js` — محاكاة بصمة المتصفح (v2: Chrome 138)
- `artifacts/wa-worker/src/human.js` — محاكاة السلوك البشري (v2: سرعة عربية صحيحة)
- `scripts/migrate-production.sql` — Migration SQL للإنتاج

## DB Tables

`groups`, `students`, `templates`, `accounts`, `campaigns`, `messages`, `settings`,
`opt_out`, `inbound_messages`, `account_events` (جديد v3), `proxies` (جديد v3)

## API Endpoints

- `POST /api/auth/login` — دخول بـ ADMIN_USERNAME / ADMIN_PASSWORD
- `GET/POST/PUT/DELETE /api/students` — مع `POST /api/students/import` لـ CSV
- `GET/POST/DELETE /api/groups`
- `GET/POST/PUT/DELETE /api/templates`
- `GET/POST/DELETE /api/accounts` + `GET /api/accounts/:id/qr`
- `POST /api/accounts/:id/unsuspend` — رفع الإيقاف يدوياً (جديد v3)
- `GET/POST/DELETE /api/campaigns` + start/pause + detail
- `GET/PUT /api/settings`
- `GET /api/stats`

## WA Worker Endpoints (internal only)

- `GET /healthz` — health check
- `POST /sessions/:id` — إنشاء جلسة
- `GET /sessions/:id` — حالة الجلسة
- `DELETE /sessions/:id` — حذف الجلسة
- `GET /sessions` — كل الجلسات
- `POST /send` — إرسال رسالة
- `POST /check-phone` — **(جديد v3)** التحقق من تسجيل رقم في واتساب

## Anti-Ban Features — الطبقات الكاملة (v3)

### طبقة المتصفح (wa-worker)
| الطبقة | التفاصيل |
|--------|----------|
| Stealth Plugin | يزيل كل آثار WebDriver وCDP |
| Fingerprint v2 | 20 طبقة: Canvas, WebGL, Audio, Battery, WebRTC, Screen, Plugins, Timezone, Speech |
| Chrome 138 UA | **إصلاح حرج**: جميع profiles تستخدم Chrome/138 يطابق الـ binary الفعلي |
| 8 Device Profiles | أجهزة أندرويد 13-14 حقيقية + GPU/timezone/لغة متسقة |
| Session Init Queue | حد 1 concurrent init، فجوة 5-12 ثانية |

### طبقة السلوك البشري
| الطبقة | التفاصيل |
|--------|----------|
| Human Send v2 | متعدد المراحل: تفكير → كتابة → توقف منتصف (للرسائل الطويلة) → مراجعة → إرسال |
| Arabic Typing Speed | **إصلاح**: 0.18-0.35 حرف/ثانية (كان 0.45-0.80، ضعفان أسرع من الواقع) |
| Presence Cycle v2 | **إصلاح**: تشتيت البداية 0-60 دقيقة (كان 0-3 دقائق فقط) |
| Organic Breathing | 15% فرصة للقيام بشيء "عضوي" بين الرسائل |
| Poisson Delay | تأخير Poisson وليس uniform |

### طبقة الحملة (campaign-runner)
| الطبقة | التفاصيل |
|--------|----------|
| Phone Validation | **جديد v3**: التحقق من تسجيل الرقم قبل الإرسال |
| Spam Score Gate | **جديد v3**: فحص محتوى الرسالة قبل الإرسال (رفض score > 60) |
| Persistent Health Score | **جديد v3**: حفظ health score في DB (يبقى بعد إعادة التشغيل) |
| Account Suspension | **جديد v3**: تعليق تلقائي للحسابات المتعبة مع cooldown |
| Early Warning System | **جديد v3**: كشف 3+ disconnects خلال ساعتين |
| Account Events Log | **جديد v3**: سجل تدقيق كامل في DB |
| Tiered Daily Limits | جديد: 20 / دافئ: 80 / ساخن: 150 |
| Contextual Personalization | اسم + جامعة + مدينة + خدمة + تخفيض |
| Spintax + 6 Layers | تنويع كامل لكل رسالة |
| Opt-out (30+ كلمة) | كشف STOP + رد تأكيد + تسجيل |
| Batch Pause + Kill Switch | تحكم كامل في الحملات |

## Required Secrets (Replit Secrets Panel)

```
JWT_SECRET          — openssl rand -hex 32
ADMIN_USERNAME      — اسم المستخدم للوحة التحكم
ADMIN_PASSWORD      — كلمة مرور قوية (16+ حرف)
WORKER_SECRET       — openssl rand -hex 16
DATABASE_URL        — postgres://...
```

## Architecture Decisions

- WA Worker مفصول عن الـ API — يتواصل فقط عبر HTTP داخلي مع WORKER_SECRET
- fingerprint.js v2: كل profiles تستخدم Chrome/138 يطابق الـ binary (إصلاح حرج)
- human.js v2: سرعة الكتابة العربية مُصحَّحة + تشتيت presence cycles
- campaign-runner v2: phone validation + spam score + persistent health + account events
- كل الأسرار في Replit Secrets وليس في .replit
- Sessions مُستثناة من git (.gitignore)

## Gotchas

- API server يحتاج `PORT` صريح
- عند إعادة تشغيل الـ workflow، يجب قتل العملية القديمة أولاً
- whatsapp-web.js يستخدم Puppeteer — يحتاج وقتاً لتهيئة الـ browser
- كل حساب يحتاج proxy سكني مستقل في الإنتاج
- قبل الإنتاج شغّل: `psql $DATABASE_URL < scripts/migrate-production.sql`

## User Preferences

- مستخدم عربي — الواجهة كاملاً بالعربية مع RTL

## Pointers

- See the `pnpm-workspace` skill for workspace structure
