<!--
  This file is part of ncSender.

  ncSender is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  ncSender is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with ncSender. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <Dialog @close="emit('close')" :show-header="false" size="small-plus">
    <div class="bluetooth-dialog">
      <header class="bluetooth-dialog__header">
        <div class="bluetooth-dialog__headline">
          <div class="headline-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div>
            <h2>Bluetooth Pendant</h2>
            <p class="bluetooth-dialog__subtitle">Connect to ncSender pendant via BLE</p>
          </div>
        </div>
        <button class="bluetooth-dialog__close" @click="emit('close')" aria-label="Close">&times;</button>
      </header>

      <!-- Status Section -->
      <section class="bluetooth-dialog__status" :class="statusClass">
        <div class="status-indicator">
          <span class="status-dot" :class="statusDotClass"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>
        <div v-if="state.error" class="status-error">{{ state.error }}</div>
      </section>

      <!-- Connected Devices -->
      <section v-if="state.wifiPendant" class="bluetooth-dialog__connected">
        <div class="connected-device wifi">
          <div class="device-icon connected wifi">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="device-info">
            <span class="device-name">{{ state.wifiPendant.name }}</span>
            <span class="device-address">{{ state.wifiPendant.ip }} · v{{ state.wifiPendant.version }}</span>
          </div>
          <span class="connection-badge wifi">WiFi</span>
        </div>
      </section>

      <section v-if="state.connectedDevice" class="bluetooth-dialog__connected">
        <div class="connected-device">
          <div class="device-icon connected">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="device-info">
            <span class="device-name">{{ state.connectedDevice.name }}</span>
            <span class="device-address">{{ state.connectedDevice.address || state.connectedDevice.id }}</span>
          </div>
          <span class="connection-badge bluetooth">BLE</span>
          <button class="btn btn-danger btn-sm" @click="disconnect" :disabled="state.isConnecting">
            Disconnect
          </button>
        </div>
      </section>

      <!-- Scan Section (show when no BLE device connected) -->
      <section v-if="!state.connectedDevice" class="bluetooth-dialog__scan">
        <div class="scan-header">
          <h3>Available Devices</h3>
          <button
            class="btn btn-primary btn-sm"
            @click="startScan"
            :disabled="state.isScanning || !state.isAvailable"
          >
            <span v-if="state.isScanning" class="spinner"></span>
            <span>{{ state.isScanning ? 'Scanning...' : 'Scan' }}</span>
          </button>
        </div>

        <div class="device-list">
          <div v-if="state.isScanning && state.devices.length === 0" class="device-list__empty">
            <div class="scanning-animation">
              <span class="pulse-ring"></span>
              <span class="pulse-ring delay-1"></span>
              <span class="pulse-ring delay-2"></span>
              <svg class="scan-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p>Searching for pendants...</p>
          </div>

          <div v-else-if="!state.isScanning && state.devices.length === 0" class="device-list__empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="empty-icon">
              <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <p>No devices found</p>
            <span class="hint">Make sure your pendant is powered on and in range</span>
          </div>

          <div
            v-else
            v-for="device in state.devices"
            :key="device.id"
            class="device-item"
            :class="{ 'device-item--connecting': state.connectingDeviceId === device.id }"
            @click="connect(device.id)"
          >
            <div class="device-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="device-info">
              <span class="device-name">{{ device.name }}</span>
              <span class="device-address">{{ device.address || device.id }}</span>
            </div>
            <div class="device-rssi" :class="getRssiClass(device.rssi)" :title="`Signal: ${device.rssi} dBm`">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="16" width="4" height="6" rx="1" fill="currentColor"/>
                <rect x="8" y="12" width="4" height="10" rx="1" fill="currentColor" :opacity="device.rssi > -70 ? 1 : 0.3"/>
                <rect x="14" y="8" width="4" height="14" rx="1" fill="currentColor" :opacity="device.rssi > -60 ? 1 : 0.3"/>
                <rect x="20" y="4" width="4" height="18" rx="1" fill="currentColor" :opacity="device.rssi > -50 ? 1 : 0.3"/>
              </svg>
            </div>
            <div v-if="state.connectingDeviceId === device.id" class="connecting-indicator">
              <span class="spinner"></span>
            </div>
          </div>
        </div>
      </section>

      <!-- Help Section -->
      <section class="bluetooth-dialog__help">
        <details>
          <summary>Troubleshooting</summary>
          <ul>
            <li>Ensure your pendant is powered on and not connected to another device</li>
            <li>The pendant should be advertising with "pibotPendant" or similar name</li>
            <li>On macOS, grant Bluetooth permission in System Settings > Privacy & Security > Bluetooth</li>
            <li>Try restarting ncSender if Bluetooth is unavailable</li>
          </ul>
        </details>
      </section>

      <footer class="bluetooth-dialog__footer">
        <button class="btn btn-secondary" @click="emit('close')">Close</button>
      </footer>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Dialog from './Dialog.vue';

