import { Router } from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { jobManager } from './job-manager.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodeJobRoutes(filesDir, cncController, serverState, broadcast) {
  const router = Router();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      if (!serverState.machineState?.connected) {
        return res.status(400).json({ error: 'CNC controller not connected' });
      }

      const machineStatus = serverState.machineState?.status?.toLowerCase();
      if (machineStatus !== 'idle') {
        return res.status(400).json({ error: `Cannot start job. Machine state is: ${machineStatus}` });
      }

      // Compute ETA server-side (best-effort) before starting
      // Initialize timing/visibility for progress at job start
      if (serverState.jobLoaded) {
        serverState.jobLoaded.jobStartTime = new Date().toISOString();
        serverState.jobLoaded.jobEndTime = null;
        serverState.jobLoaded.jobPauseAt = null;
        serverState.jobLoaded.jobPausedTotalSec = 0;
        serverState.jobLoaded.showProgress = true;
        broadcast('server-state-updated', serverState);
      }

      // Start the job processor using singleton manager
      await jobManager.startJob(filePath, filename, actualCNCController, broadcast);

      log('G-code job started:', filename);
      res.json({ success: true, message: 'G-code job started', filename });
    } catch (error) {
      log('Error starting G-code job:', error);
      const errorMessage = error.message || 'Failed to start G-code job';
      res.status(500).json({ error: errorMessage });
    }
  });

  router.post('/stop', async (req, res) => {
    try {
      if (!jobManager.hasActiveJob()) {
        return res.status(400).json({ error: 'No active job to stop' });
      }

      // If job is no longer running/paused, avoid sending real-time stop commands.
      const status = jobManager.getJobStatus();
      const isActiveMotion = status && (status.status === 'running' || status.status === 'paused');

      const rawSetting = getSetting('pauseBeforeStop', DEFAULT_SETTINGS.pauseBeforeStop);
      let pauseBeforeStop = Number(rawSetting);
      if (!Number.isFinite(pauseBeforeStop) || pauseBeforeStop < 0) {
        pauseBeforeStop = DEFAULT_SETTINGS.pauseBeforeStop;
      }

      if (isActiveMotion && pauseBeforeStop > 0) {
        try {
          await cncController.sendCommand('!', {
            meta: { jobControl: true }
          });
        } catch (error) {
          log('Failed to send feed hold before stop:', error?.message || error);
        }

        await delay(pauseBeforeStop);
      }

      // Only issue soft reset when motion is active; otherwise, skip sending \x18
      if (isActiveMotion) {
        try {
          await cncController.sendCommand('\x18', {
            meta: { jobControl: true }
          });
        } catch (error) {
          log('Failed to send soft reset during stop:', error?.message || error);
          return res.status(500).json({ error: 'Failed to stop G-code job' });
        }
      }

      try {
        jobManager.stop();
      } catch (error) {
        log('Job manager stop error:', error?.message || error);
      }

      log(`G-code job stop issued (delay ${isActiveMotion ? pauseBeforeStop : 0}ms, active=${!!isActiveMotion})`);
      return res.json({ success: true, pauseBeforeStop });
    } catch (error) {
      log('Error stopping G-code job:', error);
      return res.status(500).json({ error: 'Failed to stop G-code job' });
    }
  });


  return router;
}

export class GCodeJobProcessor {
  constructor(filePath, filename, cncController, broadcast, options = {}) {
    this.filePath = filePath;
    this.filename = filename;
    this.cncController = cncController;
    this.broadcast = broadcast;
    this.currentLineNumber = 0;
    this.totalLines = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isStopped = false;
    this.completionCallbacks = [];
    this.progressProvider = options.progressProvider || null;
    this.gcodeContent = options.gcodeContent || null; // Direct G-code content
    this.sourceId = options.sourceId || 'gcode-runner'; // Source identifier for broadcast filtering
  }

  async start() {
    // For progress provider initialization, we still need to read the full content
    // But we'll stream for actual processing
    if (this.progressProvider?.startWithContent) {
      try {
        let content;
        if (this.gcodeContent) {
          content = this.gcodeContent;
        } else {
          content = await fs.readFile(this.filePath, 'utf8');
        }
        await this.progressProvider.startWithContent(content);
      } catch {}
    }

    this.isRunning = true;
    this.isPaused = false;
    this.isStopped = false;
    this.currentLineNumber = 0;

    // Start processing lines with stream-based approach
    await this.processLinesStream();
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

    // Trigger completion callbacks when manually stopped
    this.triggerCompletion('stopped');
    try { this.progressProvider?.stop?.(); } catch {}
  }

  onComplete(callback) {
    this.completionCallbacks.push(callback);
  }

  triggerCompletion(reason = 'completed') {
    this.completionCallbacks.forEach(callback => {
      try {
        callback(reason);
      } catch (error) {
        log('Error in job completion callback:', error);
      }
    });
    this.completionCallbacks = [];
  }

  async processLinesStream() {
    try {
      let lineStream;

      if (this.gcodeContent) {
        // If content provided directly, use it (for testing or special cases)
        const lines = this.gcodeContent.split('\n');
        lineStream = (async function* () {
          for (const line of lines) {
            yield line;
          }
        })();
      } else {
        // Stream from file
        const fileStream = createReadStream(this.filePath, { encoding: 'utf8' });
        const rl = createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        lineStream = rl;
      }

      for await (const originalLine of lineStream) {
        // Wait while paused
        while (this.isPaused && !this.isStopped) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Check if stopped
        if (this.isStopped) {
          break;
        }

        this.currentLineNumber++;

        // Remove comments (semicolon and everything after)
        const cleanLine = originalLine.split(';')[0].trim();

        // Skip empty lines
        if (cleanLine === '') {
          continue;
        }

        // Generate unique command ID
        const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        try {
          await this.cncController.sendCommand(cleanLine, {
            commandId,
            displayCommand: cleanLine,
            meta: {
              lineNumber: this.currentLineNumber,
              job: { filename: this.filename },
              sourceId: this.sourceId
            }
          });
          // Notify progress provider that we've advanced a (1-based) line number
          try { this.progressProvider?.onAdvanceToLine?.(this.currentLineNumber); } catch {}
        } catch (error) {
          this.isStopped = true;
          this.isRunning = false;
          break;
        }
      }

      // Job completed or stopped
      this.isRunning = false;
      try { if (this.isStopped) this.progressProvider?.stop?.(); } catch {}

      if (!this.isStopped) {
        // Job completed successfully
        log('Job processing completed, triggering callbacks');

        const completionComment = `; Job completed: ${this.filename} (ncSender)`;

        this.broadcast('cnc-command-result', {
          id: `job-${Date.now()}`,
          command: completionComment,
          displayCommand: completionComment,
          status: 'success',
          timestamp: new Date().toISOString(),
          meta: { jobComplete: true },
          sourceId: this.sourceId
        });

        // Trigger completion callbacks after a small delay to ensure all state updates propagate
        setTimeout(() => {
          log('Triggering job completion callbacks');
          this.triggerCompletion('completed');
          try { this.progressProvider?.stop?.(); } catch {}
        }, 100);
      }
    } catch (error) {
      log('Error processing G-code file stream:', error);
      this.isRunning = false;
      this.isStopped = true;
      try { this.progressProvider?.stop?.(); } catch {}
      this.triggerCompletion('error');
    }
  }

  getEstimate() {
    try {
      return this.progressProvider?.getEstimate?.() || null;
    } catch {
      return null;
    }
  }
}
