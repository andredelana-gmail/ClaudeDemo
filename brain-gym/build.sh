#!/usr/bin/env bash
# Builds a signed, installable APK without Gradle — only the Android SDK
# build-tools + platform and a JDK are needed.
#   ANDROID_HOME   SDK location (default /opt/android-sdk)
# Output: dist/BrainGym.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
VERSION_CODE=1
VERSION_NAME=1.0
KS=release.keystore
KS_PASS=braingym
ALIAS=braingym

[ -f "$JAR" ] || { echo "Missing $JAR — install with: sdkmanager 'platforms;android-35' 'build-tools;35.0.0'"; exit 1; }

rm -rf build && mkdir -p build/gen build/classes build/dex dist

echo "› Compiling resources"
"$BT/aapt2" compile --dir app/src/main/res -o build/res.zip
"$BT/aapt2" link -o build/unaligned.apk -I "$JAR" \
  --manifest app/src/main/AndroidManifest.xml -A app/src/main/assets \
  --java build/gen --min-sdk-version 24 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip

echo "› Compiling Java"
javac -nowarn --release 11 -classpath "$JAR" -d build/classes \
  $(find app/src/main/java build/gen -name '*.java')

echo "› Dexing"
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../unaligned.apk classes.dex)

echo "› Aligning & signing"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Brain Gym" >/dev/null 2>&1
fi
"$BT/zipalign" -f -p 4 build/unaligned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias "$ALIAS" \
  --out dist/BrainGym.apk build/aligned.apk
"$BT/apksigner" verify dist/BrainGym.apk
echo "✓ dist/BrainGym.apk ($(du -h dist/BrainGym.apk | cut -f1))"
