#!/bin/bash
set -e

# Run all backend test cases before building
#echo "Running backend test suites..."
#cd backend
#node --import tsx --test src/routes/__tests__/projects.test.ts src/routes/__tests__/#diary.test.ts src/routes/__tests__/notes.test.ts src/routes/__tests__/mindmaps.test.ts
#cd ..


# Check if the user wants to rebuild assets
BUILD_ASSETS=false
for arg in "$@"; do
  if [ "$arg" = "--build-assets" ] || [ "$arg" = "-a" ]; then
    BUILD_ASSETS=true
  fi
done

# Check if pre-built download assets exist in frontend/public/downloads/
REQUIRED_ASSETS=(
  "frontend/public/downloads/super-note-debug.apk"
  "frontend/public/downloads/super-clipper-chrome.zip"
  "frontend/public/downloads/super-clipper-edge.zip"
  "frontend/public/downloads/super-clipper-firefox.zip"
)

MISSING_ASSETS=false
for asset in "${REQUIRED_ASSETS[@]}"; do
  if [ ! -f "$asset" ]; then
    MISSING_ASSETS=true
    break
  fi
done

if [ "$MISSING_ASSETS" = true ]; then
  echo "Missing pre-built mobile app or browser extensions in frontend/public/downloads/."
  echo "Forcing asset build..."
  BUILD_ASSETS=true
fi

if [ "$BUILD_ASSETS" = true ]; then
  echo "Running frontend/android/build_signed_debug_apk.sh..."
  cd frontend/android
  ./build_signed_debug_apk.sh
  cd ../../
else
  echo "=========================================================="
  echo " Using existing pre-built assets in frontend/public/downloads/"
  echo " To force rebuild apk/extensions, run: $0 --build-assets"
  echo "=========================================================="
fi

# BuildKit is required for multi-arch ARGs (BUILDPLATFORM / TARGETARCH).
# If you hit overlay issues, run: docker builder prune
echo "Running docker build..."
docker build \
    --build-arg DOCKER_REGISTRY=docker.m.daocloud.io/ \
    --build-arg APK_MIRROR=mirrors.aliyun.com \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
    -t super-note .

echo "Docker build completed successfully."
