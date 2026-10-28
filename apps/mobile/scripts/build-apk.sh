#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Configure ANDROID_HOME with an Android SDK installation}"
: "${BARZINHO_ANDROID_KEYSTORE:?Provide the private release keystore path}"
: "${BARZINHO_ANDROID_STORE_PASSWORD:?Provide the keystore password}"
: "${BARZINHO_ANDROID_KEY_ALIAS:?Provide the signing alias}"
: "${BARZINHO_ANDROID_KEY_PASSWORD:?Provide the signing key password}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://barzinho-filmes.vercel.app}"
export NODE_ENV=production
export EXPO_NO_TELEMETRY=1
node -e 'const u=new URL(process.env.EXPO_PUBLIC_API_URL);if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw Error("Use a public HTTPS API origin without credentials or a path")'
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease --no-daemon --max-workers=2 "-PreactNativeArchitectures=${BARZINHO_ANDROID_ARCHITECTURES:-arm64-v8a,armeabi-v7a,x86_64}"
mkdir -p ../dist
cp app/build/outputs/apk/release/app-release.apk ../dist/barzinho-android.apk
echo 'APK generated: apps/mobile/dist/barzinho-android.apk'
