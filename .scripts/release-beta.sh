#!/bin/bash

set -e

# Get the latest stable tag (exclude beta tags)
LATEST_STABLE_TAG=$(git tag --sort=-version:refname | grep -v "beta" | head -1)
if [ -z "$LATEST_STABLE_TAG" ]; then
    LATEST_STABLE_TAG="v0.0.0"
fi
echo "Latest stable tag: $LATEST_STABLE_TAG"

# Get the latest beta tag for the next stable version
STABLE_VERSION=${LATEST_STABLE_TAG#v}
IFS='.' read -r MAJOR MINOR PATCH <<< "$STABLE_VERSION"
NEXT_PATCH=$((PATCH + 1))
NEXT_VERSION="$MAJOR.$MINOR.$NEXT_PATCH"

# Find existing beta tags for this version
LATEST_BETA_TAG=$(git tag --sort=-version:refname | grep "v${NEXT_VERSION}-beta" | head -1)

if [ -z "$LATEST_BETA_TAG" ]; then
    # First beta for this version
    BETA_NUMBER=1
else
    # Extract beta number and increment
    BETA_NUMBER=$(echo "$LATEST_BETA_TAG" | sed -E 's/.*-beta\.?([0-9]+)/\1/')
    BETA_NUMBER=$((BETA_NUMBER + 1))
fi

NEW_VERSION="${NEXT_VERSION}-beta.${BETA_NUMBER}"
NEW_TAG="v$NEW_VERSION"

echo "New beta version: $NEW_VERSION"
echo "New tag: $NEW_TAG"

# Update package.json version
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" app/package.json

# Show the change
echo ""
echo "Updated app/package.json:"
grep "\"version\":" app/package.json

# Get commit messages since last stable release
COMMITS=$(git log "$LATEST_STABLE_TAG..HEAD" --pretty=format:"%s")

echo ""
echo "Generating beta release notes using Claude..."
echo ""

# Create a prompt for Claude
PROMPT="Based on the following git commit messages from $LATEST_STABLE_TAG to HEAD, generate release notes for beta version $NEW_VERSION.

Commit messages:
$COMMITS

CRITICAL: Output ONLY the exact markdown format shown below. Do NOT add ANY other text.

Required format:
## What's New in This Beta

### [emoji] [Category Name]
- [change description]

Rules:
1. Start with exactly \"## What's New in This Beta\"
2. Group by category with emojis (✨ New Features, 🐛 Bug Fixes, 🔧 Improvements)
3. Use user-focused language
4. Exclude internal/chore commits unless they impact users
5. No markdown code blocks, URLs, links, or non-English characters
6. Keep it concise - this is a beta preview

Output ONLY the markdown. No preamble. No explanation. Just the markdown."

# Use Claude CLI to generate release notes
RELEASE_NOTES=$(claude -p "$PROMPT" 2>&1)
CLAUDE_EXIT_CODE=$?

if [ $CLAUDE_EXIT_CODE -ne 0 ] || [ -z "$RELEASE_NOTES" ]; then
    echo "❌ Failed to generate release notes with Claude"
    echo "Falling back to basic release notes..."

    RELEASE_NOTES="## What's New in This Beta

This is a beta release for testing new features and bug fixes.

**Warning:** Beta releases may contain bugs and are not recommended for production use."
else
    echo "✅ Release notes generated successfully"
fi

# Add beta warning header
FULL_NOTES="⚠️ **Beta Release** - This version is for testing purposes only.

$RELEASE_NOTES

---
*Please report any issues on [GitHub Issues](https://github.com/siganberg/ncSender/issues)*"

# Save to latest_release.md file
RELEASE_NOTES_FILE="latest_release.md"
printf '%s\n' "$FULL_NOTES" > "$RELEASE_NOTES_FILE"

# Display release notes
echo ""
echo "========================================="
echo "Beta Release Notes for $NEW_TAG:"
echo "========================================="
cat "$RELEASE_NOTES_FILE"
echo "========================================="

echo ""

# Commit the version change and release notes
git add app/package.json "$RELEASE_NOTES_FILE"
git commit -m "chore: create beta release $NEW_TAG"

# Push the commit
git push origin $(git branch --show-current)

# Create and push the tag
git tag -a "$NEW_TAG" -m "Beta Release $NEW_TAG"
git push origin "$NEW_TAG"

echo ""
echo "✅ Successfully created and pushed beta $NEW_TAG"
echo "CI pipeline will build the beta release at: https://github.com/siganberg/ncSender/actions"
