/**
 * Surfacing Plugin
 * Generates G-code for surfacing operations (fly-cutting)
 */

export async function onLoad(ctx) {
  ctx.log('Surfacing plugin loaded');

  // Register the Surfacing tool in the Tools menu
  ctx.registerToolMenu('Surfacing', async () => {
    ctx.log('Surfacing tool clicked');

    // Get app settings to determine units
    const appSettings = ctx.getAppSettings();
    const unitsPreference = appSettings.unitsPreference || 'metric';
    const isImperial = unitsPreference === 'imperial';

    // Unit labels
    const distanceUnit = isImperial ? 'in' : 'mm';
    const feedRateUnit = isImperial ? 'in/min' : 'mm/min';

    // Conversion factor
    const MM_TO_INCH = 0.0393701;

    // Get saved settings from server or use defaults (always stored in metric)
    const savedSettings = ctx.getSettings() || {};
    const defaultPatternType = savedSettings.patternType ?? (savedSettings.invertOrientation ? 'zigzagX' : 'zigzagY');

    // Convert from metric to imperial if needed for display
    const convertToDisplay = (value) => isImperial ? parseFloat((value * MM_TO_INCH).toFixed(4)) : value;

    const settings = {
      xDimension: convertToDisplay(savedSettings.xDimension ?? 100),
      yDimension: convertToDisplay(savedSettings.yDimension ?? 100),
      depthOfCut: convertToDisplay(savedSettings.depthOfCut ?? 0.5),
      targetDepth: convertToDisplay(savedSettings.targetDepth ?? 0.5),
      bitDiameter: convertToDisplay(savedSettings.bitDiameter ?? 25.4),
      stepover: savedSettings.stepover ?? 80,
      feedRate: convertToDisplay(savedSettings.feedRate ?? 2000),
      spindleRpm: savedSettings.spindleRpm ?? 15000,
      patternType: defaultPatternType,
      mistM7: savedSettings.mistM7 ?? false,
      floodM8: savedSettings.floodM8 ?? false
    };

    ctx.showDialog('Surfacing Operation', `
      <style>
        .surfacing-layout {
          display: flex;
          flex-direction: column;
          max-width: 460px;
          width: 100%;
        }
        .form-column {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .plugin-dialog-footer {
          grid-column: 1 / -1;
          padding: 16px 20px;
          border-top: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .form-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        .form-row.coolant-row {
          grid-template-columns: 1fr;
          display: flex;
          align-items: center;
          gap: 0;
        }
        .coolant-label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--color-text-primary);
          flex-shrink: 0;
        }
        .coolant-controls {
          flex: 1;
          display: flex;
          gap: 24px;
          justify-content: flex-end;
        }
        .form-group {
          display: flex;
          flex-direction: column;
        }
        label {
          font-size: 0.85rem;
          font-weight: 500;
          margin-bottom: 4px;
          color: var(--color-text-primary);
        }
        input[type="number"] {
          padding: 8px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          font-size: 0.9rem;
          background: var(--color-surface);
          color: var(--color-text-primary);
        }
        input[type="number"]:focus {
          outline: none;
          border-color: var(--color-accent);
        }
        .toggle-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toggle-group label {
          margin: 0;
          cursor: pointer;
          font-weight: 400;
          font-size: 0.85rem;
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
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
          background-color: var(--color-surface-muted);
          border: 1px solid var(--color-border);
          transition: 0.3s;
          border-radius: 24px;
        }
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 3px;
          bottom: 3px;
          background-color: var(--color-text-primary);
          transition: 0.3s;
          border-radius: 50%;
        }
        input:checked + .toggle-slider {
          background-color: var(--color-accent);
          border-color: var(--color-accent);
        }
        input:checked + .toggle-slider:before {
          transform: translateX(20px);
          background-color: white;
        }
        .orientation-row {
          grid-template-columns: 1fr;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }
        .orientation-label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--color-text-primary);
        }
        .orientation-select {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          background: var(--color-surface);
          color: var(--color-text-primary);
          font-size: 0.9rem;
        }
        .orientation-select:focus {
          outline: none;
          border-color: var(--color-accent);
        }
        .button-group {
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: var(--radius-small);
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn:hover {
          opacity: 0.9;
        }
        .btn-secondary {
          background: var(--color-surface-muted);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }
        .btn-primary {
          background: var(--color-accent);
          color: white;
        }
      </style>

      <div class="surfacing-layout">
        <div class="form-column">
          <form id="surfacingForm" novalidate>
            <div class="form-section">
              <div class="form-row orientation-row">
                <label class="orientation-label" for="patternType">Direction</label>
                <select id="patternType" class="orientation-select">
                  <option value="zigzagX" ${settings.patternType === 'zigzagX' ? 'selected' : ''}>Horizontal</option>
                  <option value="zigzagY" ${settings.patternType === 'zigzagY' ? 'selected' : ''}>Vertical</option>
                  <option value="spiral" ${settings.patternType === 'spiral' ? 'selected' : ''}>Spiral</option>
                </select>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="xDimension">X Dimension (${distanceUnit})</label>
                  <input type="number" id="xDimension" step="0.1" value="${settings.xDimension}">
                </div>
                <div class="form-group">
                  <label for="yDimension">Y Dimension (${distanceUnit})</label>
                  <input type="number" id="yDimension" step="0.1" value="${settings.yDimension}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="depthOfCut">Depth of Cut (${distanceUnit})</label>
                  <input type="number" id="depthOfCut" step="0.1" value="${settings.depthOfCut}">
                </div>
                <div class="form-group">
                  <label for="targetDepth">Target Depth (${distanceUnit})</label>
                  <input type="number" id="targetDepth" step="0.1" value="${settings.targetDepth}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="bitDiameter">Bit Diameter (${distanceUnit})</label>
                  <input type="number" id="bitDiameter" step="0.1" value="${settings.bitDiameter}">
                </div>
                <div class="form-group">
                  <label for="stepover">Stepover (%)</label>
                  <input type="number" id="stepover" step="1" value="${settings.stepover}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="feedRate">Feed Rate (${feedRateUnit})</label>
                  <input type="number" id="feedRate" step="1" value="${settings.feedRate}">
                </div>
                <div class="form-group">
                  <label for="spindleRpm">Spindle RPM</label>
                  <input type="number" id="spindleRpm" step="1" value="${settings.spindleRpm}">
                </div>
              </div>
              <div class="form-row coolant-row">
                <div class="coolant-label">Coolant</div>
                <div class="coolant-controls">
                  <div class="toggle-group">
                    <label for="floodM8">Flood</label>
                    <label class="toggle-switch">
                      <input type="checkbox" id="floodM8" ${settings.floodM8 ? 'checked' : ''}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-group">
                    <label for="mistM7">Mist</label>
                    <label class="toggle-switch">
                      <input type="checkbox" id="mistM7" ${settings.mistM7 ? 'checked' : ''}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div class="plugin-dialog-footer">
        <div class="button-group">
          <button type="button" class="btn btn-secondary" onclick="window.postMessage({type: 'close-plugin-dialog'}, '*')">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="document.getElementById('surfacingForm').requestSubmit()">Generate G-code</button>
        </div>
      </div>

      <script>
        (function() {
          // Units configuration
          const isImperial = ${isImperial};
          const INCH_TO_MM = 25.4;

          // Validation configuration (adjusted for imperial when needed)
          const validationRules = isImperial ? {
            xDimension: { min: 0.5, max: Infinity, label: 'X Dimension' },
            yDimension: { min: 0.5, max: Infinity, label: 'Y Dimension' },
            depthOfCut: { min: 0.003, max: 1, label: 'Depth of Cut' },
            targetDepth: { min: 0.003, max: 1, label: 'Target Depth' },
            bitDiameter: { min: 0.03, max: 2, label: 'Bit Diameter' },
            stepover: { min: 10, max: 100, label: 'Stepover' },
            feedRate: { min: 40, max: 800, label: 'Feed Rate' },
            spindleRpm: { min: 2000, max: 24000, label: 'Spindle RPM' }
          } : {
            xDimension: { min: 10, max: Infinity, label: 'X Dimension' },
            yDimension: { min: 10, max: Infinity, label: 'Y Dimension' },
            depthOfCut: { min: 0.1, max: 20, label: 'Depth of Cut' },
            targetDepth: { min: 0.1, max: 20, label: 'Target Depth' },
            bitDiameter: { min: 1, max: 50, label: 'Bit Diameter' },
            stepover: { min: 10, max: 100, label: 'Stepover' },
            feedRate: { min: 1000, max: 20000, label: 'Feed Rate' },
            spindleRpm: { min: 2000, max: 24000, label: 'Spindle RPM' }
          };

          // Create tooltip element
          const tooltip = document.createElement('div');
          tooltip.style.cssText = \`
            position: absolute;
            background: #d32f2f;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 0.85rem;
            z-index: 10000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          \`;
          tooltip.style.setProperty('white-space', 'nowrap');
          document.body.appendChild(tooltip);

          // Arrow element
          const arrow = document.createElement('div');
          arrow.style.cssText = \`
            position: absolute;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 6px solid #d32f2f;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
          \`;
          tooltip.appendChild(arrow);

          function showTooltip(element, message) {
            const rect = element.getBoundingClientRect();
            tooltip.textContent = message;
            tooltip.appendChild(arrow); // Re-append arrow after textContent

            tooltip.style.left = rect.left + (rect.width / 2) + 'px';
            tooltip.style.top = (rect.top - 10) + 'px';
            tooltip.style.transform = 'translate(-50%, -100%)';
            tooltip.style.opacity = '1';

            element.style.borderColor = '#d32f2f';
            element.focus();
          }

          function hideTooltip() {
            tooltip.style.opacity = '0';
            setTimeout(() => {
              tooltip.style.left = '-9999px';
            }, 200);
          }

          function validateInput(id, value) {
            const rules = validationRules[id];
            if (!rules) return null;

            const num = parseFloat(value);

            if (isNaN(num)) {
              return \`\${rules.label} must be a valid number\`;
            }

            if (num < rules.min) {
              return \`\${rules.label} must be at least \${rules.min}\`;
            }

            if (num > rules.max) {
              return \`\${rules.label} must not exceed \${rules.max}\`;
            }

            return null;
          }

          function validateAllInputs() {
            for (const id in validationRules) {
              const element = document.getElementById(id);
              if (!element) continue;

              const error = validateInput(id, element.value);
              if (error) {
                showTooltip(element, error);
                return false;
              }
            }
            return true;
          }

          // Add input listeners to clear error state
          for (const id in validationRules) {
            const element = document.getElementById(id);
            if (element) {
              element.addEventListener('input', function() {
                this.style.borderColor = '';
                hideTooltip();
              });

              element.addEventListener('blur', function() {
                const error = validateInput(id, this.value);
                if (error) {
                  showTooltip(this, error);
                  setTimeout(hideTooltip, 3000);
                }
              });
            }
          }

          function generateSurfacingGcode(params) {
            const {
              startX, startY,
              xDimension, yDimension,
              depthOfCut, targetDepth,
              bitDiameter, stepover,
              feedRate, spindleRpm,
              patternType,
              mistM7, floodM8,
              isImperial
            } = params;

            // Static values that need conversion
            const safeHeight = isImperial ? (5 * 0.0393701).toFixed(3) : '5.000';
            const unitsCode = isImperial ? 'G20' : 'G21';
            const unitsLabel = isImperial ? 'inch' : 'mm';

            const stepoverDistance = (bitDiameter * stepover) / 100;
            const numDepthPasses = Math.ceil(targetDepth / depthOfCut);
            const selectedPattern = patternType || 'zigzagY';
            const invertOrientation = selectedPattern === 'zigzagX';
            const isSpiral = selectedPattern === 'spiral';

            const stepDimension = invertOrientation ? yDimension : xDimension;
            const numPasses = Math.ceil(stepDimension / stepoverDistance) + 1;

            let gcode = [];
            gcode.push('(Surfacing Operation)');
            gcode.push(\`(Start: X\${startX} Y\${startY})\`);
            gcode.push(\`(Dimensions: \${xDimension} x \${yDimension} \${unitsLabel})\`);
            gcode.push(\`(Bit Diameter: \${bitDiameter}\${unitsLabel}, Stepover: \${stepover}%)\`);
            gcode.push(\`(Target Depth: \${targetDepth}\${unitsLabel} in \${numDepthPasses} passes)\`);
            gcode.push(\`(Feed Rate: \${feedRate}\${unitsLabel}/min, Spindle: \${spindleRpm}RPM)\`);
            gcode.push('');
            gcode.push(\`\${unitsCode} ; \${isImperial ? 'Imperial' : 'Metric'} units\`);
            gcode.push('G90 ; Absolute positioning');
            gcode.push('G94 ; Feed rate per minute');
            gcode.push('');

            if (spindleRpm > 0) {
              gcode.push(\`M3 S\${spindleRpm} ; Start spindle\`);
            }
            if (mistM7) {
              gcode.push('M7 ; Mist coolant on');
            }
            if (floodM8) {
              gcode.push('M8 ; Flood coolant on');
            }
            gcode.push('');

            gcode.push(\`G0 X\${startX.toFixed(3)} Y\${startY.toFixed(3)} ; Move to start position\`);
            gcode.push(\`G0 Z\${safeHeight} ; Move to safe height\`);
            gcode.push('');

            let currentDepth = 0;
            for (let depthPass = 0; depthPass < numDepthPasses; depthPass++) {
              currentDepth = Math.min(currentDepth + depthOfCut, targetDepth);
              gcode.push(\`(Depth pass \${depthPass + 1}/\${numDepthPasses} - Z\${(-currentDepth).toFixed(3)})\`);

              // Move to start position and plunge
              gcode.push(\`G0 X\${startX.toFixed(3)} Y\${startY.toFixed(3)} ; Move to start position\`);
              gcode.push(\`G1 Z\${(-currentDepth).toFixed(3)} F\${feedRate / 2} ; Plunge to depth\`);

              if (isSpiral) {
                const effectiveStep = Math.max(Math.min(stepoverDistance, Math.min(xDimension, yDimension) / 2), 0.1);
                let left = startX;
                let right = startX + xDimension;
                let top = startY;
                let bottom = startY + yDimension;
                let currentX = startX;
                let currentY = startY;

                while (right - left > 0 && bottom - top > 0) {
                  gcode.push(\`G1 X\${right.toFixed(3)} Y\${top.toFixed(3)} F\${feedRate}\`);
                  currentX = right;
                  currentY = top;

                  top += effectiveStep;
                  if (top >= bottom) break;

                  gcode.push(\`G1 X\${currentX.toFixed(3)} Y\${bottom.toFixed(3)} F\${feedRate}\`);
                  currentY = bottom;

                  right -= effectiveStep;
                  if (left >= right) break;

                  gcode.push(\`G1 X\${left.toFixed(3)} Y\${currentY.toFixed(3)} F\${feedRate}\`);
                  currentX = left;

                  bottom -= effectiveStep;
                  if (top >= bottom) break;

                  gcode.push(\`G1 X\${currentX.toFixed(3)} Y\${top.toFixed(3)} F\${feedRate}\`);
                  currentY = top;

                  left += effectiveStep;
                  if (left >= right) break;

                  gcode.push(\`G1 X\${left.toFixed(3)} Y\${currentY.toFixed(3)} F\${feedRate}\`);
                  currentX = left;
                }

                const centerX = startX + (xDimension / 2);
                const centerY = startY + (yDimension / 2);
                if (Math.abs(currentX - centerX) > 0.01 || Math.abs(currentY - centerY) > 0.01) {
                  gcode.push(\`G1 X\${centerX.toFixed(3)} Y\${centerY.toFixed(3)} F\${feedRate}\`);
                }
              } else {
                let direction = 1;

                if (invertOrientation) {
                  // Cut along X-axis, step over Y-axis
                  for (let pass = 0; pass < numPasses; pass++) {
                    const yPos = startY + (pass * stepoverDistance);
                    if (pass > 0) {
                      gcode.push(\`G1 Y\${yPos.toFixed(3)} F\${feedRate} ; Step over\`);
                    }
                    if (direction === 1) {
                      gcode.push(\`G1 X\${(startX + xDimension).toFixed(3)} F\${feedRate}\`);
                    } else {
                      gcode.push(\`G1 X\${startX.toFixed(3)} F\${feedRate}\`);
                    }
                    direction *= -1;
                  }
                } else {
                  // Cut along Y-axis, step over X-axis (default)
                  for (let pass = 0; pass < numPasses; pass++) {
                    const xPos = startX + (pass * stepoverDistance);
                    if (pass > 0) {
                      gcode.push(\`G1 X\${xPos.toFixed(3)} F\${feedRate} ; Step over\`);
                    }
                    if (direction === 1) {
                      gcode.push(\`G1 Y\${(startY + yDimension).toFixed(3)} F\${feedRate}\`);
                    } else {
                      gcode.push(\`G1 Y\${startY.toFixed(3)} F\${feedRate}\`);
                    }
                    direction *= -1;
                  }
                }
              }

              // Z-hop retract and return to start
              gcode.push(\`G0 Z\${safeHeight} ; Retract to safe height\`);
              gcode.push('');
            }

            gcode.push('G0 X0 Y0 ; Return to origin');
            if (mistM7 || floodM8) {
              gcode.push('M9 ; Coolant off');
            }
            if (spindleRpm > 0) {
              gcode.push('M5 ; Stop spindle');
            }
            gcode.push('M30 ; End program');

            return gcode.join('\\n');
          }

          document.getElementById('surfacingForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            // Validate all inputs before proceeding
            if (!validateAllInputs()) {
              return;
            }

            const patternTypeSelect = document.getElementById('patternType');
            const patternType = patternTypeSelect ? patternTypeSelect.value : 'zigzagY';
            const invertOrientation = patternType === 'zigzagX';

            // Get values from form (in display units)
            const displayValues = {
              xDimension: parseFloat(document.getElementById('xDimension').value),
              yDimension: parseFloat(document.getElementById('yDimension').value),
              depthOfCut: parseFloat(document.getElementById('depthOfCut').value),
              targetDepth: parseFloat(document.getElementById('targetDepth').value),
              bitDiameter: parseFloat(document.getElementById('bitDiameter').value),
              stepover: parseFloat(document.getElementById('stepover').value),
              feedRate: parseFloat(document.getElementById('feedRate').value),
              spindleRpm: parseFloat(document.getElementById('spindleRpm').value),
              mistM7: document.getElementById('mistM7').checked,
              floodM8: document.getElementById('floodM8').checked
            };

            // Convert to metric for storage
            const convertToMetric = (value) => isImperial ? value * INCH_TO_MM : value;
            const settingsToSave = {
              xDimension: convertToMetric(displayValues.xDimension),
              yDimension: convertToMetric(displayValues.yDimension),
              depthOfCut: convertToMetric(displayValues.depthOfCut),
              targetDepth: convertToMetric(displayValues.targetDepth),
              bitDiameter: convertToMetric(displayValues.bitDiameter),
              stepover: displayValues.stepover,
              feedRate: convertToMetric(displayValues.feedRate),
              spindleRpm: displayValues.spindleRpm,
              patternType,
              invertOrientation,
              mistM7: displayValues.mistM7,
              floodM8: displayValues.floodM8
            };

            // Params for G-code generation (use display values directly)
            const params = {
              startX: 0,
              startY: 0,
              xDimension: displayValues.xDimension,
              yDimension: displayValues.yDimension,
              depthOfCut: displayValues.depthOfCut,
              targetDepth: displayValues.targetDepth,
              bitDiameter: displayValues.bitDiameter,
              stepover: displayValues.stepover,
              feedRate: displayValues.feedRate,
              spindleRpm: displayValues.spindleRpm,
              patternType,
              invertOrientation,
              mistM7: displayValues.mistM7,
              floodM8: displayValues.floodM8,
              isImperial
            };

            const gcode = generateSurfacingGcode(params);

            // Save settings to server (in metric)
            fetch('/api/plugins/com.ncsender.surfacing/settings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settingsToSave)
            }).catch(err => console.error('Failed to save settings:', err));

            // Upload file
            const formData = new FormData();
            const blob = new Blob([gcode], { type: 'text/plain' });
            formData.append('file', blob, 'Surfacing.nc');

            try {
              const response = await fetch('/api/gcode-files', {
                method: 'POST',
                body: formData
              });

              if (response.ok) {
                window.postMessage({type: 'close-plugin-dialog'}, '*');
              } else {
                alert('Failed to upload G-code file');
              }
            } catch (error) {
              alert('Error uploading G-code file: ' + error.message);
            }
          });
        })();
      </script>
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
