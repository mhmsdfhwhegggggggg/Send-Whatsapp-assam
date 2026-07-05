#!/usr/bin/env bash
# scripts/backup-db.sh — نسخ احتياطي يومي لقاعدة البيانات
# أضفه إلى cron: 0 3 * * * /opt/almossah/scripts/backup-db.sh

set -euo pipefail
APP_DIR="/opt/almossah"
BACKUP_DIR="/opt/almossah/backups"
MAX_BACKUPS=30  # احتفظ بآخر 30 نسخة

mkdir -p "$BACKUP_DIR"
source "$APP_DIR/.env"

FILENAME="almossah-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/$FILENAME"

echo "✅ نسخة احتياطية: $BACKUP_DIR/$FILENAME"

# احذف النسخ القديمة
ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f

echo "📁 عدد النسخ الاحتياطية: $(ls $BACKUP_DIR/*.sql.gz 2>/dev/null | wc -l)"

# إضافة cron تلقائياً إذا لم يكن موجوداً
CRON_JOB="0 3 * * * /opt/almossah/scripts/backup-db.sh >> /var/log/almossah/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -qF "backup-db" ) || \
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
