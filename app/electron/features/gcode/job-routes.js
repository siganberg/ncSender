import { Router } from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { jobManager } from './job-manager.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';
import { pluginEventBus } from '../../core/plugin-event-bus.js';
import { getUserDataDir } from '../../utils/paths.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodeJobRoutes(filesDir, cncController, serverState, broadcast, commandProcessor) {
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
      // Initialize timing for progress at job start
      if (serverState.jobLoaded) {
        serverState.jobLoaded.jobStartTime = new Date().toISOString();
        serverState.jobLoaded.jobEndTime = null;
        serverState.jobLoaded.jobPauseAt = null;
        serverState.jobLoaded.jobPausedTotalSec = 0;
        serverState.jobLoaded.status = 'running';
        broadcast('server-state-updated', serverState);
      }

      // Start the job processor using singleton manager
      // Always use the cache file (contains processed G-code if plugins ran)
      const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
      const displayFilename = serverState.jobLoaded?.filename || filename;

      log('Starting job with cached file:', cachePath);
      await jobManager.startJob(cachePath, displayFilename, actualCNCController, broadcast, commandProcessor, { serverState });

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
            displayCommand: '! (Feed Hold)',
            meta: { jobControl: true, sourceId: 'client' }
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
            displayCommand: '\\x18 (Soft Reset)',
            meta: { jobControl: true, sourceId: 'client' }
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
  constructor(filePath, filename, cncController, broadcast, commandProcessor, options = {}) {
    this.filePath = filePath;
    this.filename = filename;
    this.cncController = cncController;
    this.broadcast = broadcast;
    this.commandProcessor = commandProcessor;
    this.currentLineNumber = 0;
    this.totalLines = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isStopped = false;
    this.completionCallbacks = [];
    this.progressProvider = options.progressProvider || null;
    this.gcodeContent = options.gcodeContent || null;
    this.sourceId = options.sourceId || 'job';
    this.eventBus = pluginEventBus;
    this.serverState = options.serverState || null;
  }

  getExecutingLine() {
    // Get the actual executing line from grblHAL's Ln field in status reports
    // Note: It's "Ln" (capital L, lowercase n), not "LN"
    const Ln = this.serverState?.machineState?.Ln;

    if (typeof Ln === 'string' || typeof Ln === 'number') {
      const executingLine = parseInt(Ln, 10);
      // Only trust Ln if it's reasonable (not greater than lines we've sent)
      // This prevents stale Ln values from previous jobs being used
      if (Number.isFinite(executingLine) && executingLine >= 0 && executingLine <= this.currentLineNumber) {
        return executingLine;
      }
    }

    // Fallback to currentLineNumber if Ln not available (rely on controller ack)
    return this.currentLineNumber;
  }

  async start() {
    let content = null;

    if (this.progressProvider?.startWithContent || this.eventBus.listenerCount('onBeforeJobStart') > 0) {
      try {
        if (this.gcodeContent) {
          content = this.gcodeContent;
        } else {
          content = await fs.readFile(this.filePath, 'utf8');
        }

        if (this.progressProvider?.startWithContent) {
          await this.progressProvider.startWithContent(content);
        }
      } catch {}
    }

    // Count total lines in file for progress calculation
    if (!content) {
      try {
        content = this.gcodeContent || await fs.readFile(this.filePath, 'utf8');
      } catch {}
    }
    this.totalLines = content ? content.split('\n').length : 0;

    this.isRunning = true;
    this.isPaused = false;
    this.isStopped = false;
    this.currentLineNumber = 0;

    // Note: onBeforeJobStart event is now emitted at file load time (in routes.js)
    // This ensures the visualizer shows the processed G-code and avoids double processing
    if (content !== null && typeof content === 'string') {
      this.gcodeContent = content;
    }

    await this.processLinesStream();
  }

  pause() {
    if (!this.isRunning || this.isPaused) {
      throw new Error('Job is not running or already paused');
    }

    this.isPaused = true;
    try { this.progressProvider?.pause?.(); } catch {}
  }

  resume() {
    if (!this.isRunning || !this.isPaused) {
      throw new Error('Job is not paused');
    }

    this.isPaused = false;
    try { this.progressProvider?.resume?.(); } catch {}
    // The loop-based processor will automatically continue when isPaused becomes false
  }

  async stop() {
    this.isStopped = true;
    this.isRunning = false;
    this.isPaused = false;

    // Note: Soft reset is sent by the caller (job-routes.js /stop endpoint)
    // Don't send it here to avoid duplicate commands

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
        while (this.isPaused && !this.isStopped) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.isStopped) {
          break;
        }

        this.currentLineNumber++;

        let cleanLine = originalLine.trim();

        if (cleanLine === '') {
          continue;
        }

        const lineContext = {
          lineNumber: this.currentLineNumber,
          filename: this.filename,
          sourceId: this.sourceId
        };

        cleanLine = await this.eventBus.emitChain('onBeforeGcodeLine', cleanLine, lineContext);

        // Strip any existing N-number from CAM-generated code and replace with our own
        // This ensures consistent line number tracking
        const cleanedLine = cleanLine.replace(/^N\d+\s*/i, '');

        // Prefix with our sequential line number for grblHAL tracking (N<line#> <gcode>)
        const commandToSend = `N${this.currentLineNumber} ${cleanedLine}`;

        const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        try {
          // Process command through Plugin Manager
          const pluginContext = {
            sourceId: this.sourceId,
            commandId,
            lineNumber: this.currentLineNumber,
            meta: {
              lineNumber: this.currentLineNumber,
              job: { filename: this.filename },
              sourceId: this.sourceId
            },
            machineState: this.cncController.lastStatus
          };

          const result = await this.commandProcessor.instance.process(commandToSend, pluginContext);

          // Check if command was skipped (e.g., same-tool M6)
          if (!result.shouldContinue) {
            // Update progress and continue to next line
            try { this.progressProvider?.onAdvanceToLine?.(this.currentLineNumber); } catch {}
            continue;
          }

          const commands = result.commands;

          // Iterate through command array and send each to controller
          let lastResponse = null;
          for (const cmd of commands) {
            const cmdDisplayCommand = cmd.displayCommand || cleanLine;
            const cmdMeta = {
              lineNumber: this.currentLineNumber,
              job: { filename: this.filename },
              sourceId: this.sourceId,
              ...(cmd.meta || {})
            };

            // Generate unique commandId for each command in the array
            const uniqueCommandId = cmd.commandId || `${commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            lastResponse = await this.cncController.sendCommand(cmd.command, {
              commandId: uniqueCommandId,
              displayCommand: cmdDisplayCommand,
              meta: cmdMeta
            });
          }

          // Update progress based on lines sent (for accurate progress calculation)
          try { this.progressProvider?.onAdvanceToLine?.(this.currentLineNumber); } catch {}

          await this.eventBus.emitAsync('onAfterGcodeLine', cleanLine, lastResponse, lineContext);
        } catch (error) {
          this.isStopped = true;
          this.isRunning = false;
          break;
        }
      }

      this.isRunning = false;
      try { if (this.isStopped) this.progressProvider?.stop?.(); } catch {}

      if (!this.isStopped) {
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

        setTimeout(async () => {
          log('Triggering job completion callbacks');
          this.triggerCompletion('completed');
          try { this.progressProvider?.stop?.(); } catch {}

          const jobContext = {
            filename: this.filename,
            totalLines: this.currentLineNumber,
            sourceId: this.sourceId,
            reason: 'completed'
          };
          await this.eventBus.emitAsync('onAfterJobEnd', jobContext);
        }, 100);
      } else {
        const jobContext = {
          filename: this.filename,
          totalLines: this.currentLineNumber,
          sourceId: this.sourceId,
          reason: 'stopped'
        };
        await this.eventBus.emitAsync('onAfterJobEnd', jobContext);
      }
    } catch (error) {
      log('Error processing G-code file stream:', error);
      this.isRunning = false;
      this.isStopped = true;
      try { this.progressProvider?.stop?.(); } catch {}
      this.triggerCompletion('error');

      const jobContext = {
        filename: this.filename,
        totalLines: this.currentLineNumber,
        sourceId: this.sourceId,
        reason: 'error',
        error
      };
      await this.eventBus.emitAsync('onAfterJobEnd', jobContext);
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
