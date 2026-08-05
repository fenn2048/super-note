#!/usr/bin/env bash
# =============================================================================
# super-note Docker 构建脚本（Phase 0–3）
# -----------------------------------------------------------------------------
# 用法：
#   ./build_docker.sh                      # 默认：小镜像，不含 APK
#   ./build_docker.sh --with-assets        # 先编剪藏 zip + 固定签名 APK，再打进镜像
#   ./build_docker.sh --build-assets       # 同上（旧别名）
#   ./build_docker.sh --with-assets --no-bump  # 打包资源但不递增版本号
#   ./build_docker.sh --no-mirror          # 官方源
#   ./build_docker.sh --tag NAME           # 主 tag（默认 super-note）
#   ./build_docker.sh --no-sha-tag         # 不额外打 git short SHA tag
#   ./build_docker.sh --platform linux/amd64
#   ./build_docker.sh --check-only         # 只检查 context 门禁，不 build
#
# --with-assets 说明：
#   - 剪藏：packages/supernote-clipper → frontend/public/downloads/*.zip
#   - APK：固定 keystore（frontend/android/debug.keystore）签名，可覆盖安装
#   - 默认 patch 递增根 package.json 与 Android versionCode/versionName
#   - 加 --no-bump 可关闭递增（CI 重复构建同一提交时用）
#   - 构建后网页「关于」与 Android「下载更新」均可直链 /downloads/...
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BUILD_ASSETS=false
USE_MIRROR=true
IMAGE_TAG="super-note"
SHA_TAG=true
PLATFORM=""
CHECK_ONLY=false
# --with-assets 时默认 bump；可用 --no-bump 关闭
NO_BUMP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-assets|-a|--with-apk|--with-assets)
      BUILD_ASSETS=true
      shift
      ;;
    --no-bump)
      NO_BUMP=true
      shift
      ;;
    --no-mirror)
      USE_MIRROR=false
      shift
      ;;
    --tag)
      IMAGE_TAG="${2:-super-note}"
      shift 2
      ;;
    --no-sha-tag)
      SHA_TAG=false
      shift
      ;;
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    -h|--help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

read_app_version() {
  node -e 'try{console.log(require("./package.json").version)}catch(e){console.log("")}' 2>/dev/null || true
}

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
APP_VERSION="$(read_app_version)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"

echo "==> Phase 3 docker build"
echo "    tag=${IMAGE_TAG}  git=${GIT_SHA}  version=${APP_VERSION:-n/a}"
echo "    with-assets=${BUILD_ASSETS}  no-bump=${NO_BUMP}"

# --- 可选：客户端安装包（必须在 context gate 之前生成，才能进镜像）---
CLIPPER_ZIPS=(
  "frontend/public/downloads/super-clipper-chrome.zip"
  "frontend/public/downloads/super-clipper-edge.zip"
  "frontend/public/downloads/super-clipper-firefox.zip"
)
APK_PATH="frontend/public/downloads/super-note-debug.apk"
ASSET_SCRIPT="frontend/android/build_signed_debug_apk.sh"

if [[ "$BUILD_ASSETS" == true ]]; then
  ASSET_ARGS=()
  if [[ "$NO_BUMP" == true ]]; then
    ASSET_ARGS+=(--no-bump)
    echo "==> Building clipper + signed APK (stable keystore, --no-bump)..."
  else
    echo "==> Building clipper + signed APK (stable keystore, bump patch version)..."
  fi
  if [[ ! -x "$ASSET_SCRIPT" ]]; then
    echo "ERROR: missing executable $ASSET_SCRIPT" >&2
    exit 1
  fi
  # 固定签名：使用仓库内 debug.keystore（若不存在脚本会生成并提示提交）
  # 默认会递增根 package.json patch 与 app/build.gradle versionCode/versionName
  (cd frontend/android && ./build_signed_debug_apk.sh ${ASSET_ARGS[@]+"${ASSET_ARGS[@]}"})

  # bump 发生在资源构建阶段，镜像 APP_VERSION / 标签必须读回新版本
  APP_VERSION="$(read_app_version)"
  echo "    app version after assets: ${APP_VERSION:-n/a}"

  missing=0
  for f in "${CLIPPER_ZIPS[@]}"; do
    if [[ ! -f "$f" ]]; then
      echo "ERROR: missing clipper asset: $f" >&2
      missing=1
    else
      echo "    ok  $f ($(du -h "$f" | awk '{print $1}'))"
    fi
  done
  if [[ ! -f "$APK_PATH" ]]; then
    echo "ERROR: missing APK: $APK_PATH" >&2
    echo "       Need Android SDK (zipalign/apksigner) + JDK on the build machine." >&2
    missing=1
  else
    echo "    ok  $APK_PATH ($(du -h "$APK_PATH" | awk '{print $1}'))"
  fi
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
  export DOCKER_CONTEXT_WITH_ASSETS=1
