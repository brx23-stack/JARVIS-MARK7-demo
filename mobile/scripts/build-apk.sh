#!/usr/bin/env bash
# Builds and signs the APK. Run from anywhere; needs Node 22, JDK 21, Android SDK.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_NAME="${APK_NAME:-JARVIS-MARK7.apk}"
TMP="${RUNNER_TEMP:-/tmp}"

cd "$ROOT/mobile"
npm install --no-audit --no-fund
npx cap add android
node scripts/patch-android.mjs
npx cap sync android
(cd android && chmod +x gradlew && ./gradlew assembleRelease --no-daemon --stacktrace)

BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
IN="$(ls android/app/build/outputs/apk/release/*.apk | head -1)"
KS="$TMP/signing.jks"

if [ -n "${KEYSTORE_B64:-}" ] && [ -n "${KS_PASS:-}" ]; then
  echo "$KEYSTORE_B64" | base64 -d > "$KS"
  ALIAS="${KEY_ALIAS:-jarvis}"
  SIGNING="your own keystore (updates install over older builds)"
else
  KS_PASS="android-temp-$RANDOM$RANDOM"
  ALIAS="jarvis"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=JARVIS MARK 7"
  SIGNING="temporary key (uninstall the old app before installing a new build)"
fi
export KS_PASS

"$BT/zipalign" -p -f 4 "$IN" "$TMP/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-alias "$ALIAS" --ks-pass env:KS_PASS \
  --out "$ROOT/$APK_NAME" "$TMP/aligned.apk"
"$BT/apksigner" verify --verbose "$ROOT/$APK_NAME"

echo "Built $ROOT/$APK_NAME, signed with $SIGNING"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### JARVIS MARK 7 APK built
- File: \`$APK_NAME\` (see **Artifacts** below)
- Signed with: $SIGNING" >> "$GITHUB_STEP_SUMMARY"
fi
