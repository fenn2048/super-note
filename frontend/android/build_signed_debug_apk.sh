#!/usr/bin/env bash
set -euo pipefail

# build_signed_debug_apk.sh
# Usage:
#   ./build_signed_debug_apk.sh [--keystore <keystore>] [--alias <alias>] [--storepass <storepass>] [--keypass <keypass>] [--out <outdir>]
# If keystore not provided, a local debug keystore will be generated under the android folder.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_PROJECT_DIR="$SCRIPT_DIR"
GRADLEW="$ANDROID_PROJECT_DIR/gradlew"

KEYSTORE_PATH="${KEYSTORE_PATH:-$ANDROID_PROJECT_DIR/debug.keystore}"
KEY_ALIAS="${KEY_ALIAS:-mydebugkey}"
STORE_PASS="${STORE_PASS:-android}"
KEY_PASS="${KEY_PASS:-android}"
OUT_DIR="${OUT_DIR:-$ANDROID_PROJECT_DIR/output}"

# Auto-increment version in package.json and app/build.gradle
echo "==== Auto-incrementing version ===="
node -e "
const fs = require('fs');
const path = require('path');
const pkgPath = path.join('$SCRIPT_DIR', '../../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parts = (pkg.version || '1.0.0').split('.').map(Number);
if (parts.length === 3) { parts[2]++; } else { parts.push(1); }
const nextVersion = parts.join('.');
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Incremented root package.json version to:', nextVersion);

const gradlePath = path.join('$SCRIPT_DIR', 'app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  const major = parts[0] || 1;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  const nextCode = major * 10000 + minor * 100 + patch;
  gradle = gradle.replace(/versionCode\\s+\\d+/, 'versionCode ' + nextCode);
  gradle = gradle.replace(/versionName\\s+\\\"[^\\\"]+\\\"/, 'versionName \"' + nextVersion + '\"');
  fs.writeFileSync(gradlePath, gradle);
  console.log('Updated build.gradle with versionCode:', nextCode, 'versionName:', nextVersion);
}
"

# Find Java Home
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "$HOME/.local/jdk-21.0.11+10/Contents/Home" ]; then
    export JAVA_HOME="$HOME/.local/jdk-21.0.11+10/Contents/Home"
    export PATH="$JAVA_HOME/bin:$PATH"
  elif [ -d "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home" ]; then
    export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
fi

# Find Android SDK tools
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ZIPALIGN_CMD=""
APKSIGNER_CMD=""
if [ -d "$ANDROID_SDK_ROOT/build-tools" ]; then
  # prefer latest build-tools available
  LATEST=$(ls -1 "$ANDROID_SDK_ROOT/build-tools" | sort -V | tail -n1)
  ZIPALIGN_CMD="$ANDROID_SDK_ROOT/build-tools/$LATEST/zipalign"
  APKSIGNER_CMD="$ANDROID_SDK_ROOT/build-tools/$LATEST/apksigner"
fi
# Fallback to PATH
: ${ZIPALIGN_CMD:="$(which zipalign 2>/dev/null || true)"}
: ${APKSIGNER_CMD:="$(which apksigner 2>/dev/null || true)"}

# Determine if we should skip Android build (useful in environment like Docker without Android SDK)
SKIP_ANDROID_BUILD=0
if [ -z "$ZIPALIGN_CMD" ] || [ -z "$APKSIGNER_CMD" ] || [ ! -f "$GRADLEW" ]; then
  echo "Warning: zipalign, apksigner or gradlew not found. Android APK build will be skipped."
  SKIP_ANDROID_BUILD=1
fi

print_usage() {
  cat <<EOF
Usage: $0 [--keystore <path>] [--alias <alias>] [--storepass <storepass>] [--keypass <keypass>] [--out <outdir>]

Generates (if missing) a local keystore, packages browser extensions, builds frontend, and builds/signs a debug APK.
Defaults:
  keystore: $KEYSTORE_PATH
  alias:    $KEY_ALIAS
  storepass/keypass: "$STORE_PASS" / "$KEY_PASS"
  out dir:  $OUT_DIR
EOF
}

# Parse args
while [ "$#" -gt 0 ]; do
  case "$1" in
    --keystore) KEYSTORE_PATH="$2"; shift 2;;
    --alias) KEY_ALIAS="$2"; shift 2;;
    --storepass) STORE_PASS="$2"; shift 2;;
    --keypass) KEY_PASS="$2"; shift 2;;
    --out) OUT_DIR="$2"; shift 2;;
    -h|--help) print_usage; exit 0;;
    *) echo "Unknown arg: $1"; print_usage; exit 1;;
  esac
