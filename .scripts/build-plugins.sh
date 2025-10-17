#!/bin/bash

# Build plugin ZIP files for distribution
# This script creates ZIP archives of plugins from the plugins/ directory

# Get the script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_PLUGINS_DIR="$SCRIPT_DIR/plugins"
BUILD_DIR="$SCRIPT_DIR/dist/plugins"

echo "Building plugin ZIP files..."
echo "Source: $SOURCE_PLUGINS_DIR"
echo "Output: $BUILD_DIR"
echo ""

# Create build directory
mkdir -p "$BUILD_DIR"

# Track built plugins
BUILT_PLUGINS=()

# Build each plugin directory
if [ -d "$SOURCE_PLUGINS_DIR" ]; then
    for plugin_dir in "$SOURCE_PLUGINS_DIR"/*; do
        if [ -d "$plugin_dir" ]; then
            plugin_name=$(basename "$plugin_dir")

            # Skip README.md or non-plugin directories
            if [[ "$plugin_name" == "README.md" || "$plugin_name" == ".DS_Store" ]]; then
                continue
            fi

            # Check if manifest.json exists
            if [ ! -f "$plugin_dir/manifest.json" ]; then
                echo "⨯ Skipping $plugin_name (no manifest.json found)"
                continue
            fi

            echo "Building: $plugin_name"

            # Create ZIP file
            cd "$SOURCE_PLUGINS_DIR"
            zip_file="$BUILD_DIR/${plugin_name}.zip"

            # Remove old zip if it exists
            rm -f "$zip_file"

            # Create new zip (exclude .DS_Store and other hidden files)
            zip -r "$zip_file" "$plugin_name" -x "*.DS_Store" -x "*/__pycache__/*" -x "*/node_modules/*" > /dev/null

            if [ $? -eq 0 ]; then
                # Get file size
                size=$(ls -lh "$zip_file" | awk '{print $5}')
                echo "  ✓ $plugin_name.zip ($size)"
                BUILT_PLUGINS+=("$plugin_name")
            else
                echo "  ⨯ Failed to build $plugin_name.zip"
            fi
        fi
    done
    echo ""
    echo "✓ Built ${#BUILT_PLUGINS[@]} plugin(s)"
    echo ""
    echo "Plugin ZIP files are in: $BUILD_DIR"

    # List all built plugins
    if [ ${#BUILT_PLUGINS[@]} -gt 0 ]; then
        echo ""
        echo "Built plugins:"
        for plugin in "${BUILT_PLUGINS[@]}"; do
            echo "  - $plugin.zip"
        done
    fi
else
    echo "Error: plugins/ directory not found in project root"
    exit 1
fi
