let isToolChanging = false;

export function onLoad(ctx) {
  ctx.log('AutoDustBoot plugin loaded');

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
          margin-bottom: 20px;
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
        .form-group input[type="text"],
        .form-group input[type="number"] {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--color-border, #ddd);
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9rem;
          background: var(--color-surface, #fff);
          color: var(--color-text-primary, #333);
        }
        .form-group input:focus {
          outline: none;
          border-color: var(--color-accent, #4a90e2);
        }
        .toggle-switch {
          position: relative;
          width: 50px;
          height: 28px;
          margin-top: 8px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .4s;
          border-radius: 28px;
        }
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        input:checked + .toggle-slider {
          background-color: var(--color-accent, #4a90e2);
        }
        input:checked + .toggle-slider:before {
          transform: translateX(22px);
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
            <label for="retractCommand">Retract Command (Optional)</label>
            <input type="text" id="retractCommand" placeholder="M9">
            <p class="help-text">Command to retract the AutoDustBoot</p>
          </div>

          <div class="form-group">
            <label for="expandCommand">Expand Command</label>
            <input type="text" id="expandCommand" placeholder="M8">
            <p class="help-text">Command to expand the AutoDustBoot</p>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="delayAfterExpand">Add Delay After Expand (seconds)</label>
            <input type="number" id="delayAfterExpand" min="0" max="10" value="1">
            <p class="help-text">Allow the AutoDustBoot to expand before resuming</p>
          </div>

          <div class="form-group">
            <label for="retractOnHome">Retract on Home</label>
            <label class="toggle-switch">
              <input type="checkbox" id="retractOnHome" checked>
              <span class="toggle-slider"></span>
            </label>
            <p class="help-text">Automatically retract AutoDustBoot when homing</p>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="retractOnRapidMove">Retract on Rapid Move (G0)</label>
            <label class="toggle-switch">
              <input type="checkbox" id="retractOnRapidMove" checked>
              <span class="toggle-slider"></span>
            </label>
            <p class="help-text">Automatically retract the AutoDustBoot during all rapid moves, except when running jobs.</p>
          </div>
        </div>

        <div class="success-message" id="successMessage">
          Configuration saved successfully!
        </div>
      </div>

      <script>
        (async function() {
          try {
            const response = await fetch('/api/plugins/com.ncsender.autodustboot/settings');
            if (response.ok) {
              const settings = await response.json();
              document.getElementById('retractCommand').value = settings.retractCommand || 'M9';
              document.getElementById('expandCommand').value = settings.expandCommand || 'M8';
              document.getElementById('delayAfterExpand').value = settings.delayAfterExpand !== undefined ? settings.delayAfterExpand : 1;
              document.getElementById('retractOnHome').checked = settings.retractOnHome !== undefined ? settings.retractOnHome : true;
              document.getElementById('retractOnRapidMove').checked = settings.retractOnRapidMove !== undefined ? settings.retractOnRapidMove : true;
            }
          } catch (error) {
            console.error('Failed to load settings:', error);
          }
        })();

        window.addEventListener('message', (event) => {
          if (event.data.type === 'save-config') {
            saveAutoDustBootConfig();
          }
        });

        async function saveAutoDustBootConfig() {
          const retractCommand = document.getElementById('retractCommand').value.trim();
          const expandCommand = document.getElementById('expandCommand').value.trim();
          const delayAfterExpand = parseInt(document.getElementById('delayAfterExpand').value, 10);
          const retractOnHome = document.getElementById('retractOnHome').checked;
          const retractOnRapidMove = document.getElementById('retractOnRapidMove').checked;

          const settings = {
            retractCommand,
            expandCommand,
            delayAfterExpand,
            retractOnHome,
            retractOnRapidMove
          };

          try {
            const response = await fetch('/api/plugins/com.ncsender.autodustboot/settings', {
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

        document.getElementById('retractCommand').addEventListener('blur', saveAutoDustBootConfig);
        document.getElementById('expandCommand').addEventListener('blur', saveAutoDustBootConfig);
        document.getElementById('delayAfterExpand').addEventListener('blur', saveAutoDustBootConfig);
        document.getElementById('retractOnHome').addEventListener('change', saveAutoDustBootConfig);
        document.getElementById('retractOnRapidMove').addEventListener('change', saveAutoDustBootConfig);
      </script>
    </body>
    </html>
  `);

  ctx.registerEventHandler('onBeforeCommand', async (line, context) => {
    const pluginId = 'com.ncsender.autodustboot';

    if (context.meta?.processedByPlugins?.includes(pluginId)) {
      return line;
    }

    function markAsProcessed(meta = {}) {
      const processedByPlugins = meta.processedByPlugins || [];
      if (!processedByPlugins.includes(pluginId)) {
        processedByPlugins.push(pluginId);
      }
      return { ...meta, processedByPlugins };
    }

    function normalizeGCode(code) {
      return code.toUpperCase().replace(/([GM])0+(\d)/g, '$1$2');
    }

    function stripLineNumber(code) {
      return code.replace(/^N\d+\s*/i, '');
    }

    const trimmedLine = line.trim().toUpperCase();
    const lineWithoutNumber = stripLineNumber(trimmedLine);
    const normalizedLine = normalizeGCode(lineWithoutNumber);
    const settings = ctx.getSettings();
    const retractCommand = settings.retractCommand || 'M9';
    const expandCommand = settings.expandCommand || 'M8';
    const normalizedRetractCmd = normalizeGCode(retractCommand);
    const normalizedExpandCmd = normalizeGCode(expandCommand);
    const delayAfterExpand = settings.delayAfterExpand !== undefined ? settings.delayAfterExpand : 1;
    const retractOnHome = settings.retractOnHome !== undefined ? settings.retractOnHome : true;
    const retractOnRapidMove = settings.retractOnRapidMove !== undefined ? settings.retractOnRapidMove : true;

    const hasExpandRetract = expandCommand && retractCommand;

    async function sendExpandRetractSequence(originalCommand) {
      await ctx.sendGcode(expandCommand, {
        displayCommand: `${expandCommand} (AutoDustBoot - Expand)`,
        meta: markAsProcessed()
      });

      await ctx.sendGcode('G4 P0.1', {
        displayCommand: 'G4 P0.1 (AutoDustBoot - Delay)',
        meta: markAsProcessed()
      });

      await ctx.sendGcode(retractCommand, {
        displayCommand: `${retractCommand} (AutoDustBoot - Retract)`,
        meta: markAsProcessed()
      });

      await ctx.sendGcode(originalCommand, {
        displayCommand: originalCommand,
        meta: markAsProcessed()
      });
    }

    if (trimmedLine.includes('M6') && hasExpandRetract) {
      ctx.log(`M6 detected at line ${context.lineNumber}`);

      if (context.sourceId === 'job') {
        ctx.log('M6 from job source, sending retract and tracking tool change');

        await ctx.sendGcode(retractCommand, {
          displayCommand: `${retractCommand} (AutoDustBoot - Retract)`,
          meta: markAsProcessed()
        });

        isToolChanging = true;
        return line;
      } else {
        await sendExpandRetractSequence(line.trim());
        return null;
      }
    }

    if (isToolChanging && context.sourceId === 'job') {
      if (normalizedLine.startsWith(normalizedExpandCmd)) {
        ctx.log(`Skipping expand command: ${line.trim()}`);
        return `; ${line.trim()} (Skipped by AutoDustBoot)`;
      }

      const hasXMovement = /[^A-Z]X[-+]?\d+\.?\d*/i.test(line);
      const hasYMovement = /[^A-Z]Y[-+]?\d+\.?\d*/i.test(line);

      if (hasXMovement || hasYMovement) {
        ctx.log(`First XY movement after tool change at line ${context.lineNumber}`);

        isToolChanging = false;

        await ctx.sendGcode(line.trim(), {
          displayCommand: line.trim(),
          meta: markAsProcessed(context.meta)
        });

        await ctx.sendGcode(expandCommand, {
          displayCommand: `${expandCommand} (AutoDustBoot - Expand After XY)`,
          meta: markAsProcessed()
        });

        if (delayAfterExpand > 0) {
          await ctx.sendGcode(`G4 P${delayAfterExpand}`, {
            displayCommand: `G4 P${delayAfterExpand} (AutoDustBoot - Delay)`,
            meta: markAsProcessed()
          });
        }

        return null;
      }
    }

    if (trimmedLine.startsWith('$H') && hasExpandRetract && retractOnHome) {
      ctx.log(`Home command detected: ${line.trim()}`);
      await sendExpandRetractSequence(line.trim());
      return null;
    }

    if ((context.sourceId === 'client' || context.sourceId === 'macro') && hasExpandRetract && retractOnRapidMove) {
      const hasG0 = /\bG0\b/i.test(normalizedLine);
      if (hasG0) {
        ctx.log(`G0 from ${context.sourceId} detected: ${line.trim()}`);
        await sendExpandRetractSequence(line.trim());
        return null;
      }
    }

    return line;
  });

  ctx.registerEventHandler('onAfterJobEnd', async () => {
    ctx.log('Job ended, resetting tool change state');
    isToolChanging = false;
  });
}

export function onUnload() {
  console.log('[PLUGIN:com.ncsender.autodustboot] AutoDustBoot plugin unloaded');
  isToolChanging = false;
}
