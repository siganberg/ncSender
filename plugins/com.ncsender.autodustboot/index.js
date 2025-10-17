let isToolChange = false;
let shouldInjectAfterNextXY = false;

export function onLoad(ctx) {
  ctx.log('Auto Dustboot plugin loaded');

  ctx.registerConfigUI(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--color-surface, #fff);
          color: var(--color-text-primary, #333);
          height: 100vh;
          overflow-y: auto;
        }
        .config-form {
          max-width: 900px;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
        }
        .form-group label {
          margin-bottom: 8px;
          font-weight: 600;
          color: var(--color-text-primary, #333);
        }
        .form-group textarea {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--color-border, #ddd);
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9rem;
          background: var(--color-surface, #fff);
          color: var(--color-text-primary, #333);
          min-height: 100px;
          resize: vertical;
        }
        .form-group textarea:focus {
          outline: none;
          border-color: var(--color-accent, #4a90e2);
        }
        .form-group textarea::placeholder {
          color: var(--color-text-secondary, #999);
          opacity: 0.5;
        }
        .help-text {
          font-size: 0.85rem;
          color: var(--color-text-secondary, #666);
          margin-top: 6px;
          line-height: 1.4;
        }
        .success-message {
          padding: 12px 16px;
          background: rgba(52, 211, 153, 0.2);
          border: 1px solid rgba(52, 211, 153, 0.3);
          border-radius: 4px;
          color: #34d399;
          margin-top: 16px;
          display: none;
        }
        .success-message.show {
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="config-form">
        <div class="form-row">
          <div class="form-group">
            <label for="beforeToolChange">Commands before the tool change</label>
            <textarea id="beforeToolChange" placeholder="e.g. M9"></textarea>
            <p class="help-text">Commands to execute before M6 is sent (one per line). Leave empty if not needed.</p>
          </div>

          <div class="form-group">
            <label for="afterToolChange">Commands after the tool change</label>
            <textarea id="afterToolChange">M8
G4 P1</textarea>
            <p class="help-text">This will be executed after the first X/Y move for each tool change.</p>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="ignoreCommands">Ignore commands</label>
            <textarea id="ignoreCommands">M8
G4</textarea>
            <p class="help-text">These commands will be skipped if your job already has them to avoid duplicates. The commands after the tool change will be used instead.</p>
          </div>
        </div>

        <div class="success-message" id="successMessage">
          Configuration saved successfully!
        </div>
      </div>

      <script>
        (async function() {
          try {
            const response = await fetch('/api/plugins/com.ncsender.auto-dustboot/settings');
            if (response.ok) {
              const settings = await response.json();
              document.getElementById('beforeToolChange').value = settings.beforeToolChange || '';
              document.getElementById('afterToolChange').value = settings.afterToolChange || 'M8\\nG4 P1';
              document.getElementById('ignoreCommands').value = settings.ignoreCommands || 'M8\\nG4';
            }
          } catch (error) {
            console.error('Failed to load settings:', error);
          }
        })();

        // Listen for save message from parent
        window.addEventListener('message', (event) => {
          if (event.data.type === 'save-config') {
            saveAutoDustBootConfig();
          }
        });

        async function saveAutoDustBootConfig() {
          const beforeToolChange = document.getElementById('beforeToolChange').value;
          const afterToolChange = document.getElementById('afterToolChange').value;
          const ignoreCommands = document.getElementById('ignoreCommands').value;

          const settings = {
            beforeToolChange: beforeToolChange || '',
            afterToolChange: afterToolChange || 'M8\\nG4 P1',
            ignoreCommands: ignoreCommands || 'M8\\nG4'
          };

          try {
            const response = await fetch('/api/plugins/com.ncsender.auto-dustboot/settings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            });

            if (response.ok) {
              const successMsg = document.getElementById('successMessage');
              successMsg.classList.add('show');
              setTimeout(() => {
                successMsg.classList.remove('show');
              }, 3000);
            } else {
              alert('Failed to save configuration');
            }
          } catch (error) {
            console.error('Failed to save settings:', error);
            alert('Failed to save configuration');
          }
        }
      </script>
    </body>
    </html>
  `);

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    const trimmedLine = line.trim().toUpperCase();

    // Load settings
    const settings = ctx.getSettings();
    const beforeToolChange = settings.beforeToolChange || '';
    const afterToolChange = settings.afterToolChange || 'M8\nG4 P1';
    const ignoreCommands = settings.ignoreCommands || 'M8\nG4';

    // Parse multi-line settings into arrays
    const beforeCommands = beforeToolChange.split('\n').map(c => c.trim()).filter(c => c.length > 0);
    const afterCommands = afterToolChange.split('\n').map(c => c.trim()).filter(c => c.length > 0);
    const ignoreList = ignoreCommands.split('\n').map(c => c.trim().toUpperCase()).filter(c => c.length > 0);

    // If we need to inject commands after the previous XY movement, do it now
    if (shouldInjectAfterNextXY) {
      ctx.log(`Injecting after-tool-change commands before line ${context.lineNumber}`);
      shouldInjectAfterNextXY = false;

      // Send all configured after-tool-change commands
      for (const cmd of afterCommands) {
        try {
          await ctx.sendGcode(cmd, {
            displayCommand: `${cmd} (Auto Dustboot - After Tool Change)`,
            meta: { autoInjected: true, plugin: 'auto-dustboot' }
          });
          ctx.log(`Injected: ${cmd}`);
        } catch (error) {
          ctx.log(`Failed to inject command "${cmd}":`, error.message);
        }
      }
    }

    // Check if this is a tool change command (M6)
    if (trimmedLine.includes('M6')) {
      ctx.log(`Tool change detected at line ${context.lineNumber}: ${line}`);

      // Send before-tool-change commands first
      if (beforeCommands.length > 0) {
        ctx.log('Injecting before-tool-change commands');
        for (const cmd of beforeCommands) {
          try {
            await ctx.sendGcode(cmd, {
              displayCommand: `${cmd} (Auto Dustboot - Before Tool Change)`,
              meta: { autoInjected: true, plugin: 'auto-dustboot' }
            });
            ctx.log(`Injected: ${cmd}`);
          } catch (error) {
            ctx.log(`Failed to inject command "${cmd}":`, error.message);
          }
        }
      }

      // Set flag to track we're in tool change state
      isToolChange = true;

      // Let the M6 command pass through
      return line;
    }

    // If we're in a tool change state, check for commands to ignore and XY movement
    if (isToolChange) {
      // Check if this line should be ignored (starts with any of the ignore commands)
      for (const ignoreCmd of ignoreList) {
        if (trimmedLine.startsWith(ignoreCmd)) {
          ctx.log(`Skipping command at line ${context.lineNumber}: ${line.trim()}`);
          return `; ${line.trim()} (Auto Dustboot - Skipped)`;
        }
      }

      // Check if this line has X or Y movement
      const hasXMovement = /[^A-Z]X[-+]?\d+\.?\d*/i.test(line);
      const hasYMovement = /[^A-Z]Y[-+]?\d+\.?\d*/i.test(line);

      if (hasXMovement || hasYMovement) {
        ctx.log(`First XY movement after tool change at line ${context.lineNumber}: ${line}`);

        // Reset tool change state and flag that we should inject commands after this line
        isToolChange = false;
        shouldInjectAfterNextXY = true;

        return line;
      }
    }

    // Normal line - pass through unchanged
    return line;
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    ctx.log('Job ended, resetting tool change state');
    isToolChange = false;
    shouldInjectAfterNextXY = false;
  });
}

export function onUnload() {
  console.log('[PLUGIN:com.ncsender.auto-dustboot] Auto Dustboot plugin unloaded');
  isToolChange = false;
  shouldInjectAfterNextXY = false;
}
