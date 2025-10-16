let isToolChange = false;
let shouldInjectM8AfterNextLine = false;

export function onLoad(ctx) {
  ctx.log('Auto Dustboot plugin loaded');

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    const trimmedLine = line.trim().toUpperCase();

    // If we need to inject M8 after the previous line, do it now
    if (shouldInjectM8AfterNextLine) {
      ctx.log(`Injecting M8 and G4 P1 before line ${context.lineNumber}`);
      shouldInjectM8AfterNextLine = false;

      // Send M8 and G4 P1 (dwell 1 second)
      try {
        await ctx.sendGcode('M8', {
          displayCommand: 'M8 (Auto Dustboot - Injected)',
          meta: { autoInjected: true, plugin: 'auto-dustboot' }
        });
        ctx.log('M8 command successfully injected');

        await ctx.sendGcode('G4 P1', {
          displayCommand: 'G4 P1 (Auto Dustboot - Dwell)',
          meta: { autoInjected: true, plugin: 'auto-dustboot' }
        });
        ctx.log('G4 P1 dwell command successfully injected');
      } catch (error) {
        ctx.log('Failed to inject commands:', error.message);
      }

      // Now process current line normally (don't return yet, check M6 first)
    }

    // Check if this is a tool change command (M6)
    if (trimmedLine.includes('M6')) {
      ctx.log(`Tool change detected at line ${context.lineNumber}: ${line}`);
      isToolChange = true;
      return line;
    }

    // ONLY if we're in a tool change state, perform steps 2-4
    if (isToolChange) {
      // Step 2: Check if this line is M8 (coolant/dust collection on)
      if (trimmedLine.includes('M8')) {
        ctx.log(`Skipping M8 at line ${context.lineNumber}, will insert after first XY movement`);
        // Skip this M8 by converting to comment
        return '; M8 (Auto Dustboot - Skipped)';
      }

      // Step 3 & 4: Check if this line has X or Y movement
      const hasXMovement = /[^A-Z]X[-+]?\d+\.?\d*/i.test(line);
      const hasYMovement = /[^A-Z]Y[-+]?\d+\.?\d*/i.test(line);

      if (hasXMovement || hasYMovement) {
        ctx.log(`First XY movement after tool change at line ${context.lineNumber}: ${line}`);

        // Reset tool change state and flag that we should inject M8 after this line
        isToolChange = false;
        shouldInjectM8AfterNextLine = true;

        return line;
      }
    }

    // Normal line - pass through unchanged
    return line;
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    ctx.log('Job ended, resetting tool change state');
    isToolChange = false;
    shouldInjectM8AfterNextLine = false;
  });
}

export function onUnload() {
  console.log('[PLUGIN:com.ncsender.auto-dustboot] Auto Dustboot plugin unloaded');
  isToolChange = false;
  shouldInjectM8AfterNextLine = false;
}
