#!/bin/bash

# Download latest release artifacts from GitHub Actions
#
# Prerequisites:
# - GitHub CLI (gh): brew install gh
# - Authenticated: gh auth login
# - At least one successful workflow run

set -e

echo "📦 Downloading latest release artifacts..."

# Create releases directory
mkdir -p releases

# Get the latest workflow run ID
RUN_ID=$(gh run list --workflow=release-build.yml --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
  echo "❌ No workflow runs found"
  exit 1
fi

echo "🔍 Found workflow run: $RUN_ID"

# Download artifacts
gh run download "$RUN_ID" -D releases/

echo "✅ Artifacts downloaded to releases/"
echo ""
echo "📁 Contents:"
ls -lh releases/
