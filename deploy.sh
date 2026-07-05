#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AlMossah — نظام الرسائل الجماعي
#  سكريبت النشر الكامل على Ubuntu 22.04 LTS
#  الاستخدام:  bash deploy.sh [domain.com]
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="/opt/almossah"
DB_NAME="almossah"
DB_USER="almossah"
DB_PASS="$(openssl rand -hex 24)"
WORKER_SECRET="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 64)"
REPO_URL="https://github.com/mhmsdfhwhegggggggg/Send-Whatsapp-assam.git"

# ── ألوان ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
info() { echo -e "${BLUE}ℹ  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; exit 1; }

echo -e "\n${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}    نشر AlMossah — نظام الرسائل الجماعي  ${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

# ── التحقق من الصلاحيات ───────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "يجب تشغيل السكريبت بصلاحيات root: sudo bash deploy.sh"
grep -qi 'ubuntu\|debian' /etc/os-release || warn "تم الاختبار على Ubuntu 22.04 فقط"

# ══════════════════════════════════════════════════════════════════════════════
# 1. تحديث النظام
# ══════════════════════════════════════════════════════════════════════════════
info "تحديث النظام..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl wget git build-essential \
    nginx certbot python3-certbot-nginx \
    postgresql postgresql-contrib \
    chromium-browser fonts-noto-cjk fonts-noto fonts-liberation \
    ca-certificates gnupg lsb-release unzip htop ufw
ok "تم تحديث النظام"

# ══════════════════════════════════════════════════════════════════════════════
# 2. تثبيت Node.js 20 + pnpm + PM2
# ══════════════════════════════════════════════════════════════════════════════
info "تثبيت Node.js 20..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y -qq nodejs
fi
ok "Node.js $(node -v)"

info "تثبيت pnpm + PM2..."
npm install -g pnpm pm2 --quiet
ok "pnpm $(pnpm -v) | PM2 $(pm2 -v)"

# ══════════════════════════════════════════════════════════════════════════════
# 3. إعداد قاعدة البيانات PostgreSQL
# ══════════════════════════════════════════════════════════════════════════════
info "إعداد PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
ok "PostgreSQL جاهز"

# ══════════════════════════════════════════════════════════════════════════════
# 4. استنساخ/تحديث المشروع
# ══════════════════════════════════════════════════════════════════════════════
info "تنزيل المشروع..."
if [[ -d "$APP_DIR/.git" ]]; then
    cd "$APP_DIR" && git pull origin main
    ok "تم تحديث المشروع"
else
    git clone "$REPO_URL" "$APP_DIR"
    ok "تم تنزيل المشروع في $APP_DIR"
fi
cd "$APP_DIR"

# ══════════════════════════════════════════════════════════════════════════════
# 5. اكتشاف مسار Chromium
# ══════════════════════════════════════════════════════════════════════════════
CHROMIUM_PATH=""
for p in \
    "$(which chromium-browser 2>/dev/null)" \
    "$(which chromium 2>/dev/null)" \
    "/usr/bin/chromium-browser" \
    "/usr/bin/chromium"; do
    [[ -n "$p" && -x "$p" ]] && { CHROMIUM_PATH="$p"; break; }
done
[[ -z "$CHROMIUM_PATH" ]] && warn "لم يتم العثور على Chromium — ستحتاج لضبط CHROMIUM_PATH يدوياً"
ok "Chromium: ${CHROMIUM_PATH:-غير موجود}"

# ══════════════════════════════════════════════════════════════════════════════
# 6. إنشاء ملف .env
# ══════════════════════════════════════════════════════════════════════════════
info "إنشاء ملف .env..."
cat > "$APP_DIR/.env" << EOF
# ═══ إعدادات AlMossah ══════════════════════════════════════════
NODE_ENV=production

# ─── قاعدة البيانات ─────────────────────────────────────────────
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}

# ─── أمان (لا تشاركها مع أحد) ──────────────────────────────────
WORKER_SECRET=${WORKER_SECRET}
SESSION_SECRET=${SESSION_SECRET}

