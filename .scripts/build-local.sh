#!/bin/bash

# Local build script for all platforms and architectures
# Builds as close to CI as possible
#
# Prerequisites:
# - Node.js 20+
# - npm dependencies installed (npm ci in app/ and app/client/)
#
# Note: Cross-platform builds have limitations due to native modules (serialport):
# - On macOS: Can build for macOS (x64, arm64) ONLY - Linux/Windows will fail
# - On Linux: Can build for Linux (x64) ONLY
# - On Windows: Can build for Windows (x64) ONLY
# Use GitHub Actions (CI) for true cross-platform builds

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RELEASES_DIR="releases"
APP_DIR="app"

echo -e "${BLUE}🔨 ncSender Local Build Script${NC}"
echo ""

# Parse arguments
BUILD_ALL=false
BUILD_MACOS_X64=false
BUILD_MACOS_ARM64=false
BUILD_LINUX_X64=false
BUILD_WINDOWS_X64=false

if [ $# -eq 0 ]; then
  BUILD_ALL=true
else
  for arg in "$@"; do
    case $arg in
      --all)
        BUILD_ALL=true
        ;;
      --macos-x64)
        BUILD_MACOS_X64=true
        ;;
      --macos-arm64)
        BUILD_MACOS_ARM64=true
        ;;
      --linux-x64)
        BUILD_LINUX_X64=true
        ;;
      --windows-x64)
        BUILD_WINDOWS_X64=true
        ;;
      *)
        echo -e "${RED}Unknown option: $arg${NC}"
        echo "Usage: $0 [--all|--macos-x64|--macos-arm64|--linux-x64|--windows-x64]"
        exit 1
        ;;
    esac
  done
fi

# If --all is specified, enable builds based on current platform
if [ "$BUILD_ALL" = true ]; then
  OS_TYPE=$(uname -s)
  case "$OS_TYPE" in
    Darwin)
      echo -e "${YELLOW}⚠️  macOS detected: Building for macOS only (native module limitations)${NC}"
      BUILD_MACOS_X64=true
      BUILD_MACOS_ARM64=true
      ;;
    Linux)
      echo -e "${YELLOW}⚠️  Linux detected: Building for Linux only (native module limitations)${NC}"
      BUILD_LINUX_X64=true
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo -e "${YELLOW}⚠️  Windows detected: Building for Windows only (native module limitations)${NC}"
      BUILD_WINDOWS_X64=true
      ;;
    *)
      echo -e "${RED}❌ Unknown OS: $OS_TYPE${NC}"
      exit 1
      ;;
  esac
fi

# Create releases directory
echo -e "${BLUE}📁 Creating releases directory...${NC}"
mkdir -p "$RELEASES_DIR"

# Change to app directory
cd "$APP_DIR"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm ci
cd client && npm ci && cd ..

# Build client
echo -e "${BLUE}🎨 Building client...${NC}"
npm run build:client

# Build function
build_platform() {
  local platform=$1
  local arch=$2
  local output_name=$3

  echo ""
  echo -e "${BLUE}🏗️  Building $output_name...${NC}"

  # Clean previous build
  rm -rf dist-electron

  # Build
  if npm run dist -- --$platform --$arch; then
    echo -e "${GREEN}✅ $output_name build complete${NC}"

    # Copy to releases folder
    echo -e "${BLUE}📦 Copying artifacts to releases/$output_name...${NC}"
    mkdir -p "../$RELEASES_DIR/$output_name"
    cp -r dist-electron/* "../$RELEASES_DIR/$output_name/"

    echo -e "${GREEN}✅ Artifacts copied to releases/$output_name${NC}"
  else
    echo -e "${RED}❌ $output_name build failed${NC}"
    return 1
  fi
}

# Execute builds based on flags
if [ "$BUILD_MACOS_X64" = true ]; then
  build_platform "mac" "x64" "macos-x64"
fi

if [ "$BUILD_MACOS_ARM64" = true ]; then
  build_platform "mac" "arm64" "macos-arm64"
fi

if [ "$BUILD_LINUX_X64" = true ]; then
  build_platform "linux" "x64" "linux-x64"
fi

if [ "$BUILD_WINDOWS_X64" = true ]; then
  build_platform "win" "x64" "windows-x64"
fi

# Go back to root
cd ..

# Summary
echo ""
echo -e "${GREEN}🎉 Build complete!${NC}"
echo ""
echo -e "${BLUE}📁 Artifacts located in:${NC}"
ls -lh "$RELEASES_DIR"
echo ""
echo -e "${YELLOW}Note: Artifacts are organized by platform in releases/[platform-arch]/${NC}"
