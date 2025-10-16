let lineCount = 0;
let jobStartTime = null;

export function onLoad(ctx) {
  ctx.log('Job Logger plugin loaded');

  ctx.registerEventHandler('onBeforeJobStart', async (gcode, context) => {
    ctx.log('Job starting:', context.filename);
    jobStartTime = Date.now();
    lineCount = 0;
    return gcode;
  });

  ctx.registerEventHandler('onBeforeGcodeLine', async (line, context) => {
    lineCount++;
    return line;
  });

  ctx.registerEventHandler('onAfterGcodeLine', async (line, response, context) => {
    if (lineCount % 100 === 0) {
      ctx.log(`Processed ${lineCount} lines from ${context.filename}`);
    }
  });

  ctx.registerEventHandler('onAfterJobEnd', async (context) => {
    const duration = jobStartTime ? ((Date.now() - jobStartTime) / 1000).toFixed(2) : 'unknown';
    ctx.log(`Job ended: ${context.filename}`);
    ctx.log(`Reason: ${context.reason}`);
    ctx.log(`Total lines processed: ${lineCount}`);
    ctx.log(`Duration: ${duration}s`);
    lineCount = 0;
    jobStartTime = null;
  });
}

export function onUnload() {
  console.log('[PLUGIN:com.example.job-logger] Job Logger plugin unloaded');
}
