import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodeJobRoutes(filesDir, cncController, serverState, broadcast) {
  const router = Router();

  let jobProcessor = null;

  // Use real CNC controller
  let actualCNCController = cncController;

  // Start a G-code Job
  router.post('/', async (req, res) => {
    try {
      const { filename } = req.body;

      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }

      const filePath = path.join(filesDir, filename);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return res.status(404).json({ error: 'G-code file not found' });
      }

      // Check if machine is in correct state
      if (!serverState.online) {
        return res.status(400).json({ error: 'CNC controller not connected' });
      }

      const machineStatus = serverState.machineState?.status?.toLowerCase();
      if (machineStatus !== 'idle') {
        return res.status(400).json({ error: `Cannot start job. Machine state is: ${machineStatus}` });
      }

      // Start the job processor
      jobProcessor = new GCodeJobProcessor(filePath, filename, actualCNCController, broadcast);
      await jobProcessor.start();

      log('G-code job started:', filename);
      res.json({ success: true, message: 'G-code job started', filename });
    } catch (error) {
      console.error('Error starting G-code job:', error);
      res.status(500).json({ error: 'Failed to start G-code job' });
    }
  });

  // Pause/Resume G-code Job
  router.patch('/', async (req, res) => {
    try {
      const { action } = req.body;

      if (!action || !['pause', 'resume'].includes(action)) {
        return res.status(400).json({ error: 'Action must be "pause" or "resume"' });
      }

      if (!jobProcessor) {
        return res.status(400).json({ error: 'No active G-code job' });
      }

      if (action === 'pause') {
        await jobProcessor.pause();
        log('G-code job paused');
        res.json({ success: true, message: 'G-code job paused' });
      } else if (action === 'resume') {
        await jobProcessor.resume();
        log('G-code job resumed');
        res.json({ success: true, message: 'G-code job resumed' });
      }
    } catch (error) {
      console.error('Error controlling G-code job:', error);
      res.status(500).json({ error: 'Failed to control G-code job' });
    }
  });

  // Stop G-code Job
  router.delete('/', async (_req, res) => {
    try {
      if (!jobProcessor) {
        return res.status(400).json({ error: 'No active G-code job' });
      }

      await jobProcessor.stop();
      jobProcessor = null;

      log('G-code job stopped');
      res.json({ success: true, message: 'G-code job stopped' });
    } catch (error) {
      console.error('Error stopping G-code job:', error);
      res.status(500).json({ error: 'Failed to stop G-code job' });
    }
  });

  return router;
}

class GCodeJobProcessor {
  constructor(filePath, filename, cncController, broadcast) {
    this.filePath = filePath;
    this.filename = filename;
    this.cncController = cncController;
    this.broadcast = broadcast;
    this.lines = [];
    this.currentLine = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isStopped = false;
  }

  async start() {
    // Read and parse the G-code file
    const content = await fs.readFile(this.filePath, 'utf8');
    this.lines = this.parseGCodeLines(content);

    this.isRunning = true;
    this.isPaused = false;
    this.isStopped = false;
    this.currentLine = 0;

    // Start processing lines with loop-based approach
    this.processLines();
  }

  async pause() {
    if (!this.isRunning || this.isPaused) {
      throw new Error('Job is not running or already paused');
    }

    // Send pause command to CNC
    await this.cncController.sendCommand('!');
    this.isPaused = true;
  }

  async resume() {
    if (!this.isRunning || !this.isPaused) {
      throw new Error('Job is not paused');
    }

    // Send resume command to CNC
    await this.cncController.sendCommand('~');
    this.isPaused = false;

    // The loop-based processor will automatically continue when isPaused becomes false
  }

  async stop() {
    this.isStopped = true;
    this.isRunning = false;
    this.isPaused = false;

    // Send stop command to CNC

    await this.cncController.sendCommand('!');

    // Wait 700ms before sending soft reset (Ctrl+X) to give controller time to process the stop
    await new Promise((resolve) => setTimeout(resolve, 700));

    await this.cncController.sendCommand('\x18'); // Ctrl+X (soft reset)
  }

  parseGCodeLines(content) {
    const lines = content.split('\n');
    const parsedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const lineNumber = i + 1;

      // Remove comments (semicolon and everything after)
      let cleanLine = originalLine.split(';')[0].trim();

      // Skip empty lines but track line numbers
      if (cleanLine === '') {
        parsedLines.push({
          lineNumber,
          originalLine,
          cleanLine: null,
          isComment: true
        });
      } else {
        parsedLines.push({
          lineNumber,
          originalLine,
          cleanLine,
          isComment: false
        });
      }
    }

    return parsedLines;
  }

  async processLines() {
    while (this.currentLine < this.lines.length && !this.isStopped) {
      // Wait while paused
      while (this.isPaused && !this.isStopped) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Check if stopped while waiting for pause
      if (this.isStopped) {
        break;
      }

      // Check if we've reached the end
      if (this.currentLine >= this.lines.length) {
        break;
      }

      const lineData = this.lines[this.currentLine];
      this.currentLine++;

      // Skip comment/empty lines but track them
      if (lineData.isComment) {
        // this.broadcast('cnc-command-result', {
        //   id: `line-${lineData.lineNumber}`,
        //   command: lineData.originalLine,
        //   displayCommand: lineData.originalLine,
        //   status: 'skipped',
        //   timestamp: new Date().toISOString(),
        //   meta: { lineNumber: lineData.lineNumber, skipped: true }
        // });
        continue;
      }

      try {
        // Generate unique command ID
        const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        // Broadcast pending command first (cnc-command pattern)
        this.broadcast('cnc-command', {
          id: commandId,
          command: lineData.cleanLine,
          displayCommand: lineData.cleanLine,
          timestamp: new Date().toISOString(),
          meta: { lineNumber: lineData.lineNumber }
        });

        // Send command to CNC
        await this.cncController.sendCommand(lineData.cleanLine);

        // Broadcast success result
        this.broadcast('cnc-command-result', {
          id: commandId,
          command: lineData.cleanLine,
          displayCommand: lineData.cleanLine,
          status: 'success',
          timestamp: new Date().toISOString(),
          meta: { lineNumber: lineData.lineNumber }
        });

        // Small delay between commands
        // await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        // Broadcast error and stop job
        this.broadcast('cnc-command-result', {
          id: commandId,
          command: lineData.cleanLine,
          displayCommand: lineData.cleanLine,
          status: 'error',
          error: { message: `Failed to execute on Line: ${lineData.lineNumber}. ${error.message}` },
          timestamp: new Date().toISOString(),
          meta: { lineNumber: lineData.lineNumber }
        });

        this.isStopped = true;
        this.isRunning = false;
        break;
      }
    }

    // Job completed or stopped
    this.isRunning = false;

    if (!this.isStopped && this.currentLine >= this.lines.length) {
      // Job completed successfully
      this.broadcast('cnc-command-result', {
        id: `job-${Date.now()}`,
        command: 'JOB_COMPLETED',
        displayCommand: `Job completed: ${this.filename}`,
        status: 'success',
        timestamp: new Date().toISOString(),
        meta: { jobComplete: true }
      });
    }
  }
}