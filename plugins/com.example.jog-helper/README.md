# Jog Helper Example Plugin

This is an example plugin demonstrating how to use ncSender UI Components in your plugin dialogs.

## What This Plugin Does

- Adds a "Jog Helper" tool to the Tools menu
- Shows a dialog with pre-built JogControls component
- Demonstrates how to:
  - Load the ncSender UI library
  - Create and configure UI components
  - Send G-code commands from plugin dialogs
  - Handle user interactions

## Features Demonstrated

1. **Using ncSender UI Library** - Loads `/plugin-lib/ncs-ui.js`
2. **JogControls Component** - Full jog control interface
3. **Sending G-code** - Via `/api/cnc/command` endpoint
4. **Dialog Theming** - Uses ncSender CSS variables
5. **Custom Icon** - SVG icon for the tool menu

## Installation

This plugin is included as an example in the ncSender installation.

To enable it:
1. Open ncSender
2. Go to Settings > Plugins
3. Find "Jog Helper" in the list
4. Click the toggle to enable it
5. Go to the Tools tab to see the "Jog Helper" button

## Code Structure

- `manifest.json` - Plugin metadata
- `index.js` - Plugin entry point
- `README.md` - This file

## How It Works

### 1. Tool Registration

```javascript
ctx.registerToolMenu('Jog Helper', async () => {
  // Show dialog
}, {
  clientOnly: true,
  icon: '<svg>...</svg>'
});
```

### 2. Loading UI Library

```html
<script src="/plugin-lib/ncs-ui.js"></script>
```

### 3. Creating JogControls

```javascript
const jogControls = NCS.createJogControls({
  container: '#jog-container',
  stepOptions: [0.1, 1, 10, 100],
  defaultStep: 1,
  defaultFeedRate: 1000,
  onJog: async (axis, direction, distance, feedRate) => {
    // Send jog command
  }
});
```

### 4. Sending Commands

```javascript
await fetch('/api/cnc/command', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command: 'G0 X10',
    displayCommand: 'Jog X+10mm'
  })
});
```

## Customization

You can customize this plugin to:
- Add more buttons (e.g., rapid positioning)
- Include probing functionality
- Add preset positions
- Create custom jog patterns

## Learning More

- See `/docs/plugin-development-guide.md` for complete plugin API reference
- See `/docs/plugin-ui-components.md` for UI component documentation

## License

This example plugin is provided as a reference for plugin developers.
