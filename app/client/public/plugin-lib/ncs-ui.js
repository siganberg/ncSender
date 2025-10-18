/**
 * ncSender Plugin UI Library
 * Reusable UI components for plugin developers
 */

(function(window) {
  'use strict';

  console.log('[NCS-UI] Loading ncSender Plugin UI Library...');

  const NCS = window.NCS || {};

  /**
   * JogControls Component
   * Provides a jog control interface with XY joystick and Z controls
   * Matches the styling of ncSender's built-in JogControls component
   *
   * Usage:
   * <div id="jog-container"></div>
   * <script>
   *   const jogControls = NCS.createJogControls({
   *     container: '#jog-container',
   *     stepOptions: [0.1, 1, 10],
   *     defaultStep: 1,
   *     defaultFeedRate: 3000,
   *     onJog: (axis, direction, distance, feedRate) => {
   *       console.log(`Jog ${axis} ${direction > 0 ? '+' : '-'} ${distance}mm at ${feedRate}mm/min`);
   *     }
   *   });
   * </script>
   */
  NCS.createJogControls = function(options) {
    const config = {
      container: options.container,
      stepOptions: options.stepOptions || [0.1, 1, 10],
      defaultStep: options.defaultStep || 1,
      defaultFeedRate: options.defaultFeedRate || 3000,
      onJog: options.onJog || function() {},
      disabled: options.disabled || false
    };

    let currentStep = config.defaultStep;
    let feedRate = config.defaultFeedRate;
    let pressedButtons = new Set();

    const containerEl = typeof config.container === 'string'
      ? document.querySelector(config.container)
      : config.container;

    if (!containerEl) {
      console.error('JogControls: Container not found');
      return null;
    }

    // Build HTML with ncSender styling
    containerEl.innerHTML = `
      <style>
        .ncs-jog-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
          user-select: none;
        }

        .ncs-jog-controls.ncs-jog-disabled {
          pointer-events: none;
        }

        .ncs-jog-controls.ncs-jog-disabled .ncs-jog-step-selector {
          opacity: 0.5;
        }

        .ncs-jog-controls.ncs-jog-disabled .ncs-jog-btn {
          opacity: 0.5;
        }

        .ncs-jog-controls.ncs-jog-disabled .ncs-jog-z {
          opacity: 0.5;
        }

        .ncs-jog-controls.ncs-jog-disabled .ncs-jog-center {
          pointer-events: auto;
          opacity: 1;
        }

        .ncs-jog-step-selector {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
        }

        .ncs-jog-label {
          font-size: 0.85rem;
          color: var(--color-text-primary);
        }

        .ncs-chip {
          border: none;
          border-radius: 999px;
          padding: 6px 12px;
          background: var(--color-surface-muted);
          color: var(--color-text-secondary);
          cursor: pointer;
          min-width: 50px;
          transition: all 0.2s ease;
          font-size: 0.85rem;
        }

        .ncs-chip.active {
          background: var(--gradient-accent);
          color: #fff;
        }

        .ncs-feed-rate-input {
          width: 70px;
          padding: 4px 8px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          background: var(--color-surface);
          color: var(--color-text-primary);
          font-size: 0.85rem;
          text-align: center;
          transition: border-color 0.2s ease;
        }

        .ncs-feed-rate-input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .ncs-feed-rate-input::placeholder {
          color: var(--color-text-secondary);
          opacity: 0.6;
        }

        .ncs-jog-grid {
          display: flex;
          gap: 8px;
          align-items: stretch;
          justify-content: center;
        }

        .ncs-jog-xy {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(3, 1fr);
          gap: 4px;
          width: 180px;
          height: 180px;
        }

        .ncs-jog-z {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 60px;
        }

        .ncs-jog-btn {
          border-radius: var(--radius-small);
          border: 1px solid var(--color-border);
          background: var(--color-surface-muted);
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          user-select: none;
          color: var(--color-text-primary);
          touch-action: manipulation;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ncs-jog-btn:hover {
          border: 1px solid var(--color-accent);
        }

        .ncs-jog-btn:active,
        .ncs-jog-btn.pressed {
          background: var(--color-accent);
          color: white;
          transform: scale(0.98);
          box-shadow: 0 0 10px rgba(26, 188, 156, 0.5);
          border: 1px solid var(--color-accent);
        }

        .ncs-jog-corner {
          font-size: 1.2rem;
        }

        .ncs-jog-axis {
          font-weight: bold;
        }

        .ncs-jog-z-btn {
          flex: 1;
          font-weight: bold;
        }

        .ncs-jog-center {
          width: 100%;
          height: 100%;
          border: 2px solid #ff6b6b;
          border-radius: 50%;
          background: var(--color-surface);
          position: relative;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .ncs-jog-center:hover {
          background: rgba(255, 107, 107, 0.1);
          border-color: #ff4444;
        }

        .ncs-jog-center:active {
          background: rgba(255, 107, 107, 0.2);
          transform: scale(0.95);
        }

        .ncs-jog-center::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 6px;
          height: 6px;
          background: #ff6b6b;
          border-radius: 50%;
        }
      </style>

      <div class="ncs-jog-controls ${config.disabled ? 'ncs-jog-disabled' : ''}">
        <!-- Step selector with feed rate -->
        <div class="ncs-jog-step-selector">
          <span class="ncs-jog-label">Step</span>
          ${config.stepOptions.map(step => `
            <button class="ncs-chip ${step === currentStep ? 'active' : ''}" data-step="${step}">
              ${step}
            </button>
          `).join('')}
          <span class="ncs-jog-label">Feed Rate</span>
          <input
            type="text"
            class="ncs-feed-rate-input"
            value="${feedRate}"
            placeholder="0.00"
          />
        </div>

        <!-- XY Joystick + Z Controls -->
        <div class="ncs-jog-grid">
          <!-- XY Joystick (3x3 grid) -->
          <div class="ncs-jog-xy">
            <!-- Top Row -->
            <button class="ncs-jog-btn ncs-jog-corner" data-jog="diagonal" data-x="-1" data-y="1" aria-label="Jog X- Y+">↖</button>
            <button class="ncs-jog-btn ncs-jog-axis" data-jog="axis" data-axis="Y" data-dir="1" aria-label="Jog Y+">Y+</button>
            <button class="ncs-jog-btn ncs-jog-corner" data-jog="diagonal" data-x="1" data-y="1" aria-label="Jog X+ Y+">↗</button>

            <!-- Middle Row -->
            <button class="ncs-jog-btn ncs-jog-axis" data-jog="axis" data-axis="X" data-dir="-1" aria-label="Jog X-">X-</button>
            <button class="ncs-jog-center" aria-label="Stop/Cancel"></button>
            <button class="ncs-jog-btn ncs-jog-axis" data-jog="axis" data-axis="X" data-dir="1" aria-label="Jog X+">X+</button>

            <!-- Bottom Row -->
            <button class="ncs-jog-btn ncs-jog-corner" data-jog="diagonal" data-x="-1" data-y="-1" aria-label="Jog X- Y-">↙</button>
            <button class="ncs-jog-btn ncs-jog-axis" data-jog="axis" data-axis="Y" data-dir="-1" aria-label="Jog Y-">Y-</button>
            <button class="ncs-jog-btn ncs-jog-corner" data-jog="diagonal" data-x="1" data-y="-1" aria-label="Jog X+ Y-">↘</button>
          </div>

          <!-- Z Controls -->
          <div class="ncs-jog-z">
            <button class="ncs-jog-btn ncs-jog-z-btn" data-jog="axis" data-axis="Z" data-dir="1" aria-label="Jog Z+">Z+</button>
            <button class="ncs-jog-btn ncs-jog-z-btn" data-jog="axis" data-axis="Z" data-dir="-1" aria-label="Jog Z-">Z-</button>
          </div>
        </div>
      </div>
    `;

    // Get references
    const stepButtons = containerEl.querySelectorAll('[data-step]');
    const feedRateInput = containerEl.querySelector('.ncs-feed-rate-input');
    const jogButtons = containerEl.querySelectorAll('[data-jog]');

    // Step selection
    stepButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        currentStep = parseFloat(btn.dataset.step);
        stepButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Feed rate input
    feedRateInput.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      if (!isNaN(value) && value > 0) {
        feedRate = value;
      }
    });

    feedRateInput.addEventListener('blur', (e) => {
      const value = parseFloat(e.target.value);
      if (isNaN(value) || value <= 0) {
        e.target.value = feedRate;
      }
    });

    // Jog button handlers
    function handleJogStart(btn) {
      const jogType = btn.dataset.jog;
      const btnKey = btn.getAttribute('aria-label');

      if (pressedButtons.has(btnKey)) return;
      pressedButtons.add(btnKey);
      btn.classList.add('pressed');

      if (jogType === 'axis') {
        const axis = btn.dataset.axis;
        const direction = parseInt(btn.dataset.dir);
        config.onJog(axis, direction, currentStep, feedRate);
      } else if (jogType === 'diagonal') {
        const xDir = parseInt(btn.dataset.x);
        const yDir = parseInt(btn.dataset.y);
        const distance = currentStep / Math.sqrt(2);
        config.onJog('X', xDir, distance, feedRate);
        config.onJog('Y', yDir, distance, feedRate);
      }
    }

    function handleJogEnd(btn) {
      const btnKey = btn.getAttribute('aria-label');
      pressedButtons.delete(btnKey);
      btn.classList.remove('pressed');
    }

    jogButtons.forEach(btn => {
      // Mouse events
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handleJogStart(btn);
      });

      btn.addEventListener('mouseup', () => handleJogEnd(btn));
      btn.addEventListener('mouseleave', () => handleJogEnd(btn));

      // Touch events
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleJogStart(btn);
      });

      btn.addEventListener('touchend', () => handleJogEnd(btn));
      btn.addEventListener('touchcancel', () => handleJogEnd(btn));
    });

    // Public API
    return {
      setStep: (step) => {
        currentStep = step;
        stepButtons.forEach(btn => {
          btn.classList.toggle('active', parseFloat(btn.dataset.step) === step);
        });
      },
      setFeedRate: (rate) => {
        feedRate = rate;
        feedRateInput.value = rate;
      },
      setDisabled: (disabled) => {
        const controlsEl = containerEl.querySelector('.ncs-jog-controls');
        if (disabled) {
          controlsEl.classList.add('ncs-jog-disabled');
        } else {
          controlsEl.classList.remove('ncs-jog-disabled');
        }
      },
      destroy: () => {
        containerEl.innerHTML = '';
      }
    };
  };

  // Export to window
  window.NCS = NCS;

  console.log('[NCS-UI] Library loaded successfully. NCS object:', NCS);

})(window);