# ─── إعدادات الإرسال ────────────────────────────────────────────
SEND_TIMEZONE=Asia/Riyadh
REQUIRE_PROXY=true
CORS_ORIGIN=${DOMAIN:+https://${DOMAIN}}

# ─── المنافذ ────────────────────────────────────────────────────
PORT=8080
WA_WORKER_PORT=8088
API_SERVER_URL=http://localhost:8080

# ─── المتصفح ────────────────────────────────────────────────────
CHROMIUM_PATH=${CHROMIUM_PATH}
EOF
chmod 600 "$APP_DIR/.env"
ok "تم إنشاء .env"

# ══════════════════════════════════════════════════════════════════════════════
# 7. تثبيت المكتبات وبناء المشروع
# ══════════════════════════════════════════════════════════════════════════════
info "تثبيت المكتبات..."
cd "$APP_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "تم تثبيت المكتبات"

info "بناء API Server..."
pnpm --filter @workspace/api-server run build
ok "تم بناء API Server"

info "بناء Frontend..."
if pnpm --filter @workspace/frontend run build 2>/dev/null; then
    ok "تم بناء Frontend"
else
    warn "لم يتم بناء Frontend — تحقق من artifacts/frontend"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 8. تشغيل migrations
# ══════════════════════════════════════════════════════════════════════════════
info "تطبيق migrations قاعدة البيانات..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @workspace/db run migrate
ok "تم تطبيق migrations"

# ══════════════════════════════════════════════════════════════════════════════
# 9. إعداد PM2
# ══════════════════════════════════════════════════════════════════════════════
info "إعداد PM2..."
pm2 delete almossah-api    2>/dev/null || true
pm2 delete almossah-worker 2>/dev/null || true

pm2 start "$APP_DIR/pm2.config.cjs" --env production
pm2 save

# تشغيل PM2 تلقائياً عند إعادة التشغيل
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root | tail -1 | bash
ok "PM2 جاهز"

# ══════════════════════════════════════════════════════════════════════════════
# 10. إعداد Nginx
# ══════════════════════════════════════════════════════════════════════════════
info "إعداد Nginx..."
cp "$APP_DIR/nginx/almossah.conf" /etc/nginx/sites-available/almossah

if [[ -n "$DOMAIN" ]]; then
    sed -i "s/server_name _;/server_name ${DOMAIN};/g" /etc/nginx/sites-available/almossah
fi

ln -sf /etc/nginx/sites-available/almossah /etc/nginx/sites-enabled/almossah
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "Nginx جاهز"

# ══════════════════════════════════════════════════════════════════════════════
# 11. جدار الحماية UFW
# ══════════════════════════════════════════════════════════════════════════════
info "إعداد جدار الحماية..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ok "جدار الحماية نشط"

# ══════════════════════════════════════════════════════════════════════════════
# 12. SSL بـ Certbot (إذا تم تقديم domain)
# ══════════════════════════════════════════════════════════════════════════════
if [[ -n "$DOMAIN" ]]; then
    info "تفعيل SSL لـ $DOMAIN..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --email "admin@${DOMAIN}" --redirect && ok "SSL مفعّل ✓" || \
        warn "فشل SSL — تأكد من إضافة A record للـ domain"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ملخص النتائج
# ══════════════════════════════════════════════════════════════════════════════
SERVER_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}    ✅ تم نشر AlMossah بنجاح!              ${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo -e "  🌐 الرابط:    ${BLUE}${DOMAIN:+https://${DOMAIN}}${DOMAIN:-http://${SERVER_IP}}${NC}"
echo -e "  🗄  قاعدة البيانات: ${YELLOW}postgres://${DB_USER}:${DB_PASS}@localhost/${DB_NAME}${NC}"
echo -e "  🔑 WORKER_SECRET:  ${YELLOW}${WORKER_SECRET}${NC}"
echo ""
echo -e "${YELLOW}⚠️  احفظ هذه المعلومات في مكان آمن!${NC}"
echo ""
echo -e "  📊 مراقبة: pm2 monit"
echo -e "  📋 سجلات:  pm2 logs"
echo -e "  🔄 إعادة:  pm2 restart all"
echo ""
echo -e "${BLUE}الخطوات التالية:${NC}"
echo -e "  1. افتح ${DOMAIN:+https://${DOMAIN}}${DOMAIN:-http://${SERVER_IP}} في المتصفح"
echo -e "  2. سجّل الدخول بالحساب الافتراضي"
echo -e "  3. أضف حساب واتساب مع Proxy"
echo -e "  4. امسح QR code"
echo -e "  5. انتظر 7 أيام warm-up ثم ابدأ campaigns"
echo ""
