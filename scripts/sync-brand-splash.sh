#!/usr/bin/env bash
# 将 frontend/public/brand 默认闪屏/图标同步到 Capacitor 原生资源目录（需重打包生效）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="$ROOT/frontend/public/brand"
SPLASH="$BRAND/fuyou-splash-default.png"
ICON512="$BRAND/fuyou-icon-512.png"

if [[ ! -f "$SPLASH" ]]; then
  echo "missing $SPLASH" >&2
  exit 1
fi

echo "==> brand assets"
ls -la "$BRAND" | head -20

# Android drawable splash（若存在目录则复制）
ANDROID_RES="$ROOT/android/app/src/main/res"
if [[ -d "$ANDROID_RES" ]]; then
  for d in drawable drawable-port-mdpi drawable-port-hdpi drawable-port-xhdpi drawable-port-xxhdpi drawable-port-xxxhdpi; do
    dir="$ANDROID_RES/$d"
    if [[ -d "$dir" ]]; then
      cp -f "$SPLASH" "$dir/splash.png" 2>/dev/null || true
      echo "  android $d/splash.png"
    fi
  done
  if [[ -f "$ICON512" ]]; then
    # 简易：复制为 ic_launcher 候选（具体 mipmap 仍建议用 Android Studio / capacitor-assets）
    mkdir -p "$ANDROID_RES/drawable"
    cp -f "$ICON512" "$ANDROID_RES/drawable/fuyou_icon.png"
    echo "  android drawable/fuyou_icon.png"
  fi
else
  echo "  (skip android — no android/ tree)"
fi

# iOS Splash.imageset
IOS_SPLASH="$ROOT/ios/App/App/Assets.xcassets/Splash.imageset"
if [[ -d "$IOS_SPLASH" ]]; then
  cp -f "$SPLASH" "$IOS_SPLASH/splash-2732x2732.png" 2>/dev/null || cp -f "$SPLASH" "$IOS_SPLASH/splash.png" 2>/dev/null || true
  echo "  ios Splash.imageset updated"
else
  echo "  (skip ios — no Splash.imageset)"
fi

echo "==> done. Rebuild native apps: npx cap sync && open android/ios project."
echo "    Recommended: use @capacitor/assets for full multi-density icons."
