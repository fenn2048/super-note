#!/usr/bin/env bash
# =============================================================================
# super-note Docker 构建脚本（Phase 0–3）
# -----------------------------------------------------------------------------
# 用法：
#   ./build_docker.sh                 # 默认：BuildKit + 国内镜像，不编 APK
#   ./build_docker.sh --build-assets  # 编剪藏 zip + Android debug APK（很慢）
#   ./build_docker.sh --no-mirror     # 官方源
#   ./build_docker.sh --tag NAME      # 主 tag（默认 super-note）
#   ./build_docker.sh --no-sha-tag    # 不额外打 git short SHA tag
#   ./build_docker.sh --platform linux/amd64
#   ./build_docker.sh --check-only    # 只检查 context 门禁，不 build
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
      sed -n '2,16p' "$0"
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

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
APP_VERSION="$(node -e 'try{console.log(require("./package.json").version)}catch(e){console.log("")}' 2>/dev/null || true)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"

echo "==> Phase 3 docker build"
echo "    tag=${IMAGE_TAG}  git=${GIT_SHA}  version=${APP_VERSION:-n/a}"

# --- Context 门禁 ---
if command -v node >/dev/null 2>&1 && [[ -f scripts/docker-context-size.mjs ]]; then
  echo "==> Context size gate"
  node scripts/docker-context-size.mjs || {
    code=$?
    if [[ $code -eq 2 ]]; then
      echo "Context gate failed. Fix .dockerignore before building." >&2
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

# --- 可选 APK / 扩展 ---
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
    echo "WARN: frontend/android/build_signed_debug_apk.sh missing" >&2
  fi
  if [[ -f packages/supernote-clipper/package.json ]]; then
    (cd packages/supernote-clipper && npm run pack:all 2>/dev/null || npm run build) || true
  fi
else
  echo "==> Skip APK/Gradle (default). Use --build-assets to force."
  for f in "${CLIPPER_ZIPS[@]}"; do
    [[ -f "$f" ]] || echo "    warn: missing $f"
  done
  [[ -f "$APK_PATH" ]] || echo "    note: APK absent (excluded from image by .dockerignore)"
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

PLATFORM_ARGS=()
if [[ -n "$PLATFORM" ]]; then
  PLATFORM_ARGS+=(--platform "$PLATFORM")
  echo "==> platform=${PLATFORM}"
fi

echo "==> docker build ${TAGS[*]} ..."
START_TS=$(date +%s)

docker build \
  "${BUILD_ARGS[@]}" \
  "${PLATFORM_ARGS[@]}" \
  "${TAGS[@]}" \
  .

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo "==> Done in ${ELAPSED}s"
docker images "${IMAGE_TAG}" --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null || true

# 体积软报告
if docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
  SIZE=$(docker image inspect "${IMAGE_TAG}" --format '{{.Size}}')
  python3 - <<PY
size = int("${SIZE}")
mb = size / 1_000_000
print(f"Image size ≈ {mb:.1f} MB ({size} bytes)")
if size > 450_000_000:
    print("[WARN] soft gate: image > 450 MB")
else:
    print("[OK] soft gate: image ≤ 450 MB")
PY
fi

echo "Docs: docs/docker-build.md"
echo "Release: ./scripts/release.sh"
