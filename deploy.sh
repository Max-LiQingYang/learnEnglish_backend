#!/bin/bash
#
# deploy.sh — 后端一键部署脚本
#
# 流程: git pull -> npm install -> npm run build -> pm2 restart -> nginx reload
#

set -euo pipefail

APP_DIR="/projects/myApp/learnEnglish-backend"
STATIC_DIR="/projects/myApp/learnEnglish"
DOMAIN="liqingyoung.me"
IP="39.103.68.205"

echo "=== 开始部署 learnEnglish 后端 ==="

cd "$APP_DIR"

echo "[1/6] 拉取最新代码..."
git pull origin main

echo "[2/6] 安装依赖..."
npm install

echo "[3/6] 构建项目..."
npm run build

echo "[4/6] 重启 PM2 服务..."
pm2 restart learn-english-backend || pm2 start ecosystem.config.js
pm2 save

echo "[5/6] 同步 Nginx 配置..."
if [ -d /etc/nginx/conf.d ] && command -v nginx >/dev/null 2>&1; then
  if [ -d "$APP_DIR/deploy/nginx" ] && [ -f "$STATIC_DIR/index.html" ]; then
    cp "$APP_DIR/deploy/nginx/learnEnglish.conf" /etc/nginx/conf.d/learnEnglish.conf
    cp "$APP_DIR/deploy/nginx/liqingyoung.me.conf" /etc/nginx/conf.d/liqingyoung.me.conf
    nginx -t
    systemctl reload nginx
  else
    echo "跳过 Nginx 同步: 缺少 deploy/nginx 或静态首页 $STATIC_DIR/index.html"
  fi
else
  echo "跳过 Nginx 同步: 当前环境没有 Nginx"
fi

echo "[6/6] 验证服务状态..."
sleep 2
pm2 list
curl -fsS "http://127.0.0.1:3000/health" >/dev/null

echo ""
echo "=== 部署完成 ==="
echo "公网首页: http://$IP/"
echo "域名首页: https://$DOMAIN/  （中国大陆服务器需要域名完成 ICP 备案后公网才会放行）"
echo "健康检查: http://$IP/health"
