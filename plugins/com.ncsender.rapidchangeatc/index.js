/**
 * Rapid Change ATC plugin
 * Provides quick access tooling workflow controls.
 */

export function onLoad(ctx) {
  ctx.log('Rapid Change ATC plugin loaded');

  ctx.registerToolMenu('RapidChangeATC', async () => {
    ctx.log('RapidChangeATC tool opened');

    ctx.showDialog(
      'Rapid Change ATC',
      `
      <style>
        .rc-container {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 24px;
          padding: 30px;
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
        }

        .rc-select:focus,
        .rc-input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .rc-radio-group {
          display: flex;
          gap: 16px;
        }

        .rc-radio-label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          color: var(--color-text-primary);
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
          padding: 6px 16px !important;
          border-radius: var(--radius-small);
          border: 1px solid var(--color-accent);
          background: var(--color-accent);
          color: var(--color-surface);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: filter 0.15s ease;
        }

        .rc-button:hover {
          filter: brightness(0.95);
        }

        .rc-button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }

        .rc-instructions {
          margin: 0 0 16px;
          color: var(--color-text-secondary);
          font-size: 0.9rem;
          line-height: 1.4;
          max-width: 900px;
        }
      </style>

      <p class="rc-instructions">
        With the collet, nut, and bit installed on the spindle, position the spindle over Pocket 1 of the magazine. Use the Jog controls to lower it and fine-tune the position until the nut is just inside Pocket 1. Manually rotate the spindle to ensure nothing is rubbing. Once everything is centered, click Start Calibration.
      </p>

      <div class="rc-container">
        <!-- Left Panel: Form Controls -->
        <div class="rc-left-panel">
          <div class="rc-form-group">
            <label class="rc-form-label">Model</label>
            <select class="rc-select" id="rc-model">
              <option value="ER11">ER11</option>
              <option value="ER16">ER16</option>
              <option value="ER20" selected>ER20</option>
              <option value="ER25">ER25</option>
              <option value="ER32">ER32</option>
            </select>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Number of Pockets</label>
            <select class="rc-select" id="rc-pockets">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6" selected>6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="9">9</option>
              <option value="10">10</option>
            </select>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Trip</label>
            <select class="rc-select" id="rc-trip">
              <option value="Basic">Basic</option>
              <option value="Pro" selected>Pro</option>
              <option value="Premium">Premium</option>
            </select>
          </div>

          <div class="rc-form-group">
            <label class="rc-form-label">Mounting Orientation</label>
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

        <!-- Right Panel: Jog Controls -->
        <div class="rc-right-panel">
          <nc-step-control></nc-step-control>
          <nc-jog-control></nc-jog-control>

          <div class="rc-form-group">
            <label class="rc-form-label">Pocket 1 Machine Coordinates</label>
            <div class="rc-coordinate-group">
              <label class="rc-coord-label-inline" for="rc-pocket1-x">X</label>
              <input type="number" class="rc-input" id="rc-pocket1-x" value="0" step="0.001">
              <label class="rc-coord-label-inline" for="rc-pocket1-y">Y</label>
              <input type="number" class="rc-input" id="rc-pocket1-y" value="0" step="0.001">
              <button type="button" class="rc-button" id="rc-pocket1-grab">Grab</button>
            </div>
          </div>
        </div>
      </div>
    `,
      { size: 'large' }
    );
  });
}

export function onUnload() {
  // No resources to clean up in this initial version
}
