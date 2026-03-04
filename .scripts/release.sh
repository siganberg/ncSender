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
PROMPT="Generate release notes for version $NEW_VERSION from ONLY the following commit messages. Do NOT invent, assume, or add any changes not explicitly listed below.

Commit messages:
$COMMITS

CRITICAL: Output ONLY the exact markdown format shown below. Do NOT add ANY other text.

Required format:
## What's Changed

### [emoji] [Category Name]
- [change description]

Rules:
1. Start with exactly \"## What's Changed\"
2. Group by category with emojis (e.g. :rocket: New Features, :bug: Bug Fixes, :wrench: Improvements)
3. Write from the USER's perspective - describe what they can now do or what was fixed for them, not internal code details
4. SKIP commits that are purely internal (test updates, refactors, CI fixes, code cleanup) - users do not care about these
5. If multiple commits relate to the same user-facing change, combine them into a single bullet point
6. Do NOT fabricate changes that are not in the commit list
7. No markdown code blocks, URLs, links, or non-English characters
8. If after filtering out internal commits there are no user-facing changes, output: \"## What's Changed\n\n- Internal improvements and maintenance\"

Output ONLY the markdown. No preamble. No explanation. Just the markdown."

# Use Claude CLI to generate release notes
RELEASE_NOTES=$(claude -p --system-prompt "You are a release note generator for a CNC controller app. Write notes for end users, not developers. Only use the commit messages provided. Never invent changes. Skip internal-only changes like test fixes, refactors, and CI updates." "$PROMPT" 2>&1)
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
git tag -a "$NEW_TAG" --cleanup=verbatim -m "$RELEASE_NOTES"
git push origin "$NEW_TAG"

echo ""
echo "✅ Successfully created and pushed $NEW_TAG"
echo "CI pipeline will build the release at: https://github.com/siganberg/ncSender/actions"
