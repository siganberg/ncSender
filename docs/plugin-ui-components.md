# ncSender Plugin UI Components

The ncSender Plugin UI Library (`ncs-ui.js`) provides pre-built, styled UI components that plugin developers can use in their dialogs.

## Installation

Include the library in your plugin dialog HTML:

```html
<script src="/plugin-lib/ncs-ui.js"></script>
```

All components are available under the global `NCS` object.

---

## JogControls Component

A fully-functional jog control interface with XY joystick and Z controls.

### Features

- **XY Joystick**: 3x3 grid with diagonal movements
- **Z Controls**: Separate Z+ and Z- buttons
- **Step Selection**: Configurable step sizes
- **Feed Rate Input**: Adjustable feed rate
- **Touch Support**: Works on mobile/tablet devices
- **Themed Styling**: Uses ncSender CSS variables

### Usage

```javascript
const jogControls = NCS.createJogControls({
  container: '#jog-container',          // CSS selector or DOM element
  stepOptions: [0.1, 1, 10, 100],      // Available step sizes
  defaultStep: 1,                       // Initial step size
  defaultFeedRate: 1000,                // Initial feed rate (mm/min)
  disabled: false,                      // Disable controls
  onJog: (axis, direction, distance, feedRate) => {
    // Called when user jogs
    // axis: 'X', 'Y', or 'Z'
    // direction: 1 or -1
    // distance: step size (adjusted for diagonals)
    // feedRate: current feed rate

    console.log(`Jog ${axis} ${direction > 0 ? '+' : '-'}${distance}mm @ ${feedRate}mm/min`);
  }
});
```

### Complete Example

```javascript
export function onLoad(ctx) {
  ctx.registerToolMenu('Jog Assistant', async () => {
    ctx.showDialog('Jog Controls', `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: system-ui;
            padding: 20px;
            background: var(--color-bg);
            color: var(--color-text-primary);
            margin: 0;
          }

          h2 {
            margin-top: 0;
            color: var(--color-text-primary);
          }

          #jog-container {
            margin: 20px 0;
          }

          .status {
            padding: 10px;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-small);
            font-family: monospace;
            font-size: 0.9rem;
          }
        </style>
      </head>
      <body>
        <h2>Manual Jog Controls</h2>
        <p>Use the controls below to manually jog your machine.</p>

        <!-- Jog Controls will be rendered here -->
        <div id="jog-container"></div>

        <div class="status">
          <strong>Last Command:</strong>
          <span id="last-command">None</span>
        </div>

        <!-- Load the UI library -->
        <script src="/plugin-lib/ncs-ui.js"></script>

        <script>
          // Create jog controls
          // NOTE: Use 'let' instead of 'const' to avoid errors if dialog is reopened
          let jogControls = NCS.createJogControls({
            container: '#jog-container',
            stepOptions: [0.1, 1, 10, 100],
            defaultStep: 1,
            defaultFeedRate: 1000,
            onJog: async (axis, direction, distance, feedRate) => {
              // Build G-code jog command
              const dist = (direction * distance).toFixed(3);
              const gcode = \`G91\\nG0 \${axis}\${dist} F\${feedRate}\\nG90\`;

              // Update status display
              document.getElementById('last-command').textContent =
                \`\${axis}\${direction > 0 ? '+' : ''}\${dist}mm @ \${feedRate}mm/min\`;

              // Send to controller via API
              try {
                await fetch('/api/cnc/command', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    command: gcode,
                    displayCommand: \`Jog \${axis}\${direction > 0 ? '+' : ''}\${dist}mm\`
                  })
                });
              } catch (error) {
                console.error('Jog failed:', error);
                alert('Failed to send jog command');
              }
            }
          });

          // You can control the jog controls programmatically:
          // jogControls.setStep(10);
          // jogControls.setFeedRate(2000);
          // jogControls.setDisabled(true);
          // jogControls.destroy(); // Clean up when done
        </script>
      </body>
      </html>
    `);
  }, {
    clientOnly: true
  });
}
```

### API Methods

After creating a JogControls instance, you can control it programmatically:

```javascript
// Change step size
jogControls.setStep(10);

// Change feed rate
jogControls.setFeedRate(2000);

