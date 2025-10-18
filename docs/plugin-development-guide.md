# ncSender Plugin Development Guide

Complete guide for developing plugins for ncSender CNC controller software.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Plugin Structure](#plugin-structure)
- [Plugin Context API](#plugin-context-api)
- [Event System](#event-system)
- [WebSocket Events](#websocket-events)
- [Settings Management](#settings-management)
- [UI Integration](#ui-integration)
- [Tool Menu](#tool-menu)
- [REST API](#rest-api)
- [Examples](#examples)
- [Best Practices](#best-practices)

---

## Getting Started

### What is a Plugin?

An ncSender plugin is a JavaScript module that can:
- Hook into G-code job lifecycle events
- Modify G-code before it's sent to the controller
- Add custom tools to the Tools menu
- Provide configuration UIs
- Send commands to the CNC controller
- Listen to real-time controller events

### Plugin Installation Location

Plugins are installed in platform-specific directories:

- **macOS**: `~/Library/Application Support/ncSender/plugins/`
- **Linux**: `~/.config/ncSender/plugins/`
- **Windows**: `%APPDATA%\ncSender\plugins\`

### Minimum Plugin Structure

```
~/.ncSender/plugins/com.example.myplugin/
├── manifest.json    # Plugin metadata (required)
└── index.js         # Plugin code (required)
```

---

## Plugin Structure

### manifest.json

Every plugin requires a `manifest.json` file:

```json
{
  "id": "com.example.myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "author": "Your Name",
  "description": "What this plugin does",
  "icon": "icon.svg",
  "events": [
    "onBeforeJobStart",
    "onBeforeGcodeLine",
    "onAfterGcodeLine",
    "onAfterJobEnd"
  ],
  "permissions": ["gcode.modify"]
}
```

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (reverse domain notation recommended) |
| `name` | string | Display name shown in UI |
| `version` | string | Semantic version (e.g., "1.0.0") |
| `entry` | string | Entry point JavaScript file (typically "index.js") |

#### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | string | Plugin author name |
| `description` | string | Brief description of plugin functionality |
| `icon` | string | Path to icon file (SVG, PNG, JPG) |
| `events` | array | List of events this plugin handles |
| `permissions` | array | Required permissions (e.g., "gcode.modify") |

### index.js

The entry point file must export two functions:

```javascript
/**
 * Called when plugin loads
 * @param {Object} ctx - Plugin context object
 */
export function onLoad(ctx) {
  ctx.log('Plugin loaded');

  // Register event handlers, tool menu items, etc.
}

/**
 * Called when plugin unloads
 */
export function onUnload() {
  console.log('Plugin unloaded');

  // Clean up resources
}
```

---

## Plugin Context API

The `ctx` object passed to `onLoad()` provides access to all plugin functionality.

### Properties

```javascript
ctx.pluginId        // string: Your plugin's unique ID
ctx.manifest        // object: Your plugin's manifest.json data
```

### Logging

```javascript
ctx.log(...args)
// Logs with [PLUGIN:pluginId] prefix
// Example: ctx.log('Hello', { foo: 'bar' });
// Output: [timestamp] [PLUGIN:com.example.plugin] Hello { foo: 'bar' }
```

### Sending G-code Commands

```javascript
await ctx.sendGcode(gcode, options)
```

Sends G-code commands to the CNC controller.

**Parameters:**
- `gcode` (string): The G-code command(s) to send
- `options` (object, optional):
  - `commandId` (string): Unique identifier for this command
  - `displayCommand` (string): Human-readable name for UI
  - `meta` (object): Additional metadata
    - `sourceId` (string): Track command source
    - `autoInjected` (boolean): Mark as auto-injected
    - `jobControl` (boolean): Mark as job control command
    - And more...

**Returns:** Promise that resolves with controller response

**Example:**
```javascript
await ctx.sendGcode('G28', {
  displayCommand: 'Home All Axes',
  meta: {
    sourceId: 'my-plugin',
    autoInjected: true
  }
});
```

### Broadcasting Events

```javascript
ctx.broadcast(eventName, data)
```

Broadcasts custom events to all connected WebSocket clients.

**Example:**
```javascript
ctx.broadcast('plugin:status-update', {
  status: 'processing',
  progress: 50
});
```

---

## Event System

Plugins can register handlers for job lifecycle events.

### Registering Event Handlers

```javascript
ctx.registerEventHandler(eventName, handler)
```

### Available Events

#### onBeforeJobStart

Called before a G-code job starts. Can modify the entire G-code content.

```javascript
ctx.registerEventHandler('onBeforeJobStart', async (gcode, context) => {
  ctx.log('Job starting:', context.filename);

  // Optionally modify G-code
  const modifiedGcode = '(Modified by plugin)\n' + gcode;

  return modifiedGcode; // Return modified or original
});
```

**Context object:**
```javascript
{
  filename: "file.gcode",           // Basename of file
  filePath: "/path/to/file.gcode",  // Full path
  sourceId: "gcode-runner"          // Source identifier
}
```

#### onBeforeGcodeLine

Called before each G-code line is sent to the controller. Can modify individual lines.

```javascript
ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
  // Modify line or inject commands
  if (line.includes('M6')) {
    await ctx.sendGcode('M7', { displayCommand: 'Enable coolant' });
  }

  return line; // Return modified or original line
});
```

**Context object:**
```javascript
{
  lineNumber: 42,        // 1-indexed line number
  filename: "file.gcode",
  sourceId: "gcode-runner"
}
```

#### onAfterGcodeLine

Called after each line completes. Cannot modify line, but can react to responses.

```javascript
ctx.registerEventHandler('onAfterGcodeLine', async (line, response, context) => {
  ctx.log(`Line ${context.lineNumber} completed:`, response);
});
```

**Parameters:**
- `line` (string): The G-code line that was sent
- `response` (object): Controller response
- `context` (object): Same as onBeforeGcodeLine

#### onAfterJobEnd

Called when job ends (for any reason).

```javascript
ctx.registerEventHandler('onAfterJobEnd', async (context) => {
  ctx.log(`Job ended: ${context.reason}`);

  if (context.reason === 'error') {
    ctx.log('Error:', context.error);
  }
});
```

**Context object:**
```javascript
{
  filename: "file.gcode",
  totalLines: 1234,       // Total lines processed
  sourceId: "gcode-runner",
  reason: "completed",    // 'completed', 'stopped', or 'error'
  error: Error           // Only present if reason === 'error'
}
```

### Event Processing

- **onBeforeJobStart** and **onBeforeGcodeLine**: Events are chained - each plugin's handler receives the output of the previous plugin
- **onAfterGcodeLine** and **onAfterJobEnd**: All handlers run in parallel
- Errors in handlers are caught and logged but don't break other plugins

---

## WebSocket Events

Plugins can listen to real-time events from the CNC controller.

### Registering WebSocket Event Handlers

```javascript
ctx.onWebSocketEvent(eventName, handler)
```

### Available WebSocket Events

| Event | Description | Data |
|-------|-------------|------|
| `ws:cnc-data` | Raw data from CNC controller | String data from controller |
| `ws:cnc-system-message` | System messages, alarms, errors | Message object |
| `ws:cnc-response` | Responses to commands | Response data object |

**Example:**
```javascript
ctx.onWebSocketEvent('ws:cnc-data', (data) => {
  ctx.log('Received from controller:', data);
});

ctx.onWebSocketEvent('ws:cnc-system-message', (message) => {
  if (message.type === 'alarm') {
    ctx.log('ALARM:', message.code);
  }
});
```

### Custom Events to Clients

```javascript
ctx.emitToClient(eventName, data)
```

Emits custom events to all clients. Event name becomes: `plugin:{pluginId}:{eventName}`

**Example:**
```javascript
ctx.emitToClient('progress-update', { percent: 75 });
// Clients receive event: 'plugin:com.example.myplugin:progress-update'
```

---

## Settings Management

Plugins can store and retrieve persistent settings.

### Get Plugin Settings

```javascript
const settings = ctx.getSettings()
```

Returns plugin settings from `config.json`. Returns empty object `{}` if not yet set.

### Save Plugin Settings

```javascript
ctx.setSettings(settings)
```

Saves settings to plugin's `config.json` file. Settings are **merged** with existing settings.

**Example:**
```javascript
export function onLoad(ctx) {
  // Get saved settings with defaults
  const settings = ctx.getSettings();
  const enableFeature = settings.enableFeature ?? true;
  const threshold = settings.threshold ?? 100;

  // Save new settings
  ctx.setSettings({
    enableFeature: false,
    threshold: 200
  });
}
```

**Settings location:** `~/.ncSender/plugins/{pluginId}/config.json`

### Get App Settings

```javascript
const appSettings = ctx.getAppSettings()
```

Returns global ncSender application settings.

**Common settings:**
```javascript
{
  unitsPreference: 'metric',  // or 'imperial'
  numberOfTools: 6,
  pauseBeforeStop: 1000,      // milliseconds
  lastAlarmCode: 9            // if alarm occurred
  // ... other ncSender configuration
}
```

**Example:**
```javascript
const appSettings = ctx.getAppSettings();
const isMetric = appSettings.unitsPreference === 'metric';
const unit = isMetric ? 'mm' : 'in';

ctx.log(`Using ${unit} units`);
```

---

## UI Integration

### Dialogs

Display custom HTML dialogs to users.

```javascript
ctx.showDialog(title, htmlContent, options)
```

**Parameters:**
- `title` (string): Dialog title
- `htmlContent` (string): HTML content (can include CSS and JavaScript)
- `options` (object, optional): Currently unused

**Example:**
```javascript
ctx.showDialog('Hello', `
  <style>
    .my-content { padding: 20px; }
    button { padding: 10px 20px; }
  </style>
  <div class="my-content">
    <h2>Welcome!</h2>
    <p>This is a custom dialog.</p>
    <button onclick="alert('Clicked!')">Click Me</button>
  </div>
`);
```

### Dialog with Form

```javascript
ctx.showDialog('Settings', `
  <style>
    .form-group { margin: 15px 0; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input, textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }
  </style>

  <div class="form-group">
    <label>Setting Name:</label>
    <input type="text" id="settingName" value="Default">
  </div>

  <div class="form-group">
    <label>Description:</label>
    <textarea id="description" rows="4"></textarea>
  </div>

  <button onclick="saveSettings()">Save</button>

  <script>
    async function saveSettings() {
      const settings = {
        name: document.getElementById('settingName').value,
        description: document.getElementById('description').value
      };

      await fetch('/api/plugins/com.example.myplugin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      alert('Settings saved!');
      window.postMessage({type: 'close-plugin-dialog'}, '*');
    }
  </script>
`);
```

### Available CSS Variables for Theming

Use these CSS custom properties in your dialog HTML for consistent theming:

```css
--color-bg               /* Background color */
--color-surface          /* Surface/card background */
--color-surface-muted    /* Muted surface color */
--color-text-primary     /* Primary text color */
--color-text-secondary   /* Secondary text color */
--color-border           /* Border color */
--color-accent           /* Accent/highlight color */
--gap-xs                 /* 8px spacing */
--gap-sm                 /* 16px spacing */
--gap-md                 /* 24px spacing */
--gap-lg                 /* 32px spacing */
--radius-small           /* Small border radius */
--radius-medium          /* Medium border radius */
```

### Closing Dialogs

```javascript
// From within dialog JavaScript:
window.postMessage({type: 'close-plugin-dialog'}, '*');
```

### Configuration UI

Register a persistent configuration UI shown in Settings > Plugins.

```javascript
ctx.registerConfigUI(htmlContent)
```

**Example:**
```javascript
export function onLoad(ctx) {
  ctx.registerConfigUI(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: system-ui;
          padding: 20px;
          background: var(--color-bg);
          color: var(--color-text-primary);
        }
        .form-group { margin: 15px 0; }
        input {
          padding: 8px;
          width: 100%;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          color: var(--color-text-primary);
        }
        button {
          padding: 10px 20px;
          background: var(--color-accent);
          color: white;
          border: none;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <h2>Plugin Configuration</h2>

      <div class="form-group">
        <label>API Key:</label>
        <input type="text" id="apiKey">
      </div>

      <button onclick="saveConfig()">Save Configuration</button>

      <script>
        // Load current settings
        async function loadSettings() {
          const response = await fetch('/api/plugins/com.example.myplugin/settings');
          const settings = await response.json();
          document.getElementById('apiKey').value = settings.apiKey || '';
        }

        async function saveConfig() {
          const settings = {
            apiKey: document.getElementById('apiKey').value
          };

          await fetch('/api/plugins/com.example.myplugin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
          });

          alert('Configuration saved!');
        }

        loadSettings();
      </script>
    </body>
    </html>
  `);
}
```

---

## Tool Menu

Add custom actions to the Tools tab.

### Registering Tool Menu Items

```javascript
ctx.registerToolMenu(label, callback, options)
```

**Parameters:**
- `label` (string): Menu item label shown in UI
- `callback` (async function): Called when menu item is clicked
- `options` (object, optional):
  - `clientOnly` (boolean): If true, action only affects the client that clicked
  - `icon` (string): Custom SVG icon (as string)

**Example:**
```javascript
export function onLoad(ctx) {
  // Simple tool
  ctx.registerToolMenu('Home Machine', async () => {
    await ctx.sendGcode('G28', {
      displayCommand: 'Home All Axes'
    });
    ctx.showDialog('Success', '<p>Machine homed!</p>');
  });

  // Tool with custom icon
  const customIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

  ctx.registerToolMenu('Custom Action', async () => {
    // Your code here
  }, {
    clientOnly: true,
    icon: customIcon
  });
}
```

### Client-Only vs Broadcast Tools

**Broadcast (default):**
```javascript
ctx.registerToolMenu('Broadcast Tool', async () => {
  // Dialog shown to ALL connected clients
  ctx.showDialog('For Everyone', '<p>All clients see this</p>');
});
```

**Client-Only:**
```javascript
ctx.registerToolMenu('Personal Tool', async () => {
  // Dialog only shown to the client who clicked
  ctx.showDialog('Just for You', '<p>Only you see this</p>');
}, { clientOnly: true });
```

Use `clientOnly: true` for tools that:
- Generate G-code based on user input (surfacing, drilling patterns)
- Show client-specific information
- Require user interaction before proceeding

---

## REST API

Plugins can be managed via REST API endpoints.

### Plugin Management

```bash
# List all installed plugins
GET /api/plugins

# Get loaded plugins
GET /api/plugins/loaded

# Enable plugin
POST /api/plugins/:pluginId/enable

# Disable plugin
POST /api/plugins/:pluginId/disable

# Reload plugin
POST /api/plugins/:pluginId/reload

# Uninstall plugin
DELETE /api/plugins/:pluginId
```

### Settings API

```bash
# Get plugin settings
GET /api/plugins/:pluginId/settings

# Update plugin settings
PUT /api/plugins/:pluginId/settings
Content-Type: application/json
Body: { "key": "value" }
```

### UI APIs

```bash
# Get plugin config UI HTML
GET /api/plugins/:pluginId/config-ui

# Check if plugin has config UI
GET /api/plugins/:pluginId/has-config

# Get plugin icon
GET /api/plugins/:pluginId/icon
```

### Tool Menu API

```bash
# Get all tool menu items
GET /api/plugins/tool-menu-items

# Execute tool menu item
POST /api/plugins/tool-menu-items/execute
Content-Type: application/json
Body: {
  "pluginId": "com.example.plugin",
  "label": "Menu Item Label"
}
```

### Installation API

```bash
# Install plugin from ZIP file
POST /api/plugins/install
Content-Type: multipart/form-data
Body: plugin=<zip-file>

# Register existing plugin directory
POST /api/plugins/:pluginId/register
```

---

## Examples

### Example 1: Simple Job Logger

Log job start/end times and line counts.

```javascript
let jobStartTime = null;
let lineCount = 0;

export function onLoad(ctx) {
  ctx.registerEventHandler('onBeforeJobStart', async (gcode, context) => {
    jobStartTime = Date.now();
    lineCount = 0;
    ctx.log('Job started:', context.filename);
    return gcode;
  });

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    lineCount++;
    return line;
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    const duration = ((Date.now() - jobStartTime) / 1000).toFixed(2);
    ctx.log(`Job completed in ${duration}s, ${lineCount} lines`);
  });
}

export function onUnload() {
  console.log('Job logger unloaded');
}
```

### Example 2: Auto Tool Change Commands

Automatically inject commands before/after tool changes.

```javascript
export function onLoad(ctx) {
  // Register config UI for user to set commands
  ctx.registerConfigUI(`
    <html>
    <body>
      <h3>Auto Tool Change Configuration</h3>
      <label>Before Tool Change (M6):</label>
      <textarea id="beforeM6" rows="4"></textarea>
      <br>
      <label>After Tool Change:</label>
      <textarea id="afterM6" rows="4"></textarea>
      <br>
      <button onclick="save()">Save</button>

      <script>
        fetch('/api/plugins/com.example.autotoolchange/settings')
          .then(r => r.json())
          .then(s => {
            document.getElementById('beforeM6').value = s.beforeM6 || '';
            document.getElementById('afterM6').value = s.afterM6 || '';
          });

        function save() {
          fetch('/api/plugins/com.example.autotoolchange/settings', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              beforeM6: document.getElementById('beforeM6').value,
              afterM6: document.getElementById('afterM6').value
            })
          });
        }
      </script>
    </body>
    </html>
  `);

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    if (line.trim().toUpperCase().includes('M6')) {
      const settings = ctx.getSettings();

      // Inject commands before M6
      const beforeCommands = (settings.beforeM6 || '').split('\n');
      for (const cmd of beforeCommands) {
        if (cmd.trim()) {
          await ctx.sendGcode(cmd, {
            displayCommand: `${cmd} (Before tool change)`,
            meta: { autoInjected: true }
          });
        }
      }
    }

    return line;
  });
}

export function onUnload() {
  console.log('Auto tool change unloaded');
}
```

### Example 3: Surfacing Tool Generator

Add a tool menu item that generates surfacing G-code.

```javascript
export function onLoad(ctx) {
  ctx.registerToolMenu('Surfacing', async () => {
    const settings = ctx.getSettings() || {};

    ctx.showDialog('Surfacing Operation', `
      <style>
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
        label { font-weight: bold; }
        input { padding: 5px; }
      </style>

      <div class="form-row">
        <div>
          <label>Width (mm):</label>
          <input type="number" id="width" value="${settings.width || 100}">
        </div>
        <div>
          <label>Height (mm):</label>
          <input type="number" id="height" value="${settings.height || 100}">
        </div>
      </div>

      <div class="form-row">
        <div>
          <label>Depth (mm):</label>
          <input type="number" id="depth" value="${settings.depth || 0.5}" step="0.1">
        </div>
        <div>
          <label>Stepover (%):</label>
          <input type="number" id="stepover" value="${settings.stepover || 50}">
        </div>
      </div>

      <button onclick="generate()">Generate G-code</button>

      <script>
        function generate() {
          const width = parseFloat(document.getElementById('width').value);
          const height = parseFloat(document.getElementById('height').value);
          const depth = parseFloat(document.getElementById('depth').value);
          const stepover = parseFloat(document.getElementById('stepover').value);

          // Save settings
          fetch('/api/plugins/com.example.surfacing/settings', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ width, height, depth, stepover })
          });

          // Generate G-code
          let gcode = '; Surfacing operation\\n';
          gcode += 'G90 G21 ; Absolute mode, metric\\n';
          gcode += 'G0 Z5 ; Safe height\\n';
          gcode += 'M3 S12000 ; Start spindle\\n';
          gcode += 'G4 P3 ; Wait 3 seconds\\n';

          const toolDiameter = 25.4; // Example: 1" tool
          const stepDistance = toolDiameter * (stepover / 100);
          const passes = Math.ceil(height / stepDistance);

          for (let i = 0; i < passes; i++) {
            const y = i * stepDistance;
            gcode += \`G0 Y\${y.toFixed(3)}\\n\`;
            gcode += \`G1 Z-\${depth.toFixed(3)} F500\\n\`;
            gcode += \`G1 X\${width.toFixed(3)} F2000\\n\`;
            gcode += 'G0 Z5\\n';
          }

          gcode += 'M5 ; Stop spindle\\n';
          gcode += 'G0 Z10\\n';
          gcode += 'G0 X0 Y0\\n';

          // Upload G-code
          const blob = new Blob([gcode], { type: 'text/plain' });
          const formData = new FormData();
          formData.append('file', blob, 'surfacing.gcode');

          fetch('/api/gcode-files/upload', {
            method: 'POST',
            body: formData
          }).then(() => {
            alert('Surfacing G-code generated!');
            window.postMessage({type: 'close-plugin-dialog'}, '*');
          });
        }
      </script>
    `);
  }, {
    clientOnly: true,
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="4" width="12" height="8" fill="none" stroke="currentColor"/><line x1="2" y1="6" x2="14" y2="6" stroke="currentColor"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor"/><line x1="2" y1="10" x2="14" y2="10" stroke="currentColor"/></svg>'
  });
}

export function onUnload() {
  console.log('Surfacing tool unloaded');
}
```

### Example 4: Progress Monitor

Monitor job progress via WebSocket events.

```javascript
export function onLoad(ctx) {
  let totalLines = 0;
  let currentLine = 0;

  ctx.registerEventHandler('onBeforeJobStart', async (gcode, context) => {
    totalLines = gcode.split('\n').length;
    currentLine = 0;
    ctx.emitToClient('progress', { percent: 0, line: 0, total: totalLines });
    return gcode;
  });

  ctx.registerEventHandler('onAfterGcodeLine', async (line, response, context) => {
    currentLine = context.lineNumber;
    const percent = Math.round((currentLine / totalLines) * 100);

    if (currentLine % 10 === 0) { // Update every 10 lines
      ctx.emitToClient('progress', {
        percent,
        line: currentLine,
        total: totalLines
      });
    }
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    ctx.emitToClient('progress', {
      percent: 100,
      line: totalLines,
      total: totalLines,
      completed: true
    });
  });

  // Listen to controller alarms
  ctx.onWebSocketEvent('ws:cnc-system-message', (message) => {
    if (message.type === 'alarm') {
      ctx.log('ALARM DETECTED:', message.code);
      ctx.emitToClient('alarm', { code: message.code });
    }
  });
}

export function onUnload() {
  console.log('Progress monitor unloaded');
}
```

---

## Best Practices

### 1. Use ctx.log() for Logging

Always use `ctx.log()` instead of `console.log()` for plugin output. This ensures logs are properly prefixed.

```javascript
// Good
ctx.log('Processing line:', lineNumber);

// Avoid
console.log('Processing line:', lineNumber);
```

### 2. Handle Errors Gracefully

Wrap async operations in try-catch blocks.

```javascript
ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
  try {
    if (needsSpecialHandling(line)) {
      await ctx.sendGcode('G4 P0.5'); // Dwell
    }
  } catch (error) {
    ctx.log('Error handling line:', error.message);
  }
  return line;
});
```

### 3. Validate User Input

Always validate and sanitize user input from dialogs.

```javascript
const width = parseFloat(document.getElementById('width').value);
if (isNaN(width) || width <= 0) {
  alert('Width must be a positive number');
  return;
}
```

### 4. Use Settings for Persistence

Store user preferences in plugin settings, not in memory.

```javascript
// Save user preferences
ctx.setSettings({
  lastWidth: 100,
  lastHeight: 100,
  preferredFeedRate: 2000
});