else
  echo "==> Skip APK/Gradle (default). Use --with-assets to bundle clients."
  for f in "${CLIPPER_ZIPS[@]}"; do
    [[ -f "$f" ]] || echo "    warn: missing $f (关于页剪藏下载会 404)"
  done
  if [[ -f "$APK_PATH" ]]; then
    echo "    note: $APK_PATH exists and will be included in context"
    export DOCKER_CONTEXT_WITH_ASSETS=1
  else
    echo "    note: no APK in public/downloads (Android 更新将回落 GitHub/ENV)"
  fi
fi

# --- Context 门禁 ---
if command -v node >/dev/null 2>&1 && [[ -f scripts/docker-context-size.mjs ]]; then
  echo "==> Context size gate"
  GATE_ARGS=()
  if [[ "${DOCKER_CONTEXT_WITH_ASSETS:-}" == "1" ]]; then
    GATE_ARGS+=(--with-assets)
  fi
  node scripts/docker-context-size.mjs "${GATE_ARGS[@]+"${GATE_ARGS[@]}"}" || {
    code=$?
    if [[ $code -eq 2 ]]; then
    
      exit 2
    fi
  }
else
  echo "==> Skip context gate (node or script missing)"
fi

if [[ "$CHECK_ONLY" == true ]]; then
  echo "==> --check-only: done"
  exit 0
fi

BUILD_ARGS=(
  --build-arg "APP_VERSION=${APP_VERSION}"
  --build-arg "BUILD_DATE=${BUILD_DATE}"
)
if [[ "$USE_MIRROR" == true ]]; then
  BUILD_ARGS+=(
    --build-arg "DOCKER_REGISTRY=docker.m.daocloud.io/"
    --build-arg "APK_MIRROR=mirrors.aliyun.com"
    --build-arg "NPM_REGISTRY=https://registry.npmmirror.com"
  )
  echo "==> Mirrors: DaoCloud / Aliyun apk / npmmirror"
else
  echo "==> Official registries"
fi

TAGS=(-t "${IMAGE_TAG}" -t "${IMAGE_TAG}:latest")
if [[ "$SHA_TAG" == true && "$GIT_SHA" != "unknown" ]]; then
  TAGS+=(-t "${IMAGE_TAG}:${GIT_SHA}")
  echo "==> Extra tag: ${IMAGE_TAG}:${GIT_SHA}"
fi

# macOS Bash 3.2 + set -u：空数组 "${arr[@]}" 会报 unbound variable
DOCKER_ARGS=("${BUILD_ARGS[@]}" "${TAGS[@]}")
if [[ -n "$PLATFORM" ]]; then
  DOCKER_ARGS=(--platform "$PLATFORM" "${DOCKER_ARGS[@]}")
  echo "==> platform=${PLATFORM}"
fi

echo "==> docker build ${TAGS[*]} ..."
START_TS=$(date +%s)

docker build "${DOCKER_ARGS[@]}" .

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo "==> Done in ${ELAPSED}s"
docker images "${IMAGE_TAG}" --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null || true

if docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
  SIZE=$(docker image inspect "${IMAGE_TAG}" --format '{{.Size}}')
  python3 - <<PY
size = int("${SIZE}")
mb = size / 1_000_000
print(f"Image size ≈ {mb:.1f} MB ({size} bytes)")
limit = 520_000_000 if "${BUILD_ASSETS}" == "true" else 450_000_000
if size > limit:
    print(f"[WARN] soft gate: image > {limit // 1_000_000} MB")
else:
    print(f"[OK] soft gate: image ≤ {limit // 1_000_000} MB")
PY
fi

if [[ "$BUILD_ASSETS" == true ]]; then
  echo "==> Verify downloads in image (optional):"
  echo "    docker run --rm ${IMAGE_TAG} ls -la /app/frontend/dist/downloads/"
fi

echo "Docs: docs/docker-build.md"
echo "Release: ./scripts/release.sh"
if [[ "$BUILD_ASSETS" != true ]]; then
  echo "Tip: ./build_docker.sh --with-assets  # bundle APK + clipper into image"
fi
