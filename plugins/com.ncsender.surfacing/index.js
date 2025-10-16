/**
 * Surfacing Plugin
 * Generates G-code for surfacing operations (fly-cutting)
 */

function generateSurfacingGcode(params) {
  const {
    startX, startY,
    xDimension, yDimension,
    depthOfCut, targetDepth,
    bitDiameter, stepover,
    feedRate, spindleRpm,
    mistM7, floodM8
  } = params;

  // Calculate stepover distance based on percentage
  const stepoverDistance = (bitDiameter * stepover) / 100;

  // Calculate number of passes needed
  const numDepthPasses = Math.ceil(targetDepth / depthOfCut);
  const numXPasses = Math.ceil(xDimension / stepoverDistance) + 1;

  let gcode = [];

  // Header
  gcode.push('(Surfacing Operation)');
  gcode.push(`(Start: X${startX} Y${startY})`);
  gcode.push(`(Dimensions: ${xDimension} x ${yDimension})`);
  gcode.push(`(Bit Diameter: ${bitDiameter}mm, Stepover: ${stepover}%)`);
  gcode.push(`(Target Depth: ${targetDepth}mm in ${numDepthPasses} passes)`);
  gcode.push('');

  // Setup
  gcode.push('G21 ; Metric units');
  gcode.push('G90 ; Absolute positioning');
  gcode.push('G94 ; Feed rate per minute');
  gcode.push('');

  // Spindle and coolant
  if (spindleRpm > 0) {
    gcode.push(`M3 S${spindleRpm} ; Start spindle`);
  }
  if (mistM7) {
    gcode.push('M7 ; Mist coolant on');
  }
  if (floodM8) {
    gcode.push('M8 ; Flood coolant on');
  }
  gcode.push('');

  // Move to start position
  gcode.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} ; Move to start position`);
  gcode.push('G0 Z5.000 ; Move to safe height');
  gcode.push('');

  // Surfacing passes
  let currentDepth = 0;
  for (let depthPass = 0; depthPass < numDepthPasses; depthPass++) {
    currentDepth = Math.min(currentDepth + depthOfCut, targetDepth);

    gcode.push(`(Depth pass ${depthPass + 1}/${numDepthPasses} - Z${-currentDepth.toFixed(3)})`);
    gcode.push(`G1 Z${(-currentDepth).toFixed(3)} F${feedRate / 2} ; Plunge to depth`);

    let direction = 1; // 1 for positive Y, -1 for negative Y

    for (let xPass = 0; xPass < numXPasses; xPass++) {
      const xPos = startX + (xPass * stepoverDistance);

      // Move to X position (if not first pass)
      if (xPass > 0) {
        gcode.push(`G1 X${xPos.toFixed(3)} F${feedRate} ; Step over`);
      }

      // Cut along Y axis
      if (direction === 1) {
        gcode.push(`G1 Y${(startY + yDimension).toFixed(3)} F${feedRate}`);
      } else {
        gcode.push(`G1 Y${startY.toFixed(3)} F${feedRate}`);
      }

      direction *= -1; // Reverse direction for next pass
    }

    // Retract after each depth pass
    gcode.push('G0 Z5.000 ; Retract');
    gcode.push('');
  }

  // Return to start and shutdown
  gcode.push('G0 X0 Y0 ; Return to origin');
  if (mistM7) {
    gcode.push('M9 ; Coolant off');
  }
  if (floodM8) {
    gcode.push('M9 ; Coolant off');
  }
  if (spindleRpm > 0) {
    gcode.push('M5 ; Stop spindle');
  }
  gcode.push('M30 ; End program');

  return gcode.join('\n');
}

export async function onLoad(ctx) {
  ctx.log('Surfacing plugin loaded');

  // Listen for messages from the dialog
  ctx.registerEventHandler('message', async (data) => {
    if (data.type === 'surfacing-generate' && data.params) {
      ctx.log('Generating surfacing G-code with params:', JSON.stringify(data.params));

      try {
        // Save settings for next time
        ctx.setSettings(data.params);

        // Generate G-code
        const gcode = generateSurfacingGcode(data.params);

        // Send to client to display or load
        ctx.emitToClient('gcode-generated', {
          gcode,
          filename: `surfacing_${Date.now()}.gcode`
        });

        ctx.log('G-code generated successfully');
      } catch (error) {
        ctx.log('Error generating G-code:', error);
      }
    }
  });

  // Register the Surfacing tool in the Tools menu
  ctx.registerToolMenu('Surfacing', async () => {
    ctx.log('Surfacing tool clicked');

    // Load saved settings or use defaults
    const settings = ctx.getSettings();
    const defaults = {
      startX: settings.startX ?? 0,
      startY: settings.startY ?? 0,
      xDimension: settings.xDimension ?? 100,
      yDimension: settings.yDimension ?? 100,
      depthOfCut: settings.depthOfCut ?? 0.5,
      targetDepth: settings.targetDepth ?? 1.0,
      bitDiameter: settings.bitDiameter ?? 6.0,
      stepover: settings.stepover ?? 50,
      feedRate: settings.feedRate ?? 1000,
      spindleRpm: settings.spindleRpm ?? 10000,
      mistM7: settings.mistM7 ?? false,
      floodM8: settings.floodM8 ?? false
    };

    // Show surfacing dialog with input controls
    ctx.showDialog('Surfacing Operation', `
      <style>
        .surfacing-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          max-width: 500px;
        }
        .form-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .form-section h4 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          color: var(--color-text-primary, #333);
          border-bottom: 1px solid var(--color-border, #ddd);
          padding-bottom: 8px;
        }
        .form-group {
          display: grid;
          grid-template-columns: 150px 1fr;
          align-items: center;
          gap: 12px;
        }
        .form-group label {
          font-size: 0.9rem;
          color: var(--color-text-primary, #333);
        }
        .form-group input[type="number"] {
          padding: 8px 12px;
          border: 1px solid var(--color-border, #ddd);
          border-radius: 4px;
          font-size: 0.9rem;
          background: var(--color-surface, #fff);
          color: var(--color-text-primary, #333);
        }
        .form-group input[type="number"]:focus {
          outline: none;
          border-color: var(--color-accent, #4a90e2);
        }
        .toggle-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toggle-switch {
          position: relative;
          width: 44px;
          height: 24px;
          background: #ccc;
          border-radius: 12px;
          cursor: pointer;
          transition: background 0.3s;
        }
        .toggle-switch.active {
          background: var(--color-accent, #4a90e2);
        }
        .toggle-switch .toggle-handle {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform 0.3s;
        }
        .toggle-switch.active .toggle-handle {
          transform: translateX(20px);
        }
        .button-group {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid var(--color-border, #ddd);
        }
        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn:hover {
          opacity: 0.9;
        }
        .btn-primary {
          background: var(--color-accent, #4a90e2);
          color: white;
        }
        .btn-secondary {
          background: var(--color-surface-muted, #e0e0e0);
          color: var(--color-text-primary, #333);
        }
      </style>

      <div class="surfacing-form">
        <div class="form-section">
          <h4>Start Position</h4>
          <div class="form-group">
            <label>X Start</label>
            <input type="number" id="startX" value="${defaults.startX}" step="0.1" />
          </div>
          <div class="form-group">
            <label>Y Start</label>
            <input type="number" id="startY" value="${defaults.startY}" step="0.1" />
          </div>
        </div>

        <div class="form-section">
          <h4>Dimensions</h4>
          <div class="form-group">
            <label>X Dimension</label>
            <input type="number" id="xDimension" value="${defaults.xDimension}" step="0.1" min="0" />
          </div>
          <div class="form-group">
            <label>Y Dimension</label>
            <input type="number" id="yDimension" value="${defaults.yDimension}" step="0.1" min="0" />
          </div>
        </div>

        <div class="form-section">
          <h4>Cutting Parameters</h4>
          <div class="form-group">
            <label>Depth of Cut</label>
            <input type="number" id="depthOfCut" value="${defaults.depthOfCut}" step="0.1" min="0.01" />
          </div>
          <div class="form-group">
            <label>Target Depth</label>
            <input type="number" id="targetDepth" value="${defaults.targetDepth}" step="0.1" min="0.01" />
          </div>
          <div class="form-group">
            <label>Bit Diameter</label>
            <input type="number" id="bitDiameter" value="${defaults.bitDiameter}" step="0.1" min="0.1" />
          </div>
          <div class="form-group">
            <label>Stepover (%)</label>
            <input type="number" id="stepover" value="${defaults.stepover}" step="1" min="1" max="100" />
          </div>
        </div>

        <div class="form-section">
          <h4>Machine Settings</h4>
          <div class="form-group">
            <label>Feed Rate</label>
            <input type="number" id="feedRate" value="${defaults.feedRate}" step="10" min="1" />
          </div>
          <div class="form-group">
            <label>Spindle RPM</label>
            <input type="number" id="spindleRpm" value="${defaults.spindleRpm}" step="100" min="0" />
          </div>
        </div>

        <div class="form-section">
          <h4>Coolant Control</h4>
          <div class="form-group">
            <label>Mist (M7)</label>
            <div class="toggle-group">
              <div class="toggle-switch ${defaults.mistM7 ? 'active' : ''}" id="mistToggle" onclick="this.classList.toggle('active')">
                <div class="toggle-handle"></div>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>Flood (M8)</label>
            <div class="toggle-group">
              <div class="toggle-switch ${defaults.floodM8 ? 'active' : ''}" id="floodToggle" onclick="this.classList.toggle('active')">
                <div class="toggle-handle"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="button-group">
          <button class="btn btn-secondary" onclick="window.parent.postMessage({type: 'close-plugin-dialog'}, '*')">Cancel</button>
          <button class="btn btn-primary" onclick="generateSurfacingGcode()">Generate G-code</button>
        </div>
      </div>

      <script>
        function generateSurfacingGcode() {
          // Get all form values
          const params = {
            startX: parseFloat(document.getElementById('startX').value),
            startY: parseFloat(document.getElementById('startY').value),
            xDimension: parseFloat(document.getElementById('xDimension').value),
            yDimension: parseFloat(document.getElementById('yDimension').value),
            depthOfCut: parseFloat(document.getElementById('depthOfCut').value),
            targetDepth: parseFloat(document.getElementById('targetDepth').value),
            bitDiameter: parseFloat(document.getElementById('bitDiameter').value),
            stepover: parseFloat(document.getElementById('stepover').value),
            feedRate: parseFloat(document.getElementById('feedRate').value),
            spindleRpm: parseFloat(document.getElementById('spindleRpm').value),
            mistM7: document.getElementById('mistToggle').classList.contains('active'),
            floodM8: document.getElementById('floodToggle').classList.contains('active')
          };

          // Send to parent window (will be handled by plugin)
          window.parent.postMessage({
            type: 'surfacing-generate',
            params: params
          }, '*');

          // Close dialog
          window.parent.postMessage({type: 'close-plugin-dialog'}, '*');
        }
      </script>
    `);
  });
}

export async function onUnload() {
  console.log('Surfacing plugin unloaded');
}
