/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import { Router } from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { jobManager } from './job-manager.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';
import { pluginEventBus } from '../../core/plugin-event-bus.js';
import { getUserDataDir } from '../../utils/paths.js';
import { GCodeStateAnalyzer, generateResumeSequence, compareToolState, findArcStart } from './gcode-state-analyzer.js';
import { parseM6Command } from '../../utils/gcode-patterns.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('GCodeJob');

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

  router.post('/analyze-line', async (req, res) => {
    try {
      const { lineNumber } = req.body;

      if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        return res.status(400).json({ error: 'Valid line number is required' });
      }

      const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');

      try {
        await fs.access(cachePath);
      } catch {
        return res.status(404).json({ error: 'No G-code file loaded' });
      }

      const content = await fs.readFile(cachePath, 'utf8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      if (lineNumber > totalLines) {
        return res.status(400).json({ error: `Line ${lineNumber} exceeds file length (${totalLines} lines)` });
      }

      // Check if selected line is in the middle of an arc and adjust if needed
      const arcAdjustment = findArcStart(lines, lineNumber);
      const effectiveLineNumber = arcAdjustment.adjustedLine;

      const analyzer = new GCodeStateAnalyzer();
      // Analyze to effectiveLineNumber - 1 to get state BEFORE the start line
      // This ensures the resume sequence sets up the machine correctly for the start line to execute
      const targetLine = Math.max(1, effectiveLineNumber - 1);
      const { state } = analyzer.analyzeToLine(content, targetLine);

      // Check if the selected start line is a tool change (M6)
      const startLineContent = lines[effectiveLineNumber - 1] || '';
      const startLineToolChange = parseM6Command(startLineContent);
      const isStartingAtToolChange = startLineToolChange?.matched && startLineToolChange?.toolNumber !== null;

      // If starting at a tool change, use that tool for comparison (not the previous tool)
      const expectedTool = isStartingAtToolChange ? startLineToolChange.toolNumber : state.tool;

      const currentTool = serverState.machineState?.tool ?? null;
      const toolComparison = compareToolState(expectedTool, currentTool);

      const warnings = [];

      // Only warn about homing if firmware requires it
      const homingRequired = serverState.machineState?.homingRequired !== false;
      if (!serverState.machineState?.homed && homingRequired) {
        warnings.push('Machine is not homed');
      }

      // Tool mismatch is shown in the "Tool Change Required" info box, not in warnings

      // Check if tool change will be needed (mismatch and not already starting at tool change)
      const willPerformToolChange = toolComparison.mismatch && !isStartingAtToolChange;

      // Generate resume sequence preview (with default options for preview)
      const resumeSequence = generateResumeSequence(state, {
        spindleDelaySec: 0,
        approachHeight: 10,
        plungeFeedRate: 500,
        isStartingAtToolChange,
        expectedTool: willPerformToolChange ? expectedTool : null,
        currentTool: willPerformToolChange ? currentTool : null
      });

      // Add arc adjustment warning if line was adjusted
      if (arcAdjustment.wasAdjusted) {
        warnings.push(`Line <strong>${lineNumber}</strong> is in the middle of an arc. Adjusted to line <strong>${effectiveLineNumber}</strong> instead (arc start).`);
      }

      res.json({
        state,
        lineNumber: effectiveLineNumber,
        originalLineNumber: arcAdjustment.wasAdjusted ? lineNumber : null,
        lineAdjusted: arcAdjustment.wasAdjusted,
        totalLines,
        toolMismatch: false,  // No longer a blocking mismatch - we handle it in preamble
        willPerformToolChange,
        expectedTool,
        currentTool,
        warnings,
        resumeSequence,
        isStartingAtToolChange
      });
    } catch (error) {
      log('Error analyzing G-code line:', error);
      res.status(500).json({ error: 'Failed to analyze G-code line' });
    }
  });

  router.post('/start-from-line', async (req, res) => {
    try {
      const {
        filename,
        startLine,
        skipToolCheck = false,
        spindleDelaySec = 0,
        approachHeight = 10,
        plungeFeedRate = 500
      } = req.body;

      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }

      if (!Number.isFinite(startLine) || startLine < 1) {
        return res.status(400).json({ error: 'Valid start line number is required' });
      }

      const filePath = path.join(filesDir, filename);

      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({ error: 'G-code file not found' });
      }

      if (!serverState.machineState?.connected) {
        return res.status(400).json({ error: 'CNC controller not connected' });
      }

      const machineStatus = serverState.machineState?.status?.toLowerCase();
      if (machineStatus !== 'idle') {
        return res.status(400).json({ error: `Cannot start job. Machine state is: ${machineStatus}` });
      }

      // Only require homing if firmware says so ($22 bit 0 and bit 2 are set)
      const homingRequiredForStart = serverState.machineState?.homingRequired !== false;
      if (!serverState.machineState?.homed && homingRequiredForStart) {
        return res.status(400).json({ error: 'Machine must be homed before starting from a specific line' });
      }

      const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
      const content = await fs.readFile(cachePath, 'utf8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      if (startLine > totalLines) {
        return res.status(400).json({ error: `Line ${startLine} exceeds file length (${totalLines} lines)` });
      }

      // Check if selected line is in the middle of an arc and adjust if needed
      const arcAdjustment = findArcStart(lines, startLine);
      const effectiveStartLine = arcAdjustment.adjustedLine;

      if (arcAdjustment.wasAdjusted) {
        log(`Line ${startLine} is arc continuation, adjusted to arc start at line ${effectiveStartLine}`);
      }

      const analyzer = new GCodeStateAnalyzer();
      // Analyze to effectiveStartLine - 1 to get state BEFORE the start line
      // This ensures the resume sequence sets up the machine correctly for the start line to execute
      const targetLine = Math.max(1, effectiveStartLine - 1);
      const { state } = analyzer.analyzeToLine(content, targetLine);

      // Check if the selected start line is a tool change (M6)
      const startLineContent = lines[effectiveStartLine - 1] || '';
      const startLineToolChange = parseM6Command(startLineContent);
      const isStartingAtToolChange = startLineToolChange?.matched && startLineToolChange?.toolNumber !== null;

      // If starting at a tool change, use that tool for comparison (not the previous tool)
      const expectedTool = isStartingAtToolChange ? startLineToolChange.toolNumber : state.tool;

      const currentTool = serverState.machineState?.tool ?? null;
      const toolComparison = compareToolState(expectedTool, currentTool);

      // Check if tool change will be needed (mismatch and not already starting at tool change)
      const willPerformToolChange = toolComparison.mismatch && !isStartingAtToolChange;

      const resumeSequence = generateResumeSequence(state, {
        spindleDelaySec,
        approachHeight,
        plungeFeedRate,
        isStartingAtToolChange,
        expectedTool: willPerformToolChange ? expectedTool : null,
        currentTool: willPerformToolChange ? currentTool : null
      });

      if (serverState.jobLoaded) {
        serverState.jobLoaded.jobStartTime = new Date().toISOString();
        serverState.jobLoaded.jobEndTime = null;
        serverState.jobLoaded.jobPauseAt = null;
        serverState.jobLoaded.jobPausedTotalSec = 0;
        serverState.jobLoaded.status = 'running';
        serverState.jobLoaded.currentLine = effectiveStartLine;
        broadcast('server-state-updated', serverState);
      }

      const displayFilename = serverState.jobLoaded?.filename || filename;

      log('Starting job from line:', effectiveStartLine, 'with resume sequence');

      // Fire and forget - don't await, let job run in background
      jobManager.startJob(cachePath, displayFilename, actualCNCController, broadcast, commandProcessor, {
        serverState,
        startLine: effectiveStartLine,
        resumeSequence
      }).catch(error => {
        log('Error during job execution from line:', error);
      });

      log('G-code job started from line:', effectiveStartLine);
      res.json({
        success: true,
        message: arcAdjustment.wasAdjusted
          ? `G-code job started from line ${effectiveStartLine} (adjusted from ${startLine} - arc start)`
          : `G-code job started from line ${effectiveStartLine}`,
        filename,
        startLine: effectiveStartLine,
        originalStartLine: arcAdjustment.wasAdjusted ? startLine : null,
        lineAdjusted: arcAdjustment.wasAdjusted,
        resumeSequence
      });
    } catch (error) {
      log('Error starting G-code job from line:', error);
      const errorMessage = error.message || 'Failed to start G-code job from line';
      res.status(500).json({ error: errorMessage });
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
    this.startLine = options.startLine || 1;
    this.resumeSequence = options.resumeSequence || [];
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
          await this.progressProvider.startWithContent(content, { startLine: this.startLine });
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
    this.currentLineNumber = this.startLine > 1 ? this.startLine - 1 : 0;

    // Note: onBeforeJobStart event is now emitted at file load time (in routes.js)
    // This ensures the visualizer shows the processed G-code and avoids double processing
    if (content !== null && typeof content === 'string') {
      this.gcodeContent = content;
    }

    // Execute resume sequence if starting from a line other than 1
    if (this.startLine > 1 && this.resumeSequence.length > 0) {
      await this.executeResumeSequence();
    }

    await this.processLinesStream();
  }

  async executeResumeSequence() {
    log('Executing resume sequence for start from line:', this.startLine);

    let resumeLineNumber = 0;

    for (const command of this.resumeSequence) {
      if (this.isStopped) {
        break;
      }

      const cleanCommand = command.trim();
      if (!cleanCommand || cleanCommand.startsWith(';')) {
        continue;
      }

      resumeLineNumber++;

      try {
        const commandId = `resume-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        // Build context for plugins/command processor
        const lineContext = {
          lineNumber: 0, // Resume sequence is "line 0" (before actual job)
          filename: this.filename,
          sourceId: this.sourceId,
          isResumeSequence: true
        };

        // Allow plugins to process/modify the command
        let processedCommand = await this.eventBus.emitChain('onBeforeGcodeLine', cleanCommand, lineContext);

        // Process through command processor (handles M6, macros, etc.)
        const pluginContext = {
          sourceId: this.sourceId,
          commandId,
          lineNumber: 0,
          meta: {
            lineNumber: 0,
            resumeSequence: true,
            resumeLineNumber,
            job: { filename: this.filename },
            sourceId: this.sourceId
          },
          machineState: this.cncController.lastStatus
        };

        const result = await this.commandProcessor.instance.process(processedCommand, pluginContext);

        // Check if command was skipped (e.g., same-tool M6)
        if (!result.shouldContinue) {
          log('Resume sequence command skipped:', cleanCommand);
          continue;
        }

        // Send all resulting commands
        for (const cmd of result.commands) {
          const uniqueCommandId = cmd.commandId || `${commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

          await this.cncController.sendCommand(cmd.command, {
            commandId: uniqueCommandId,
            displayCommand: `[Resume] ${cmd.displayCommand || cleanCommand}`,
            meta: {
              resumeSequence: true,
              resumeLineNumber,
              sourceId: this.sourceId,
              ...(cmd.meta || {})
            }
          });
        }
      } catch (error) {
        log('Error executing resume sequence command:', cleanCommand, error);
        this.isStopped = true;
        this.isRunning = false;
        throw error;
      }
    }

    log('Resume sequence completed');
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

      let fileLineNumber = 0;

      for await (const originalLine of lineStream) {
        fileLineNumber++;

        // Skip lines before startLine when starting from a specific line
        if (fileLineNumber < this.startLine) {
          continue;
        }

        while (this.isPaused && !this.isStopped) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.isStopped) {
          break;
        }

        this.currentLineNumber = fileLineNumber;

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
