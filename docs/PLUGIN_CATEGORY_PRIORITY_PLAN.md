# Plugin Category and Priority System - Implementation Plan

## Overview
Add `category` (required) and `priority` (optional) attributes to the plugin system. Categories enable exclusivity rules and UI grouping. Priority controls execution order for event-based plugins only.

## Changes Required

### 1. Update Plugin Manifests (3 files)

#### RapidChangeATC (`plugins/com.ncsender.rapidchangeatc/manifest.json`)
- Add: `"category": "tool-changer"`
- Add: `"priority": 50` (needed - registers `onBeforeCommand`)

#### Surfacing (`plugins/com.ncsender.surfacing/manifest.json`)
- Add: `"category": "gcode-generator"`
- No priority field (not needed - tool-only plugin)

#### AutoDustBoot (`plugins/com.ncsender.autodustboot/manifest.json`)
- Add: `"category": "utility"`
- Add: `"priority": 100` (needed - registers `onBeforeCommand`, executes FIRST)

### 2. Update Plugin Manager (`app/electron/core/plugin-manager.js`)

#### a) Add category exclusivity mapping (top of file)
```javascript
const EXCLUSIVE_CATEGORIES = new Set(['tool-changer']);
```

#### b) Modify `loadManifest()` method (line 104-124)
- Add `category` to required fields validation
- Make `priority` optional

```javascript
if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry || !manifest.category) {
  throw new Error('Invalid manifest: missing required fields (id, name, version, entry, category)');
}
```

#### c) Modify `installPlugin()` method (line 359-384)
- Read `category` and `priority` from manifest
- Store in registry entry
- If plugin has exclusive category, check for conflicts
- If another enabled plugin in same exclusive category exists, set new plugin `enabled: false`
- Log warning about exclusivity conflict

```javascript
async installPlugin(pluginId, manifest) {
  const registry = this.loadRegistry();
  const existingIndex = registry.findIndex(p => p.id === pluginId);

  // Check for exclusive category conflicts
  let shouldEnable = true;
  if (manifest.category && EXCLUSIVE_CATEGORIES.has(manifest.category)) {
    const conflictingPlugin = registry.find(p =>
      p.id !== pluginId &&
      p.category === manifest.category &&
      p.enabled === true
    );
    if (conflictingPlugin) {
      shouldEnable = false;
      log(`Plugin "${pluginId}" has exclusive category "${manifest.category}" - ` +
          `disabling by default because "${conflictingPlugin.id}" is already enabled`);
    }
  }

  const pluginEntry = {
    id: pluginId,
    name: manifest.name,
    version: manifest.version,
    category: manifest.category,
    enabled: shouldEnable,
    installedAt: new Date().toISOString()
  };

  // Only add priority if it exists in manifest
  if (manifest.priority !== undefined) {
    pluginEntry.priority = manifest.priority;
  }

  if (existingIndex >= 0) {
    registry[existingIndex] = pluginEntry;
  } else {
    registry.push(pluginEntry);
  }

  this.saveRegistry(registry);
  log(`Registered plugin "${pluginId}" in registry`);
}
```

#### d) Modify `enablePlugin()` method (line 404-417)
- Before enabling, check if plugin has exclusive category
- If yes, find and disable other enabled plugins in same category
- Update registry for all affected plugins

