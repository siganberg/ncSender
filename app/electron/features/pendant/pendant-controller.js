/*
 * Pendant Controller
 *
 * Manages BLE pendant initialization and shutdown based on showPendant setting.
 * Allows dynamic enable/disable at runtime.
 */

import { createLogger } from '../../core/logger.js';
import { getSetting } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('Pendant');

class PendantController {
  constructor() {
    this.isEnabled = false;
    this.bleClientAdapter = null;
    this.blePendantManager = null;
    this.dependencies = null;
  }

  /**
   * Store dependencies needed for BLE setup (call this once at app startup)
   */
  setDependencies(deps) {
    this.dependencies = deps;
  }

  /**
   * Initialize pendant (BLE) if showPendant setting is enabled
   */
  async initialize() {
    const showPendant = getSetting('showPendant', false);
    if (showPendant) {
      await this.enable();
    }
  }

  /**
   * Enable BLE pendant support
   */
  async enable() {
    if (this.isEnabled) {
      log('Pendant already enabled');
      return true;
    }

    if (!this.dependencies) {
      logError('Cannot enable pendant: dependencies not set');
      return false;
    }

    try {
      log('Enabling pendant support...');

      // Dynamic import to avoid loading BLE modules when not needed
      const bleClientModule = await import('./ble-client.js');
      const bleManagerModule = await import('./ble-manager.js');

      this.bleClientAdapter = bleClientModule.bleClientAdapter;
      this.blePendantManager = bleManagerModule.blePendantManager;

      // Setup BLE client adapter
      this.bleClientAdapter.setup(this.dependencies);

      // Try auto-connect
      try {
        const connected = await this.blePendantManager.autoConnect();
        if (connected) {
          log('BLE pendant auto-connected');
        }
      } catch (err) {
        log('BLE auto-connect skipped:', err.message);
      }

      this.isEnabled = true;
      log('Pendant support enabled');
      return true;
    } catch (err) {
      logError('Failed to enable pendant:', err.message);
      return false;
    }
  }

  /**
   * Disable BLE pendant support
   */
  async disable() {
    if (!this.isEnabled) {
      log('Pendant already disabled');
      return true;
    }

    try {
      log('Disabling pendant support...');

      // Disconnect if connected
      if (this.blePendantManager?.isConnected()) {
        await this.blePendantManager.disconnect();
      }

      // Stop any ongoing scans
      if (this.blePendantManager) {
        await this.blePendantManager.stopScan();
      }

      this.isEnabled = false;
      log('Pendant support disabled');
      return true;
    } catch (err) {
      logError('Failed to disable pendant:', err.message);
      return false;
    }
  }

  /**
   * Toggle pendant support based on showPendant setting change
   */
  async onSettingChanged(showPendant) {
    if (showPendant) {
      return this.enable();
    } else {
      return this.disable();
    }
  }

  /**
   * Get BLE client adapter (may be null if not enabled)
   */
  getBleClientAdapter() {
    return this.bleClientAdapter;
  }

  /**
   * Get BLE pendant manager (may be null if not enabled)
   */
  getBlePendantManager() {
    return this.blePendantManager;
  }

  /**
   * Check if pendant support is enabled
   */
  isPendantEnabled() {
    return this.isEnabled;
  }
}

// Singleton instance
export const pendantController = new PendantController();
