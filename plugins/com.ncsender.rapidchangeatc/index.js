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
        .rc-controls {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
        }
      </style>

      <div class="rc-controls">
        <nc-step-control></nc-step-control>
        <nc-jog-control></nc-jog-control>
      </div>
    `,
      { size: 'large' }
    );
  });
}

export function onUnload() {
  // No resources to clean up in this initial version
}
