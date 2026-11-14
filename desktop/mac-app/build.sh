#!/bin/bash
# Builds "Chocolate Studio.app" (Apple Silicon) from this repository's web editor.
# Needs, on macOS: Node.js (npx) and the Xcode command line tools (codesign, iconutil, sips).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
APP_NAME="Chocolate Studio"
VERSION="$(node -p "require('./package.json').version")"
DIST="dist"
OUT="$DIST/$APP_NAME-darwin-arm64/$APP_NAME.app"
PNPM="npx -y pnpm@$(node -p "require('$ROOT/package.json').packageManager.split('@')[1]")"

echo "Web editor: install and build ($PNPM)"
(cd "$ROOT" && $PNPM install --frozen-lockfile && $PNPM --filter @chocolate-studio/web build)
rm -rf web && cp -R "$ROOT/apps/web/dist" web

[[ -d node_modules ]] || npm install --no-audit --no-fund

# icon: assets/icon-1024.png -> assets/icon.icns
if [[ ! -f assets/icon.icns || assets/icon-1024.png -nt assets/icon.icns ]]; then
  ICONSET="$(mktemp -d)/icon.iconset"; mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z $size $size assets/icon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) assets/icon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o assets/icon.icns
fi

npx @electron/packager . "$APP_NAME" \
  --platform=darwin --arch=arm64 --out="$DIST" --overwrite \
  --icon=assets/icon.icns \
  --app-bundle-id=local.chocolatestudio.app \
  --app-version="$VERSION" \
  --ignore='^/dist' --ignore='^/assets' --ignore='^/build\.sh$'

# ad-hoc signature so macOS accepts the bundle
codesign --force --deep --sign - "$OUT"
echo "Built: $(pwd)/$OUT"
