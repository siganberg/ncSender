# ncSender Plugin Development Guide

## Overview

ncSender supports a plugin system that allows developers to extend functionality without modifying the core application. Plugins can hook into the G-code job lifecycle, modify G-code on the fly, and interact with the CNC controller.

## Plugin Structure

A plugin consists of:
- **manifest.json** - Metadata and configuration
- **index.js** - Main entry point with event handlers
- **config.json** - User-configurable settings (optional)

### Directory Layout

```
~/.ncSender/plugins/
└── com.example.myplugin/
    ├── manifest.json
    ├── index.js
    └── config.json (optional)
```

Platform-specific paths:
- **macOS**: `~/Library/Application Support/ncSender/plugins/`
- **Windows**: `%APPDATA%\ncSender\plugins\`
- **Linux**: `~/.config/ncSender/plugins/`

## Manifest File

The `manifest.json` file defines plugin metadata:

```json
{
  "id": "com.example.myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "0.3.0",
  "author": "Your Name",
  "description": "Plugin description",
  "entry": "index.js",
  "events": [
    "onBeforeJobStart",
    "onBeforeGcodeLine",
    "onAfterGcodeLine",
    "onAfterJobEnd"
  ],
  "permissions": ["gcode.modify"]
}
```

### Required Fields

- **id**: Unique identifier (reverse domain notation recommended)
- **name**: Human-readable plugin name
- **version**: Semantic version (e.g., "1.0.0")
- **entry**: JavaScript file to load (typically "index.js")

### Optional Fields

- **minAppVersion**: Minimum ncSender version required (e.g., "0.3.0"). Installation will be blocked if the app version is lower than this requirement
- **author**: Plugin author name
- **description**: Brief description of plugin functionality
- **events**: Array of event names this plugin listens to
- **permissions**: Array of permissions required

## Plugin API

### Entry Point

Your `index.js` must export these functions:

```javascript
export function onLoad(ctx) {
  // Called when plugin is loaded
  // Register event handlers here
}

export function onUnload() {
  // Called when plugin is unloaded
  // Cleanup resources here
}
```

### Plugin Context (ctx)

The context object provides access to ncSender APIs:

```javascript
ctx.pluginId          // Your plugin ID
ctx.manifest          // Your plugin manifest

// Logging
ctx.log(...args)      // Log messages with plugin prefix

// Event system
ctx.registerEventHandler(eventName, handler)

// CNC control
await ctx.sendGcode(gcode, options)

// Broadcasting
ctx.broadcast(eventName, data)

// Settings
ctx.getSettings()     // Get plugin settings
ctx.setSettings(obj)  // Save plugin settings

// UI Integration (Phase 3)
ctx.showDialog(title, content, options)  // Show dialog to user
ctx.registerToolMenu(label, callback)    // Add Tools menu item
ctx.emitToClient(eventName, data)        // Emit custom events to clients

