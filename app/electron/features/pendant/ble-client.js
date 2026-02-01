/*
 * BLE Client Adapter
 *
 * Bridges BLE pendant connections to the WebSocket message handling infrastructure.
 * Creates a virtual client that can send/receive messages like a WebSocket client.
 */

import { EventEmitter } from 'events';
import { blePendantManager } from './ble-manager.js';
import { createLogger } from '../../core/logger.js';
import { getSetting, DEFAULT_SETTINGS, readSettings } from '../../core/settings-manager.js';
import path from 'node:path';
import { getUserDataDir } from '../../utils/paths.js';

const { log, error: logError } = createLogger('BLE-Client');


class BLEClientAdapter extends EventEmitter {
  constructor() {
    super();
    this.clientId = null;
    this.clientMeta = null;
    this.websocketLayer = null;
    this.serverState = null;
    this.jobManager = null;
    this.isSetup = false;
  }

  setup({ websocketLayer, serverState, jobManager, cncController, commandProcessor, broadcast }) {
    if (this.isSetup) return;

    this.websocketLayer = websocketLayer;
    this.serverState = serverState;
    this.jobManager = jobManager;
    this.cncController = cncController;
    this.commandProcessor = commandProcessor;
    this.wsBroadcast = broadcast;
    this.isSetup = true;

    // Handle BLE connection
    blePendantManager.on('connected', (device) => {
      this.handleConnect(device);
    });

    // Handle BLE disconnection
    blePendantManager.on('disconnected', (device) => {
      this.handleDisconnect(device);
    });

    // Handle incoming BLE messages
    blePendantManager.on('message', (message) => {
      this.handleMessage(message);
    });

    // Handle BLE errors gracefully
    blePendantManager.on('error', (err) => {
      logError('BLE error:', err.message);
    });

    log('BLE client adapter setup complete');
  }

  handleConnect(device) {
    // Generate client ID for this BLE connection
    this.clientId = `ble-${device.id}-${Date.now()}`;

    this.clientMeta = {
      clientId: this.clientId,
      ip: 'bluetooth',
      isLocal: true,
      product: 'ncSenderPendant',
      machineId: device.id,
      version: null,
      licensed: false,
      connectedAt: Date.now(),
      connectionType: 'ble',
      deviceName: device.name,
      deviceAddress: device.address
    };

    log('BLE client connected:', this.clientId, device.name);

    // Broadcast client connected event
    if (this.websocketLayer) {
      this.websocketLayer.broadcast('client:connected', this.clientMeta);
    }

    // Send initial state to pendant
    this.sendInitialState();
  }

  handleDisconnect(device) {
    if (!this.clientId) return;

    log('BLE client disconnected:', this.clientId);

    // Broadcast client disconnected event
    if (this.websocketLayer && this.clientMeta) {
      this.websocketLayer.broadcast('client:disconnected', this.clientMeta);
    }

    this.clientId = null;
    this.clientMeta = null;
  }

  async sendInitialState() {
    if (!blePendantManager.isConnected()) return;

    try {
      // Send full state including WCO for correct work position calculation
      if (this.serverState) {
        await blePendantManager.send({
          type: 'server-state-updated',
          data: {
            senderStatus: this.serverState.senderStatus,
            machineState: this.serverState.machineState,
            jobLoaded: this.serverState.jobLoaded
          }
        });
      }

      // Send settings including theme
      try {
        const settings = readSettings();
        await blePendantManager.send({
          type: 'settings-changed',
          data: settings
        });
        log('Sent settings to BLE pendant');
      } catch (settingsErr) {
        logError('Failed to send settings:', settingsErr.message);
      }

      log('Sent initial state to BLE pendant');
    } catch (err) {
      logError('Failed to send initial state:', err.message);
    }
  }

  handleMessage(message) {
    if (!message || !message.type) {
      logError('Invalid BLE message (no type)');
      return;
    }

    log('BLE message received:', message.type);

    // Route message to appropriate handler
    switch (message.type) {
      case 'cnc:command':
        this.handleCncCommand(message.data);
        break;

      case 'jog:step':
        this.handleJogStep(message.data);
        break;

      case 'client:metadata':
        this.handleClientMetadata(message.data);
        break;

      case 'job:start':
        this.handleJobStart(message.data);
        break;

      case 'job:pause':
        this.handleJobPause(message.data);
        break;

      case 'job:resume':
        this.handleJobResume(message.data);
        break;

      case 'job:stop':
        this.handleJobStop(message.data);
        break;

      default:
        if (message.type.startsWith('plugin:')) {
          this.handlePluginMessage(message);
        } else {
          log('Unhandled BLE message type:', message.type);
        }
    }
  }

