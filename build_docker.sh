#!/usr/bin/env bash
# =============================================================================
# super-note Docker 构建脚本（Phase 0+1）
# -----------------------------------------------------------------------------
# 用法：
#   ./build_docker.sh                 # 默认：不编 APK，BuildKit + 国内镜像加速
#   ./build_docker.sh --build-assets  # 强制编剪藏 zip + Android debug APK（很慢）
#   ./build_docker.sh --with-apk      # 同 --build-assets
#   ./build_docker.sh --no-mirror     # 不用 DaoCloud/npmmirror，走官方源
#   ./build_docker.sh --tag my-tag    # 自定义镜像 tag（默认 super-note）
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BUILD_ASSETS=false
USE_MIRROR=true
IMAGE_TAG="super-note"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-assets|-a|--with-apk)
      BUILD_ASSETS=true
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
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

# BuildKit：cache mount、并行 stage 必需
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# --- 可选：本机预构建下载页资产（默认跳过，避免 Gradle 拖垮）---
CLIPPER_ZIPS=(
  "frontend/public/downloads/super-clipper-chrome.zip"
  "frontend/public/downloads/super-clipper-edge.zip"
  "frontend/public/downloads/super-clipper-firefox.zip"
)
APK_PATH="frontend/public/downloads/super-note-debug.apk"

if [[ "$BUILD_ASSETS" == true ]]; then
  echo "==> Building clipper + Android debug APK (slow)..."
  if [[ -x frontend/android/build_signed_debug_apk.sh ]]; then
    (cd frontend/android && ./build_signed_debug_apk.sh)
  else
    echo "WARN: frontend/android/build_signed_debug_apk.sh missing or not executable" >&2
  fi
  # 剪藏 zip（若脚本未覆盖）
  if [[ -f packages/supernote-clipper/package.json ]]; then
    (cd packages/supernote-clipper && npm run pack:all 2>/dev/null || npm run build) || true
  fi
else
  echo "==> Skip APK/Gradle (default). Use --build-assets to force."
  MISSING=()
  for f in "${CLIPPER_ZIPS[@]}"; do
    [[ -f "$f" ]] || MISSING+=("$f")
  done
  if [[ ! -f "$APK_PATH" ]]; then
    echo "    note: $APK_PATH not present (excluded from image by .dockerignore anyway)"
  fi
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "    warn: clipper zips missing (download page empty for those):"
    printf '      - %s\n' "${MISSING[@]}"
    echo "    rebuild with: $0 --build-assets   or pack packages/supernote-clipper"
  fi
fi

# --- context 体积提示 ---
if command -v du >/dev/null 2>&1; then
  echo "==> Rough context (git-clean estimate; docker still applies .dockerignore):"
  du -sh backend/src frontend/src frontend/public backend/package-lock.json 2>/dev/null || true
fi

BUILD_ARGS=()
if [[ "$USE_MIRROR" == true ]]; then
  BUILD_ARGS+=(
    --build-arg "DOCKER_REGISTRY=docker.m.daocloud.io/"
    --build-arg "APK_MIRROR=mirrors.aliyun.com"
    --build-arg "NPM_REGISTRY=https://registry.npmmirror.com"
  )
  echo "==> Using China mirrors (DaoCloud / Aliyun apk / npmmirror). --no-mirror to disable."
else
  echo "==> Using official registries."
fi

# 版本元信息（可选）
APP_VERSION="$(node -e 'try{console.log(require("./package.json").version)}catch(e){console.log("")}' 2>/dev/null || true)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
BUILD_ARGS+=(
  --build-arg "APP_VERSION=${APP_VERSION}"
  --build-arg "BUILD_DATE=${BUILD_DATE}"
)

echo "==> docker build -t ${IMAGE_TAG} ..."
# shellcheck disable=SC2086
docker build \
  "${BUILD_ARGS[@]}" \
  -t "${IMAGE_TAG}" \
  .

echo "==> Done: ${IMAGE_TAG}"
docker image inspect "${IMAGE_TAG}" --format 'Size: {{.Size}} bytes ({{printf "%.1f" (div .Size 1000000.0)}} MB approx)' 2>/dev/null \
  || docker images "${IMAGE_TAG}" --format 'Size: {{.Size}}'
echo "Tip: rebuild after only source changes should hit npm ci cache layers."
