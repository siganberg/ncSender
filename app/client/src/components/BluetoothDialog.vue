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
            <h2>Pendant Connection</h2>
            <p class="bluetooth-dialog__subtitle">Connect to ncSender pendant via WiFi or Bluetooth</p>
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
        <div class="connected-device wifi" :class="{ 'connected-device--active': state.activeConnectionType === 'wifi' }">
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
          <span v-if="state.activeConnectionType === 'wifi'" class="active-badge">Active</span>
        </div>
      </section>

      <section v-if="state.connectedDevice" class="bluetooth-dialog__connected">
        <div class="connected-device" :class="{ 'connected-device--active': state.activeConnectionType === 'bluetooth' }">
          <div class="device-icon connected">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="device-info">
            <span class="device-name">{{ state.connectedDevice.name }}</span>
            <span class="device-address">{{ state.connectedDevice.version ? `v${state.connectedDevice.version}` : 'Connected' }}</span>
          </div>
          <span v-if="state.activeConnectionType === 'bluetooth'" class="active-badge">Active</span>
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

      <!-- Manual IP Connection Section (show when no pendant connected) -->
      <section v-if="!state.connectedDevice && !state.wifiPendant" class="bluetooth-dialog__manual-ip">
        <details :open="manualPendantInfo !== null || manualIpError !== null">
          <summary>
            <span class="config-title">Connect via WiFi (IP Address)</span>
            <span class="config-hint">Enter pendant IP address to activate license</span>
          </summary>
          <div class="manual-ip-form">
            <div class="form-group">
              <label for="pendant-ip">Pendant IP Address</label>
              <div class="ip-input-row">
                <input
                  id="pendant-ip"
                  type="text"
                  v-model="manualIp"
                  placeholder="192.168.1.100"
                  class="form-input"
                  @keyup.enter="connectManualIp"
                  :disabled="manualIpConnecting"
                />
                <button
                  class="btn btn-primary btn-sm"
                  @click="connectManualIp"
                  :disabled="manualIpConnecting || !manualIp"
                >
                  <span v-if="manualIpConnecting" class="spinner"></span>
                  <span>{{ manualIpConnecting ? 'Connecting...' : 'Connect' }}</span>
                </button>
              </div>
              <span class="form-hint">Find the IP address on your pendant's activation screen</span>
            </div>

            <div v-if="manualIpError" class="config-result error">
              {{ manualIpError }}
            </div>

            <!-- Show pendant info when connected -->
            <div v-if="manualPendantInfo" class="manual-pendant-connected">
              <div class="manual-pendant-header">
                <div class="device-icon connected wifi">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <div class="device-info">
                  <span class="device-name">Pendant ({{ manualIp }})</span>
                  <span class="device-address">v{{ manualPendantInfo.firmwareVersion }}</span>
                </div>
                <button class="btn btn-secondary btn-sm" @click="clearManualConnection">
                  Disconnect
                </button>
              </div>

              <!-- Device Info Box -->
              <div class="device-info-box">
                <div class="device-info-row">
                  <span class="device-info-label">Device ID</span>
                  <span class="device-info-value">{{ manualPendantInfo.deviceIdFormatted || manualPendantInfo.deviceId }}</span>
                </div>
                <div class="device-info-row">
                  <span class="device-info-label">Model</span>
                  <span class="device-info-value">{{ manualPendantInfo.deviceModel }}</span>
                </div>
                <div class="device-info-row">
                  <span class="device-info-label">Firmware</span>
                  <span class="device-info-value">v{{ manualPendantInfo.firmwareVersion }}</span>
                </div>
              </div>

              <!-- Licensed Badge or Activation Form -->
              <div v-if="manualPendantInfo.licensed" class="licensed-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                  <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>License Active</span>
              </div>

              <div v-else class="manual-activation-form">
                <div class="form-group">
                  <label for="manual-installation-id">Installation ID</label>
                  <input
                    id="manual-installation-id"
                    type="text"
                    :value="installationId"
                    @input="onInstallationIdInput"
                    placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                    class="form-input installation-id-input"
                    spellcheck="false"
                    autocomplete="off"
                    maxlength="41"
                  />
                  <span class="form-hint">Enter the Installation ID from your purchase email</span>
                </div>
                <div class="form-actions">
                  <button
                    class="btn btn-success btn-sm"
                    @click="activateManualPendant"
                    :disabled="activationSending || !isInstallationIdValid()"
                  >
                    <span v-if="activationSending" class="spinner"></span>
                    <span>{{ activationSending ? 'Activating...' : 'Activate License' }}</span>
                  </button>
                </div>
                <div v-if="activationResult" class="config-result" :class="activationResult.success ? 'success' : 'error'">
                  {{ activationResult.message }}
                </div>
              </div>
            </div>
          </div>
        </details>
      </section>

      <!-- Activation Section (show when pendant connected via BLE or WiFi and not licensed) -->
      <section v-if="(state.connectedDevice || state.wifiPendant) && pendantInfo && !pendantInfo.licensed" class="bluetooth-dialog__activation">
        <details :open="activationOpen" @toggle="activationOpen = ($event.target as HTMLDetailsElement).open">
          <summary>
            <span class="config-title">License Activation</span>
            <span class="config-hint">Activate pendant license via Bluetooth</span>
          </summary>
          <div class="activation-form">
            <div class="device-info-box">
              <div class="device-info-row">
                <span class="device-info-label">Device ID</span>
                <span class="device-info-value">{{ pendantInfo.deviceIdFormatted || pendantInfo.deviceId }}</span>
              </div>
              <div class="device-info-row">
                <span class="device-info-label">Model</span>
                <span class="device-info-value">{{ pendantInfo.deviceModel }}</span>
              </div>
              <div class="device-info-row">
                <span class="device-info-label">Firmware</span>
                <span class="device-info-value">v{{ pendantInfo.firmwareVersion }}</span>
              </div>
            </div>
            <div class="form-group">
              <label for="installation-id">Installation ID</label>
              <input
                id="installation-id"
                type="text"
                :value="installationId"
                @input="onInstallationIdInput"
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                class="form-input installation-id-input"
                spellcheck="false"
                autocomplete="off"
                maxlength="41"
              />
              <span class="form-hint">Enter the Installation ID from your purchase email</span>
            </div>
            <div class="form-actions">
              <button
                class="btn btn-success btn-sm"
                @click="activateLicense"
                :disabled="activationSending || !isInstallationIdValid()"
              >
                <span v-if="activationSending" class="spinner"></span>
                <span>{{ activationSending ? 'Activating...' : 'Activate License' }}</span>
              </button>
            </div>
            <div v-if="activationResult" class="config-result" :class="activationResult.success ? 'success' : 'error'">
              {{ activationResult.message }}
            </div>
          </div>
        </details>
      </section>

      <!-- Licensed Badge (show when pendant connected and licensed) -->
      <section v-if="(state.connectedDevice || state.wifiPendant) && pendantInfo?.licensed" class="bluetooth-dialog__licensed">
        <div class="licensed-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>License Active</span>
        </div>
      </section>

      <!-- WiFi Configuration Section (show when BLE connected) -->
      <section v-if="state.connectedDevice" class="bluetooth-dialog__wifi-config">
        <details :open="wifiConfigOpen" @toggle="wifiConfigOpen = ($event.target as HTMLDetailsElement).open">
          <summary>
            <span class="config-title">WiFi Configuration</span>
            <span class="config-hint">Configure pendant WiFi via Bluetooth</span>
          </summary>
          <div class="wifi-config-form">
            <div class="form-group">
              <label for="wifi-ssid">WiFi Network (SSID)</label>
              <input
                id="wifi-ssid"
                type="text"
                v-model="wifiConfig.ssid"
                placeholder="Enter WiFi network name"
                class="form-input"
              />
            </div>
            <div class="form-group">
              <label for="wifi-password">WiFi Password</label>
              <input
                id="wifi-password"
                type="password"
                v-model="wifiConfig.password"
                placeholder="Enter WiFi password"
                class="form-input"
              />
            </div>
            <div class="form-row">
              <span class="form-label">ncSender Server</span>
              <span class="form-value">{{ wifiConfig.serverIP }}:{{ wifiConfig.serverPort }}</span>
            </div>
            <div class="form-actions">
              <button
                class="btn btn-primary btn-sm"
                @click="sendWifiConfig"
                :disabled="wifiConfigSending || !wifiConfig.ssid"
              >
                <span v-if="wifiConfigSending" class="spinner"></span>
                <span>{{ wifiConfigSending ? 'Sending...' : 'Send to Pendant' }}</span>
              </button>
            </div>
            <div v-if="wifiConfigResult" class="config-result" :class="wifiConfigResult.success ? 'success' : 'error'">
              {{ wifiConfigResult.message }}
            </div>
          </div>
        </details>
      </section>

      <!-- Help Icon with Tooltip -->
      <div class="bluetooth-dialog__help-icon">
        <button
          class="help-button"
          @click="showHelpTooltip = !showHelpTooltip"
          @mouseenter="showHelpTooltip = true"
          @mouseleave="showHelpTooltip = false"
          aria-label="Help"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="17" r="1" fill="currentColor"/>
          </svg>
        </button>
        <div v-if="showHelpTooltip" class="help-tooltip">
          <h4>Troubleshooting</h4>
          <ul>
            <li>Ensure your pendant is powered on and not connected to another device</li>
            <li>The pendant should be advertising with "pibotPendant" or similar name</li>
            <li>On macOS, grant Bluetooth permission in System Settings &gt; Privacy &amp; Security &gt; Bluetooth</li>
            <li>Try restarting ncSender if Bluetooth is unavailable</li>
          </ul>
        </div>
      </div>

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
  version?: string;
}