```javascript
async enablePlugin(pluginId) {
  const registry = this.loadRegistry();
  const plugin = registry.find(p => p.id === pluginId);

  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" not found in registry`);
  }

  // Handle exclusive category
  if (plugin.category && EXCLUSIVE_CATEGORIES.has(plugin.category)) {
    const conflictingPlugins = registry.filter(p =>
      p.id !== pluginId &&
      p.category === plugin.category &&
      p.enabled === true
    );

    for (const conflictingPlugin of conflictingPlugins) {
      log(`Disabling "${conflictingPlugin.id}" due to exclusive category "${plugin.category}"`);
      conflictingPlugin.enabled = false;

      // Unload the conflicting plugin
      if (this.plugins.has(conflictingPlugin.id)) {
        await this.unloadPlugin(conflictingPlugin.id);
      }
    }
  }

  plugin.enabled = true;
  this.saveRegistry(registry);

  await this.loadPlugin(pluginId);
  log(`Enabled plugin "${pluginId}"`);
}
```

#### e) Add `updatePluginPriority()` method
```javascript
async updatePluginPriority(pluginId, newPriority) {
  const registry = this.loadRegistry();
  const plugin = registry.find(p => p.id === pluginId);

  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" not found in registry`);
  }

  plugin.priority = newPriority;
  this.saveRegistry(registry);

  log(`Updated priority for plugin "${pluginId}" to ${newPriority}`);
}
```

#### f) Modify `processCommand()` method (line 487-522)
- Before iterating plugins, sort by priority (descending - higher priority first)
- Plugins without priority field are processed last

```javascript
async processCommand(command, context = {}) {
  // Initialize command array with original command
  let commands = [{
    command: command,
    isOriginal: true,
    displayCommand: null,
    meta: context.meta || {},
    commandId: context.commandId || null
  }];

  // Sort plugins by priority (descending - higher number executes first)
  const sortedPlugins = Array.from(this.plugins.entries()).sort((a, b) => {
    const priorityA = a[1].manifest.priority ?? 0; // No priority = 0 (executes last)
    const priorityB = b[1].manifest.priority ?? 0;
    return priorityB - priorityA; // Descending order
  });

  // Iterate through sorted plugins
  for (const [pluginId, plugin] of sortedPlugins) {
    const pluginContext = this.pluginContexts.get(pluginId);

    // Get handlers registered via ctx.registerEventHandler('onBeforeCommand', ...)
    const pluginEventHandlers = this.eventBus.pluginHandlers.get(pluginId);
    const handlers = pluginEventHandlers?.get('onBeforeCommand') || [];

    if (handlers.length > 0) {
      for (const handler of handlers) {
        try {
          const result = await handler(commands, context, pluginContext);
          // Plugin returns modified array or undefined (no changes)
          if (Array.isArray(result)) {
            commands = result;
          }
        } catch (error) {
          log(`Error in plugin "${pluginId}" onBeforeCommand:`, error);
          // Continue with other plugins even if one fails
        }
      }
    }
  }

  return commands;
}
```

### 3. Update Registry Schema (`plugins.json`)

#### Event-based plugin entry:
```json
{
  "id": "com.ncsender.autodustboot",
  "name": "AutoDustboot",
  "version": "1.0.0",
  "enabled": true,
  "category": "utility",
  "priority": 100,
  "installedAt": "2025-01-01T00:00:00.000Z"
}
```

#### Tool-only plugin entry:
```json
{
  "id": "com.ncsender.surfacing",
  "name": "Surfacing & Jointer",
  "version": "1.0.0",
  "enabled": true,
  "category": "gcode-generator",
  "installedAt": "2025-01-01T00:00:00.000Z"
}
```

### 4. Update Plugin Routes (`app/electron/features/plugins/routes.js`)

#### a) Add new route: `POST /api/plugins/reorder`
```javascript
router.post('/reorder', asyncHandler(async (req, res) => {
  const { pluginIds } = req.body; // Array of plugin IDs in desired order

  if (!Array.isArray(pluginIds)) {
    return res.status(400).json({ error: 'pluginIds must be an array' });
  }

  // Calculate descending priorities: first=100, second=90, third=80, etc.
  for (let i = 0; i < pluginIds.length; i++) {
    const priority = 100 - (i * 10);
    await pluginManager.updatePluginPriority(pluginIds[i], priority);
  }

  res.json({ success: true, message: 'Plugin priorities updated' });
}));
```

#### b) Modify `GET /api/plugins` response
- Include `category` and `priority` fields in response
- Sort by priority (descending, nulls last)

```javascript
router.get('/', asyncHandler(async (req, res) => {
  const plugins = pluginManager.getInstalledPlugins();

  // Sort by priority (descending, nulls last)
  const sorted = plugins.sort((a, b) => {
    const priorityA = a.priority ?? -1;
    const priorityB = b.priority ?? -1;
    return priorityB - priorityA;
  });

  res.json(sorted);
}));
```

### 5. Update Frontend UI (Settings > Plugins)

#### File to modify
Find the Settings > Plugins component (likely in `app/client/src/features/settings/` or similar)

#### UI Layout
```
┌─────────────────────────────────────────────────┐
│  SORTABLE PLUGINS (Event-based)                │
├─────────────────────────────────────────────────┤
│  [≡] AutoDustBoot          [enabled] [⚙️] [🗑️]  │  ← Drag handle
│  [≡] RapidChangeATC        [enabled] [⚙️] [🗑️]  │  ← Drag handle
├─────────────────────────────────────────────────┤
│  OTHER PLUGINS (Tool-only)                      │
├─────────────────────────────────────────────────┤
│      Surfacing & Jointer   [enabled] [⚙️] [🗑️]  │  ← No drag handle
└─────────────────────────────────────────────────┘
```

#### Implementation
1. Fetch plugins from `/api/plugins`
2. Split into two arrays:
   - `sortablePlugins` - plugins with `priority !== undefined`
   - `otherPlugins` - plugins with `priority === undefined`
3. Use drag-n-drop library (e.g., `vue-draggable` or `@dnd-kit/core`)
4. Show drag handles (`[≡]`) only for sortable plugins
5. On drag complete:
   - Collect plugin IDs in new visual order
   - POST to `/api/plugins/reorder` with `{ pluginIds: [...] }`
   - Refresh plugin list

#### Example Vue Component Structure
```vue
<template>
  <div>
    <!-- Sortable Section -->
    <div class="plugin-section">
      <h3>Sortable Plugins (Event-based)</h3>
      <draggable v-model="sortablePlugins" @end="handleReorder">
        <div v-for="plugin in sortablePlugins" :key="plugin.id" class="plugin-row">
          <span class="drag-handle">≡</span>
          <span>{{ plugin.name }}</span>
          <!-- Enable/Config/Delete buttons -->
        </div>
      </draggable>
    </div>

    <!-- Divider -->
    <hr />

    <!-- Other Plugins Section -->
    <div class="plugin-section">
      <h3>Other Plugins (Tool-only)</h3>
      <div v-for="plugin in otherPlugins" :key="plugin.id" class="plugin-row">
        <span class="no-drag-spacer"></span>
        <span>{{ plugin.name }}</span>
        <!-- Enable/Config/Delete buttons -->
      </div>
    </div>
  </div>