done

mkdir -p "$OUT_DIR"

# 1. Package browser extensions (supernote-clipper)
CLIPPER_DIR="$SCRIPT_DIR/../../packages/supernote-clipper"
FRONTEND_DIR="$SCRIPT_DIR/.."
if [ -d "$CLIPPER_DIR" ]; then
  echo "==== Building and packaging browser extensions ===="
  pushd "$CLIPPER_DIR" >/dev/null
  if [ -f "package-lock.json" ]; then
    npm ci --no-audit --no-fund --legacy-peer-deps || npm install --no-audit --no-fund --legacy-peer-deps
  else
    npm install --no-audit --no-fund --legacy-peer-deps
  fi
  npm run pack:all
  
  VERSION=$(node -e "console.log(require('./package.json').version)")
  mkdir -p "$FRONTEND_DIR/public/downloads"
  
  if [ -f "releases/super-clipper-${VERSION}.zip" ]; then
    cp "releases/super-clipper-${VERSION}.zip" "$FRONTEND_DIR/public/downloads/super-clipper-chrome.zip"
  fi
  if [ -f "releases/super-clipper-${VERSION}-edge.zip" ]; then
    cp "releases/super-clipper-${VERSION}-edge.zip" "$FRONTEND_DIR/public/downloads/super-clipper-edge.zip"
  fi
  if [ -f "releases/super-clipper-${VERSION}-firefox.zip" ]; then
    cp "releases/super-clipper-${VERSION}-firefox.zip" "$FRONTEND_DIR/public/downloads/super-clipper-firefox.zip"
  fi
  echo "Browser extensions copied to public downloads folder."
  popd >/dev/null
else
  echo "Browser extension directory not found at $CLIPPER_DIR, skipping."
fi

