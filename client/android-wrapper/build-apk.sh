#!/usr/bin/env bash
# Builds the AuraOS Android app (a Capacitor wrapper around your hosted web app,
# plus the native WiFi/LAN printer plugin) and produces an installable APK.
#
# Usage (from the client/ folder):
#   APP_URL=https://your-app.up.railway.app ./android-wrapper/build-apk.sh
#
# Needs: Node 18+, Java 17, and the Android SDK (ANDROID_HOME). The GitHub
# Action in .github/workflows/android-apk.yml sets all of that up for you.
set -euo pipefail

: "${APP_URL:?Set APP_URL to your hosted app, e.g. https://your-app.up.railway.app}"
APP_ID="com.auraos.pos"
APP_NAME="${APP_NAME:-AuraOS}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../android-build"          # generated project (git-ignored)

rm -rf "$OUT"
mkdir -p "$OUT/www"
cd "$OUT"

cat > package.json <<JSON
{ "name": "auraos-android", "version": "1.0.0", "private": true,
  "dependencies": { "@capacitor/core": "^6.1.0", "@capacitor/android": "^6.1.0" },
  "devDependencies": { "@capacitor/cli": "^6.1.0" } }
JSON

# Tiny fallback page, only shown if the server can't be reached at launch.
cat > www/index.html <<HTML
<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:sans-serif;padding:2rem"><h2>$APP_NAME</h2>
<p>Can't reach the server. Check the internet connection, then reopen the app.</p></body>
HTML

HOST="$(echo "$APP_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
cat > capacitor.config.json <<JSON
{
  "appId": "$APP_ID",
  "appName": "$APP_NAME",
  "webDir": "www",
  "server": { "url": "$APP_URL", "cleartext": false, "allowNavigation": ["$HOST"] },
  "android": { "allowMixedContent": false }
}
JSON

npm install --no-audit --no-fund
npx cap add android

# Add the native printer plugin and register it.
JAVA_DIR="android/app/src/main/java/com/auraos/pos"
mkdir -p "$JAVA_DIR"
cp "$HERE/TcpPrinterPlugin.java" "$HERE/MainActivity.java" "$JAVA_DIR/"
# Remove any MainActivity the generator put elsewhere (it uses the same appId, so same folder).

npx cap sync android
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon

APK="app/build/outputs/apk/debug/app-debug.apk"
cp "$APK" "$HERE/../AuraOS.apk"
echo "Built: client/AuraOS.apk"
