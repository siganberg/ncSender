#!/bin/bash

# Manual commit script to be run when Claude completes a user request
# Usage: ./commit-response.sh "Brief description of changes"

# Change to the project directory
cd "$(dirname "$0")/.."

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Not in a git repository"
    exit 1
fi

# Check if there are any changes to commit
if git diff --quiet && git diff --cached --quiet; then
    echo "No changes to commit"
    exit 0
fi

# Use provided description or generate one
if [[ -n "$1" ]]; then
    commit_msg="$1"
else
    # Generate commit message based on changed files
    modified_files=$(git diff --name-only --cached 2>/dev/null || git diff --name-only 2>/dev/null | head -5)
    num_files=$(echo "$modified_files" | wc -l | xargs)

    if [[ $num_files -eq 1 ]]; then
        file_name=$(basename "$modified_files")
        commit_msg="Update $file_name"
    elif [[ $num_files -le 3 ]]; then
        commit_msg="Update $(echo "$modified_files" | tr '\n' ', ' | sed 's/,$//')"
    else
        commit_msg="Update $num_files files"
    fi
fi

# Stage all changes
git add -A

# Commit with the message
echo "Committing: $commit_msg"
git commit -m "$commit_msg"

if [[ $? -eq 0 ]]; then
    echo "✅ Committed successfully"
else
    echo "❌ Commit failed"
    exit 1
fi