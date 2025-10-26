/**
 * Rapid Change ATC plugin
 * Provides quick access tooling workflow controls.
 */

const ALLOWED_COLLET_SIZES = ['ER11', 'ER16', 'ER20', 'ER25', 'ER32'];
const ALLOWED_MODELS = ['Basic', 'Pro', 'Premium'];
const ORIENTATIONS = ['X', 'Y'];
const DIRECTIONS = ['Positive', 'Negative'];

const clampPockets = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(parsed, 1), 8);
};

const clampSpindleDelay = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 10);
};

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
};

const sanitizeColletSize = (value) => (ALLOWED_COLLET_SIZES.includes(value) ? value : 'ER20');
const sanitizeModel = (value) => (ALLOWED_MODELS.includes(value) ? value : 'Pro');
const sanitizeOrientation = (value) => (ORIENTATIONS.includes(value) ? value : 'Y');
const sanitizeDirection = (value) => (DIRECTIONS.includes(value) ? value : 'Negative');
const sanitizeCoords = (coords = {}) => ({
  x: toFiniteNumber(coords.x),
  y: toFiniteNumber(coords.y)
});

const buildInitialConfig = (raw = {}) => ({
  // UI Settings
  colletSize: sanitizeColletSize(raw.colletSize ?? raw.model),
  pockets: clampPockets(raw.pockets),
  model: sanitizeModel(raw.model ?? raw.trip ?? raw.modelName ?? raw.machineModel),
  orientation: sanitizeOrientation(raw.orientation),
  direction: sanitizeDirection(raw.direction),
  showMacroCommand: raw.showMacroCommand ?? false,
  spindleDelay: clampSpindleDelay(raw.spindleDelay),

  // Position Settings
  pocket1: sanitizeCoords(raw.pocket1),
  toolSetter: sanitizeCoords(raw.toolSetter),
  manualTool: sanitizeCoords(raw.manualTool),
  pocketDistance: toFiniteNumber(raw.pocketDistance, 45),

  // Z-axis Settings
  zEngagement: toFiniteNumber(raw.zEngagement, -100),
  zSafe: toFiniteNumber(raw.zSafe, 0),
  zSpinOff: toFiniteNumber(raw.zSpinOff, 23),
  zRetreat: toFiniteNumber(raw.zRetreat, 7),
  zProbeStart: toFiniteNumber(raw.zProbeStart, -20),

  // Tool Change Settings
  unloadRpm: toFiniteNumber(raw.unloadRpm, 1500),
  loadRpm: toFiniteNumber(raw.loadRpm, 1200),
  engageFeedrate: toFiniteNumber(raw.engageFeedrate, 3500),

  // Tool Setter Settings
  seekDistance: toFiniteNumber(raw.seekDistance, 50),
  seekFeedrate: toFiniteNumber(raw.seekFeedrate, 800)
});

const resolveServerPort = (pluginSettings = {}, appSettings = {}) => {
  const appPort = Number.parseInt(appSettings?.senderPort, 10);
  if (Number.isFinite(appPort)) {
    return appPort;
  }

  const pluginPort = Number.parseInt(pluginSettings?.port, 10);
  if (Number.isFinite(pluginPort)) {
    return pluginPort;
  }

  return 8090;
};

// === Helper Functions ===

// Helper: Format G-code with proper indentation based on O-code control structures
function formatGCode(gcode) {
  const lines = gcode.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');

  const formatted = [];
  let indentLevel = 0;

  for (const line of lines) {
    const upperLine = line.toUpperCase();
    const isOCode = upperLine.startsWith('O');

    // Decrease indent for closing/else keywords
    if (isOCode && (
      upperLine.includes('ENDIF') ||
      upperLine.includes('ENDWHILE') ||
      upperLine.includes('ENDREPEAT') ||
      upperLine.includes('ENDSUB') ||
      upperLine.includes('ELSE')
    )) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Add line with current indentation
    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    // Increase indent for opening keywords
    if (isOCode && (
      upperLine.includes(' IF ') ||
      upperLine.includes(' WHILE ') ||
      upperLine.includes(' DO ') ||
      upperLine.includes('REPEAT') ||
      upperLine.includes(' SUB')
    )) {
      indentLevel++;
    }

    // Special case: ELSE also increases indent after being printed
    if (isOCode && upperLine.includes('ELSE') && !upperLine.includes('ELSEIF')) {
      indentLevel++;
    }
  }

  return formatted;
}

