#!/bin/bash
set -e

# Run all backend test cases before building
#echo "Running backend test suites..."
#cd backend
#node --import tsx --test src/routes/__tests__/projects.test.ts src/routes/__tests__/#diary.test.ts src/routes/__tests__/notes.test.ts src/routes/__tests__/mindmaps.test.ts
#cd ..


# Run Android build script
echo "Running frontend/android/build_signed_debug_apk.sh..."
cd frontend/android
./build_signed_debug_apk.sh
cd ../../

# BuildKit is required for multi-arch ARGs (BUILDPLATFORM / TARGETARCH).
# If you hit overlay issues, run: docker builder prune
echo "Running docker build..."
docker build \
    --build-arg DOCKER_REGISTRY=docker.m.daocloud.io/ \
    --build-arg APK_MIRROR=mirrors.aliyun.com \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
    -t super-note .

echo "Docker build completed successfully."