// WebSocket Events (Phase 3)
ctx.onWebSocketEvent(eventName, handler) // Subscribe to WebSocket events
```

## Plugin Categories

ncSender organizes plugins into categories based on their function:

### Exclusive Categories

Only one plugin of this category can be enabled at a time:

- **tool-changer** (priority 50-100): Manages automatic tool changes

### Non-Exclusive Categories

Multiple plugins of these categories can be enabled simultaneously:

- **post-processor** (priority 120-150): Transforms G-code files after loading, before execution
- **utility** (priority 0-50): General-purpose helper plugins
- **gcode-generator** (priority 0-50): Generates G-code programmatically
- **custom** (priority varies): User-defined category

### Post-Processor Plugins

Post-processor plugins transform loaded G-code files to adapt CAM software output for specific machines or requirements. They run at high priority (120-150) to process G-code before other plugins.

**Common Use Cases:**
- Converting CAM software output to machine-specific format
- Adjusting feed rates and spindle speeds for specific materials
- Transforming tool change commands (automatic to manual, or vice versa)
- Adding machine-specific initialization and shutdown sequences
- Removing or adding safety checks
- Stripping comments or debug information

**Key Characteristics:**
- Use `onBeforeJobStart` event for file-level transformation
- Execute before tool-changer and other lower-priority plugins
- Multiple post-processors can be chained (ordered by priority)
- Should be fast and efficient (process entire file in memory)

**Example Post-Processor:**

```javascript
export function onLoad(ctx) {
  ctx.log('Post-Processor loaded');

  ctx.registerEventHandler('onGcodeProgramLoad', async (content, context) => {
    const settings = ctx.getSettings();
    const lines = content.split('\n');
    const processedLines = [];

    ctx.log(`Processing file: ${context.filename}`);

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();

      // Skip empty lines
      if (line === '') continue;

      // Strip comments if configured
      if (settings.stripComments && line.startsWith('(')) {
        continue;
      }

      // Transform tool changes to manual
      if (settings.manualToolChange && line.match(/M6/i)) {
        const toolMatch = line.match(/T(\d+)/i);
        if (toolMatch) {
          line = `M0 (Insert Tool ${toolMatch[1]})`;
        }
      }

      // Adjust feed rates
      if (settings.feedMultiplier && line.match(/F[\d.]+/)) {
        line = line.replace(/F([\d.]+)/i, (match, feed) => {
          const adjusted = parseFloat(feed) * settings.feedMultiplier;
          return `F${adjusted.toFixed(1)}`;
        });
      }

      // Adjust spindle speeds
      if (settings.spindleMultiplier && line.match(/S\d+/i)) {
        line = line.replace(/S(\d+)/i, (match, speed) => {
          const adjusted = Math.round(parseInt(speed, 10) * settings.spindleMultiplier);
          return `S${adjusted}`;
        });
      }

      processedLines.push(line);
    }

    ctx.log(`Processed ${lines.length} → ${processedLines.length} lines`);
    return processedLines.join('\n');
  });
}