// Shared TLS routine generator
function createToolLengthSetRoutine(settings) {
  const gcode = `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${settings.toolSetter.x} Y${settings.toolSetter.y}
    G53 G0 Z${settings.zProbeStart}
    G43.1 Z0
    G38.2 G91 Z-${settings.seekDistance} F${settings.seekFeedrate}
    G0 G91 Z5
    G38.2 G91 Z-5 F250
    G91 G0 Z5
    G90
    #<_ofs_idx> = [#5220 * 20 + 5203]
    #<_cur_wcs_z_ofs> = #[#<_ofs_idx>]
    #<_rc_trigger_mach_z> = [#5063 + #<_cur_wcs_z_ofs>]
    G43.1 Z[#<_rc_trigger_mach_z>]
  `.trim();
  return gcode.split('\n');
}

function createToolLengthSetProgram(settings) {
  const tlsRoutine = createToolLengthSetRoutine(settings).join('\n');
  const gcode = `
    (Start of Tool Length Setter)
    #<return_units> = [20 + #<_metric>]
    G21
    ${tlsRoutine}
    G53 G0 Z${settings.zSafe}
    G[#<return_units>]
    (End of Tool Length Setter)
    (MSG, TOOL CHANGE COMPLETE)
  `.trim();
  return gcode.split('\n');
}