interface PendantInfo {
  firmwareVersion: string;
  deviceId: string;
  deviceIdFormatted: string;
  deviceModel: string;
  licensed: boolean;
  licenseId?: string;
  customer?: string;
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
  activeConnectionType: 'wifi' | 'bluetooth' | null;
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
  error: null,
  activeConnectionType: null
});

let pollInterval: ReturnType<typeof setInterval> | null = null;

// WiFi configuration state
const wifiConfigOpen = ref(false);
const wifiConfigSending = ref(false);
const wifiConfigResult = ref<{ success: boolean; message: string } | null>(null);
const wifiConfig = ref({
  ssid: '',
  password: '',
  serverIP: '',
  serverPort: 8090
});

// Help tooltip state
const showHelpTooltip = ref(false);

// Activation state
const activationOpen = ref(false);
const activationSending = ref(false);
const activationResult = ref<{ success: boolean; message: string } | null>(null);
const pendantInfo = ref<PendantInfo | null>(null);
const installationId = ref('');

// Manual IP connection state
const manualIp = ref('');
const manualIpConnecting = ref(false);
const manualIpError = ref<string | null>(null);
const manualPendantInfo = ref<PendantInfo | null>(null);

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
    const wasBleConnected = !!state.value.connectedDevice;
    const wasWifiConnected = !!state.value.wifiPendant;
    const isNowBleConnected = !!data.connectedDevice;
    const isNowWifiConnected = !!data.wifiPendant;

    state.value.adapterState = data.adapterState;
    state.value.connectionState = data.connectionState;
    state.value.connectedDevice = data.connectedDevice;
    state.value.wifiPendant = data.wifiPendant;
    state.value.isAvailable = data.isAvailable && data.adapterState === 'poweredOn';
    state.value.activeConnectionType = data.activeConnectionType || null;
    if (data.error && !state.value.error) {
      state.value.error = data.error;
    }

    // Fetch pendant info when any pendant connected (BLE or WiFi)
    if (isNowBleConnected || isNowWifiConnected) {
      fetchPendantInfo();
    }

    // Clear pendant info when all pendants disconnect
    if ((wasBleConnected || wasWifiConnected) && !isNowBleConnected && !isNowWifiConnected) {
      pendantInfo.value = null;
      activationResult.value = null;
    }
  } catch (err) {
    console.error('Failed to fetch Bluetooth status:', err);
  }
};

