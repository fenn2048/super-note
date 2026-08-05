# Docker 构建指南（Phase 0–3）

## 快速构建

```bash
# 默认：小镜像（不含 APK；剪藏 zip 若已在 public/downloads 会打进镜像）
./build_docker.sh

# 推荐自托管 / 云端：内置剪藏插件 + 固定签名 Android APK
# （默认 patch 递增根 package.json 与 Android versionCode/versionName）
./build_docker.sh --with-assets

# 打包资源但不递增版本（CI 重复构建同一提交）
./build_docker.sh --with-assets --no-bump

# 官方源
./build_docker.sh --no-mirror

# 额外 tag
./build_docker.sh --tag super-note:dev

# 仅检查 context 门禁
./build_docker.sh --check-only
./build_docker.sh --with-assets --check-only
```

`--with-assets`（别名 `--build-assets` / `--with-apk`）会：

1. 打包浏览器剪藏 → `frontend/public/downloads/super-clipper-*.zip`
2. 用**固定** `frontend/android/debug.keystore` 签名 APK → `frontend/public/downloads/super-note-debug.apk`
3. **默认** patch 递增 `package.json` 版本，并同步 `app/build.gradle` 的 `versionCode` / `versionName`  
   - 需要关闭时加 `--no-bump`
4. 递增后重新读取版本，写入 Docker `APP_VERSION` build-arg
5. 再执行 `docker build`，Vite 将 `public/downloads` 复制进 `frontend/dist/downloads`

构建机需要：JDK + Android SDK（`zipalign` / `apksigner`）+ Node。

Compose：

```bash
docker compose build

# 中国大陆加速
DOCKER_REGISTRY=docker.m.daocloud.io/ \
APK_MIRROR=mirrors.aliyun.com \
NPM_REGISTRY=https://registry.npmmirror.com \
docker compose build
```

注意：`docker compose build` **不会**自动编 APK。需要客户端安装包时先跑：

```bash
./build_docker.sh --with-assets
# 或仅预生成资源后再 compose（不递增版本时用 --no-bump）
cd frontend/android && ./build_signed_debug_apk.sh
```

正式发布到 Docker Hub / 多架构见 `scripts/release.sh`。

## 客户端下载与签名

| 路径 | 说明 |
|------|------|
| `/downloads/super-note-debug.apk` | Android 安装包（固定签名，可覆盖安装） |
| `/downloads/super-clipper-chrome.zip` 等 | 剪藏扩展 |

- 设置 → 关于：点「下载」走直链 / 原生下载器  
- Android「下载更新」：原生流式下载后调起系统安装器  
- 签名文件：`frontend/android/debug.keystore`（已纳入版本库例外 `!debug.keystore`）  
  - alias: `mydebugkey`  
  - store/key pass: `android`（仅用于自托管 debug 分发；生产可换自己的 keystore）  
- **切勿删除/轮换 keystore**，否则用户无法覆盖安装旧包  

无内置 APK 时：`/downloads/*.apk` 会 302 到 `SUPER_ANDROID_APK_URL` 或 GitHub Releases。

## 架构摘要

| Stage | 内容 |
|-------|------|
| frontend-build | `npm ci` + Vite（含 public/downloads） |
| backend-build | esbuild 单文件 + 极简 native node_modules |
| runtime | `node:20-alpine` + 前端 dist |

## Context 与镜像门禁

```bash
node scripts/docker-context-size.mjs
node scripts/docker-context-size.mjs --with-assets
```

| 指标 | 默认 | `--with-assets` |
|------|------|-----------------|
| context 告警 | 80 MB | 150 MB |
| context 硬失败 | 200 MB | 280 MB |
| 镜像软告警 | ~450 MB | ~520 MB |

## CI

- 工作流：`.github/workflows/docker-build.yml`
- PR / push：默认 `docker build` **不含** APK
- 需要带 APK 的发布：本地或 CI 跑 `./build_docker.sh --with-assets`

## 常见问题

**Q: 设置页没有 Android APK？**  
A: 使用 `./build_docker.sh --with-assets` 重新构建并部署；或配置 `SUPER_ANDROID_APK_URL`。

**Q: 下载更新变成登录页？**  
A: 旧镜像对缺失的 `.apk` 会 SPA 回退 `index.html`。请升级后端；新版本会 404/302，不再回登录页。

**Q: 安装提示签名不一致？**  
A: 确认构建始终使用同一 `debug.keystore`，且仓库里已提交该文件。

**Q: `empty platform value from expression $BUILDPLATFORM`？**  
A: 不要在 Dockerfile 顶部写 `ARG BUILDPLATFORM=` 空默认。

**Q: sharp / better-sqlite3 启动报错？**  
A: 运行时需 Alpine musl 预编译包；Dockerfile 已设 `npm_config_platform=linux npm_config_libc=musl`。
