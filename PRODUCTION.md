# AlMossah — Production Deployment Checklist

## ⚠️ متطلبات الإنتاج الإلزامية

### متغيرات البيئة (Secrets)

| المتغير | القيمة | الوصف |
|---------|--------|-------|
| `WORKER_SECRET` | `<random-32-char>` | **إلزامي** — مشترك بين API Server والـ Worker |
| `SESSION_SECRET` | `<random-64-char>` | **إلزامي** — JWT signing key |
| `DATABASE_URL` | `postgres://...` | **إلزامي** — PostgreSQL connection string |
| `SEND_TIMEZONE` | `Asia/Riyadh` | Timezone لساعات الإرسال (المدن السعودية: Asia/Riyadh) |
| `CORS_ORIGIN` | `https://your-domain.com` | **إلزامي في production** — الـ origin المسموح بها |
| `REQUIRE_PROXY` | `true` | **موصى به** — يُجبر على وجود proxy لكل حساب |
| `NODE_ENV` | `production` | تفعيل HSTS وإيقاف dev fallbacks |
| `PORT` | يُضبط تلقائياً | منفذ الـ API server |
| `WA_WORKER_PORT` | `8088` | منفذ الـ WhatsApp Worker |
| `API_SERVER_URL` | `http://localhost:8080` | عنوان الـ API من Worker |

```bash
# توليد مفاتيح عشوائية آمنة:
openssl rand -hex 32   # WORKER_SECRET
openssl rand -hex 64   # SESSION_SECRET
```

---

## 🛡️ ضمانات مكافحة الحظر (Anti-Ban Guarantees)

### 1. بصمة الجهاز (Device Fingerprint) ✅
- **12 profile** عربي مختلف (Samsung Galaxy S24/S25/A55/Z Fold, Pixel 8 Pro, OnePlus, Xiaomi, Oppo)
- `noiseSeed` حتمي من `sessionId` — لا يتغير بين restarts
- حالة البطارية ثابتة per-session
- كل حساب يحصل على نفس الجهاز دائماً

### 2. حدود الإرسال الآمنة ✅

| مرحلة الحساب | حد يومي | حد ساعي |
|-------------|---------|---------|
| جديد (0–7 أيام) | 20/يوم | **4/ساعة** |
| دافئ (7–30 يوم) | 80/يوم | **20/ساعة** |
| نشط (30+ يوم) | 150/يوم | **40/ساعة** |

### 3. سلوك بشري ✅
- توزيع Poisson للتأخير بين الرسائل
- محاكاة كتابة متعددة المراحل
- دورات presence (online/offline) حقيقية عبر WhatsApp API
- `organicBreathe()` يُرسل presence signals فعلية

### 4. كشف الحظر التلقائي ✅
- `auth_failure` → إيقاف الحساب فوراً + إيقاف كل campaigns تستخدمه
- حساب درجة الصحة (health score) يُخفّض عند الفشل
- إيقاف تلقائي عند تجاوز معدل الـ disconnect

### 5. Warm-up تلقائي ✅
- Scheduler يومي عند منتصف الليل UTC
- ترقية الحساب: New → Warm → Hot تلقائياً

### 6. Proxy إلزامي ✅
- اضبط `REQUIRE_PROXY=true` في production
- تحقق من صيغة الـ proxy عند الإنشاء
- يجب أن يكون كل حساب على proxy مستقل

---

## 🔧 إعداد Proxy (إلزامي للإنتاج)

```bash
# صيغة صحيحة:
http://username:password@host:port

# مثال:
http://sa_user:abc123@proxy.example.com:8080
```

**أفضل مزودي Proxy للواتساب:**
- Smartproxy (residential)
- Oxylabs (residential)
- Bright Data (mobile proxy — الأفضل)

**يجب:**
- ✅ Residential أو Mobile proxy (لا datacenter)
- ✅ IP ثابت per-account (لا rotating IP بين الرسائل)
- ✅ IP في نفس البلد كالمستخدم

---

## 📊 مراقبة الحسابات

### مؤشرات الخطر (يجب مراقبتها):
- `health_score < 60` → قد يكون الحساب تحت ضغط
- `health_score < 40` → إيقاف تلقائي (cooldown)
- `disconnected × 3+ في ساعتين` → تحذير مبكر

### ما يحدث عند الحظر:
1. WhatsApp يُرسل `auth_failure` للـ worker
2. Worker يُرسل POST `/api/accounts/:id/ban` للـ API
3. API يُوقف الحساب فوراً (`suspendedUntil` = بعد سنة)
4. كل campaigns تستخدم هذا الحساب تُوقَف تلقائياً
5. رسائل في انتظار الإرسال تُعاد للـ retry بحساب مختلف

---

## ⚙️ إعداد ساعات العمل

في الإعدادات (Settings), اضبط:
- `workingHoursStart`: الساعة التي تبدأ فيها الإرسال (مثال: 9 = 9 صباحاً)
- `workingHoursEnd`: الساعة التي تنتهي فيها (مثال: 22 = 10 مساءً)
- وهذه الساعات حسب `SEND_TIMEZONE` (ليس UTC)

---

## 🚀 ترتيب التشغيل

```
1. PostgreSQL يجب أن يكون جاهزاً
2. pnpm install
3. pnpm --filter @workspace/db run migrate
4. Start: API Server (PORT env var)
5. Start: WA Worker (WA_WORKER_PORT=8088)
   └── سيستعيد sessions تلقائياً من API بعد 3 ثواني
6. سجّل الدخول للـ frontend
7. أضف الحسابات (مع proxy)
8. امسح QR من هاتفك
9. انتظر warm-up (7 أيام كحد أدنى)
10. ابدأ campaigns
```

---

## ❌ أخطاء شائعة تسبب الحظر

| الخطأ | الحل |
|-------|------|
| إرسال بدون proxy | اضبط `REQUIRE_PROXY=true` |
| بدء campaign فوراً بعد الإنشاء | انتظر 7 أيام warm-up |
| الـ timezone خاطئ | اضبط `SEND_TIMEZONE=Asia/Riyadh` |
| بدون spintax في الرسائل | فعّل Spintax في الإعدادات |
| إرسال لأرقام غير مسجلة | فعّل Phone Validation |
| تكرار نفس الرسالة لنفس الشخص | اضبط `dedupWindowDays >= 7` |