const fetchPendantInfo = async () => {
  try {
    // Try BLE first if connected
    if (state.value.connectedDevice) {
      const response = await fetch('/api/pendant/info');
      if (response.ok) {
        pendantInfo.value = await response.json();
        if (pendantInfo.value && !pendantInfo.value.licensed) {
          activationOpen.value = true;
        }
        return;
      }
    }

    // Fall back to WiFi pendant API
    if (state.value.wifiPendant?.ip) {
      const response = await fetch(`http://${state.value.wifiPendant.ip}/api/info`);
      if (response.ok) {
        pendantInfo.value = await response.json();
        if (pendantInfo.value && !pendantInfo.value.licensed) {
          activationOpen.value = true;
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch pendant info:', err);
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

// Fetch server info for WiFi configuration defaults
const fetchServerInfo = async () => {
  try {
    const response = await fetch('/api/server-info');
    const data = await response.json();
    if (data.serverIP) {
      wifiConfig.value.serverIP = data.serverIP;
    }
    if (data.serverPort) {
      wifiConfig.value.serverPort = data.serverPort;
    }
  } catch (err) {
    console.error('Failed to fetch server info:', err);
  }
};

// Send WiFi configuration to pendant via BLE
const sendWifiConfig = async () => {
  if (!state.value.connectedDevice || wifiConfigSending.value) return;

  wifiConfigSending.value = true;
  wifiConfigResult.value = null;

  try {
    const response = await fetch('/api/pendant/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          type: 'pendant:configure-wifi',
          data: {
            ssid: wifiConfig.value.ssid,
            password: wifiConfig.value.password,
            serverIP: wifiConfig.value.serverIP,
            serverPort: wifiConfig.value.serverPort
          }
        }
      })
    });

    if (response.ok) {
      wifiConfigResult.value = {
        success: true,
        message: 'Configuration sent! Restart pendant to apply WiFi settings.'
      };
    } else {
      const data = await response.json();
      wifiConfigResult.value = {
        success: false,
        message: data.error || 'Failed to send configuration'
      };
    }
  } catch (err) {
    wifiConfigResult.value = {
      success: false,
      message: 'Failed to send configuration'
    };
  } finally {
    wifiConfigSending.value = false;
  }
};

// Request pendant info via BLE
const requestPendantInfo = async () => {
  if (!state.value.connectedDevice) return;

  try {
    // Send pendant:get-info request via BLE
    await fetch('/api/pendant/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          type: 'pendant:get-info'
        }
      })
    });
  } catch (err) {
    console.error('Failed to request pendant info:', err);
  }
};

