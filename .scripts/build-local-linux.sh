#!/bin/bash
set -e

# Local Linux x64 build script — simulates CI beta-build.yml (linux-x64 job)
# Usage: .scripts/build-local-linux.sh [version]
# Example: .scripts/build-local-linux.sh 2.0.1-beta.local

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="${1:-2.0.1-beta.local}"
VERSION="${VERSION#v}"  # Strip leading 'v' if present
BUILD_DIR="$PROJECT_ROOT/build/linux"
echo "=== Building ncSender Linux DEB (x64) — v${VERSION} ==="
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
echo "--- Step 2/5: Publishing server (AOT, linux-x64) ---"
dotnet publish src/NcSender.Server -c Release -r linux-x64 --self-contained \
  /p:PublishAot=true /p:Version="$VERSION" -o "$BUILD_DIR/server/"

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

# 5. Package DEB
echo ""
echo "--- Step 5/5: Packaging DEB ---"
rm -rf dist-electron
npx electron-builder --linux deb --x64 --publish never \
  -c.extraMetadata.version="$VERSION"

cd "$PROJECT_ROOT"

# Copy DEB to build/linux
DEB=$(find src/NcSender.Desktop/dist-electron -name "*.deb" | head -1)
if [ -n "$DEB" ]; then
  cp "$DEB" "$BUILD_DIR/"
  FINAL="$BUILD_DIR/$(basename "$DEB")"
  echo ""
  echo "=== Build complete ==="
  echo "Size: $(du -h "$FINAL" | cut -f1)"
  echo ""
  echo "  $FINAL"
  echo ""
else
  echo "ERROR: DEB not found"
  exit 1
fi
