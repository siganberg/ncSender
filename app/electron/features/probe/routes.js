import { Router } from 'express';
import { generateProbeCode } from './probing-utils.js';
import { jobManager } from '../gcode/job-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PROBE]`, ...args);
};

export function createProbeRoutes(cncController, broadcast) {
  const router = Router();

  /**
   * Start a probing operation
   * POST /api/probe/start
   */
  router.post('/start', async (req, res) => {
    try {
      const options = req.body;

    log('Starting probe operation:', options);

    // Generate G-code for probing
    const gcodeCommands = generateProbeCode(options);

    if (!gcodeCommands || gcodeCommands.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No G-code generated for probing operation'
      });
    }

    log(`Generated ${gcodeCommands.length} G-code commands`);

    // Join commands into multi-line string
    const gcodeContent = gcodeCommands.join('\n');

    log('G-code to be sent:\n', gcodeContent);

    // Start job with G-code content
    await jobManager.startJob(
      null, // No file path
      `Probe-${options.probingAxis}`, // Job name
      cncController,
      broadcast,
      {
        gcodeContent, // Pass G-code content directly
        sourceId: 'probing' // Tag as probing to broadcast to terminal
      }
    );

    log('Probe job started');

    res.json({
      success: true,
      message: 'Probe operation started',
      commandCount: gcodeCommands.length
    });
  } catch (error) {
    log('Error starting probe:', error);
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
  router.post('/stop', async (req, res) => {
    try {
      if (!jobManager.hasActiveJob()) {
        return res.status(400).json({
          success: false,
          error: 'No active probe operation to stop'
        });
      }

      log('Stopping probe operation');

      // Stop the job through job manager
      jobManager.stop();

      log('Probe operation stopped');

      res.json({
        success: true,
        message: 'Probe operation stopped'
      });
    } catch (error) {
      log('Error stopping probe:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}
