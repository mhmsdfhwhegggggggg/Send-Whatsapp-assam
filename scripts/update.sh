#!/usr/bin/env bash
# scripts/update.sh — تحديث AlMossah إلى أحدث إصدار
# الاستخدام: sudo bash scripts/update.sh
set -euo pipefail

APP_DIR="/opt/almossah"
cd "$APP_DIR"

echo "🔄 تحديث AlMossah..."

# حفظ نسخة احتياطية من DB قبل التحديث
echo "📦 نسخة احتياطية من قاعدة البيانات..."
source .env
pg_dump "$DATABASE_URL" > "/tmp/almossah-backup-$(date +%Y%m%d-%H%M%S).sql"
echo "✅ نسخة احتياطية: /tmp/almossah-backup-*.sql"

# جلب آخر التغييرات
git pull origin main

# تثبيت أي مكتبات جديدة
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# بناء المشروع
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/frontend run build 2>/dev/null || true

# تطبيق migrations جديدة
pnpm --filter @workspace/db run migrate

# إعادة تشغيل الخدمات
pm2 reload almossah-api
sleep 5
pm2 reload almossah-worker

echo ""
echo "✅ تم التحديث بنجاح!"
pm2 status
