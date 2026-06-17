# =============================================================================
# super-note 多架构 Dockerfile（Alpine 精简版）
# -----------------------------------------------------------------------------
# 支持 linux/amd64 与 linux/arm64，macOS（Apple Silicon + Intel）均可原生构建。
#
# 构建方式：
#   # macOS Apple Silicon → arm64（默认，最快，无需 QEMU）
#   docker build -t super-note .
#
#   # macOS Intel / Linux x86 → amd64
#   docker build -t super-note .
#
#   # 显式指定架构
#   docker build --platform linux/amd64 -t super-note .
#   docker build --platform linux/arm64 -t super-note .
#
#   # 多架构 manifest
#   docker buildx build --platform linux/amd64,linux/arm64 -t super-note --push .
#
# 关键设计：
#   - 基础镜像：node:20-alpine（~42MB），而非 node:20-slim（~150MB）
#   - better-sqlite3 / sqlite-vec 在 musl 下需要本地编译 → 用 --virtual
#     安装构建链，npm ci 完立即 `apk del`，不留任何构建产物在运行层
#   - rollup 的原生绑定根据 TARGETARCH 选 musl 版（linux-*-musl）而不是 gnu
#   - APK_MIRROR 与 NPM_REGISTRY 可配置，中国大陆用户换成国内镜像加速
# =============================================================================

# Docker 镜像源：中国大陆用户可设为 docker.m.daocloud.io/ 加速
# 通过 docker build --build-arg DOCKER_REGISTRY=docker.m.daocloud.io/ ... 传入
ARG DOCKER_REGISTRY=""
ARG TARGETPLATFORM=
ARG TARGETARCH=

# ---------- 镜像源配置 ----------
# 中国大陆用户可设置：
#   docker build --build-arg APK_MIRROR=mirrors.ustc.edu.cn --build-arg NPM_REGISTRY=https://registry.npmmirror.com ...
# 或通过 docker-compose.yml 的 args 传入。
# 默认留空 → 使用 Alpine / npm 官方源（全球 CDN，对 macOS 友好）。
ARG APK_MIRROR=""
ARG NPM_REGISTRY=""

# ---------- Stage 1: 前端构建 ----------
FROM --platform=$BUILDPLATFORM ${DOCKER_REGISTRY}node:20-alpine AS frontend-build
ARG TARGETARCH
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app

# 安装 bash（脚本依赖）
RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache bash \
    && if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY"; \
    fi \
    && npm config set fetch-retry-maxtimeout 180000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 600000

# 复制整个项目（包含 clipper 插件、整个 frontend 目录、根 package.json）
COPY package.json ./
COPY packages/supernote-clipper ./packages/supernote-clipper
COPY frontend ./frontend

# 运行整合了打包插件、编译前端、可跳过安卓打包的自签名编译脚本
RUN chmod +x frontend/android/build_signed_debug_apk.sh \
    && TARGETARCH=${TARGETARCH} ./frontend/android/build_signed_debug_apk.sh

# ---------- Stage 2: 后端构建（tsc） ----------
FROM --platform=$BUILDPLATFORM ${DOCKER_REGISTRY}node:20-alpine AS backend-build
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app/backend

# 配置镜像源（同 Stage 1）
RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY"; \
    fi \
    && npm config set fetch-retry-maxtimeout 180000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 600000

# tsc 纯 JS 架构无关，但 npm ci 会触发 better-sqlite3 / sqlite-vec / sharp 编译
# vips-dev + fftw-dev 是 sharp 在 Alpine (musl) 下从源码编译的依赖
RUN apk add --no-cache --virtual .build-deps python3 make g++ linux-headers vips-dev fftw-dev

COPY backend/package.json backend/package-lock.json ./
# 告知 sharp 选取 linux-musl 预构建包，而非 glibc 版
RUN npm_config_platform=linux npm_config_libc=musl \
    npm install --no-audit --no-fund --legacy-peer-deps
COPY backend/ .
RUN npx tsc

# build-deps 在这个 stage 用不着保留，最终运行时镜像会从 runtime stage 重新编译
RUN apk del .build-deps

# ---------- Stage 3: 运行时镜像 ----------
# 默认使用主机架构（`docker build`）；跨架构构建请用 buildx
FROM ${DOCKER_REGISTRY}node:20-alpine
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app

# 配置镜像源
RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY"; \
    fi \
    && npm config set fetch-retry-maxtimeout 180000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 600000

# tini 提供 PID 1 信号转发，15KB，避免容器 kill 时僵尸进程
# docker-cli 用于按需启停 SenseVoice 容器
RUN apk add --no-cache tini docker-cli

# 运行时依赖（production only）：独立编译一次，确保 .node 是正确架构的 musl 版
# 根 package.json 是运行时版本号的真相源
COPY package.json ./package.json
COPY backend/package.json backend/package-lock.json ./backend/
# vips-dev + fftw-dev 供 sharp 在 Alpine (musl) 下编译或加载预构建二进制
RUN apk add --no-cache --virtual .build-deps python3 make g++ linux-headers vips-dev fftw-dev \
    && cd backend \
    && npm_config_platform=linux npm_config_libc=musl \
       npm install --omit=dev --no-audit --no-fund --legacy-peer-deps \
    && apk del .build-deps \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/* /var/cache/apk/*

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY backend/templates ./backend/templates
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data

# 数据卷（便于 NAS 面板自动识别）
VOLUME ["/app/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ---- 版本/构建元信息 ----
ARG BUILD_DATE=""
ARG APP_VERSION=""
ENV SUPER_BUILD_TIME=${BUILD_DATE}
ENV SUPER_APP_VERSION=${APP_VERSION}

ENV NODE_ENV=production
ENV DB_PATH=/app/data/super-note.db
ENV PORT=3001

EXPOSE 3001

WORKDIR /app
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
