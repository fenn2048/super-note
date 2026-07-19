# Docker 构建指南（Phase 0–3）

## 快速构建

```bash
# 推荐：BuildKit + 国内镜像，不编 APK
./build_docker.sh

# 官方源
./build_docker.sh --no-mirror

# 额外 tag
./build_docker.sh --tag super-note:dev

# 需要设置页 APK/扩展（很慢）
./build_docker.sh --build-assets
```

Compose：

```bash
# 使用默认 Dockerfile 构建
docker compose build

# 中国大陆加速（compose 已支持变量）
DOCKER_REGISTRY=docker.m.daocloud.io/ \
APK_MIRROR=mirrors.aliyun.com \
NPM_REGISTRY=https://registry.npmmirror.com \
docker compose build
```

正式发布到 Docker Hub / 多架构见 `scripts/release.sh`。

## 架构摘要

| Stage | 内容 |
|-------|------|
| frontend-build | `npm ci` + Vite，依赖层与源码层分离 |
| backend-build | 全量 deps → **esbuild 单文件** → 仅装 external native 到 `node_modules` |
| runtime | `node:20-alpine` + `dist/index.js` + 极简 native modules + `frontend/dist` |

External（运行时真实 require）：`better-sqlite3`、`sqlite-vec`、`sharp`、`bonjour-service`、`unpdf`。

## Context 与镜像门禁

```bash
# 估算 context（应通常 < 80MB，>200MB 失败）
node scripts/docker-context-size.mjs

# 镜像体积
docker images super-note
```

| 指标 | 目标（Phase 0–2 后） |
|------|----------------------|
| build context | **&lt; 80 MB**（告警），**&lt; 200 MB**（硬失败） |
| 冷构建（有缓存 mount） | 视网络，重复构建明显加速 |
| 热构建（只改 backend 业务） | 尽量只重跑 bundle 层 |
| 镜像 | 显著小于「全量 node_modules + data/APK」时期 |

## CI

- 工作流：`.github/workflows/docker-build.yml`
- PR / push 到主分支：`docker build` + GHA cache
- 不默认推镜像；发布用 `scripts/release.sh`

## 常见问题

**Q: 设置页没有 Android APK？**  
A: `.dockerignore` 排除 `*.apk`，镜像不内置 APK。本地 `./build_docker.sh --build-assets` 或外链 Release。

**Q: `npm ci` 失败？**  
A: 检查 lockfile 是否与 `package.json` 同步；本地 `cd backend && npm install` / `cd frontend && npm install` 后提交 lock。

**Q: sharp / better-sqlite3 启动报错？**  
A: 运行时必须带 Alpine musl 预编译包；Dockerfile 已设 `npm_config_platform=linux npm_config_libc=musl`。

**Q: `empty platform value from expression $BUILDPLATFORM`？**  
A: 不要在 Dockerfile 顶部写 `ARG BUILDPLATFORM=`（空默认会盖掉 BuildKit 自动注入）。构建阶段用 `FROM --platform=$BUILDPLATFORM`，平台变量由 BuildKit 提供。
