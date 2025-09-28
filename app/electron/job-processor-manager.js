import { GCodeJobProcessor } from './routes/gcode-job-routes.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [JOB MANAGER]`, ...args);
};

class JobProcessorManager {
  constructor() {
    this.currentJob = null;
  }

  async startJob(filePath, filename, cncController, broadcast) {
    if (this.currentJob) {
      throw new Error('A job is already running. Stop the current job before starting a new one.');
    }

    this.currentJob = new GCodeJobProcessor(filePath, filename, cncController, broadcast);
    await this.currentJob.start();
    log('Job started:', filename);

    // Listen for job completion to clear the reference
    this.currentJob.onComplete(() => {
      log('Job completed, clearing reference');
      this.currentJob = null;
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
    return {
      filename: this.currentJob.filename,
      currentLine: this.currentJob.currentLine,
      totalLines: this.currentJob.lines.length,
      isRunning: this.currentJob.isRunning,
      isPaused: this.currentJob.isPaused,
      isStopped: this.currentJob.isStopped
    };
  }
}

// Export singleton instance
export const jobManager = new JobProcessorManager();