#!/bin/bash
set -e

# Run Android build script
echo "Running frontend/android/build_signed_debug_apk.sh..."
cd frontend/android
./build_signed_debug_apk.sh
cd ../../

# For local docker build compatibility, disable buildkit or clean it.
# Sometimes overlay issue happens in buildkit. We can prune docker builder.
echo "Running docker build..."
DOCKER_BUILDKIT=0 docker build \
    --build-arg DOCKER_REGISTRY=docker.m.daocloud.io/ \
    --build-arg APK_MIRROR=mirrors.aliyun.com \
    --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
    -t super-note .

echo "Docker build completed successfully."
