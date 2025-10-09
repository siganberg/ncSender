import { Router } from 'express';
import { generateProbeCode } from './probing-utils.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PROBE]`, ...args);
};

export function createProbeRoutes(cncController, serverState, broadcast) {
  const router = Router();

  /**
   * Start a probing operation
   * POST /api/probe/start
   */
  router.post('/start', async (req, res) => {
    try {
      const options = req.body;

    log('Starting probe operation:', options);

    // Set probing state
    serverState.machineState.isProbing = true;
    broadcast('server-state-updated', serverState);

    // Generate G-code for probing
    const gcodeCommands = generateProbeCode(options);

    if (!gcodeCommands || gcodeCommands.length === 0) {
      serverState.machineState.isProbing = false;
      broadcast('server-state-updated', serverState);
      return res.status(400).json({
        success: false,
        error: 'No G-code generated for probing operation'
      });
    }

    // Log G-code for debugging
    log('Probe G-code:', gcodeCommands.join('\n'));

    // Send probe commands directly to controller (don't use jobManager for probing)
    for (const command of gcodeCommands) {
      const cleanCommand = command.trim();
      if (!cleanCommand) continue;

      const commandId = `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      await cncController.sendCommand(cleanCommand, {
        commandId,
        displayCommand: cleanCommand,
        meta: {
          sourceId: 'probing',
          probeOperation: options.probingAxis
        }
      });
    }

    // Reset probing state after all commands sent
    serverState.machineState.isProbing = false;
    broadcast('server-state-updated', serverState);

    res.json({
      success: true,
      message: 'Probe operation started',
      commandCount: gcodeCommands.length
    });
  } catch (error) {
    log('Error starting probe:', error);
    serverState.machineState.isProbing = false;
    broadcast('server-state-updated', serverState);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

  /**
   * Stop/abort probing operation
   * POST /api/probe/stop
   */
  router.post('/stop', async (_req, res) => {
    try {
      log('Stopping probe operation');

      // Send soft reset to stop any active motion
      await cncController.sendCommand('\x18', {
        meta: { probeControl: true }
      });

      // Reset probing state
      serverState.machineState.isProbing = false;
      broadcast('server-state-updated', serverState);

      log('Probe operation stopped (soft reset sent)');

      res.json({
        success: true,
        message: 'Probe operation stopped'
      });
    } catch (error) {
      log('Error stopping probe:', error);
      serverState.machineState.isProbing = false;
      broadcast('server-state-updated', serverState);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}