  async handleCncCommand(data) {
    if (!this.websocketLayer) return;

    // Create a virtual WebSocket-like object for the handler
    const virtualWs = this.createVirtualWs();

    try {
      await this.websocketLayer.handleWebSocketCommand(virtualWs, data);
    } catch (err) {
      logError('Failed to handle CNC command:', err.message);
    }
  }

  async handleJogStep(data) {
    // Jog commands are handled similarly to WebSocket
    // The jog manager expects the message in a specific format
    if (!this.websocketLayer) return;

    const virtualWs = this.createVirtualWs();

    try {
      // Emit through the websocket layer's jog handling
      // For now, treat jog:step like a cnc:command
      const jogCommand = data.command;
      const commandData = {
        command: jogCommand,
        commandId: data.commandId,
        meta: {
          sourceId: 'ble-pendant',
          silent: data.silent || false,
          skipJogCancel: data.skipJogCancel
        }
      };

      await this.websocketLayer.handleWebSocketCommand(virtualWs, commandData);
    } catch (err) {
      logError('Failed to handle jog step:', err.message);
    }
  }

  handleClientMetadata(data) {
    if (!data || !this.clientMeta) return;

    // Update client metadata
    Object.assign(this.clientMeta, data);

    if (this.websocketLayer) {
      this.websocketLayer.broadcast('client:metadata-updated', this.clientMeta);
    }
  }

  handlePluginMessage(message) {
    // Plugin messages are forwarded to the plugin system
    // The websocket layer handles this via the plugin manager
    log('Plugin message from BLE:', message.type);
  }

  async handleJobStart(data) {
    // Start job - same logic as WebSocket job:start handler
    try {
      const filename = this.serverState?.jobLoaded?.filename;
      if (!filename) {
        log('job:start failed: No program loaded');
        return;
      }
      if (!this.serverState?.machineState?.connected) {
        log('job:start failed: CNC controller not connected');
        return;
      }
      const machineStatus = this.serverState?.machineState?.status?.toLowerCase();
      if (machineStatus !== 'idle') {
        log(`job:start failed: Machine state is ${machineStatus}`);
        return;
      }
      // Initialize timing for progress
      if (this.serverState.jobLoaded) {
        this.serverState.jobLoaded.jobStartTime = new Date().toISOString();
        this.serverState.jobLoaded.jobEndTime = null;
        this.serverState.jobLoaded.jobPauseAt = null;
        this.serverState.jobLoaded.jobPausedTotalSec = 0;
        this.serverState.jobLoaded.status = 'running';
        if (this.wsBroadcast) {
          this.wsBroadcast('server-state-updated', this.serverState);
        }
      }
      const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
      await this.jobManager.startJob(cachePath, filename, this.cncController, this.wsBroadcast, this.commandProcessor, { serverState: this.serverState });
      log('Job started via BLE');
    } catch (err) {
      logError('Failed to start job:', err.message);
    }
  }

  async handleJobPause(data) {
    // Pause job - same logic as WebSocket job:pause handler
    try {
      const machineStatus = this.serverState?.machineState?.status?.toLowerCase();
      if (machineStatus === 'hold' || machineStatus === 'door') {
        log('job:pause: Already paused');
        return;
      }
      if (machineStatus !== 'run') {
        log(`job:pause failed: Machine state is ${machineStatus}`);
        return;
      }
      const useDoorAsPause = getSetting('useDoorAsPause', DEFAULT_SETTINGS.useDoorAsPause);
      const command = useDoorAsPause ? '\x84' : '!';
      await this.cncController.sendCommand(command, {
        displayCommand: useDoorAsPause ? '\\x84 (Safety Door)' : '! (Feed Hold)',
        meta: { jobControl: true, sourceId: 'ble-pendant' }
      });
      log('Job paused via BLE');
    } catch (err) {
      logError('Failed to pause job:', err.message);
    }
  }

