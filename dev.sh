#!/bin/bash

# ==============================================================================
# Super Note - 本地开发启动脚本 (支持前端 Live Reload / HMR)
# ==============================================================================

# 确保切换到脚本所在的根目录
cd "$(dirname "$0")"

echo "===================================================================="
echo "🚀 正在启动 Super Note 本地开发模式 (支持实时热重载)..."
echo "===================================================================="

# 检查依赖是否已安装，若无则自动安装
if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
  echo "⚠️  检测到依赖未安装，开始安装项目依赖..."
  npm run install:all
  if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败，请手动执行 'npm run install:all'"
    exit 1
  fi
fi

# 进程清理函数
cleanup() {
  echo ""
  echo "🛑 正在关闭开发服务器..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo "✨ 服务已成功停止。"
  exit 0
}

# 捕获退出信号，确保退出时清理后台进程
trap cleanup SIGINT SIGTERM EXIT

# 检查 Redis 状态，若未运行则自动尝试启动
if ! nc -z 127.0.0.1 6379 >/dev/null 2>&1; then
  echo "⚠️  检测到 Redis (port 6379) 未运行，正在尝试启动本地 Redis 服务..."
  if command -v brew &>/dev/null && brew services list | grep -q "redis"; then
    brew services start redis
    sleep 1.5
  elif command -v redis-server &>/dev/null; then
    redis-server --daemonize yes
    sleep 1.5
  elif command -v docker &>/dev/null; then
    if docker ps -a --format '{{.Names}}' | grep -q "^super-note-redis$"; then
      echo "🔄 检测到已存在的 Docker Redis 容器，正在启动..."
      docker start super-note-redis
    else
      echo "📥 正在拉取并启动 Docker Redis 容器..."
      docker run -d --name super-note-redis -p 6379:6379 docker.m.daocloud.io/redis:7-alpine || \
      docker run -d --name super-note-redis -p 6379:6379 redis:7-alpine
    fi
    sleep 2
  fi

  # 再次确认 Redis 是否成功启动
  if ! nc -z 127.0.0.1 6379 >/dev/null 2>&1; then
    echo "❌ 无法自动启动 Redis 服务，请确保已安装并手动运行 redis-server (port 6379) 或已运行 Docker。"
    exit 1
  else
    echo "✅ Redis 服务已成功启动！"
  fi
fi

# 检查并释放占用端口 3001 和 5173 的旧进程，防止 EADDRINUSE 报错
for port in 3001 5173; do
  PID=$(lsof -t -i:$port 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "⚠️  检测到端口 $port 已被进程 $PID 占用，正在释放..."
    kill -9 $PID 2>/dev/null
    sleep 0.5
  fi
done

# 启动后端服务 (使用 tsx watch，文件修改时后端会自动重启)
echo "📡 正在启动后端服务..."
npm run dev:backend &
BACKEND_PID=$!

# 启动前端服务 (使用 Vite，支持 CSS/JS 热重载)
echo "💻 正在启动前端开发服务..."
npm run dev:frontend &
FRONTEND_PID=$!

echo "--------------------------------------------------------------------"
echo "🎉 Super Note 本地服务器已启动！"
echo "👉 前端地址 (已配置 API 代理): http://localhost:5173"
echo "💬 按 [Ctrl + C] 可安全停止前后端服务。"
echo "--------------------------------------------------------------------"

# 等待子进程，保持前台运行
wait $BACKEND_PID $FRONTEND_PID