export function onUnload() {
  console.log('Post-Processor unloaded');
}
```

**Post-Processor manifest.json:**

```json
{
  "id": "com.example.postprocessor",
  "name": "CAM Post-Processor",
  "version": "1.0.0",
  "category": "post-processor",
  "priority": 120,
  "author": "Your Name",
  "description": "Transforms CAM output for machine-specific format",
  "entry": "index.js",
  "events": ["onGcodeProgramLoad"]
}
```

## Available Events

### onGcodeProgramLoad

Called when a G-code file is loaded or uploaded into ncSender. This is the primary event for post-processor plugins that transform G-code files.

**When it fires:**
- When a file is uploaded via the UI (`POST /api/gcode-files`)
- When a file is loaded from the file list (`POST /api/gcode-files/:filename/load`)
- Before the file is cached and displayed in the visualizer

```javascript
ctx.registerEventHandler('onGcodeProgramLoad', async (gcode, context) => {
  ctx.log('G-code file loaded:', context.filename);
  ctx.log('Source:', context.sourceId); // 'upload' or 'load'

  // Transform the entire file
  const modifiedGcode = gcode
    .split('\n')
    .map(line => {
      // Strip comments
      if (line.trim().startsWith('(')) return '';
      // Adjust feed rates
      return line.replace(/F(\d+)/g, (match, feed) => {
        return `F${Math.round(parseInt(feed) * 1.2)}`;
      });
    })
    .filter(line => line !== '')
    .join('\n');

  return modifiedGcode;
});
```

**Context:**
- `filename`: Name of the G-code file (e.g., "example.gcode")
- `filePath`: Full path to the file on disk
- `sourceId`: Either `'upload'` (new file) or `'load'` (existing file)

**Use cases:**
- Converting CAM software output to machine-specific format
- Adjusting feed rates and spindle speeds
- Transforming tool change commands
- Adding/removing safety checks
- Stripping comments or debug information

### onBeforeJobStart

Called when a G-code job execution starts (when the user clicks "Start Job"). This is different from `onGcodeProgramLoad` which fires when files are loaded/uploaded.

**Status:** Currently reserved for future implementation. For file-level post-processing, use `onGcodeProgramLoad` instead.

**When it will fire (future):**
- When user clicks "Start Job" button (`POST /api/gcode-jobs`)
- After the file has been loaded and cached
- Before the first G-code line is sent to the controller

**Planned use case:** Dynamic adjustments based on machine state at job start time (e.g., adjusting based on current tool offset, workpiece coordinate system, etc.)

### onBeforeGcodeLine

Called before each G-code line is sent to the controller. Can modify individual lines.

```javascript
ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
  // Log every 10th line
  if (context.lineNumber % 10 === 0) {
    ctx.log(`Processing line ${context.lineNumber}: ${line}`);
  }

  // Modify line if needed
  return line;
});
```

**Context:**
- `lineNumber`: Current line number (1-indexed)
- `filename`: Name of the file
- `sourceId`: Source identifier

### onAfterGcodeLine

Called after each G-code line is sent and acknowledged by the controller.

```javascript
ctx.registerEventHandler('onAfterGcodeLine', async (line, response, context) => {
  ctx.log(`Line ${context.lineNumber} completed:`, line);
  // response contains the controller's response
});
```

### onAfterJobEnd

Called when a job completes, is stopped, or encounters an error.

```javascript
ctx.registerEventHandler('onAfterJobEnd', async (context) => {
  ctx.log(`Job ended: ${context.filename}`);
  ctx.log(`Reason: ${context.reason}`);  // 'completed', 'stopped', or 'error'
  ctx.log(`Total lines: ${context.totalLines}`);

  if (context.error) {
    ctx.log('Error:', context.error);
  }
});
```

## UI Integration (Phase 3)

### Show Dialogs

Display dialogs to the user:

```javascript
export function onLoad(ctx) {
  ctx.registerToolMenu('Show Info', async () => {
    ctx.showDialog('Plugin Info', `
      <h2>My Plugin</h2>
      <p>This is a custom plugin dialog.</p>
    `);
  });
}
```

### Tools Menu Integration

Add custom menu items to the Tools menu:

```javascript
export function onLoad(ctx) {
  ctx.registerToolMenu('Run Custom Action', async () => {
    ctx.log('Tool menu item clicked!');

    // Perform custom action
    await ctx.sendGcode('G28', { displayCommand: 'Home All Axes' });

    // Show confirmation
    ctx.showDialog('Success', 'Homing completed!');
  });
}
```

### WebSocket Event Subscriptions

Listen to real-time CNC controller events:

```javascript
export function onLoad(ctx) {
  // Subscribe to CNC data events
  ctx.onWebSocketEvent('cnc-data', (data) => {
    ctx.log('Received CNC data:', data);
  });

  // Subscribe to system messages
  ctx.onWebSocketEvent('cnc-system-message', (message) => {
    ctx.log('System message:', message);
  });

  // Subscribe to responses
  ctx.onWebSocketEvent('cnc-response', (response) => {
    ctx.log('CNC response:', response);
  });
}
```

Available WebSocket events:
- `cnc-data` - Raw data from CNC controller
- `cnc-system-message` - System messages (e.g., alarms, errors)
- `cnc-response` - Responses to commands

## Example Plugins

### Job Logger

Logs job execution statistics:

```javascript
let lineCount = 0;
let jobStartTime = null;

export function onLoad(ctx) {
  ctx.log('Job Logger plugin loaded');

  ctx.registerEventHandler('onBeforeJobStart', async (gcode, context) => {
    ctx.log('Job starting:', context.filename);
    jobStartTime = Date.now();
    lineCount = 0;
    return gcode;
  });

  ctx.registerEventHandler('onAfterGcodeLine', async (line, response, context) => {
    lineCount++;
    if (lineCount % 100 === 0) {
      ctx.log(`Processed ${lineCount} lines`);
    }
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    const duration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
    ctx.log(`Job completed in ${duration}s, ${lineCount} lines processed`);
  });
}

export function onUnload() {
  console.log('Job Logger unloaded');
}
```

### Feed Rate Adjuster

Adjusts feed rates in G-code:

```javascript
export function onLoad(ctx) {
  const settings = ctx.getSettings();
  const multiplier = settings.feedRateMultiplier || 1.0;

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    // Find feed rate commands (F followed by number)
    const match = line.match(/F(\d+\.?\d*)/);
    if (match) {
      const originalFeedRate = parseFloat(match[1]);
      const newFeedRate = Math.round(originalFeedRate * multiplier);
      const modifiedLine = line.replace(/F\d+\.?\d*/, `F${newFeedRate}`);
      return modifiedLine;
    }
    return line;
  });
}

