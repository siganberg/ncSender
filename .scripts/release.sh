#!/bin/bash

set -e

# Get the latest STABLE tag (exclude beta tags)
LATEST_TAG=$(git tag --sort=-version:refname | grep -v '\-beta' | head -1)
if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v0.0.0"
fi
echo "Latest stable tag: $LATEST_TAG"

# Extract version number (remove 'v' prefix)
VERSION=${LATEST_TAG#v}

# Split version into major.minor.patch
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

# Increment patch version
PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"
NEW_TAG="v$NEW_VERSION"

echo "New version: $NEW_VERSION"
echo "New tag: $NEW_TAG"

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Working tree is not clean. Commit or stash changes first."
    exit 1
fi

# Check if there are new commits since last tag
echo ""
COMMIT_COUNT=$(git rev-list "$LATEST_TAG..HEAD" --count)
if [ "$COMMIT_COUNT" = "0" ]; then
    echo "⚠️  No new commits since $LATEST_TAG. Nothing to release."
    exit 1
fi

echo "$COMMIT_COUNT commit(s) since $LATEST_TAG"

# Get commit messages
COMMITS=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s")

echo ""
echo "Generating release notes using Claude..."
echo ""

# Create a prompt for Claude
PROMPT="Based on the following git commit messages from $LATEST_TAG to HEAD, generate user-focused release notes for version $NEW_VERSION.

Commit messages:
$COMMITS

CRITICAL: Output ONLY the exact markdown format shown below. Do NOT add ANY other text.

Required format:
## What's Changed

### [emoji] [Category Name]
- [change description]
- [change description]

Rules:
1. Start with exactly \"## What's Changed\"
2. Group by category with emojis (✨ New Features, 🐛 Bug Fixes, 🔧 Improvements)
3. Use user-focused language
4. Exclude internal/chore commits unless they impact users
5. No markdown code blocks, URLs, links, or non-English characters

Output ONLY the markdown. No preamble. No explanation. Just the markdown."

# Use Claude CLI to generate release notes
RELEASE_NOTES=$(claude -p "$PROMPT" 2>&1)
CLAUDE_EXIT_CODE=$?

if [ $CLAUDE_EXIT_CODE -ne 0 ] || [ -z "$RELEASE_NOTES" ]; then
    echo "❌ Failed to generate release notes with Claude"
    echo "Please make sure 'claude' CLI is installed and configured"
    echo ""
    echo "Falling back to basic release notes..."

    # Fallback: basic categorization
    RELEASE_NOTES="## What's Changed"$'\n'

    FEATURES=$(echo "$COMMITS" | grep -i "^feat\|^feature\|^add" || true)
    FIXES=$(echo "$COMMITS" | grep -i "^fix\|^bug" || true)
    OTHER=$(echo "$COMMITS" | grep -iv "^feat\|^feature\|^add\|^fix\|^bug\|^chore" || true)

    if [ -n "$FEATURES" ]; then
        RELEASE_NOTES+=$'\n'"### ✨ New Features"$'\n'
        while IFS= read -r line; do
            CLEAN_LINE=$(echo "$line" | sed -E 's/^(feat|feature|add|Add|Feature|Feat)://i' | sed 's/^[[:space:]]*//')
            RELEASE_NOTES+="- $CLEAN_LINE"$'\n'
        done <<< "$FEATURES"
    fi

    if [ -n "$FIXES" ]; then
        RELEASE_NOTES+=$'\n'"### 🐛 Bug Fixes"$'\n'
        while IFS= read -r line; do
            CLEAN_LINE=$(echo "$line" | sed -E 's/^(fix|bug|Fix|Bug)://i' | sed 's/^[[:space:]]*//')
            RELEASE_NOTES+="- $CLEAN_LINE"$'\n'
        done <<< "$FIXES"
    fi

    if [ -n "$OTHER" ]; then
        RELEASE_NOTES+=$'\n'"### 📦 Other Changes"$'\n'
        while IFS= read -r line; do
            RELEASE_NOTES+="- $line"$'\n'
        done <<< "$OTHER"
    fi
else
    echo "✅ Release notes generated successfully"
fi

# Display release notes
echo ""
echo "========================================="
echo "Release Notes for $NEW_TAG:"
echo "========================================="
echo "$RELEASE_NOTES"
echo "========================================="
echo ""

# Create annotated tag on current HEAD with release notes
# No commit needed - CI injects version from tag name during build
git tag -a "$NEW_TAG" -m "$RELEASE_NOTES"
git push origin "$NEW_TAG"

echo ""
echo "✅ Successfully created and pushed $NEW_TAG"
echo "CI pipeline will build the release at: https://github.com/siganberg/ncSender/actions"