// Format installation ID (XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX)
const formatInstallationId = (raw: string): string => {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 36);
  const parts = clean.match(/.{1,6}/g);
  return parts ? parts.join('-') : '';
};

// Handle installation ID input
const onInstallationIdInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const pos = input.selectionStart || 0;
  const oldLen = input.value.length;
  installationId.value = formatInstallationId(input.value);
  const newLen = installationId.value.length;
  const newPos = pos + (newLen - oldLen);
  input.setSelectionRange(newPos, newPos);
};

// Validate installation ID
const isInstallationIdValid = (): boolean => {
  const raw = installationId.value.replace(/[^A-Za-z0-9]/g, '');
  return raw.length === 36;
};

// Connect to pendant via manual IP address
const connectManualIp = async () => {
  if (!manualIp.value || manualIpConnecting.value) return;

  manualIpConnecting.value = true;
  manualIpError.value = null;
  manualPendantInfo.value = null;

  try {
    const response = await fetch(`http://${manualIp.value}/api/info`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Failed to connect (HTTP ${response.status})`);
    }

    const info = await response.json();
    manualPendantInfo.value = info;

    if (!info.licensed) {
      activationOpen.value = true;
    }
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      manualIpError.value = 'Connection timed out. Check the IP address and ensure the pendant is online.';
    } else if (err.message?.includes('Failed to fetch')) {
      manualIpError.value = 'Unable to reach pendant. Check the IP address and network connection.';
    } else {
      manualIpError.value = err.message || 'Failed to connect to pendant';
    }
  } finally {
    manualIpConnecting.value = false;
  }
};

// Activate pendant via manual IP
const activateManualPendant = async () => {
  if (!manualPendantInfo.value || activationSending.value || !isInstallationIdValid()) return;
  if (!manualPendantInfo.value.deviceId) {
    activationResult.value = {
      success: false,
      message: 'Device ID not available.'
    };
    return;
  }

  activationSending.value = true;
  activationResult.value = null;

  try {
    const response = await fetch('/api/pendant/activate-wifi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: installationId.value.trim().toUpperCase(),
        deviceId: manualPendantInfo.value.deviceId,
        pendantIp: manualIp.value
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      activationResult.value = {
        success: true,
        message: 'License activated successfully! The pendant will update.'
      };
      if (manualPendantInfo.value) {
        manualPendantInfo.value.licensed = true;
      }
      installationId.value = '';
    } else {
      activationResult.value = {
        success: false,
        message: data.error || 'Activation failed'
      };
    }
  } catch (err) {
    activationResult.value = {
      success: false,
      message: 'Failed to activate license'
    };
  } finally {
    activationSending.value = false;
  }
};

// Clear manual connection
const clearManualConnection = () => {
  manualPendantInfo.value = null;
  manualIpError.value = null;
  activationResult.value = null;
};

// Activate pendant license
const activateLicense = async () => {
  const hasPendant = state.value.connectedDevice || state.value.wifiPendant;
  if (!hasPendant || activationSending.value || !isInstallationIdValid()) return;
  if (!pendantInfo.value?.deviceId) {
    activationResult.value = {
      success: false,
      message: 'Device ID not available. Please wait for device info.'
    };
    return;
  }

  activationSending.value = true;
  activationResult.value = null;

  try {
    let response;

    // Use BLE activation if Bluetooth connected, otherwise use WiFi
    if (state.value.connectedDevice) {
      response = await fetch('/api/pendant/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: installationId.value.trim().toUpperCase(),
          deviceId: pendantInfo.value.deviceId
        })
      });
    } else if (state.value.wifiPendant?.ip) {
      // WiFi activation - call server endpoint that handles WiFi activation
      response = await fetch('/api/pendant/activate-wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: installationId.value.trim().toUpperCase(),
          deviceId: pendantInfo.value.deviceId,
          pendantIp: state.value.wifiPendant.ip
        })
      });
    } else {
      throw new Error('No pendant connection available');
    }

    const data = await response.json();

    if (response.ok && data.success) {
      activationResult.value = {
        success: true,
        message: 'License activated successfully! The pendant will update.'
      };
      // Update local state
      if (pendantInfo.value) {
        pendantInfo.value.licensed = true;
      }
      // Clear installation ID
      installationId.value = '';
    } else {
      activationResult.value = {
        success: false,
        message: data.error || 'Activation failed'
      };
    }
  } catch (err) {
    activationResult.value = {
      success: false,
      message: 'Failed to activate license'
    };
  } finally {
    activationSending.value = false;
  }
};

onMounted(async () => {
  await fetchStatus();
  fetchDevices();
  fetchServerInfo();
  // Fetch pendant info if already connected (BLE or WiFi)
  if (state.value.connectedDevice || state.value.wifiPendant) {
    fetchPendantInfo();
  }
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
  position: relative;
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

.active-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--color-accent);
  color: white;
}

.connected-device--active {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
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

/* Manual IP Connection Section */
.bluetooth-dialog__manual-ip {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.bluetooth-dialog__manual-ip summary {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bluetooth-dialog__manual-ip .config-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.bluetooth-dialog__manual-ip .config-hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.manual-ip-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
}

.ip-input-row {
  display: flex;
  gap: 8px;
}

.ip-input-row .form-input {
  flex: 1;
}

.manual-pendant-connected {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(40, 167, 69, 0.08);
  border: 1px solid rgba(40, 167, 69, 0.25);
  border-radius: 12px;
}

.manual-pendant-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.manual-pendant-header .device-info {
  flex: 1;
}

.manual-activation-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid rgba(40, 167, 69, 0.25);
}

/* Activation Section */
.bluetooth-dialog__activation {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.bluetooth-dialog__activation summary {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bluetooth-dialog__activation .config-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.bluetooth-dialog__activation .config-hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.activation-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
}

.device-info-box {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
}

.device-info-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.85rem;
}

.device-info-label {
  color: var(--color-text-secondary);
}

.device-info-value {
  color: var(--color-text-primary);
  font-weight: 500;
  font-family: var(--font-mono, monospace);
}

.installation-id-input {
  font-family: var(--font-mono, monospace);
  font-size: 0.95rem;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.form-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* Licensed Badge */
.bluetooth-dialog__licensed {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.licensed-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(40, 167, 69, 0.1);
  border: 1px solid rgba(40, 167, 69, 0.3);
  border-radius: 8px;
  color: #28a745;
  font-weight: 600;
}

/* WiFi Configuration */
.bluetooth-dialog__wifi-config {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.bluetooth-dialog__wifi-config summary {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bluetooth-dialog__wifi-config .config-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.bluetooth-dialog__wifi-config .config-hint {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.wifi-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.form-input {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.9rem;
  background: var(--color-surface);
  color: var(--color-text-primary);
  transition: border-color 0.15s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.form-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.form-actions {
  padding-top: 8px;
}

.config-result {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.config-result.success {
  background: rgba(40, 167, 69, 0.1);
  color: #28a745;
  border: 1px solid rgba(40, 167, 69, 0.3);
}

.config-result.error {
  background: rgba(220, 53, 69, 0.1);
  color: #dc3545;
  border: 1px solid rgba(220, 53, 69, 0.3);
}

.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.form-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: var(--font-mono, monospace);
}

/* Help Icon and Tooltip */
.bluetooth-dialog__help-icon {
  position: absolute;
  top: 24px;
  right: 56px;
}

.help-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.15s ease;
}

.help-button:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-muted);
}

.help-tooltip {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 320px;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.help-tooltip h4 {
  margin: 0 0 12px 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.help-tooltip ul {
  margin: 0;
  padding-left: 18px;
}

.help-tooltip li {
  margin: 6px 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
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

.btn-success {
  background: #28a745;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #218838;
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
