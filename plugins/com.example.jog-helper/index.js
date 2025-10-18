/**
 * Jog Helper Plugin
 * Example plugin demonstrating the use of ncSender UI Components
 */

export async function onLoad(ctx) {
  ctx.log('Jog Helper plugin loaded');

  ctx.registerToolMenu('Jog Helper', async () => {
    ctx.log('Jog Helper tool clicked');

    ctx.showDialog('Jog Helper', `
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

          .info-box {
            padding: 12px;
            background: var(--color-surface-muted);
            border-left: 3px solid var(--color-accent);
            margin: 15px 0;
            border-radius: var(--radius-small);
          }

          #jog-container {
            margin: 20px 0;
          }

          .status {
            padding: 12px;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-small);
            font-family: monospace;
            font-size: 0.9rem;
            margin-top: 15px;
          }

          .status strong {
            color: var(--color-text-secondary);
          }

          .controls {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }

          .btn {
            padding: 8px 16px;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-small);
            cursor: pointer;
            color: var(--color-text-primary);
            font-size: 0.9rem;
          }

          .btn:hover {
            background: var(--color-surface-muted);
            border-color: var(--color-accent);
          }

          .btn-primary {
            background: var(--color-accent);
            color: white;
            border-color: var(--color-accent);
          }

          .btn-primary:hover {
            opacity: 0.9;
          }
        </style>
      </head>
      <body>
        <h2>Jog Helper</h2>

        <div class="info-box">
          ℹ️ This plugin demonstrates how to use ncSender UI Components in your plugin dialogs.
          The JogControls component below is from <code>/plugin-lib/ncs-ui.js</code>.
        </div>

        <!-- Jog Controls will be rendered here -->
        <div id="jog-container"></div>

        <div class="controls">
          <button id="home-btn" class="btn btn-primary">Home All ($H)</button>
          <button id="close-btn" class="btn">Close</button>
        </div>

        <div class="status">
          <strong>Last Command:</strong>
          <span id="last-command">None</span>
        </div>

        <!-- Load the ncSender UI Library -->
        <script src="/plugin-lib/ncs-ui.js"></script>

        <script>
          (function() {
            // Create jog controls using the NCS UI library
            const jogControls = NCS.createJogControls({
              container: '#jog-container',
              stepOptions: [0.1, 1, 10],
              defaultStep: 1,
              defaultFeedRate: 3000,
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
                alert('Failed to send jog command: ' + error.message);
                }
              }
            });

            // Home button
            document.getElementById('home-btn').addEventListener('click', async () => {
              try {
                document.getElementById('last-command').textContent = 'Homing...';

                await fetch('/api/cnc/command', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    command: '$H',
                    displayCommand: 'Home All Axes'
                  })
                });

                document.getElementById('last-command').textContent = 'Homing complete';
              } catch (error) {
                console.error('Homing failed:', error);
                alert('Failed to home: ' + error.message);
              }
            });

            // Close button
            document.getElementById('close-btn').addEventListener('click', () => {
              window.postMessage({type: 'close-plugin-dialog'}, '*');
            });
          })();
        </script>
      </body>
      </html>
    `);
  }, {
    clientOnly: true,
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M7 1h2v2H7V1zm0 12h2v2H7v-2zM1 7h2v2H1V7zm12 0h2v2h-2V7zM3 3h2v2H3V3zm8 0h2v2h-2V3zM3 11h2v2H3v-2zm8 0h2v2h-2v-2z"/><circle fill="currentColor" cx="8" cy="8" r="2"/></svg>'
  });
}

export async function onUnload() {
  console.log('Jog Helper plugin unloaded');
}
