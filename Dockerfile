# =============================================================================
# super-note Dockerfile（Phase 0+1+2）
# -----------------------------------------------------------------------------
# Phase 2：
#   - 后端 esbuild 单文件 dist/index.js
#   - 运行时 node_modules 仅保留 native/external（better-sqlite3/sharp/…）
#   - 前端构建后删除 map；manualChunks 由 vite 配置负责
# =============================================================================

# 仅声明会在 FROM 中插值的 ARG。
# 切勿写 ARG BUILDPLATFORM= / TARGETARCH= 空默认值：会覆盖 BuildKit 自动注入，
# 导致 FROM --platform=$BUILDPLATFORM 报 empty platform value。
ARG DOCKER_REGISTRY=""
ARG APK_MIRROR=""
ARG NPM_REGISTRY=""


# ---------- Stage 1: 前端 ----------
# BUILDPLATFORM / TARGETARCH 由 BuildKit 自动注入（无需全局 ARG）
FROM --platform=$BUILDPLATFORM ${DOCKER_REGISTRY}node:20-alpine AS frontend-build
ARG TARGETARCH
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app

RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache bash \
    && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm config set fetch-retry-maxtimeout 180000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 600000

COPY package.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN --mount=type=cache,target=/root/.npm \
    cd frontend \
    && npm ci --no-audit --no-fund --legacy-peer-deps

COPY frontend/index.html \
     frontend/vite.config.ts \
     frontend/tsconfig.json \
     frontend/tsconfig.app.json \
     frontend/tsconfig.node.json \
     frontend/postcss.config.cjs \
     frontend/tailwind.config.cjs \
     frontend/components.json \
     ./frontend/
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public

RUN --mount=type=cache,target=/root/.npm \
    cd frontend \
    && if [ -n "${TARGETARCH}" ]; then \
      ROLLUP_VER=$(node -e "try{const l=require('./package-lock.json');const v=(l.packages||{})['node_modules/rollup']||(l.dependencies||{}).rollup||{};console.log(v.version||'')}catch(e){console.log('')}"); \
      [ -z "$ROLLUP_VER" ] && ROLLUP_VER="4.59.0"; \
      case "$TARGETARCH" in \
        amd64) ROLLUP_PKG="@rollup/rollup-linux-x64-musl@${ROLLUP_VER}" ;; \
        arm64) ROLLUP_PKG="@rollup/rollup-linux-arm64-musl@${ROLLUP_VER}" ;; \
        *)     ROLLUP_PKG="" ;; \
      esac; \
      if [ -n "$ROLLUP_PKG" ]; then \
        npm install "$ROLLUP_PKG" --no-save --no-audit --no-fund 2>/dev/null || true; \
      fi; \
    fi \
    && npm run build \
    && find dist -name '*.map' -type f -delete 2>/dev/null || true \
    && find dist -type d -name 'node_modules' -prune -o -type f -name '*.LICENSE.txt' -delete 2>/dev/null || true


# ---------- Stage 2: 后端 bundle + 极简 runtime node_modules ----------
FROM --platform=$BUILDPLATFORM ${DOCKER_REGISTRY}node:20-alpine AS backend-build
ARG TARGETARCH
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app/backend

RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm config set fetch-retry-maxtimeout 180000 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-timeout 600000

# 编译 native 模块需要工具链；esbuild 为 JS 依赖
RUN apk add --no-cache --virtual .build-deps python3 make g++ linux-headers vips-dev fftw-dev

COPY backend/package.json backend/package-lock.json ./
COPY backend/build.bundle.mjs ./
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/templates ./templates

# 全量依赖（含 esbuild dev）用于打包
RUN --mount=type=cache,target=/root/.npm \
    npm_config_platform=linux npm_config_libc=musl \
    npm ci --no-audit --no-fund --legacy-peer-deps \
    && node build.bundle.mjs

# 仅安装 runtime external 到 dist/node_modules（体积关键）
WORKDIR /app/backend/dist
RUN --mount=type=cache,target=/root/.npm \
    npm_config_platform=linux npm_config_libc=musl \
    npm install --omit=dev --no-audit --no-fund --legacy-peer-deps \
    && apk del .build-deps \
    && rm -rf /tmp/* /root/.npm/_logs \
    && du -sh /app/backend/dist /app/backend/dist/node_modules 2>/dev/null || true


# ---------- Stage 3: 运行时 ----------
FROM ${DOCKER_REGISTRY}node:20-alpine
ARG APK_MIRROR
WORKDIR /app

RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache tini \
    && rm -rf /var/cache/apk/*

COPY package.json ./package.json
# 单文件 + 极简 node_modules
COPY --from=backend-build /app/backend/dist/index.js ./backend/dist/index.js
COPY --from=backend-build /app/backend/dist/package.json ./backend/dist/package.json
COPY --from=backend-build /app/backend/dist/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/templates ./backend/templates
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data
VOLUME ["/app/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ARG BUILD_DATE=""
ARG APP_VERSION=""
ENV SUPER_BUILD_TIME=${BUILD_DATE} \
    SUPER_APP_VERSION=${APP_VERSION} \
    NODE_ENV=production \
    DB_PATH=/app/data/super-note.db \
    PORT=3001 \
    # NODE_PATH 让 require('better-sqlite3') 从 /app/backend/node_modules 解析
    NODE_PATH=/app/backend/node_modules

EXPOSE 3001
WORKDIR /app
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
# 从 /app 启动时 cwd 正确，node 找 backend/dist/index.js；
# external 模块经 NODE_PATH 解析
CMD ["node", "backend/dist/index.js"]