export function onUnload() {}
```

## Plugin Settings

Store and retrieve plugin-specific settings:

```javascript
export function onLoad(ctx) {
  // Get settings with defaults
  const settings = ctx.getSettings();
  const interval = settings.logInterval || 100;

  // Update settings
  ctx.setSettings({
    logInterval: 50,
    lastRun: new Date().toISOString()
  });
}
```

Settings are stored in `config.json` within your plugin directory.

## API Endpoints

Manage plugins via REST API:

```bash
# List all installed plugins
GET /api/plugins

# Get loaded plugins
GET /api/plugins/loaded

# Enable a plugin
POST /api/plugins/:pluginId/enable

# Disable a plugin
POST /api/plugins/:pluginId/disable

# Reload a plugin (hot-reload)
POST /api/plugins/:pluginId/reload

# Uninstall a plugin
DELETE /api/plugins/:pluginId

# Get plugin settings
GET /api/plugins/:pluginId/settings

# Update plugin settings
PUT /api/plugins/:pluginId/settings

# Install plugin from ZIP file
POST /api/plugins/install
Content-Type: multipart/form-data
Body: plugin=<zip-file>

# Get tool menu items
GET /api/plugins/tool-menu-items

# Execute tool menu item
POST /api/plugins/tool-menu-items/execute
Body: { "pluginId": "com.example.plugin", "label": "Menu Item" }
```

## Best Practices

1. **Error Handling**: Always wrap plugin code in try-catch blocks
2. **Performance**: Keep line-level processing fast to avoid slowing jobs
3. **Logging**: Use `ctx.log()` instead of `console.log()` for proper prefixing
4. **State Management**: Store state in variables within your module scope
5. **Cleanup**: Implement `onUnload()` to clean up resources
6. **Testing**: Test with small G-code files first

## Plugin Development CLI (Phase 4)

ncSender includes a CLI tool for plugin development:

### Create a New Plugin

```bash
node .scripts/plugin-cli.js create my-plugin
```

This creates a new plugin from a template with:
- `manifest.json` - Plugin metadata
- `index.js` - Main entry point with example code
- `README.md` - Documentation template

### Build a Plugin

Package your plugin into a ZIP file:

```bash
node .scripts/plugin-cli.js build my-plugin
```

Creates `plugins/com.ncsender.my-plugin.zip`

### Install a Plugin

Install a built plugin to ncSender:

```bash
node .scripts/plugin-cli.js install my-plugin
```

Copies the plugin to the user data directory and registers it.

### List Installed Plugins

```bash
node .scripts/plugin-cli.js list
```

Shows all installed plugins with status and version information.

### Hot Reload During Development

After making changes to your plugin:

```bash
# Rebuild and reinstall
node .scripts/plugin-cli.js build my-plugin
node .scripts/plugin-cli.js install my-plugin

# Reload the plugin without restarting ncSender
curl -X POST http://localhost:8090/api/plugins/com.ncsender.my-plugin/reload
```

Alternatively, use the sync script for automatic reload:

```bash
.scripts/sync-plugins.sh
```

## Limitations

- Plugins run in the main Node.js process (no sandboxing yet)
- Custom panel support coming in future release
- Cannot access filesystem outside plugin directory
- Limited to event-based hooks

## Troubleshooting

Check plugin logs in the main ncSender console output. Look for messages prefixed with `[PLUGIN:your-plugin-id]`.

Common issues:
- **Plugin not loading**: Check manifest.json syntax and file paths
- **Events not firing**: Verify event names in manifest match registered handlers
- **Errors during job**: Check if plugin is modifying G-code incorrectly
- **Tool menu not showing**: Ensure `registerToolMenu` is called in `onLoad`
- **WebSocket events not firing**: Check event name matches available events

## Future Roadmap

- Custom panel/window support
- Plugin marketplace
- Enhanced sandboxing and security
- Plugin testing framework
- Plugin debugging tools
- Multi-language plugin support
