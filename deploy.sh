#!/bin/bash
#
# deploy.sh — 后端一键部署脚本
# 用法: bash deploy.sh
#
# 流程: git pull → npm install → npm run build → pm2 restart
#

set -e

echo "=== 开始部署 learnEnglish 后端 ==="

cd /projects/myApp/learnEnglish-backend

echo "[1/5] 拉取最新代码..."
git pull origin main

echo "[2/5] 安装依赖..."
npm install

echo "[3/5] 构建项目..."
npm run build

echo "[4/5] 重启 PM2 服务..."
pm2 restart learn-english-backend || pm2 start ecosystem.config.js

echo "[5/5] 验证服务状态..."
sleep 2
pm2 list

echo ""
echo "=== ✅ 部署完成 ==="
echo "后端地址: http://39.103.68.205:8080"
