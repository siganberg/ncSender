# 🧩 ncSender Plugin Architecture Plan

## Overview

Enable external developers (and yourself) to extend `ncSender` without recompiling the core app, through a **plugin system** that supports:
- Installation / configuration / removal from a **Plugins tab** in Settings
- Optional UI injection (Tools menu, panels, dialogs)
- Event-based hooks for **G-code streaming and job lifecycle**

---

## 🧱 Architecture Overview

**Core components:**
1. **Plugin Manager (core service)**
   Handles registration, loading, lifecycle, and communication with plugins.
2. **Plugin Registry (manifest store)**
   JSON database (e.g. `plugins.json` in user data) tracking installed plugins.
3. **Plugin Host (runtime sandbox)**
   Loads plugin code dynamically via ES Modules or Node `vm` contexts.
4. **Plugin Event Bus**
   Allows plugins to subscribe to app events like:
   - `onBeforeJobStart(gcode)`
   - `onAfterJobEnd()`
   - `onBeforeGcodeLine(line, index)`
   - `onAfterGcodeLine(line, index, response)`
   - `onAppReady()`
   - `onShutdown()`
5. **UI Integration Layer**
   Injects plugin-defined panels, menu items, or toolbar buttons into the main UI.

---

## ⚙️ Plugin Installation Flow

### 1. Installation
- From the **Plugins tab**, user can:
  - **Install from local file (.zip)**
  - **Install from GitHub URL / npm registry**
  - **Uninstall / Disable / Enable**
- On install, system extracts to:
  ```
  ~/.ncSender/plugins/<plugin-id>/
  ├── manifest.json
  ├── index.js
  ├── ui/
  └── assets/
  ```

### 2. Manifest Structure
Each plugin includes a simple manifest file:
```json
{
  "id": "com.example.autotoolchanger",
  "name": "Auto Tool Changer Helper",
  "version": "1.0.0",
  "author": "FrancisCreation",
  "entry": "index.js",
  "events": ["onBeforeJobStart", "onAfterGcodeLine"],
  "ui": {
    "toolsMenu": true,
    "window": "ui/config.html"
  },
  "permissions": ["gcode.modify", "filesystem.read"]
}
```

---

## 🧠 Plugin Lifecycle API

Each plugin exports a standard interface:

```js
export function onLoad(ctx) {
  // ctx provides hooks and utilities
}

export function onUnload() {}

export function onBeforeJobStart(gcode, context) {
  // Optional: return modified gcode
  return gcode;
}

export function onAfterGcodeLine(line, response, context) {
  // Optional: inspect results
}
```

`ctx` exposes safe utilities:
```js
ctx.log(message)
ctx.showDialog(title, htmlContent)
ctx.registerToolMenu(name, callback)
ctx.sendGcode(gcode)
ctx.getSettings(pluginId)
ctx.setSettings(pluginId, settings)
```

---

## 🧩 Event System Design

Use a **publish–subscribe** system (`EventEmitter`) inside the core.

Example:
```js
pluginManager.emit('beforeJobStart', gcode)
pluginManager.emit('afterGcodeLine', line, result)
```

Each plugin can register like:
```js
pluginManager.subscribe('beforeJobStart', pluginId, handlerFn)
```

---

## 🧰 Job Processor Hook Integration

Refactor your existing job streamer so it supports middleware chaining:
```js
for (const plugin of pluginsWith('onBeforeGcodeLine')) {
   line = await plugin.onBeforeGcodeLine(line, context)
}
sendToController(line)
```

This middleware approach ensures:
- Isolation between plugins
- Ordered execution (respect plugin priority)
- Graceful fallback if plugin fails

---

## 🖥️ UI Integration Design

1. **Tools Panel**
   - Plugins can add menu items under “Tools” via manifest flag.
   - Core dynamically loads those into the menu with plugin icons.

2. **Dockable Windows**
   - Each plugin can define an HTML UI loaded in an isolated webview (Electron BrowserView).
   - Communicate via IPC (e.g. `ipcRenderer.invoke('plugin:call', { id, method, args })`).

3. **Settings Panel**
   - Add a new **Plugins Tab** in Settings.
   - Each plugin can expose a config UI component (HTML/React/Vue).
   - Settings stored in per-plugin JSON file:
     ```
     ~/.ncSender/plugins/<plugin-id>/config.json
     ```

---

## 🧰 Developer Experience

Provide a **Plugin SDK**:
```js
import { definePlugin } from 'ncsender-sdk'

export default definePlugin({
  id: 'example.plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  hooks: {
    onBeforeJobStart(ctx) { /* ... */ },
    onAfterGcodeLine(ctx) { /* ... */ }
  },
  ui: {
    toolsMenu: { label: 'Example Action', onClick: () => {/*...*/} }
  }
})
```

SDK exposes utilities for:
- Event registration
- Safe g-code sending
- IPC bridge access
- Settings management

---

## 🔒 Security and Safety Practices

- **Sandbox** plugin code using Node `vm` or isolated Electron `contextIsolation`
- **Permission system** — manifest must declare access (filesystem, serial, gcode, UI)
- **Error boundary** — plugin exceptions must never crash core app
- **Version pinning** — only compatible with `ncSender` version in manifest range
- **Auto-update** optional, with hash verification

---

## 🧭 Example Folder Layout

```
/src
 ├── main/
 │   ├── plugin-manager.js
 │   ├── plugin-runtime.js
 │   └── job-processor.js
 ├── renderer/
 │   ├── windows/Settings/PluginsTab.vue
 │   ├── components/PluginList.vue
 │   └── components/PluginConfigView.vue
 └── shared/
     ├── events.js
     └── sdk/
```

---

## 🚀 Next Steps

1. [ ] Refactor job streamer to support middleware/event hooks
2. [ ] Implement core `PluginManager` class
3. [ ] Implement `Plugins` tab UI in Settings
4. [ ] Add `Tools` menu dynamic injection
5. [ ] Build developer SDK template (`ncsender-sdk`)
6. [ ] Add sandbox + permission handling
7. [ ] Release first example plugin (e.g., “Job Timer” or “G-code Stats Viewer”)
