#!/bin/bash

# Auto-commit script for Claude Code hook
# This script runs after file edits to automatically commit meaningful changes

# Navigate to project root
cd /Users/francis/projects/ncSender

# Check if there are any changes to commit
if ! git diff --quiet || ! git diff --cached --quiet; then
    # Get current status for context
    CHANGES=$(git status --porcelain)

    # Count changed files
    CHANGED_FILES=$(echo "$CHANGES" | wc -l | xargs)

    # Generate meaningful commit message based on changes
    COMMIT_MSG=""

    # Check for specific file patterns and generate appropriate messages
    if echo "$CHANGES" | grep -q "\.vue$"; then
        if echo "$CHANGES" | grep -q "TopToolbar\.vue"; then
            COMMIT_MSG="Update TopToolbar component layout and styling"
        elif echo "$CHANGES" | grep -q "App\.vue"; then
            COMMIT_MSG="Update main App component"
        else
            COMMIT_MSG="Update Vue components"
        fi
    elif echo "$CHANGES" | grep -q "\.js$"; then
        if echo "$CHANGES" | grep -q "api\.js"; then
            COMMIT_MSG="Update API client configuration"
        elif echo "$CHANGES" | grep -q "routes.*\.js"; then
            COMMIT_MSG="Update server routes"
        else
            COMMIT_MSG="Update JavaScript modules"
        fi
    elif echo "$CHANGES" | grep -q "package\.json"; then
        COMMIT_MSG="Update package dependencies and configuration"
    elif echo "$CHANGES" | grep -q "README\.md"; then
        COMMIT_MSG="Update project documentation"
    elif echo "$CHANGES" | grep -q "\.md$"; then
        COMMIT_MSG="Update documentation"
    else
        # Generic message based on number of files
        if [ "$CHANGED_FILES" -eq 1 ]; then
            FILENAME=$(echo "$CHANGES" | head -1 | awk '{print $2}' | xargs basename)
            COMMIT_MSG="Update $FILENAME"
        else
            COMMIT_MSG="Update $CHANGED_FILES files"
        fi
    fi

    # Add all changes
    git add .

    # Commit with generated message
    git commit -m "$COMMIT_MSG

🤖 Auto-committed by Claude Code hook"

    echo "Auto-committed: $COMMIT_MSG"
else
    echo "No changes to commit"
fi