</template>

<script>
async handleReorder() {
  const pluginIds = this.sortablePlugins.map(p => p.id);
  await fetch('/api/plugins/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pluginIds })
  });
  // Refresh list
}
</script>
```

### 6. Category Definitions

#### Exclusive Categories (only one can be enabled at a time)
- `tool-changer` - Tool change automation plugins

#### Non-Exclusive Categories (multiple can be enabled)
- `post-processor` - G-code file transformation (priority 120-150, runs before other plugins)
- `tool-importer` - Tool library import from external formats (no priority - UI integration only)
- `gcode-generator` - G-code generation tools
- `utility` - Utility/helper plugins
- `custom` - User-defined category

### 7. Priority System Details

#### Priority Assignment
- **Higher number = Higher priority = Executes first**
- Priority ranges by category:
  - **post-processor**: 120-150 (runs before all other plugins)
  - **tool-changer**: 50-100
  - **utility**: 0-50
  - **gcode-generator**: 0-50
  - **tool-importer**: No priority (UI integration only, no event handlers)
- Default range for UI drag-n-drop: 100, 90, 80, 70... (descending by 10)
- Plugins without priority get `0` (execute last)

#### Execution Order Example
```
Priority 150: CAM Post-Processor  → Executes FIRST (transforms entire file)
Priority 100: AutoDustBoot        → Executes SECOND
Priority 50:  RapidChangeATC      → Executes THIRD
Priority 0:   (no priority)       → Executes LAST
```

#### Command Flow Example
```
Input: M6 T1

→ AutoDustBoot (priority: 100)
  Adds retract sequence before M6

→ RapidChangeATC (priority: 50)
  Sees M6, generates full tool change program

→ Final command array sent to CNC
```

## Benefits
- ✅ Prevents conflicts between tool changer plugins (exclusive categories)
- ✅ Priority only required for event-based plugins
- ✅ User can reorder event-based plugins via drag-n-drop UI
- ✅ Tool-only plugins remain simple (no priority needed)
- ✅ Priority numbers hidden from user - visual ordering only
- ✅ Backward compatible (missing fields handled gracefully)
- ✅ Flexible for future exclusive categories
- ✅ Clear separation of sortable vs non-sortable plugins in UI

## Testing Checklist
- [ ] Install plugin with exclusive category when another is enabled
- [ ] Enable plugin with exclusive category - verify others disabled
- [ ] Drag-n-drop sortable plugins - verify order persists
- [ ] Verify command execution order matches priority
- [ ] Verify tool-only plugins appear in "Other" section
- [ ] Verify missing category fails manifest validation
- [ ] Verify missing priority works for tool-only plugins
