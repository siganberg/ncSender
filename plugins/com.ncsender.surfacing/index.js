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

    // Show "Not available yet" message
    ctx.showDialog('Surfacing Operation', `
      <style>
        .placeholder-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 40px;
          text-align: center;
        }
        .placeholder-message {
          font-size: 1.1rem;
          color: var(--color-text-secondary, #666);
          margin: 0;
        }
        .button-group {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 32px;
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
      </style>

      <div class="placeholder-container">
        <p class="placeholder-message">Not available yet</p>
        <div class="button-group">
          <button class="btn btn-primary" onclick="window.parent.postMessage({type: 'close-plugin-dialog'}, '*')">Close</button>
        </div>
      </div>
    `);
  });

  // Register the Jointer tool in the Tools menu
  ctx.registerToolMenu('Jointer', async () => {
    ctx.log('Jointer tool clicked');

    // Show "Not available yet" message
    ctx.showDialog('Jointer Operation', `
      <style>
        .placeholder-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 40px;
          text-align: center;
        }
        .placeholder-message {
          font-size: 1.1rem;
          color: var(--color-text-secondary, #666);
          margin: 0;
        }
        .button-group {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 32px;
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
      </style>

      <div class="placeholder-container">
        <p class="placeholder-message">Not available yet</p>
        <div class="button-group">
          <button class="btn btn-primary" onclick="window.parent.postMessage({type: 'close-plugin-dialog'}, '*')">Close</button>
        </div>
      </div>
    `);
  });
}

export async function onUnload() {
  console.log('Surfacing plugin unloaded');
}
