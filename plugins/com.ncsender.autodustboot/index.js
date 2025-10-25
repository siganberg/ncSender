import { parseM6Command } from '../../app/electron/utils/gcode-patterns.js';

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
            await fetch('/api/plugins/com.ncsender.autodustboot/settings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            });
          } catch (error) {
            console.error('Failed to save settings:', error);
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

  // NEW API: onBeforeCommand receives command array
  ctx.registerEventHandler('onBeforeCommand', async (commands, context) => {
    const settings = ctx.getSettings();
    const expandCommand = settings.expandCommand || 'M8';
    const retractCommand = settings.retractCommand || 'M9';
    const delayAfterExpand = settings.delayAfterExpand !== undefined ? settings.delayAfterExpand : 1;
    const retractOnHome = settings.retractOnHome !== undefined ? settings.retractOnHome : true;
    const retractOnRapidMove = settings.retractOnRapidMove !== undefined ? settings.retractOnRapidMove : true;

    const hasExpandRetract = expandCommand && retractCommand;
    if (!hasExpandRetract) {
      return commands; // No configuration, pass through
    }

    // Helper to create expand/retract sequence as a single multi-line command
    function createExpandRetractSequence(includeExpand = true) {
      const sequence = ['(Start of AutoDustBoot Plugin Sequence)'];

      if (includeExpand) {
        sequence.push(expandCommand);
        sequence.push('G4 P0.1');
      }

      sequence.push(retractCommand);
      sequence.push('(End of AutoDustBoot Plugin Sequence)');

      // Return single command object with multi-line command string
      // displayCommand is null to show the first line in terminal
      return {
        command: sequence.join('\n'),
        displayCommand: null
      };
    }

    // Find original M6 command
    const m6Index = commands.findIndex(cmd => {
      if (!cmd.isOriginal) return false;
      const parsed = parseM6Command(cmd.command);
      return parsed?.matched && parsed.toolNumber !== null;
    });

    if (m6Index !== -1) {
      const parsed = parseM6Command(commands[m6Index].command);
      const toolNumber = parsed?.toolNumber;

      // Only process if we have a valid tool number
      if (toolNumber !== null && Number.isFinite(toolNumber)) {
        const location = context.lineNumber !== undefined
          ? `at line ${context.lineNumber}`
          : `from ${context.sourceId}`;
        ctx.log(`M6 tool change detected with T${toolNumber} ${location}`);

        if (context.sourceId === 'job') {
          ctx.log('M6 from job source, tracking tool change');
          isToolChanging = true;
          // Insert retract sequence before M6
          const sequence = createExpandRetractSequence(false);
          commands.splice(m6Index, 0, sequence);
          return commands;
        } else {
          // Client/macro source - full expand/retract sequence
          const sequence = createExpandRetractSequence(true);
          commands.splice(m6Index, 0, sequence);
          return commands;
        }
      }
    }

    // Handle job post-tool-change expansion
    if (isToolChanging && context.sourceId === 'job') {
      const normalizedExpandCmd = expandCommand.toUpperCase().replace(/([GM])0+(\d)/g, '$1$2');

      // Skip expand command from G-code (we'll inject it ourselves)
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const normalizedLine = cmd.command.toUpperCase().replace(/([GM])0+(\d)/g, '$1$2');

        if (normalizedLine.startsWith(normalizedExpandCmd)) {
          ctx.log(`Skipping expand command: ${cmd.command.trim()}`);
          cmd.command = `; ${cmd.command.trim()} (Skipped by AutoDustBoot)`;
          continue;
        }

        // Check for first XY movement
        const hasXMovement = /[^A-Z]X[-+]?\d+\.?\d*/i.test(cmd.command);
        const hasYMovement = /[^A-Z]Y[-+]?\d+\.?\d*/i.test(cmd.command);

        if (cmd.isOriginal && (hasXMovement || hasYMovement)) {
          ctx.log(`First XY movement after tool change at line ${context.lineNumber}`);
          isToolChanging = false;

          // Insert expand command and delay after this XY movement as a single multi-line command
          const expandLines = [expandCommand];

          if (delayAfterExpand > 0) {
            expandLines.push(`G4 P${delayAfterExpand}`);
          }

          const expandSequence = {
            command: expandLines.join('\n'),
            displayCommand: null
          };
          commands.splice(i + 1, 0, expandSequence);
          return commands;
        }
      }
    }

    // Handle $H home command
    const homeIndex = commands.findIndex(cmd =>
      cmd.isOriginal && cmd.command.trim().toUpperCase().startsWith('$H')
    );

    if (homeIndex !== -1 && retractOnHome) {
      ctx.log(`Home command detected: ${commands[homeIndex].command.trim()}`);
      const sequence = createExpandRetractSequence(true);
      commands.splice(homeIndex, 0, sequence);
      return commands;
    }

    // Handle G0 rapid move (client/macro only)
    if ((context.sourceId === 'client' || context.sourceId === 'macro') && retractOnRapidMove) {
      const g0Index = commands.findIndex(cmd => {
        const normalized = cmd.command.toUpperCase().replace(/([GM])0+(\d)/g, '$1$2');
        const hasG0 = /\bG0\b/i.test(normalized);
        return cmd.isOriginal && hasG0;
      });

      if (g0Index !== -1) {
        ctx.log(`G0 command from ${context.sourceId} detected: ${commands[g0Index].command.trim()}`);
        const sequence = createExpandRetractSequence(true);
        commands.splice(g0Index, 0, sequence);
        return commands;
      }
    }

    return commands;
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
