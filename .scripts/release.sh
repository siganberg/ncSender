#!/bin/bash

set -e

# Get the latest tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo "Latest tag: $LATEST_TAG"

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

# Update package.json version
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" app/package.json

# Show the change
echo ""
echo "Updated app/package.json:"
grep "\"version\":" app/package.json

# Check if there are new commits since last tag
echo ""
if git rev-list "$LATEST_TAG..HEAD" --count | grep -q "^0$"; then
    echo "⚠️  No new commits since $LATEST_TAG"
    git restore app/package.json
    exit 1
fi

# Get commit messages
COMMITS=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s")

echo "Generating release notes using Claude..."
echo ""

# Create a prompt for Claude
PROMPT="Based on the following git commit messages from $LATEST_TAG to HEAD, generate user-focused release notes for version $NEW_VERSION.

Commit messages:
$COMMITS

Please create release notes that:
1. Are focused on users, not developers
2. Group changes into categories with emojis (✨ New Features, 🐛 Bug Fixes, 🔧 Improvements, etc.)
3. Use clear, non-technical language where possible
4. Start with \"## What's Changed\"
5. Format as markdown with bullet points
6. Exclude internal/chore commits unless they directly impact users

Output only the release notes markdown, nothing else."

# Use Claude CLI to generate release notes
RELEASE_NOTES=$(claude -p "$PROMPT" 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$RELEASE_NOTES" ]; then
    echo "❌ Failed to generate release notes with Claude"
    echo "Please make sure 'claude' CLI is installed and configured"
    echo ""
    echo "Falling back to basic release notes..."

    # Fallback: basic categorization
    RELEASE_NOTES_FILE=$(mktemp)
    echo "## What's Changed" > "$RELEASE_NOTES_FILE"
    echo "" >> "$RELEASE_NOTES_FILE"

    # Simple categorization
    FEATURES=$(echo "$COMMITS" | grep -i "^feat\|^feature\|^add" || true)
    FIXES=$(echo "$COMMITS" | grep -i "^fix\|^bug" || true)
    OTHER=$(echo "$COMMITS" | grep -iv "^feat\|^feature\|^add\|^fix\|^bug\|^chore" || true)

    if [ -n "$FEATURES" ]; then
        echo "### ✨ New Features" >> "$RELEASE_NOTES_FILE"
        echo "$FEATURES" | while read -r line; do
            CLEAN_LINE=$(echo "$line" | sed -E 's/^(feat|feature|add|Add|Feature|Feat)://i' | sed 's/^[[:space:]]*//')
            echo "- $CLEAN_LINE" >> "$RELEASE_NOTES_FILE"
        done
        echo "" >> "$RELEASE_NOTES_FILE"
    fi

    if [ -n "$FIXES" ]; then
        echo "### 🐛 Bug Fixes" >> "$RELEASE_NOTES_FILE"
        echo "$FIXES" | while read -r line; do
            CLEAN_LINE=$(echo "$line" | sed -E 's/^(fix|bug|Fix|Bug)://i' | sed 's/^[[:space:]]*//')
            echo "- $CLEAN_LINE" >> "$RELEASE_NOTES_FILE"
        done
        echo "" >> "$RELEASE_NOTES_FILE"
    fi

    if [ -n "$OTHER" ]; then
        echo "### 📦 Other Changes" >> "$RELEASE_NOTES_FILE"
        echo "$OTHER" | while read -r line; do
            echo "- $line" >> "$RELEASE_NOTES_FILE"
        done
        echo "" >> "$RELEASE_NOTES_FILE"
    fi

    RELEASE_NOTES=$(cat "$RELEASE_NOTES_FILE")
    rm "$RELEASE_NOTES_FILE"
else
    echo "✅ Release notes generated successfully"
fi

# Save to temp file for git tag
RELEASE_NOTES_FILE=$(mktemp)
echo "$RELEASE_NOTES" > "$RELEASE_NOTES_FILE"

# Display release notes
echo ""
echo "========================================="
echo "Release Notes for $NEW_TAG:"
echo "========================================="
cat "$RELEASE_NOTES_FILE"
echo "========================================="

# Ask for confirmation
echo ""
read -p "Do you want to commit, tag, and push with these release notes? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Commit the version change
    git add app/package.json
    git commit -m "chore: bump version to $NEW_VERSION"

    # Push the commit
    git push origin $(git branch --show-current)

    # Create and push the tag with release notes
    git tag -a "$NEW_TAG" -F "$RELEASE_NOTES_FILE"
    git push origin "$NEW_TAG"

    echo ""
    echo "✅ Successfully created and pushed $NEW_TAG"
    echo "CI pipeline will build the release at: https://github.com/siganberg/ncSender/actions"

    # Clean up
    rm "$RELEASE_NOTES_FILE"
else
    # Revert the package.json change
    git restore app/package.json
    rm "$RELEASE_NOTES_FILE"
    echo "Cancelled. Changes reverted."
fi