  async handleJobResume(data) {
    // Resume job - same logic as WebSocket job:resume handler
    try {
      const machineStatus = this.serverState?.machineState?.status?.toLowerCase();
      if (!machineStatus || !['hold', 'door'].includes(machineStatus)) {
        log(`job:resume failed: Machine state is ${machineStatus}`);
        return;
      }
      await this.cncController.sendCommand('~', {
        displayCommand: '~ (Resume)',
        meta: { jobControl: true, sourceId: 'ble-pendant' }
      });
      log('Job resumed via BLE');
    } catch (err) {
      logError('Failed to resume job:', err.message);
    }
  }

  async handleJobStop(data) {
    // Stop job - same logic as WebSocket job:stop handler
    try {
      if (!this.jobManager.hasActiveJob()) {
        log('job:stop: No active job');
        return;
      }
      const status = this.jobManager.getJobStatus();
      const isActiveMotion = status && (status.status === 'running' || status.status === 'paused');

      const rawSetting = getSetting('pauseBeforeStop', DEFAULT_SETTINGS.pauseBeforeStop);
      let pauseBeforeStop = Number(rawSetting);
      if (!Number.isFinite(pauseBeforeStop) || pauseBeforeStop < 0) {
        pauseBeforeStop = DEFAULT_SETTINGS.pauseBeforeStop;
      }

      if (isActiveMotion && pauseBeforeStop > 0) {
        await this.cncController.sendCommand('!', {
          displayCommand: '! (Feed Hold)',
          meta: { jobControl: true, sourceId: 'ble-pendant' }
        });
        await new Promise(resolve => setTimeout(resolve, pauseBeforeStop));
      }

      if (isActiveMotion) {
        await this.cncController.sendCommand('\x18', {
          displayCommand: '\\x18 (Soft Reset)',
          meta: { jobControl: true, sourceId: 'ble-pendant' }
        });
      }

      this.jobManager.stop();
      log('Job stopped via BLE');
    } catch (err) {
      logError('Failed to stop job:', err.message);
    }
  }

  createVirtualWs() {
    // Create a virtual WebSocket-like object that sends responses via BLE
    const self = this;
    return {
      clientId: this.clientId,
      isLocal: true,
      readyState: 1, // OPEN
      send: (data) => {
        self.sendToPendant(data);
      }
    };
  }

  async sendToPendant(data) {
    if (!blePendantManager.isConnected()) return;

    try {
      let message;
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else {
        message = data;
      }

      await blePendantManager.send(message);
    } catch (err) {
      logError('Failed to send to pendant:', err.message);
    }
  }

  // Called by websocket layer to broadcast to all clients including BLE
  async broadcast(type, data) {
    if (!blePendantManager.isConnected()) return;

    // Skip BLE broadcast if pendant is also connected via WebSocket
    // (pendant will receive updates via WebSocket, no need to duplicate)
    if (this.hasPendantWebSocketConnection()) {
      return;
    }

    // Only send message types the pendant actually needs
    // Skip cnc-command, cnc-command-result, etc. - pendant only needs state updates
    const pendantRelevantTypes = [
      'server-state-updated',
      'client-id',
      'settings-changed'
    ];
    if (!pendantRelevantTypes.includes(type) && !type.startsWith('pendant:')) {
      return;
    }

    try {
      await blePendantManager.send({ type, data });
    } catch (err) {
      logError('Failed to broadcast to BLE:', err.message);
    }
  }

  /**
   * Check if there's a WebSocket client that appears to be the same pendant
   * (connected via WiFi in addition to BLE)
   */
  hasPendantWebSocketConnection() {
    if (!this.websocketLayer || !this.clientMeta) return false;

    const bleDeviceId = this.clientMeta.machineId;
    const wsClients = this.websocketLayer.getClients?.() || [];

    // Check if any WebSocket client has matching machineId or is a pendant
    for (const client of wsClients) {
      if (client.connectionType === 'ble') continue; // Skip BLE clients
      if (client.product === 'ncSenderPendant' && client.machineId === bleDeviceId) {
        return true;
      }
    }

    return false;
  }

  isConnected() {
    return blePendantManager.isConnected();
  }

  getClientMeta() {
    return this.clientMeta;
  }

  getConnectionType() {
    return blePendantManager.isConnected() ? 'bluetooth' : null;
  }
}

// Singleton instance
export const bleClientAdapter = new BLEClientAdapter();
