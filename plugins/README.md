# Development Plugins

This directory contains plugins under development that can be synced to your ncSender application data folder for testing.

## Directory Structure

```
plugins/
├── com.example.job-logger/
│   ├── manifest.json
│   └── index.js
└── com.ncsender.auto-dustboot/
    ├── manifest.json
    └── index.js
```

## Hot-Reload Development Workflow

**No restart needed!** The sync script will automatically hot-reload plugins:

```bash
./.scripts/sync-plugins.sh
```

This will:
1. Copy all plugins from `plugins/` to your ncSender data folder
2. **Automatically reload each plugin via API** (if server is running)
3. Show reload status for each plugin

Example output:
```
Syncing plugins from: /path/to/ncSender/plugins
                  to: ~/Library/Application Support/ncSender/plugins
Syncing plugin: com.ncsender.auto-dustboot
  ✓ com.ncsender.auto-dustboot synced
Syncing plugin: com.example.job-logger
  ✓ com.example.job-logger synced

✓ All plugins synced successfully

Attempting to hot-reload plugins...
  ✓ com.ncsender.auto-dustboot reloaded
  ✓ com.example.job-logger reloaded
```

## Manual Hot-Reload via API

You can also reload individual plugins via API:

```bash
curl -X POST http://localhost:8090/api/plugins/com.ncsender.auto-dustboot/reload
```

## Platform-Specific Plugin Locations

Plugins are synced to:
- **macOS**: `~/Library/Application Support/ncSender/plugins/`
- **Linux**: `~/.config/ncSender/plugins/`
- **Windows**: `%APPDATA%\ncSender\plugins\`

## Included Plugins

### Job Logger (`com.example.job-logger`)
Example plugin that logs job statistics:
- Job start/end events
- Line count tracking
- Duration measurement

### Auto Dustboot (`com.ncsender.auto-dustboot`)
Production plugin that manages dust collection during tool changes:
- Detects M6 (tool change) commands
- Removes M8 commands immediately after tool change
- Injects M8 after the first XY movement following tool change
- Ensures dust collection activates at the right time

## Development Workflow

1. Edit plugin files in `plugins/[plugin-id]/index.js`
2. Run `./.scripts/sync-plugins.sh`
3. **Plugin reloads automatically - no restart needed!**
4. Check server logs for plugin output
5. Test your changes immediately

## Custom Server Port

If ncSender is running on a different port, set the environment variable:

```bash
NCSENDER_PORT=3000 ./.scripts/sync-plugins.sh
```

## Creating New Plugins

1. Create a new directory: `plugins/com.yourname.pluginname/`
2. Add `manifest.json` with plugin metadata
3. Add `index.js` with plugin logic
4. Run sync script to deploy and hot-reload
5. Add plugin to `plugins.json` registry (or use API)

See `docs/PLUGIN_DEVELOPMENT.md` for full documentation.

## API Endpoints

```bash
# Reload a specific plugin
POST /api/plugins/:pluginId/reload

# List all plugins
GET /api/plugins

# Enable/disable plugin
POST /api/plugins/:pluginId/enable
POST /api/plugins/:pluginId/disable
```
