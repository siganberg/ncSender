#!/bin/bash
set -e

# Local macOS ARM64 build script — simulates CI beta-build.yml (macos job)
# Usage: .scripts/build-local-mac.sh [version]
# Example: .scripts/build-local-mac.sh 2.0.1-beta.local

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="${1:-2.0.1-beta.local}"
VERSION="${VERSION#v}"  # Strip leading 'v' if present
BUILD_DIR="$PROJECT_ROOT/build/macos"
echo "=== Building ncSender macOS DMG (arm64) — v${VERSION} ==="
echo "Output: $BUILD_DIR"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 1. Build client
echo ""
echo "--- Step 1/5: Building client ---"
cd src/NcSender.Client
npm ci --silent
npm run build
cd "$PROJECT_ROOT"

# 2. AOT publish server
echo ""
echo "--- Step 2/5: Publishing server (AOT, osx-arm64) ---"
SYSROOT="$(xcrun --show-sdk-path)"
dotnet publish src/NcSender.Server -c Release -r osx-arm64 --self-contained \
  /p:PublishAot=true "/p:SysRoot=${SYSROOT}" /p:Version="$VERSION" -o "$BUILD_DIR/server/"

# 3. Stage resources for Electron
echo ""
echo "--- Step 3/5: Staging resources ---"
mkdir -p src/NcSender.Desktop/resources/server
mkdir -p src/NcSender.Desktop/resources/client/dist
cp -r "$BUILD_DIR/server/"* src/NcSender.Desktop/resources/server/
rm -f src/NcSender.Desktop/resources/server/*.pdb
cp -r src/NcSender.Client/dist/* src/NcSender.Desktop/resources/client/dist/

# 4. Install Electron dependencies
echo ""
echo "--- Step 4/5: Installing Electron dependencies ---"
cd src/NcSender.Desktop
npm ci --silent

# 5. Package DMG
echo ""
echo "--- Step 5/5: Packaging DMG ---"
rm -rf dist-electron
npx electron-builder --mac dmg --arm64 --publish never \
  -c.extraMetadata.version="$VERSION"

cd "$PROJECT_ROOT"

# Copy DMG to build/macos
DMG=$(find src/NcSender.Desktop/dist-electron -name "*.dmg" | head -1)
if [ -n "$DMG" ]; then
  cp "$DMG" "$BUILD_DIR/"
  FINAL="$BUILD_DIR/$(basename "$DMG")"
  echo ""
  echo "=== Build complete ==="
  echo "Size: $(du -h "$FINAL" | cut -f1)"
  echo ""
  echo "  $FINAL"
  echo ""
else
  echo "ERROR: DMG not found"
  exit 1
fi