// Load with defaults
const settings = ctx.getSettings();
const width = settings.lastWidth || 100;
```

### 5. Clean Up in onUnload

Release resources and clear state when plugin unloads.

```javascript
let interval = null;

export function onLoad(ctx) {
  interval = setInterval(() => {
    ctx.log('Periodic task');
  }, 5000);
}

export function onUnload() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
```

### 6. Respect Units Preference

Always check user's units preference and convert accordingly.

```javascript
const appSettings = ctx.getAppSettings();
const isMetric = appSettings.unitsPreference === 'metric';

function convertToDisplay(mm) {
  return isMetric ? mm : mm * 0.0393701; // mm to inches
}

function convertToMetric(value) {
  return isMetric ? value : value / 0.0393701; // inches to mm
}
```

### 7. Use Semantic Versioning

Follow semantic versioning (MAJOR.MINOR.PATCH) in manifest.json.

```json
{
  "version": "1.2.3"
}
```

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

### 8. Provide Configuration UI

For plugins with settings, always provide a config UI for easy setup.

```javascript
ctx.registerConfigUI(htmlContent);
```

### 9. Test with Different Workflows

Test your plugin with:
- Different G-code files (small and large)
- Different units (metric and imperial)
- Error conditions (controller disconnected, invalid commands)
- Multiple simultaneous clients

### 10. Document Your Plugin

Include a README.md in your plugin directory explaining:
- What the plugin does
- Configuration options
- Example use cases
- Known limitations

---

## Troubleshooting

### Plugin Not Loading

1. Check manifest.json syntax (must be valid JSON)
2. Verify all required fields are present (`id`, `name`, `version`, `entry`)
3. Check plugin directory name matches manifest `id`
4. Look for errors in ncSender logs

### Settings Not Persisting

1. Ensure you're calling `ctx.setSettings()`, not reassigning `ctx.getSettings()`
2. Check file permissions in plugin directory
3. Verify JSON serialization of settings (no circular references)

### Dialog Not Closing

Use the message API to close dialogs:

```javascript
window.postMessage({type: 'close-plugin-dialog'}, '*');
```

### G-code Not Being Modified

1. Ensure you're returning the modified G-code/line from event handlers
2. Check that plugin is enabled and loaded
3. Verify event is registered correctly

### WebSocket Events Not Firing

1. Ensure controller is connected
2. Check event name is correct (`ws:cnc-data`, not `cnc-data`)
3. Verify handler is registered in `onLoad()`

---

## Additional Resources

### Plugin Examples

Look at these built-in plugins for reference:
- **com.ncsender.autodustboot** - Auto dustboot control during tool changes
- **com.ncsender.surfacing** - Surfacing and jointer G-code generators

### File Locations

- **Plugin directory**: `~/.ncSender/plugins/` (or platform equivalent)
- **Plugin settings**: `~/.ncSender/plugins/{pluginId}/config.json`
- **ncSender logs**: Check console output for `[PLUGIN:...]` messages

### API Endpoints

All plugin APIs are under `/api/plugins`:
- List: `GET /api/plugins`
- Settings: `GET/PUT /api/plugins/:pluginId/settings`
- Tools: `GET /api/plugins/tool-menu-items`

---

## Getting Help

If you need help developing plugins:

1. Check this documentation
2. Review example plugins in the source code
3. Open an issue on GitHub
4. Join the community discussion

---

**Happy Plugin Development!**