interface BluetoothDevice {
  id: string;
  name: string;
  address?: string;
  rssi: number;
}

interface WifiPendant {
  id: string;
  name: string;
  ip: string;
  version?: string;
}

interface BluetoothState {
  adapterState: string;
  connectionState: string;
  connectedDevice: BluetoothDevice | null;
  wifiPendant: WifiPendant | null;
  isAvailable: boolean;
  isScanning: boolean;
  isConnecting: boolean;
  connectingDeviceId: string | null;
  devices: BluetoothDevice[];
  error: string | null;
}

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const state = ref<BluetoothState>({
  adapterState: 'unknown',
  connectionState: 'idle',
  connectedDevice: null,
  wifiPendant: null,
  isAvailable: false,
  isScanning: false,
  isConnecting: false,
  connectingDeviceId: null,
  devices: [],
  error: null
});

let pollInterval: ReturnType<typeof setInterval> | null = null;

const hasPendantConnected = computed(() => state.value.connectedDevice || state.value.wifiPendant);

const statusClass = computed(() => {
  if (state.value.error) return 'status--error';
  if (hasPendantConnected.value) return 'status--connected';
  if (state.value.isScanning) return 'status--scanning';
  if (!state.value.isAvailable) return 'status--unavailable';
  return 'status--idle';
});

const statusDotClass = computed(() => {
  if (hasPendantConnected.value) return 'dot--connected';
  if (state.value.isScanning) return 'dot--scanning';
  if (!state.value.isAvailable) return 'dot--unavailable';
  return 'dot--idle';
});

const statusText = computed(() => {
  if (state.value.wifiPendant && state.value.connectedDevice) return 'Connected (WiFi + Bluetooth)';
  if (state.value.wifiPendant) return 'Connected via WiFi';
  if (state.value.connectedDevice) return 'Connected via Bluetooth';
  if (state.value.isConnecting) return 'Connecting...';
  if (state.value.isScanning) return 'Scanning for devices...';
  if (state.value.adapterState === 'poweredOff') return 'Bluetooth is turned off';
  if (state.value.adapterState === 'unauthorized') return 'Bluetooth permission denied';
  if (!state.value.isAvailable) return 'Bluetooth unavailable';
  return 'Ready to scan';
});

const getRssiClass = (rssi: number) => {
  if (rssi > -50) return 'rssi--excellent';
  if (rssi > -60) return 'rssi--good';
  if (rssi > -70) return 'rssi--fair';
  return 'rssi--weak';
};

const fetchStatus = async () => {
  try {
    const response = await fetch('/api/pendant/status');
    const data = await response.json();
    state.value.adapterState = data.adapterState;
    state.value.connectionState = data.connectionState;
    state.value.connectedDevice = data.connectedDevice;
    state.value.wifiPendant = data.wifiPendant;
    state.value.isAvailable = data.isAvailable && data.adapterState === 'poweredOn';
    if (data.error && !state.value.error) {
      state.value.error = data.error;
    }
  } catch (err) {
    console.error('Failed to fetch Bluetooth status:', err);
  }
};

const fetchDevices = async () => {
  try {
    const response = await fetch('/api/pendant/devices');
    const data = await response.json();
    state.value.devices = data.devices || [];
  } catch (err) {
    console.error('Failed to fetch devices:', err);
  }
};

const startScan = async () => {
  state.value.error = null;
  state.value.isScanning = true;
  state.value.devices = [];

  try {
    const response = await fetch('/api/pendant/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 10000 })
    });

    if (!response.ok) {
      const data = await response.json();
      state.value.error = data.error || 'Scan failed';
      state.value.isScanning = false;
      return;
    }

    // Poll for devices during scan
    const scanPoll = setInterval(async () => {
      await fetchDevices();
    }, 1000);

    // Stop polling after scan duration
    setTimeout(() => {
      clearInterval(scanPoll);
      state.value.isScanning = false;
      fetchDevices();
    }, 10000);

  } catch (err) {
    state.value.error = 'Failed to start scan';
    state.value.isScanning = false;
  }
};

const connect = async (deviceId: string) => {
  if (state.value.isConnecting) return;

  state.value.error = null;
  state.value.isConnecting = true;
  state.value.connectingDeviceId = deviceId;

  try {
    const response = await fetch('/api/pendant/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });

    const data = await response.json();

    if (!response.ok) {
      state.value.error = data.error || 'Connection failed';
    } else {
      state.value.connectedDevice = data.device;
    }
  } catch (err) {
    state.value.error = 'Failed to connect';
  } finally {
    state.value.isConnecting = false;
    state.value.connectingDeviceId = null;
  }
};

const disconnect = async () => {
  state.value.error = null;

  try {
    await fetch('/api/pendant/disconnect', { method: 'POST' });
    state.value.connectedDevice = null;
  } catch (err) {
    state.value.error = 'Failed to disconnect';
  }
};

onMounted(() => {
  fetchStatus();
  fetchDevices();
  pollInterval = setInterval(fetchStatus, 3000);
});

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
});
</script>