# 2. Build frontend and sync assets to Android
if [ "$SKIP_ANDROID_BUILD" -eq 0 ]; then
  echo "==== Building frontend ===="
  pushd "$FRONTEND_DIR" >/dev/null
  if [ -f "package-lock.json" ]; then
    npm ci --no-audit --no-fund --legacy-peer-deps || npm install --no-audit --no-fund --legacy-peer-deps
  else
    npm install --no-audit --no-fund --legacy-peer-deps
  fi

  # Install rollup target architecture package if TARGETARCH is set (inside Docker build)
  if [ -n "${TARGETARCH:-}" ]; then
    ROLLUP_VER=$(node -e "try{const l=require('./package-lock.json');const v=(l.packages||{})['node_modules/rollup']||(l.dependencies||{}).rollup||{};console.log(v.version||'')}catch(e){console.log('')}")
    [ -z "$ROLLUP_VER" ] && ROLLUP_VER="4.59.0"
    case "$TARGETARCH" in
      amd64) ROLLUP_PKG="@rollup/rollup-linux-x64-musl@${ROLLUP_VER}" ;;
      arm64) ROLLUP_PKG="@rollup/rollup-linux-arm64-musl@${ROLLUP_VER}" ;;
      *)     ROLLUP_PKG="" ;;
    esac
    if [ -n "$ROLLUP_PKG" ]; then
      echo "Installing rollup target arch pkg: $ROLLUP_PKG"
      npm install "$ROLLUP_PKG" --save-optional --no-audit --no-fund 2>/dev/null || true
    fi
  fi

  npm run build
  # Sync web build output to Android assets directory.
  echo "Syncing dist/ to Android assets..."
  if [ -d "android/app/src/main/assets/public" ]; then
    rm -rf android/app/src/main/assets/public/*
  fi
  if npx cap copy android 2>/dev/null; then
    echo "Sync via Capacitor CLI completed."
  else
    echo "Capacitor CLI copy failed or not found, falling back to manual copy..."
    mkdir -p android/app/src/main/assets/public
    cp -r dist/* android/app/src/main/assets/public/
  fi
  popd >/dev/null
else
  echo "==== Android build skipped, skipping host frontend build ===="
fi

# 3. Build signed Android APK if SDK tools exist
if [ "$SKIP_ANDROID_BUILD" -eq 0 ]; then
  echo "==== Building and signing Android App ===="
  # Clean old APK outputs to prevent picking up stale builds
  rm -rf "$OUT_DIR"/*
  find "$ANDROID_PROJECT_DIR" -type f -path "*/build/outputs/apk/debug/*.apk" -exec rm -f {} + 2>/dev/null || true

  # Generate keystore if missing
  if [ ! -f "$KEYSTORE_PATH" ]; then
    echo "Keystore not found at $KEYSTORE_PATH. Generating..."
    keytool -genkeypair \
      -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -keystore "$KEYSTORE_PATH" \
      -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
      -dname "CN=Local Debug, OU=Dev, O=Local, L=City, ST=State, C=CN"
    echo "Keystore generated: $KEYSTORE_PATH"
  fi

  # Ensure gradlew is executable
  if [ ! -x "$GRADLEW" ]; then
    chmod +x "$GRADLEW" || true
  fi

  # Build debug APK
  echo "Starting Gradle assembleDebug..."
  pushd "$ANDROID_PROJECT_DIR" >/dev/null
  ./gradlew clean assembleDebug -x lint
  popd >/dev/null

  # Locate the produced APK
  APK_PATH="$(find "$ANDROID_PROJECT_DIR" -type f -path "*/build/outputs/apk/debug/*.apk" | head -n1)"
  if [ -z "$APK_PATH" ]; then
    echo "Error: couldn't find generated debug APK"
    exit 1
  fi

  SIGNED_APK="$OUT_DIR/$(basename "$APK_PATH" .apk)-signed.apk"
  TMP_ALIGNED="$OUT_DIR/tmp-aligned.apk"

  # Align and sign
  echo "Aligning APK..."
  "$ZIPALIGN_CMD" -v -p 4 "$APK_PATH" "$TMP_ALIGNED"

  echo "Signing APK with keystore: $KEYSTORE_PATH (alias: $KEY_ALIAS)"
  "$APKSIGNER_CMD" sign --ks "$KEYSTORE_PATH" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass pass:"$STORE_PASS" --key-pass pass:"$KEY_PASS" --out "$SIGNED_APK" "$TMP_ALIGNED"

  # Verify signature
  "$APKSIGNER_CMD" verify "$SIGNED_APK" && echo "Signature verified."
  rm -f "$TMP_ALIGNED"

  echo "Signed debug APK created: $SIGNED_APK"

else
  echo "==== Android build skipped ===="
fi

# 4. Copy final downloads to web build (dist/downloads)
echo "==== Copying final assets to web build (dist/downloads/) ===="
mkdir -p "$FRONTEND_DIR/dist/downloads"

# Copy browser extensions if they exist
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")
CLIPPER_DIR="$SCRIPT_DIR/../../packages/supernote-clipper"
if [ -d "$CLIPPER_DIR" ]; then
  CLIPPER_VERSION=$(node -e "try { console.log(require('$CLIPPER_DIR/package.json').version) } catch(e) { console.log('$VERSION') }" 2>/dev/null || echo "0.0.0")
  if [ -f "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}.zip" ]; then
    cp "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}.zip" "$FRONTEND_DIR/dist/downloads/super-clipper-chrome.zip"
  fi
  if [ -f "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}-edge.zip" ]; then
    cp "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}-edge.zip" "$FRONTEND_DIR/dist/downloads/super-clipper-edge.zip"
  fi
  if [ -f "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}-firefox.zip" ]; then
    cp "$CLIPPER_DIR/releases/super-clipper-${CLIPPER_VERSION}-firefox.zip" "$FRONTEND_DIR/dist/downloads/super-clipper-firefox.zip"
  fi
  echo "Browser extensions copied to dist/downloads/."
fi

# Copy signed APK if it was built
if [ "$SKIP_ANDROID_BUILD" -eq 0 ] && [ -f "${SIGNED_APK:-}" ]; then
  cp "$SIGNED_APK" "$FRONTEND_DIR/dist/downloads/super-note-debug.apk"
  cp "$SIGNED_APK" "$FRONTEND_DIR/public/downloads/super-note-debug.apk"
  echo "Signed APK copied to dist/downloads/ and public/downloads/."
fi

echo "==== Build process completed! ===="
exit 0
