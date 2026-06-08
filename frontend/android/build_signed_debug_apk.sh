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

# Find Android SDK tools
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
ZIPALIGN_CMD=""
APKSIGNER_CMD=""
if [ -n "$ANDROID_SDK_ROOT" ]; then
  # prefer latest build-tools available
  if [ -d "$ANDROID_SDK_ROOT/build-tools" ]; then
    LATEST=$(ls -1 "$ANDROID_SDK_ROOT/build-tools" | sort -V | tail -n1)
    ZIPALIGN_CMD="$ANDROID_SDK_ROOT/build-tools/$LATEST/zipalign"
    APKSIGNER_CMD="$ANDROID_SDK_ROOT/build-tools/$LATEST/apksigner"
  fi
fi
# Fallback to PATH
: ${ZIPALIGN_CMD:="$(which zipalign 2>/dev/null || true)"}
: ${APKSIGNER_CMD:="$(which apksigner 2>/dev/null || true)"}

if [ -z "$ZIPALIGN_CMD" ] || [ -z "$APKSIGNER_CMD" ]; then
  echo "Error: zipalign or apksigner not found. Please ensure Android SDK build-tools are installed and ANDROID_SDK_ROOT/ANDROID_HOME is set, or tools are in PATH."
  exit 1
fi

print_usage() {
  cat <<EOF
Usage: $0 [--keystore <path>] [--alias <alias>] [--storepass <storepass>] [--keypass <keypass>] [--out <outdir>]

Generates (if missing) a local keystore and builds a debug APK, then signs and aligns it.
Defaults:
  keystore: $KEYSTORE_PATH
  alias:    $KEY_ALIAS
  storepass/keypass: "$STORE_PASS" / "$KEY_PASS"
  out dir:  $OUT_DIR

Examples:
  $0 --keystore ./mydebug.keystore --alias myalias --storepass secret --keypass secret --out ./out
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
# Use wrapper to ensure correct Gradle version
./gradlew clean assembleDebug -x lint || true
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

# Cleanup
rm -f "$TMP_ALIGNED"

echo "Signed debug APK created: $SIGNED_APK"
exit 0