// Enable/disable controls
jogControls.setDisabled(true);  // Disable
jogControls.setDisabled(false); // Enable

// Clean up (removes all event listeners and DOM elements)
jogControls.destroy();
```

### CSS Customization

The JogControls component uses ncSender's CSS variables for theming. You can customize the appearance:

```css
/* Override colors */
:root {
  --color-accent: #ff5722;      /* Accent color for active states */
  --color-surface: #ffffff;      /* Button background */
  --color-border: #e0e0e0;       /* Border color */
  --color-text-primary: #000000; /* Text color */
}

/* Custom button styles */
.ncs-jog-btn {
  font-size: 1rem !important;
  border-radius: 8px !important;
}
```

---

## Real-World Example: Probing Dialog

Here's how you might use JogControls in a probing workflow:

```javascript
export function onLoad(ctx) {
  ctx.registerToolMenu('Auto Probe', async () => {
    ctx.showDialog('Probing Assistant', `
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

          .probe-section {
            margin: 20px 0;
            padding: 15px;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-medium);
          }

          .btn-primary {
            padding: 10px 20px;
            background: var(--color-accent);
            color: white;
            border: none;
            border-radius: var(--radius-small);
            cursor: pointer;
            font-size: 1rem;
          }

          .btn-primary:hover {
            opacity: 0.9;
          }

          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        </style>
      </head>
      <body>
        <h2>Probing Assistant</h2>

        <!-- Step 1: Position -->
        <div class="probe-section">
          <h3>Step 1: Position Probe</h3>
          <p>Use the jog controls to position the probe near your workpiece.</p>
          <div id="jog-container"></div>
        </div>

        <!-- Step 2: Probe -->
        <div class="probe-section">
          <h3>Step 2: Run Probe</h3>
          <button id="probe-btn" class="btn-primary">Start Probing</button>
        </div>

        <script src="/plugin-lib/ncs-ui.js"></script>
        <script>
          let isProbing = false;

          // Create jog controls
          let jogControls = NCS.createJogControls({
            container: '#jog-container',
            stepOptions: [0.1, 1, 10],
            defaultStep: 1,
            defaultFeedRate: 500,  // Slower for positioning
            onJog: async (axis, direction, distance, feedRate) => {
              const dist = (direction * distance).toFixed(3);
              const gcode = \`G91\\nG0 \${axis}\${dist} F\${feedRate}\\nG90\`;

              await fetch('/api/cnc/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  command: gcode,
                  displayCommand: \`Position: \${axis}\${direction > 0 ? '+' : ''}\${dist}\`
                })
              });
            }
          });

          // Probe button
          document.getElementById('probe-btn').addEventListener('click', async () => {
            if (isProbing) return;

            isProbing = true;
            jogControls.setDisabled(true);
            document.getElementById('probe-btn').disabled = true;
            document.getElementById('probe-btn').textContent = 'Probing...';

            try {
              // Run probe command
              await fetch('/api/cnc/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  command: 'G38.2 Z-50 F100',  // Probe down
                  displayCommand: 'Probing Z'
                })
              });

              // Set work zero
              await fetch('/api/cnc/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  command: 'G10 L20 P0 Z0',
                  displayCommand: 'Set Z Zero'
                })
              });

              alert('Probing complete! Z zero set.');
              window.postMessage({type: 'close-plugin-dialog'}, '*');
            } catch (error) {
              alert('Probing failed: ' + error.message);
            } finally {
              isProbing = false;
              jogControls.setDisabled(false);
              document.getElementById('probe-btn').disabled = false;
              document.getElementById('probe-btn').textContent = 'Start Probing';
            }
          });
        </script>
      </body>
      </html>
    `);
  }, {
    clientOnly: true
  });
}
```

---

## Future Components

More components will be added to the UI library in future releases:

- **ToolSelector**: Tool selection dropdown with tool table integration
- **GCodePreview**: Lightweight G-code preview
- **ProgressBar**: Styled progress indicator
- **CoordinateDisplay**: Work/machine coordinate display
- **StatusIndicator**: Connection/status badges

---

## Contributing

If you'd like to see additional components in the UI library, please open an issue on GitHub with your suggestions!
