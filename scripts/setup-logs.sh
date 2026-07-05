#!/bin/bash
# إنشاء مجلدات السجلات
mkdir -p /var/log/almossah
chmod 755 /var/log/almossah

# إعداد logrotate لتدوير السجلات تلقائياً
cat > /etc/logrotate.d/almossah << 'EOF'
/var/log/almossah/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF

echo "✅ تم إعداد مجلدات السجلات"
