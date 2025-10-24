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

# Generate release notes from commits
echo ""
echo "Generating release notes from $LATEST_TAG to HEAD..."
echo ""

# Get commit messages and categorize them
RELEASE_NOTES_FILE=$(mktemp)

echo "## What's Changed" > "$RELEASE_NOTES_FILE"
echo "" >> "$RELEASE_NOTES_FILE"

# Check if there are new commits since last tag
if git rev-list "$LATEST_TAG..HEAD" --count | grep -q "^0$"; then
    echo "⚠️  No new commits since $LATEST_TAG"
    rm "$RELEASE_NOTES_FILE"
    git restore app/package.json
    exit 1
fi

# Categorize commits
FEATURES=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s" | grep -i "^feat\|^feature\|^add" || true)
FIXES=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s" | grep -i "^fix\|^bug" || true)
IMPROVEMENTS=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s" | grep -i "^enhance\|^improve\|^update\|^refactor" || true)
CHORES=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s" | grep -i "^chore" || true)
OTHER=$(git log "$LATEST_TAG..HEAD" --pretty=format:"%s" | grep -iv "^feat\|^feature\|^add\|^fix\|^bug\|^enhance\|^improve\|^update\|^refactor\|^chore" || true)

# Add features
if [ -n "$FEATURES" ]; then
    echo "### ✨ New Features" >> "$RELEASE_NOTES_FILE"
    echo "$FEATURES" | while read -r line; do
        # Remove prefix and clean up
        CLEAN_LINE=$(echo "$line" | sed -E 's/^(feat|feature|add|Add|Feature|Feat)://i' | sed 's/^[[:space:]]*//')
        echo "- $CLEAN_LINE" >> "$RELEASE_NOTES_FILE"
    done
    echo "" >> "$RELEASE_NOTES_FILE"
fi

# Add fixes
if [ -n "$FIXES" ]; then
    echo "### 🐛 Bug Fixes" >> "$RELEASE_NOTES_FILE"
    echo "$FIXES" | while read -r line; do
        CLEAN_LINE=$(echo "$line" | sed -E 's/^(fix|bug|Fix|Bug)://i' | sed 's/^[[:space:]]*//')
        echo "- $CLEAN_LINE" >> "$RELEASE_NOTES_FILE"
    done
    echo "" >> "$RELEASE_NOTES_FILE"
fi

# Add improvements
if [ -n "$IMPROVEMENTS" ]; then
    echo "### 🔧 Improvements" >> "$RELEASE_NOTES_FILE"
    echo "$IMPROVEMENTS" | while read -r line; do
        CLEAN_LINE=$(echo "$line" | sed -E 's/^(enhance|improve|update|refactor|Enhance|Improve|Update|Refactor)://i' | sed 's/^[[:space:]]*//')
        echo "- $CLEAN_LINE" >> "$RELEASE_NOTES_FILE"
    done
    echo "" >> "$RELEASE_NOTES_FILE"
fi

# Add other changes (excluding chores)
if [ -n "$OTHER" ]; then
    echo "### 📦 Other Changes" >> "$RELEASE_NOTES_FILE"
    echo "$OTHER" | while read -r line; do
        echo "- $line" >> "$RELEASE_NOTES_FILE"
    done
    echo "" >> "$RELEASE_NOTES_FILE"
fi

# Display release notes
cat "$RELEASE_NOTES_FILE"

# Ask for confirmation
echo ""
read -p "Do you want to commit, tag, and push with these release notes? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Commit the version change
    git add app/package.json
    git commit -m "chore: bump version to $NEW_VERSION"

    # Push the commit
    git push origin main

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
