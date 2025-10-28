#!/bin/bash

# Sync development plugins from repo to application data directory
# This script copies plugins from the plugins/ directory to the user's ncSender data folder

# Determine the platform-specific plugins directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLUGINS_DIR="$HOME/Library/Application Support/ncSender/plugins"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLUGINS_DIR="$HOME/.config/ncSender/plugins"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    PLUGINS_DIR="$APPDATA/ncSender/plugins"
else
    echo "Unsupported platform: $OSTYPE"
    exit 1
fi

# Get the script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Use DEV_PLUGINS_DIR env variable if set, otherwise fall back to default
SOURCE_PLUGINS_DIR="${DEV_PLUGINS_DIR:-$SCRIPT_DIR/plugins}"

# Default port
PORT="${NCSENDER_PORT:-8090}"

echo "Syncing plugins from: $SOURCE_PLUGINS_DIR"
echo "                  to: $PLUGINS_DIR"

# Create plugins directory if it doesn't exist
mkdir -p "$PLUGINS_DIR"

# Track synced plugins for hot-reload
SYNCED_PLUGINS=()

# Copy each plugin directory
if [ -d "$SOURCE_PLUGINS_DIR" ]; then
    for plugin_dir in "$SOURCE_PLUGINS_DIR"/*; do
        if [ -d "$plugin_dir" ]; then
            plugin_name=$(basename "$plugin_dir")

            # Skip README.md or non-plugin directories
            if [[ "$plugin_name" == "README.md" || "$plugin_name" == ".DS_Store" ]]; then
                continue
            fi

            echo "Syncing plugin: $plugin_name"

            # Create plugin directory if it doesn't exist
            mkdir -p "$PLUGINS_DIR/$plugin_name"

            # Sync plugin files but preserve existing config.json
            rsync -a --delete --exclude='config.json' "$plugin_dir/" "$PLUGINS_DIR/$plugin_name/"

            echo "  ✓ $plugin_name synced (config.json preserved)"
            SYNCED_PLUGINS+=("$plugin_name")
        fi
    done
    echo ""
    echo "✓ All plugins synced successfully"
else
    echo "Error: plugins/ directory not found in project root"
    exit 1
fi

# Update plugins.json registry
REGISTRY_FILE="$HOME/Library/Application Support/ncSender/plugins.json"

if [ ! -f "$REGISTRY_FILE" ]; then
    echo "Creating plugins.json registry..."
    echo "[]" > "$REGISTRY_FILE"
fi

# Try to register and reload plugins via API
echo ""
echo "Attempting to register and reload plugins..."

for plugin_id in "${SYNCED_PLUGINS[@]}"; do
    # First, try to register the plugin (reads manifest from disk and enables it)
    register_response=$(curl -s -X POST "http://localhost:$PORT/api/plugins/$plugin_id/register" 2>/dev/null)

    # Then try to reload it if already loaded
    reload_response=$(curl -s -X POST "http://localhost:$PORT/api/plugins/$plugin_id/reload" 2>/dev/null)

    if [[ $? -eq 0 && "$reload_response" == *"success"* ]]; then
        echo "  ✓ $plugin_id reloaded"
    elif [[ "$register_response" == *"success"* ]]; then
        echo "  ✓ $plugin_id registered (restart ncSender to load)"
    else
        echo "  ⨯ $plugin_id could not be loaded (server may not be running)"
    fi
done

echo ""
echo "Note: If this is the first time loading plugins, restart ncSender to load them"
