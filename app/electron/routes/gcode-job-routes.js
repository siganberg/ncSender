import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { jobManager } from '../job-processor-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodeJobRoutes(filesDir, cncController, serverState, broadcast) {
  const router = Router();

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

      // Start the job processor using singleton manager
      await jobManager.startJob(filePath, filename, actualCNCController, broadcast);

      log('G-code job started:', filename);
      res.json({ success: true, message: 'G-code job started', filename });
    } catch (error) {
      console.error('Error starting G-code job:', error);
      res.status(500).json({ error: 'Failed to start G-code job' });
    }
  });


  return router;
}

export class GCodeJobProcessor {
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
    this.completionCallbacks = [];
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

  pause() {
    if (!this.isRunning || this.isPaused) {
      throw new Error('Job is not running or already paused');
    }

    this.isPaused = true;
  }

  resume() {
    if (!this.isRunning || !this.isPaused) {
      throw new Error('Job is not paused');
    }

    this.isPaused = false;
    // The loop-based processor will automatically continue when isPaused becomes false
  }

  stop() {
    this.isStopped = true;
    this.isRunning = false;
    this.isPaused = false;
  }

  onComplete(callback) {
    this.completionCallbacks.push(callback);
  }

  triggerCompletion() {
    this.completionCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in job completion callback:', error);
      }
    });
    this.completionCallbacks = [];
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

    // Trigger completion callbacks for both success and stop
    this.triggerCompletion();
  }
}