function handleTLSCommand(commands, settings, ctx) {
  const tlsIndex = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$TLS'
  );

  if (tlsIndex === -1) {
    return; // No $TLS command found
  }

  ctx.log('$TLS command detected, replacing with tool length setter routine');

  const tlsCommand = commands[tlsIndex];
  const toolLengthSetProgram = createToolLengthSetProgram(settings);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolLengthSetProgram.map((line, index) => {
    if (index === 0) {
      // First command - show $TLS if hiding macro, otherwise show actual command
      return {
        command: line,
        displayCommand: showMacroCommand ? null : tlsCommand.command.trim(),
        isOriginal: false
      };
    } else {
      // Rest of commands - hide if not showing macro
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(tlsIndex, 1, ...expandedCommands);
}

function handlePocket1Command(commands, settings, ctx) {
  const pocket1Index = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$POCKET1'
  );

  if (pocket1Index === -1) {
    return; // No $POCKET1 command found
  }

  ctx.log('$POCKET1 command detected, moving to pocket 1 position');

  const pocket1Command = commands[pocket1Index];
  const gcode = `
    G53 G21 G90 G0 Z${settings.zSafe}
    G53 G21 G90 G0 X${settings.pocket1.x} Y${settings.pocket1.y}
  `.trim();

  const pocket1Program = formatGCode(gcode);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = pocket1Program.map((line, index) => {
    if (index === 0) {
      return {
        command: line,
        displayCommand: showMacroCommand ? null : pocket1Command.command.trim(),
        isOriginal: false
      };
    } else {
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(pocket1Index, 1, ...expandedCommands);
}

function handleM6Command(commands, context, settings, ctx) {
  // Find original M6 command
  const m6Index = commands.findIndex(cmd => {
    if (!cmd.isOriginal) return false;
    const parsed = ctx.utils.parseM6Command(cmd.command);
    return parsed?.matched && parsed.toolNumber !== null;
  });

  if (m6Index === -1) {
    return; // No M6 found
  }

  const m6Command = commands[m6Index];
  const parsed = ctx.utils.parseM6Command(m6Command.command);

  if (!parsed?.matched || parsed.toolNumber === null) {
    return;
  }

  const toolNumber = parsed.toolNumber;
  const location = context.lineNumber !== undefined ? `at line ${context.lineNumber}` : `from ${context.sourceId}`;
  const currentTool = context.machineState?.tool ?? 0;

  ctx.log(`M6 detected with tool T${toolNumber} ${location}, current tool: T${currentTool}, executing tool change program`);

  const toolChangeProgram = buildToolChangeProgram(settings, currentTool, toolNumber);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolChangeProgram.map((line, index) => {
    if (index === 0) {
      // First command - show M6 if hiding macro, otherwise show actual command
      return {
        command: line,
        displayCommand: showMacroCommand ? null : m6Command.command.trim(),
        isOriginal: false
      };
    } else {
      // Rest of commands - hide if not showing macro
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(m6Index, 1, ...expandedCommands);
}

// Helper: Calculate pocket position based on tool number
function calculatePocketPosition(settings, toolNum) {
  if (toolNum <= 0) {
    return { x: settings.pocket1.x, y: settings.pocket1.y };
  }
  const direction = settings.direction === 'Negative' ? -1 : 1;
  const offset = (toolNum - 1) * settings.pocketDistance * direction;
  if (settings.orientation === 'Y') {
    return { x: settings.pocket1.x, y: settings.pocket1.y + offset };
  } else {
    return { x: settings.pocket1.x + offset, y: settings.pocket1.y };
  }
}

// Helper: Manual tool change fallback routine
function createManualToolFallback(settings) {
  return `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${settings.manualTool.x} Y${settings.manualTool.y}
    M0
  `.trim();
}

// Helper: Tool unload routine
function createToolUnload(settings) {
  const zone1 = settings.zEngagement + settings.zSpinOff;
  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    G65P6
    M4 S${settings.unloadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G65P6
    M5
    G53 G0 Z${zone1}
    G4 P0.2
  `.trim();
}

// Helper: Tool load routine
function createToolLoad(settings, tool) {
  const zone1 = settings.zEngagement + settings.zSpinOff;
  const zone2 = settings.zEngagement + 28;
  const manualFallback1 = createManualToolFallback(settings);
  const manualFallback2 = createManualToolFallback(settings);

  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    G65P6
    M3 S${settings.loadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G65P6
    M5
    G53 G0 Z${zone1}
    G4 P0.2
    o300 IF [#<_probe_state> EQ 0]
    ${manualFallback1}
    o300 ELSE
       G53 G0 Z${zone2}
       G4 P0.2
       o301 IF [#<_probe_state> EQ 1]
    ${manualFallback2}
       o301 ENDIF
    o300 ENDIF
    M61 Q${tool}
  `.trim();
}

// Build unload tool section
function buildUnloadTool(settings, currentTool, sourcePos) {
  if (currentTool === 0) {
    return '';
  }
  if (currentTool > settings.pockets) {
    return `
      G53 G0 Z${settings.zSafe}
      ${createManualToolFallback(settings)}
      M61 Q0
    `.trim();
  } else {
    return `
      G53 G0 Z${settings.zSafe}
      G53 G0 X${sourcePos.x} Y${sourcePos.y}
      ${createToolUnload(settings)}
      o100 IF [#<_probe_state> EQ 1]
        ${createToolUnload(settings)}
        o101 IF [#<_probe_state> EQ 1]
          ${createManualToolFallback(settings)}
        o101 ENDIF
      o100 ENDIF
      M61 Q0
    `.trim();
  }
}

// Build load tool section
function buildLoadTool(settings, toolNumber, targetPos, tlsRoutine) {
  if (toolNumber === 0) {
    return '';
  }

  if (toolNumber <= settings.pockets) {
    return `
      G53 G0 Z${settings.zSafe}
      G53 G0 X${targetPos.x} Y${targetPos.y}
      ${createToolLoad(settings, toolNumber)}
      ${tlsRoutine}
    `.trim();
  } else {
    return `
      G53 G0 Z${settings.zSafe}
      ${createManualToolFallback(settings)}
      M61 Q${toolNumber}
      ${tlsRoutine}
    `.trim();
  }
}

function buildToolChangeProgram(settings, currentTool, toolNumber) {
  // Calculate positions and prepare components
  const sourcePos = calculatePocketPosition(settings, currentTool);
  const targetPos = calculatePocketPosition(settings, toolNumber);
  const tlsRoutine = createToolLengthSetRoutine(settings).join('\n');

  // Build sections
  const spindleDelaySection = settings.spindleDelay > 0 ? `G4 P${settings.spindleDelay}` : '';
  const unloadSection = buildUnloadTool(settings, currentTool, sourcePos);
  const loadSection = buildLoadTool(settings, toolNumber, targetPos, tlsRoutine);

  // Assemble complete program
  const gcode = `
    (Start of RapidChangeATC Plugin Sequence)
    #<return_units> = [20 + #<_metric>]
    G21
    M5
    ${spindleDelaySection}
    ${unloadSection}
    ${loadSection}
    G53 G0 Z${settings.zSafe}
    G[#<return_units>]
    (End of RapidChangeATC Plugin Sequence)
    (MSG, TOOL CHANGE COMPLETE: T${toolNumber})
  `.trim();

  // Format G-code with proper indentation
  return formatGCode(gcode);
}

// === Plugin Lifecycle ===

export async function onLoad(ctx) {
  ctx.log('Rapid Change ATC plugin loaded');

  // Get current plugin settings and app settings
  const pluginSettings = ctx.getSettings() || {};
  const appSettings = ctx.getAppSettings() || {};

  // Check if plugin has been configured (has required settings)
  const isConfigured = pluginSettings.pocket1 && pluginSettings.pockets;

  // Sync tool count from plugin config to app settings
  const pocketCount = pluginSettings.pockets || 0;
  const currentToolSettings = appSettings.tool || {};

  // Set tool.source to indicate this plugin controls the tool count
  // and sync the count from the plugin's pocket configuration
  // Only enable manual and TLS tools if plugin is configured
  // Add small delay to avoid race condition with onUnload during hot reload
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const response = await fetch(`http://localhost:${resolveServerPort(pluginSettings, appSettings)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: {
          count: pocketCount,
          source: 'com.ncsender.rapidchangeatc',
          manual: isConfigured,
          tls: isConfigured
        }
      })
    });

    if (response.ok) {
      ctx.log(`Tool settings synchronized: count=${pocketCount}, manual=${isConfigured}, tls=${isConfigured} (source: com.ncsender.rapidchangeatc)`);
    } else {
      ctx.log(`Failed to sync tool settings: ${response.status}`);
    }
  } catch (error) {
    ctx.log('Failed to sync tool settings on plugin load:', error);
  }

  // NEW API: onBeforeCommand receives command array
  ctx.registerEventHandler('onBeforeCommand', async (commands, context) => {
    const rawSettings = ctx.getSettings() || {};

    // Skip command handling if plugin is not configured
    if (!rawSettings.pocket1 || !rawSettings.pockets) {
      ctx.log('Plugin not configured, skipping command handling');
      return commands;
    }

    const settings = buildInitialConfig(rawSettings);

    // Handle $TLS command
    handleTLSCommand(commands, settings, ctx);

    // Handle $POCKET1 command
    handlePocket1Command(commands, settings, ctx);

    // Handle M6 tool change command
    handleM6Command(commands, context, settings, ctx);

    return commands;
  });

  ctx.registerEventHandler('message', async (data) => {
    if (!data || data.action !== 'save') {
      return;
    }

    const payload = data.payload || {};
    const sanitized = buildInitialConfig(payload);
    const existing = ctx.getSettings() || {};
    const appSettings = ctx.getAppSettings() || {};
    const resolvedPort = resolveServerPort(existing, appSettings);

    ctx.setSettings({
      ...existing,
      ...sanitized,
      port: resolvedPort
    });

    ctx.log('Rapid Change ATC settings saved');
  });

  ctx.registerToolMenu('RapidChangeATC', async () => {
    ctx.log('RapidChangeATC tool opened');

    const storedSettings = ctx.getSettings() || {};
    const appSettings = ctx.getAppSettings() || {};
    const serverPort = resolveServerPort(storedSettings, appSettings);
    const initialConfig = buildInitialConfig(storedSettings);
    const initialConfigJson = JSON.stringify(initialConfig)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');

    ctx.showDialog(
      'Rapid Change ATC',
      /* html */ `
      <style>
        .rc-dialog-wrapper {
          display: grid;
          grid-template-rows: auto 1fr auto;
          overflow: hidden;
          width: 800px;
        }

        .rc-header {
          padding: 20px 30px;
        }

        .rc-content {
          overflow-y: auto;
          padding: 30px;
          padding-top: 0;
        }

        .rc-container {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 24px;
        }

        .rc-left-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rc-right-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rc-form-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }

        .rc-form-row-wide {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 48px;
        }

        .rc-form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rc-form-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .rc-select,
        .rc-input {
          padding: 8px 12px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          background: var(--color-surface);
          color: var(--color-text-primary);
          font-size: 0.9rem;
          text-align: right;
        }

        .rc-select:focus,
        .rc-input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .rc-select {
          text-align-last: right;
        }

        .rc-radio-group {
          display: flex;
          gap: 16px;
        }

        .rc-right-panel > nc-step-control {
          align-self: center;
        }

        .rc-radio-label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          color: var(--color-text-primary);
        }

        .rc-toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
        }

        .rc-toggle-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .toggle-switch {
          position: relative;
          width: 50px;
          height: 28px;
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
          color: var(--color-text-secondary);
          margin-top: 6px;
          line-height: 1.4;
        }

        .rc-coordinate-group {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .rc-coord-label-inline {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--color-text-secondary);
        }

        .rc-button {
          border-radius: var(--radius-small);
          border: 1px solid var(--color-accent);
          background: var(--color-accent);
          color: var(--color-surface);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: filter 0.15s ease;
        }

        .rc-button-grab {
          padding: 6px 16px !important;
        }

        .rc-button-auto-calibrate {
          width: 200px;
          padding: 10px 16px;
          margin: 0 auto;
        }

        .rc-button:hover {
          filter: brightness(0.95);
        }

        .rc-button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }

        .rc-button.rc-button-busy,
        .rc-button:disabled {
          filter: none;
          opacity: 0.7;
          cursor: progress;
        }

        .rc-instructions {
          margin: 0;
          color: var(--color-text-secondary);
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .rc-footer {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 16px 30px;
          border-top: 1px solid var(--color-border);
          background: var(--color-surface);
        }

        .rc-button-secondary {
          background: var(--color-surface-muted);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .rc-button-secondary:hover {
          background: var(--color-surface);
          filter: none;
        }
      </style>

      <div class="rc-dialog-wrapper">
        <div class="rc-header">
          <p class="rc-instructions">
            With the collet, nut, and bit installed on the spindle, position the spindle over Pocket 1 of the magazine. Use the Jog controls to lower it and fine-tune the position until the nut is just inside Pocket 1. Manually rotate the spindle to ensure nothing is rubbing. Once everything is centered, click Auto Calibrate.
          </p>
        </div>

        <div class="rc-content">
          <div class="rc-container">
            <!-- Left Panel: Form Controls -->
        <div class="rc-left-panel">
          <div class="rc-form-row">
            <div class="rc-form-group">
              <label class="rc-form-label">Collet Size</label>
              <select class="rc-select" id="rc-collet-size">
                <option value="ER11" disabled>ER11</option>
                <option value="ER16" disabled>ER16</option>
                <option value="ER20" selected>ER20</option>
                <option value="ER25" disabled>ER25</option>
                <option value="ER32" disabled>ER32</option>
              </select>
            </div>

            <div class="rc-form-group">
              <label class="rc-form-label">Pocket Size</label>
              <select class="rc-select" id="rc-pockets">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6" selected>6</option>
                <option value="7">7</option>
                <option value="8">8</option>
              </select>
            </div>

            <div class="rc-form-group">
              <label class="rc-form-label">Model</label>
              <select class="rc-select" id="rc-model-select">
                <option value="Basic" disabled>Basic</option>
                <option value="Pro" selected>Pro</option>
                <option value="Premium" disabled>Premium</option>
              </select>
            </div>
          </div>

          <div class="rc-form-row-wide">
            <div class="rc-form-group">
              <label class="rc-form-label">Orientation</label>
              <div class="rc-radio-group">
                <label class="rc-radio-label">
                  <input type="radio" name="orientation" value="Y" checked>
                  Y
                </label>
                <label class="rc-radio-label">
                  <input type="radio" name="orientation" value="X">
                  X
                </label>
              </div>
            </div>

            <div class="rc-form-group">
              <label class="rc-form-label">Direction (Pocket 1 → 2)</label>
              <div class="rc-radio-group">
                <label class="rc-radio-label">
                  <input type="radio" name="direction" value="Negative" checked>
                  Negative
                </label>
                <label class="rc-radio-label">
                  <input type="radio" name="direction" value="Positive">
                  Positive
                </label>
              </div>
            </div>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Pocket 1 Coordinates</label>
            <div class="rc-coordinate-group">
              <label class="rc-coord-label-inline" for="rc-pocket1-x">X</label>
              <input type="number" class="rc-input" id="rc-pocket1-x" value="0" step="0.001">
              <label class="rc-coord-label-inline" for="rc-pocket1-y">Y</label>
              <input type="number" class="rc-input" id="rc-pocket1-y" value="0" step="0.001">
              <button type="button" class="rc-button rc-button-grab" id="rc-pocket1-grab">Grab</button>
            </div>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Tool Setter Coordinates</label>
            <div class="rc-coordinate-group">
              <label class="rc-coord-label-inline" for="rc-toolsetter-x">X</label>
              <input type="number" class="rc-input" id="rc-toolsetter-x" value="0" step="0.001">
              <label class="rc-coord-label-inline" for="rc-toolsetter-y">Y</label>
              <input type="number" class="rc-input" id="rc-toolsetter-y" value="0" step="0.001">
              <button type="button" class="rc-button rc-button-grab" id="rc-toolsetter-grab">Grab</button>
            </div>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Manual Tool Coordinates</label>
            <div class="rc-coordinate-group">
              <label class="rc-coord-label-inline" for="rc-manualtool-x">X</label>
              <input type="number" class="rc-input" id="rc-manualtool-x" value="0" step="0.001">
              <label class="rc-coord-label-inline" for="rc-manualtool-y">Y</label>
              <input type="number" class="rc-input" id="rc-manualtool-y" value="0" step="0.001">
              <button type="button" class="rc-button rc-button-grab" id="rc-manualtool-grab">Grab</button>
            </div>
          </div>

          <div class="rc-form-row-wide">
            <div class="rc-form-group">
              <label class="rc-form-label">Spindle Delay (seconds)</label>
              <input type="number" class="rc-input" id="rc-spindle-delay" value="0" min="0" max="10" step="1">
            </div>

            <div class="rc-form-group">
              <label class="rc-form-label">Z Engagement</label>
              <div class="rc-coordinate-group" style="grid-template-columns: 1fr auto;">
                <input type="number" class="rc-input" id="rc-zengagement" value="-100" step="0.001">
                <button type="button" class="rc-button rc-button-grab" id="rc-zengagement-grab">Grab</button>
              </div>
            </div>
          </div>

        </div>

            <!-- Right Panel: Jog Controls -->
            <div class="rc-right-panel">
              <nc-step-control></nc-step-control>
              <nc-jog-control></nc-jog-control>
              <button type="button" class="rc-button rc-button-auto-calibrate" id="rc-auto-calibrate-btn">Auto Calibrate</button>
              <div class="rc-toggle-row">
                <label class="rc-toggle-label">Show Macro Command</label>
                <label class="toggle-switch">
                  <input type="checkbox" id="rc-show-macro-command">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="rc-footer">
          <button type="button" class="rc-button rc-button-secondary" id="rc-close-btn">Close</button>
          <button type="button" class="rc-button" id="rc-save-btn">Save</button>
        </div>
      </div>
      <script>
        (function() {
          const POCKET_PREFIX = 'pocket1';
          const TOOL_SETTER_PREFIX = 'toolsetter';
          const MANUAL_TOOL_PREFIX = 'manualtool';
          const STATUS_ENDPOINTS = ['/api/server-state'];
          const FALLBACK_PORT = ${serverPort};
          const initialConfig = ${initialConfigJson};

          const resolveApiBaseUrl = () => {
            if (window.ncSender && typeof window.ncSender.getApiBaseUrl === 'function') {
              return window.ncSender.getApiBaseUrl(FALLBACK_PORT);
            }
            return 'http://localhost:' + FALLBACK_PORT;
          };

          const BASE_URL = resolveApiBaseUrl();

          const getInput = (id) => document.getElementById(id);

          const formatCoordinate = (value) => (
            Number.isFinite(value) ? value.toFixed(3) : ''
          );

          const parseCoordinateString = (raw) => {
            if (typeof raw === 'string' && raw.length > 0) {
              const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
              if (parts.length >= 2 && parts.every(Number.isFinite)) {
                return { x: parts[0], y: parts[1], z: parts[2] };
              }
            }
            if (Array.isArray(raw) && raw.length >= 2) {
              const [x, y, z] = raw;
              if ([x, y].every(Number.isFinite)) {
                return { x, y, z };
              }
            }
            if (raw && typeof raw === 'object') {
              const { x, y, z } = raw;
              if ([x, y].every(Number.isFinite)) {
                return { x, y, z };
              }
            }
            return null;
          };

          const extractCoordinatesFromPayload = (payload) => {
            if (!payload || typeof payload !== 'object') {
              return null;
            }

            const nestedKeys = ['machineState', 'lastStatus', 'statusReport'];
            for (let i = 0; i < nestedKeys.length; i += 1) {
              const key = nestedKeys[i];
              if (payload[key] && typeof payload[key] === 'object') {
                const nestedCoords = extractCoordinatesFromPayload(payload[key]);
                if (nestedCoords) {
                  return nestedCoords;
                }
              }
            }

            const candidates = [
              payload.machineCoords,
              payload.MPos,
              payload.MPOS,
              payload.mpos,
              payload.machinePosition
            ];

            for (let i = 0; i < candidates.length; i += 1) {
              const coords = parseCoordinateString(candidates[i]);
              if (coords) {
                return coords;
              }
            }

            return null;
          };

          const fetchMachineCoordinates = async () => {
            for (let i = 0; i < STATUS_ENDPOINTS.length; i += 1) {
              const endpoint = STATUS_ENDPOINTS[i];
              const url = BASE_URL + endpoint;
              try {
                const response = await fetch(url);
                if (!response.ok) {
                  console.warn('[RapidChangeATC] Endpoint ' + url + ' responded with status ' + response.status);
                  continue;
                }

                const payload = await response.json();
                const coords = extractCoordinatesFromPayload(payload);
                if (coords) {
                  return coords;
                }
              } catch (error) {
                console.warn('[RapidChangeATC] Failed to read endpoint ' + url + ':', error);
              }
            }

            return null;
          };

          const setCoordinateInputs = (prefix, coords) => {
            if (!coords) return;
            const xInput = getInput('rc-' + prefix + '-x');
            const yInput = getInput('rc-' + prefix + '-y');

            if (xInput) {
              xInput.value = formatCoordinate(coords.x ?? Number.NaN);
            }
            if (yInput) {
              yInput.value = formatCoordinate(coords.y ?? Number.NaN);
            }
          };

          const setRadioValue = (name, value) => {
            const radios = document.querySelectorAll('input[name="' + name + '"]');
            radios.forEach(function(radio) {
              radio.checked = radio.value === value;
            });
          };

          const getRadioValue = (name) => {
            const selected = document.querySelector('input[name="' + name + '"]:checked');
            return selected ? selected.value : null;
          };

          const applyInitialSettings = () => {
            const colletSelect = getInput('rc-collet-size');
            if (colletSelect && initialConfig.colletSize) {
              colletSelect.value = initialConfig.colletSize;
            }

            const pocketsSelect = getInput('rc-pockets');
            if (pocketsSelect && initialConfig.pockets) {
              pocketsSelect.value = String(initialConfig.pockets);
            }

            const modelSelect = getInput('rc-model-select');
            if (modelSelect && initialConfig.model) {
              modelSelect.value = initialConfig.model;
            }

            setRadioValue('orientation', initialConfig.orientation);
            setRadioValue('direction', initialConfig.direction);
            setCoordinateInputs(POCKET_PREFIX, initialConfig.pocket1);
            setCoordinateInputs(TOOL_SETTER_PREFIX, initialConfig.toolSetter);
            setCoordinateInputs(MANUAL_TOOL_PREFIX, initialConfig.manualTool);

            const spindleDelayInput = getInput('rc-spindle-delay');
            if (spindleDelayInput) {
              spindleDelayInput.value = String(initialConfig.spindleDelay ?? 0);
            }

            const zEngagementInput = getInput('rc-zengagement');
            if (zEngagementInput) {
              zEngagementInput.value = formatCoordinate(initialConfig.zEngagement ?? -100);
            }

            const showMacroCommandCheck = getInput('rc-show-macro-command');
            if (showMacroCommandCheck) {
              showMacroCommandCheck.checked = !!initialConfig.showMacroCommand;
            }
          };

          const notifyError = (message) => {
            console.warn('[RapidChangeATC] ' + message);
            window.alert(message);
          };

          const grabCoordinates = async (prefix) => {
            try {
              const coords = await fetchMachineCoordinates();

              if (!coords) {
                notifyError('Unable to determine machine coordinates. Ensure the machine is connected and reporting status.');
                return;
              }

              setCoordinateInputs(prefix, coords);
            } catch (error) {
              console.error('[RapidChangeATC] Failed to grab machine coordinates:', error);
              notifyError('Failed to read machine coordinates. Please try again.');
            }
          };

          const grabZCoordinate = async (inputId) => {
            try {
              const coords = await fetchMachineCoordinates();

              if (!coords) {
                notifyError('Unable to determine machine coordinates. Ensure the machine is connected and reporting status.');
                return;
              }

              const input = getInput(inputId);
              if (input && coords.z !== undefined) {
                input.value = formatCoordinate(coords.z);
              }
            } catch (error) {
              console.error('[RapidChangeATC] Failed to grab Z coordinate:', error);
              notifyError('Failed to read machine coordinates. Please try again.');
            }
          };

          const registerButton = (prefix, buttonId) => {
            const button = getInput(buttonId);
            if (!button) return;

            button.addEventListener('click', () => {
              if (button.disabled) {
                return;
              }

              button.disabled = true;
              button.classList.add('rc-button-busy');

              grabCoordinates(prefix).finally(() => {
                button.disabled = false;
                button.classList.remove('rc-button-busy');
              });
            });
          };

          const getParseFloat = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const getParseInt = (value) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const gatherFormData = () => {
            const colletSelect = getInput('rc-collet-size');
            const pocketsSelect = getInput('rc-pockets');
            const modelSelect = getInput('rc-model-select');
            const pocket1X = getInput('rc-pocket1-x');
            const pocket1Y = getInput('rc-pocket1-y');
            const toolSetterX = getInput('rc-toolsetter-x');
            const toolSetterY = getInput('rc-toolsetter-y');
            const manualToolX = getInput('rc-manualtool-x');
            const manualToolY = getInput('rc-manualtool-y');
            const spindleDelayInput = getInput('rc-spindle-delay');
            const zEngagementInput = getInput('rc-zengagement');
            const showMacroCommandCheck = getInput('rc-show-macro-command');

            return {
              colletSize: colletSelect ? colletSelect.value : null,
              pockets: pocketsSelect ? getParseInt(pocketsSelect.value) : null,
              model: modelSelect ? modelSelect.value : null,
              orientation: getRadioValue('orientation'),
              direction: getRadioValue('direction'),
              showMacroCommand: showMacroCommandCheck ? showMacroCommandCheck.checked : false,
              spindleDelay: spindleDelayInput ? getParseInt(spindleDelayInput.value) : 0,
              zEngagement: zEngagementInput ? getParseFloat(zEngagementInput.value) : -100,
              pocket1: {
                x: pocket1X ? getParseFloat(pocket1X.value) : null,
                y: pocket1Y ? getParseFloat(pocket1Y.value) : null
              },
              toolSetter: {
                x: toolSetterX ? getParseFloat(toolSetterX.value) : null,
                y: toolSetterY ? getParseFloat(toolSetterY.value) : null
              },
              manualTool: {
                x: manualToolX ? getParseFloat(manualToolX.value) : null,
                y: manualToolY ? getParseFloat(manualToolY.value) : null
              }
            };
          };

          const closeButton = getInput('rc-close-btn');
          if (closeButton) {
            closeButton.addEventListener('click', function() {
              window.postMessage({ type: 'close-plugin-dialog' }, '*');
            });
          }

          const saveButton = getInput('rc-save-btn');
          if (saveButton) {
            saveButton.addEventListener('click', async function() {
              if (saveButton.disabled) {
                return;
              }

              saveButton.disabled = true;
              saveButton.classList.add('rc-button-busy');

              const payload = gatherFormData();

              try {
                const pluginResponse = await fetch(BASE_URL + '/api/plugins/com.ncsender.rapidchangeatc/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });

                if (!pluginResponse.ok) {
                  throw new Error('Failed to save plugin settings: ' + pluginResponse.status);
                }

                const toolCount = payload.pockets || 0;
                const settingsResponse = await fetch(BASE_URL + '/api/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: {
                      count: toolCount,
                      source: 'com.ncsender.rapidchangeatc',
                      manual: true,
                      tls: true
                    }
                  })
                });

                if (!settingsResponse.ok) {
                  throw new Error('Failed to update tool.count setting: ' + settingsResponse.status);
                }

                setTimeout(function() {
                  saveButton.disabled = false;
                  saveButton.classList.remove('rc-button-busy');
                  window.postMessage({ type: 'close-plugin-dialog' }, '*');
                }, 150);
              } catch (error) {
                console.error('[RapidChangeATC] Failed to save settings:', error);
                notifyError('Failed to save settings. Please try again.');
                saveButton.disabled = false;
                saveButton.classList.remove('rc-button-busy');
              }
            });
          }

          // Register Z Engagement grab button
          const zEngagementButton = getInput('rc-zengagement-grab');
          if (zEngagementButton) {
            zEngagementButton.addEventListener('click', () => {
              if (zEngagementButton.disabled) {
                return;
              }

              zEngagementButton.disabled = true;
              zEngagementButton.classList.add('rc-button-busy');

              grabZCoordinate('rc-zengagement').finally(() => {
                zEngagementButton.disabled = false;
                zEngagementButton.classList.remove('rc-button-busy');
              });
            });
          }

          applyInitialSettings();
          registerButton(POCKET_PREFIX, 'rc-pocket1-grab');
          registerButton(TOOL_SETTER_PREFIX, 'rc-toolsetter-grab');
          registerButton(MANUAL_TOOL_PREFIX, 'rc-manualtool-grab');
        })();
      </script>
    `,
      { size: 'large' }
    );
  }, {
    icon: 'logo.png'
  });
}

export async function onUnload(ctx) {
  ctx.log('Rapid Change ATC plugin unloading');

  // Reset tool.source and tool.count to give control back to Settings > General
  const pluginSettings = ctx.getSettings() || {};
  const appSettings = ctx.getAppSettings() || {};

  try {
    const response = await fetch(`http://localhost:${resolveServerPort(pluginSettings, appSettings)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: {
          source: null,
          count: 0,
          manual: false,
          tls: false
        }
      })
    });

    if (response.ok) {
      ctx.log('Tool settings reset: count=0, manual=false, tls=false, source=null');
    } else {
      ctx.log(`Failed to reset tool settings: ${response.status}`);
    }
  } catch (error) {
    ctx.log('Failed to reset tool settings on plugin unload:', error);
  }
}
