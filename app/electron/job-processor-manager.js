import { GCodeJobProcessor } from './features/gcode/job-routes.js';
import { GrblHalTelemetryProvider } from './features/cnc/telemetry-provider.js';
import { JobProgressEstimator } from './features/gcode/job-progress-estimator.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [JOB MANAGER]`, ...args);
};

class JobProcessorManager {
  constructor() {
    this.currentJob = null;
    this.progressProviderFactory = null;
  }

  async startJob(filePath, filename, cncController, broadcast) {
    if (this.currentJob) {
      throw new Error('A job is already running. Stop the current job before starting a new one.');
    }

    // Create a swappable telemetry-backed progress provider
    const progressProvider = this.progressProviderFactory
      ? this.progressProviderFactory(cncController, { filePath, filename })
      : new JobProgressEstimator({ telemetry: new GrblHalTelemetryProvider(cncController) });

    this.currentJob = new GCodeJobProcessor(
      filePath,
      filename,
      cncController,
      broadcast,
      { progressProvider }
    );
    await this.currentJob.start();
    log('Job started:', filename);

    // Listen for job completion to clear the reference
    this.currentJob.onComplete((reason) => {
      log('Job completed, clearing reference');
      const wasRunning = this.currentJob !== null;
      this.currentJob = null;

      // Call external completion callback if set and job was actually running
      if (wasRunning && this.onJobCompleteCallback) {
        log('Calling job complete callback');
        this.onJobCompleteCallback(reason);
      }
    });

    return this.currentJob;
  }

  pause() {
    if (!this.currentJob) {
      throw new Error('No active job to pause');
    }
    this.currentJob.pause();
    log('Job paused');
  }

  resume() {
    if (!this.currentJob) {
      throw new Error('No active job to resume');
    }
    this.currentJob.resume();
    log('Job resumed');
  }

  stop() {
    if (!this.currentJob) {
      throw new Error('No active job to stop');
    }
    this.currentJob.stop();
    log('Job stopped');
    this.currentJob = null;
  }

  forceReset() {
    // Force reset the job without validation (used when machine resets externally)
    if (this.currentJob) {
      try {
        this.currentJob.stop();
      } catch (error) {
        // Ignore errors during force reset
      }
      log('Job force reset');
      this.currentJob = null;
    }
  }

  getCurrentJob() {
    return this.currentJob;
  }

  hasActiveJob() {
    return this.currentJob !== null;
  }

  getJobStatus() {
    if (!this.currentJob) {
      return null;
    }

    // Determine status: 'running', 'paused', or 'stopped'
    let status = 'stopped';
    if (this.currentJob.isRunning) {
      status = 'running';
    } else if (this.currentJob.isPaused) {
      status = 'paused';
    }

    const est = this.currentJob.getEstimate?.() || null;

    const base = {
      filename: this.currentJob.filename,
      currentLine: this.currentJob.currentLine,
      totalLines: this.currentJob.lines.length,
      status: status
    };

    // Merge estimator output if present
    if (est && typeof est === 'object') {
      return { ...base, ...est };
    }
    return base;
  }

  setJobCompleteCallback(callback) {
    this.onJobCompleteCallback = callback;
  }

  setProgressProviderFactory(factory) {
    // factory: (cncController, { filePath, filename }) => { getEstimate(), startWithContent(), ... }
    this.progressProviderFactory = typeof factory === 'function' ? factory : null;
  }
}

// Export singleton instance
export const jobManager = new JobProcessorManager();
