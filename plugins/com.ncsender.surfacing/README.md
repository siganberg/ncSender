# Surfacing

A new ncSender plugin

## Installation

1. Build the plugin:
   ```bash
   node .scripts/plugin-cli.js build com.ncsender.surfacing
   ```

2. Install the plugin:
   ```bash
   node .scripts/plugin-cli.js install com.ncsender.surfacing
   ```

## Development

Edit `index.js` to add your plugin logic. The plugin supports the following hooks:

- `onLoad(ctx)` - Called when plugin loads
- `onUnload()` - Called when plugin unloads
- `onBeforeJobStart(gcode, context)` - Modify G-code before job starts
- `onBeforeGcodeLine(line, context)` - Modify individual lines
- `onAfterGcodeLine(line, response, context)` - React to line results
- `onAfterJobEnd(context)` - Handle job completion

## Context API

The `ctx` object provides:

- `ctx.log(...args)` - Log messages with plugin prefix
- `ctx.sendGcode(gcode, options)` - Send G-code commands
- `ctx.broadcast(event, data)` - Broadcast to clients
- `ctx.getSettings()` - Get plugin settings
- `ctx.setSettings(settings)` - Save plugin settings
- `ctx.showDialog(title, content)` - Show dialog to user
- `ctx.registerToolMenu(label, callback)` - Add Tools menu item
- `ctx.onWebSocketEvent(event, handler)` - Subscribe to WebSocket events
- `ctx.emitToClient(event, data)` - Emit custom events to clients

## License

MIT