<style scoped>
.bluetooth-dialog {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  min-width: 420px;
  max-width: 520px;
}

.bluetooth-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.bluetooth-dialog__headline {
  display: flex;
  align-items: center;
  gap: 12px;
}

.headline-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #0066cc, #0099ff);
  border-radius: 12px;
  color: white;
}

.bluetooth-dialog__headline h2 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
}

.bluetooth-dialog__subtitle {
  margin: 2px 0 0 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.bluetooth-dialog__close {
  background: none;
  border: none;
  font-size: 1.8rem;
  line-height: 1;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0 4px;
}

.bluetooth-dialog__close:hover {
  color: var(--color-text-primary);
}

/* Status Section */
.bluetooth-dialog__status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
}

.bluetooth-dialog__status.status--connected {
  background: rgba(40, 167, 69, 0.1);
  border-color: rgba(40, 167, 69, 0.3);
}

.bluetooth-dialog__status.status--error {
  background: rgba(220, 53, 69, 0.1);
  border-color: rgba(220, 53, 69, 0.3);
}

.bluetooth-dialog__status.status--unavailable {
  background: rgba(108, 117, 125, 0.1);
  border-color: rgba(108, 117, 125, 0.3);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.dot--connected {
  background: #28a745;
  box-shadow: 0 0 8px rgba(40, 167, 69, 0.6);
}

.status-dot.dot--scanning {
  background: #0099ff;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-dot.dot--unavailable {
  background: #6c757d;
}

.status-dot.dot--idle {
  background: #ffc107;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.status-text {
  font-weight: 600;
  color: var(--color-text-primary);
}

.status-error {
  font-size: 0.85rem;
  color: #dc3545;
}

/* Connected Device */
.bluetooth-dialog__connected {
  padding: 0;
}

.connected-device {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(40, 167, 69, 0.08);
  border: 1px solid rgba(40, 167, 69, 0.25);
  border-radius: 12px;
}

.device-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--color-surface-muted);
  border-radius: 10px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.device-icon.connected {
  background: #0099ff;
  color: white;
}

.device-icon.connected.wifi {
  background: #28a745;
}

.connection-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.connection-badge.wifi {
  background: rgba(40, 167, 69, 0.15);
  color: #28a745;
}

.connection-badge.bluetooth {
  background: rgba(0, 153, 255, 0.15);
  color: #0099ff;
}

.connected-device.wifi {
  background: rgba(40, 167, 69, 0.08);
  border-color: rgba(40, 167, 69, 0.25);
}

.device-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.device-name {
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.device-address {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scan Section */
.bluetooth-dialog__scan {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.scan-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 8px;
}

.device-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-secondary);
}

.device-list__empty p {
  margin: 12px 0 4px 0;
  font-weight: 500;
}

.device-list__empty .hint {
  font-size: 0.8rem;
  opacity: 0.7;
}

.empty-icon {
  opacity: 0.4;
}

.scanning-animation {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border: 2px solid #0099ff;
  border-radius: 50%;
  opacity: 0;
  animation: pulse-ring 2s ease-out infinite;
}

.pulse-ring.delay-1 { animation-delay: 0.5s; }
.pulse-ring.delay-2 { animation-delay: 1s; }

@keyframes pulse-ring {
  0% { transform: scale(0.5); opacity: 0.8; }
  100% { transform: scale(1.5); opacity: 0; }
}

.scan-icon {
  color: #0099ff;
  z-index: 1;
}

.device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.device-item:hover {
  border-color: var(--color-accent);
  background: rgba(26, 188, 156, 0.05);
}

.device-item--connecting {
  opacity: 0.7;
  pointer-events: none;
}

.device-rssi {
  color: var(--color-text-secondary);
}

.device-rssi.rssi--excellent { color: #28a745; }
.device-rssi.rssi--good { color: #7cb342; }
.device-rssi.rssi--fair { color: #ffc107; }
.device-rssi.rssi--weak { color: #dc3545; }

.connecting-indicator {
  margin-left: auto;
}

/* Help Section */
.bluetooth-dialog__help {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.bluetooth-dialog__help details {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.bluetooth-dialog__help summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 8px;
}

.bluetooth-dialog__help ul {
  margin: 0;
  padding-left: 20px;
}

.bluetooth-dialog__help li {
  margin: 4px 0;
  line-height: 1.5;
}

/* Footer */
.bluetooth-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  border: none;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  padding: 10px 16px;
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.btn-primary {
  background: linear-gradient(135deg, #0066cc, #0099ff);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 102, 204, 0.4);
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface);
}

.btn-danger {
  background: #dc3545;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #c82333;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
