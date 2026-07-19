# =============================================================================
# super-note 多架构 Dockerfile（Alpine · Phase 0+1 缓存优化）
# -----------------------------------------------------------------------------
# 关键改动（相对旧版）：
#   - npm ci + BuildKit cache mount（/root/.npm）
#   - 前端 COPY 分层：依赖与源码分离，避免改一行业务就重装依赖
#   - APK 默认不进 context（.dockerignore），镜像更小
#   - 后端同样 npm ci + cache
#
# 构建：
#   DOCKER_BUILDKIT=1 docker build \
#     --build-arg DOCKER_REGISTRY=docker.m.daocloud.io/ \
#     --build-arg APK_MIRROR=mirrors.aliyun.com \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     -t super-note .
# =============================================================================

ARG DOCKER_REGISTRY=""
ARG TARGETPLATFORM=
ARG TARGETARCH=
ARG BUILDPLATFORM=

ARG APK_MIRROR=""
ARG NPM_REGISTRY=""

# ---------- 公共：配置 apk / npm 镜像 ----------
# 各 stage 内联一小段，避免额外 base stage 拖垮缓存命中语义


# ---------- Stage 1: 前端构建 ----------
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

# 1) 仅 lockfile → 依赖层可长期缓存
COPY package.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN --mount=type=cache,target=/root/.npm \
    cd frontend \
    && npm ci --no-audit --no-fund --legacy-peer-deps

# 2) 配置与源码分层（改业务代码不重装依赖）
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

# 3) 目标 arch 的 rollup musl 绑定 + 构建
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
        echo "Installing rollup target arch pkg: $ROLLUP_PKG"; \
        npm install "$ROLLUP_PKG" --no-save --no-audit --no-fund 2>/dev/null || true; \
      fi; \
    fi \
    && npm run build \
    && find dist -name '*.map' -type f -delete 2>/dev/null || true


# ---------- Stage 2: 后端构建 ----------
FROM --platform=$BUILDPLATFORM ${DOCKER_REGISTRY}node:20-alpine AS backend-build
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

# better-sqlite3 / sqlite-vec / sharp(musl 源码路径) 需要编译链
RUN apk add --no-cache --virtual .build-deps python3 make g++ linux-headers vips-dev fftw-dev

COPY backend/package.json backend/package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm_config_platform=linux npm_config_libc=musl \
    npm ci --no-audit --no-fund --legacy-peer-deps

COPY backend/tsconfig.json ./
COPY backend/src ./src
# templates 运行时需要；构建 tsc 不依赖，但一并复制简化 runtime COPY
COPY backend/templates ./templates

RUN npx tsc \
    && npm prune --omit=dev --no-audit --no-fund \
    && apk del .build-deps \
    && rm -rf /tmp/* /root/.npm/_logs


# ---------- Stage 3: 运行时 ----------
FROM ${DOCKER_REGISTRY}node:20-alpine
ARG APK_MIRROR
WORKDIR /app

# 运行时尽量少装包；sharp 预编译包通常自带，不装 vips-dev
RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i 's/https/http/g' /etc/apk/repositories \
      && sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache tini \
    && rm -rf /var/cache/apk/*

COPY package.json ./package.json
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
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
    PORT=3001

EXPOSE 3001
WORKDIR /app
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
