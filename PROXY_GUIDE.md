# دليل إضافة Proxy — AlMossah

## لماذا Proxy ضروري؟

كل حساب واتساب يجب أن يعمل على IP مختلف.
بدون proxy: جميع حساباتك تستخدم IP السيرفر ← واتساب يكتشف أنها من مكان واحد ← حظر جماعي.

---

## مزودو Proxy الموصى بهم

| المزود | النوع | الأفضل لـ | السعر التقريبي |
|--------|-------|-----------|----------------|
| **Bright Data** | Mobile | واتساب (الأفضل) | $300+/شهر |
| **Smartproxy** | Residential | واتساب | $75+/شهر |
| **Oxylabs** | Residential | واتساب | $99+/شهر |
| **IPRoyal** | Residential | اقتصادي | $7/GB |
| **Webshare** | Residential | اقتصادي | $30+/شهر |

> ⚠️ **لا تستخدم Datacenter proxies** — واتساب يكتشفها فوراً.
> ✅ **استخدم Residential أو Mobile proxies فقط.**

---

## صيغة Proxy المطلوبة

```
http://اسم_المستخدم:كلمة_المرور@الخادم:المنفذ
```

**أمثلة:**
```
http://user123:pass456@gate.smartproxy.com:7000
http://customer-abc:xyz@proxy.brightdata.com:22225
socks5://user:pass@proxy.example.com:1080
```

---

## كيفية إضافة Proxy للحساب

### الطريقة 1: من الواجهة (الأسهل)

1. افتح AlMossah في المتصفح
2. اذهب إلى **الحسابات** → **إضافة حساب**
3. أدخل اسم الحساب
4. في حقل **Proxy**: أدخل الصيغة الكاملة
5. انقر **إضافة**
6. امسح QR Code من هاتفك

### الطريقة 2: عبر API

```bash
curl -X POST https://your-domain.com/api/accounts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "حساب السعودية 1",
    "proxy": "http://user:pass@gate.smartproxy.com:7000"
  }'
```

---

## خطة الـ Proxy الموصى بها

### للمبتدئين (1–5 حسابات)
```
الميزانية: $30–75/شهر
المزود:    Webshare أو IPRoyal
نوع:       Residential Static
حساب واحد = IP واحد ثابت
```

### للاحترافيين (5–20 حساب)
```
الميزانية: $75–200/شهر
المزود:    Smartproxy
نوع:       Residential rotating (sticky sessions 24h)
```

### للإنتاج الكبير (20+ حساب)
```
الميزانية: $300+/شهر
المزود:    Bright Data (Mobile)
نوع:       Mobile proxies — أقرب لسلوك الهاتف الحقيقي
```

---

## التحقق من عمل Proxy

بعد إضافة الحساب مع proxy، تحقق من:
- ✅ ظهور QR Code (الـ session تعمل عبر الـ proxy)
- ✅ مسح QR بنجاح
- ✅ ظهور الحساب بحالة "متصل"
- ✅ `Health Score: 100`

إذا لم يظهر QR:
```bash
# تحقق من logs الـ worker
pm2 logs almossah-worker --lines 50

# أو في Docker:
docker compose logs worker --tail 50
```

---

## نصائح مهمة

1. **حساب واحد = Proxy واحد** — لا تشارك IP بين حسابين
2. **IP ثابت** — لا rotating IP بين الرسائل (sticky session 24h+)
3. **نفس البلد** — proxy سعودي للرقم السعودي
4. **لا تغير IP** — تغيير الـ proxy وسط الحملة يُنبّه واتساب
5. **اختبر قبل الإضافة:**
   ```bash
   curl -x http://user:pass@proxy:port https://api.ipify.org
   # يجب أن يُظهر IP مختلف عن IP السيرفر
   ```
