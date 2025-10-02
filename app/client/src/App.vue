<template>
  <AppShell>
    <template #top-toolbar>
      <TopToolbar
        :workspace="workspace"
        :connected="status.connected && websocketConnected"
        :setup-required="showSetupDialog"
        :machine-state="status.machineState"
        :is-tool-changing="serverState.machineState?.isToolChanging"
        @toggle-theme="toggleTheme"
        :on-show-settings="openSettings"
      />
    </template>

    <template #main>
      <ToolpathViewport
        :view="viewport"
        :theme="theme"
        :connected="status.connected && websocketConnected"
        :machine-state="status.machineState"
        :job-loaded="serverState.jobLoaded"
        :work-coords="status.workCoords"
        :spindle-rpm="status.spindleRpm"
        :current-tool="status.tool"
        @change-view="viewport = $event"
      />
      <RightPanel
        :status="{ ...status, connected: status.connected && websocketConnected }"
        :console-lines="consoleLines"
        :jog-config="jogConfig"
        :job-loaded="serverState.jobLoaded"
        @update:jog-step="jogConfig.stepSize = $event"
        @clear-console="clearConsole"
      />
    </template>

    <!-- Utility bar hidden for now -->
    <!-- <template #utility-bar>
      <UtilityBar
        :connected="status.connected"
        :theme="theme"
        @toggle-theme="toggleTheme"
      />
    </template> -->
  </AppShell>

  <!-- Dialog moved outside AppShell to avoid overflow clipping -->
  <Dialog v-if="showSettings" @close="showSettings = false" :show-header="false" size="medium">
    <div class="settings-container">
      <div class="tabs">
        <button
          v-for="tab in settingsTabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </div>

      <div class="tab-content">
        <!-- General Tab -->
        <div v-if="activeTab === 'general'" class="tab-panel">
          <div class="settings-section">
            <h3 class="section-title">Connection Settings</h3>
            <div class="setting-item">
              <label class="setting-label">Connection Type</label>
              <select class="setting-select setting-input--right" v-model="connectionSettings.type" @change="loadMainUsbPorts">
                <option value="USB">USB</option>
                <option value="Ethernet">Ethernet</option>
              </select>
            </div>
            <div class="setting-item" v-if="connectionSettings.type === 'USB'">
              <label class="setting-label">USB Port</label>
              <div class="custom-dropdown">
                <button
                  class="dropdown-trigger setting-input--right"
                  :class="{ 'invalid': !mainValidation.usbPort && connectionSettings.type === 'USB' }"
                  @click="mainUsbDropdownOpen = !mainUsbDropdownOpen"
                  type="button"
                >
                  <span>{{ getSelectedMainPortDisplay() }}</span>
                  <span class="dropdown-arrow">▼</span>
                </button>
                <div v-if="mainUsbDropdownOpen" class="dropdown-menu">
                  <div
                    v-if="availableUsbPorts.length === 0"
                    class="dropdown-item disabled"
                  >
                    No USB ports available
                  </div>
                  <div
                    v-for="port in availableUsbPorts"
                    :key="port.path"
                    class="dropdown-item"
                    @click="selectMainUsbPort(port)"
                  >
                    <div class="port-path">{{ port.path }}</div>
                    <div class="port-manufacturer">{{ port.manufacturer || 'Unknown Manufacturer' }}</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="setting-item">
              <label class="setting-label">Baud Rate</label>
              <select class="setting-select setting-input--right" v-model="connectionSettings.baudRate">
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400">38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200</option>
                <option value="230400">230400</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
              </select>
            </div>
            <div class="setting-item">
              <label class="setting-label">IP Address</label>
              <input
                type="text"
                class="setting-input setting-input--right"
                v-model="connectionSettings.ipAddress"
                :disabled="connectionSettings.type === 'USB'"
                :class="{ 'invalid': !isValidIP && connectionSettings.type === 'Ethernet' }"
                placeholder="192.168.5.1"
                @blur="validateIP"
              >
            </div>
            <div class="setting-item">
              <label class="setting-label">Port</label>
              <input
                type="number"
                class="setting-input setting-input--right"
                v-model="connectionSettings.port"
                :disabled="connectionSettings.type === 'USB'"
                :class="{ 'invalid': !mainValidation.port && connectionSettings.type === 'Ethernet' }"
                min="1"
                max="65535"
                @blur="validateMainPort"
              >
            </div>
            <div class="setting-item setting-item--with-note">
              <div class="setting-item-content">
                <label class="setting-label">Remote Control Port</label>
                <div class="settings-note">
                  Note: Changes this require restarting the application to take effect.
                </div>
              </div>
              <input
                type="number"
                class="setting-input setting-input--right"
                v-model="connectionSettings.serverPort"
                min="1024"
                max="65535"
              >
            </div>
          </div>

          <div class="settings-section">
            <h3 class="section-title">Application Settings</h3>
            <div class="setting-item">
              <label class="setting-label">Theme</label>
              <select class="setting-select" :value="theme" @change="theme = $event.target.value">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div class="setting-item">
              <label class="setting-label">Default Workspace</label>
              <select class="setting-select" :value="workspace" @change="workspace = $event.target.value">
                <option value="G54">G54</option>
                <option value="G55">G55</option>
                <option value="G56">G56</option>
                <option value="G57">G57</option>
                <option value="G58">G58</option>
                <option value="G59">G59</option>
              </select>
            </div>
            <div class="setting-item">
              <label class="setting-label">Default G-Code Preview</label>
              <select class="setting-select" v-model="defaultView">
                <option value="top">Top</option>
                <option value="front">Side</option>
                <option value="iso">3D</option>
              </select>
            </div>
            <div class="setting-item">
              <label class="setting-label">Accent / Gradient Color</label>
              <div class="color-picker-container">
                <input type="color" class="color-picker" :value="accentColor" @input="updateAccentColor($event.target.value)">
                <input type="color" class="color-picker" :value="gradientColor" @input="updateGradientColor($event.target.value)">
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="section-title">Console Settings</h3>
            <div class="setting-item">
              <label class="setting-label">Auto-clear console on new job</label>
              <label class="toggle-switch">
                <input type="checkbox" v-model="consoleSettings.autoClearConsole">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="setting-item">
              <label class="setting-label">Console buffer size</label>
              <span class="setting-value">50 lines (optimized for performance)</span>
            </div>
          </div>
        </div>

        <!-- Firmware Tab -->
        <div v-if="activeTab === 'firmware'" class="tab-panel tab-panel--firmware">
          <!-- Loading State -->
          <div v-if="isFirmwareLoading" class="firmware-loading">
            <div class="loading-spinner"></div>
            <p>Querying firmware settings...</p>
            <p class="loading-hint">Sending $EG, $ES, and $ESH commands to controller</p>
          </div>

          <!-- Error State -->
          <div v-else-if="firmwareError" class="firmware-error">
            <p class="error-message">{{ firmwareError }}</p>
            <button @click="loadFirmwareData" class="retry-button">Retry</button>
          </div>

          <!-- No Data State (Not Connected) -->
          <div v-else-if="!firmwareData && !status.connected" class="firmware-empty">
            <p>Connect to a CNC controller to query firmware settings</p>
          </div>

          <!-- Firmware Data Display -->
          <div v-else-if="firmwareData" class="firmware-content">
            <!-- Header with search and submit -->
            <div class="firmware-header">
              <input
                type="text"
                v-model="firmwareSearchQuery"
                placeholder="Search Firmware Settings..."
                class="firmware-search-input"
              />
              <button @click="firmwareSearchQuery = ''" class="clear-search-button" v-if="firmwareSearchQuery">
                Clear Search
              </button>
              <button
                @click="submitFirmwareChanges"
                class="submit-changes-button"
                :disabled="!hasFirmwareChanges"
                v-if="hasFirmwareChanges"
              >
                Submit Changes ({{ Object.keys(firmwareChanges).length }})
              </button>
            </div>

            <!-- Firmware Settings Table -->
            <div class="firmware-table-container">
              <table class="firmware-table">
                <thead>
                  <tr>
                    <th class="col-setting">$ Setting</th>
                    <th class="col-description">Description</th>
                    <th class="col-value">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="setting in filteredFirmwareSettings"
                    :key="setting.id"
                    class="firmware-row"
                  >
                    <td class="col-setting">
                      <div class="setting-id">{{ setting.id }}</div>
                      <div class="setting-group" v-if="setting.group">{{ setting.group.name }}</div>
                    </td>
                    <td class="col-description">
                      <div class="setting-name">{{ setting.name }}</div>
                      <div
                        class="setting-hal-description"
                        v-if="setting.halDetails && setting.halDetails[4]"
                        v-html="setting.halDetails[4].replace(/\\n/g, '<br>')"
                      ></div>
                      <div class="setting-details" v-if="setting.unit || setting.min || setting.max">
                        <span v-if="setting.unit">Unit: {{ setting.unit }}</span>
                        <span v-if="setting.min">Min: {{ setting.min }}</span>
                        <span v-if="setting.max">Max: {{ setting.max }}</span>
                      </div>
                    </td>
                    <td class="col-value">
                      <!-- DataType 0-5: Integers (int8, uint8, int16, uint16, int32, uint32) -->
                      <div v-if="[0, 1, 2, 3, 4, 5].includes(setting.dataType)" class="numeric-input-container">
                        <input
                          type="number"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                          @blur="updateNumericSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :min="setting.min || undefined"
                          :max="setting.max || undefined"
                          step="1"
                          :class="['setting-numeric-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 6: Float -->
                      <div v-else-if="setting.dataType === 6" class="numeric-input-container">
                        <input
                          type="number"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                          @blur="updateNumericSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :min="setting.min || undefined"
                          :max="setting.max || undefined"
                          step="any"
                          :class="['setting-numeric-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 7: Bitfield with toggle sliders -->
                      <div v-else-if="setting.dataType === 7 && setting.format" class="bitfield-toggles">
                        <template
                          v-for="(bitName, index) in setting.format.split(',')"
                          :key="index"
                        >
                          <span class="bitfield-name">{{ bitName.trim() }}</span>
                          <label class="toggle-switch">
                            <input
                              type="checkbox"
                              :checked="isBitSet(setting.value, index)"
                              @change="toggleBit(setting, index)"
                            />
                            <span class="toggle-slider"></span>
                          </label>
                        </template>
                      </div>

                      <!-- DataType 8: String -->
                      <div v-else-if="setting.dataType === 8" class="string-input-container">
                        <input
                          type="text"
                          :value="setting.value || ''"
                          @blur="updateStringSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :minlength="setting.min ? parseInt(setting.min) : undefined"
                          :maxlength="setting.max ? parseInt(setting.max) : undefined"
                          class="setting-string-input"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 9: Bitmask (similar to bitfield) -->
                      <div v-else-if="setting.dataType === 9 && setting.format" class="bitfield-toggles">
                        <template
                          v-for="(bitName, index) in setting.format.split(',')"
                          :key="index"
                        >
                          <span class="bitfield-name">{{ bitName.trim() }}</span>
                          <label class="toggle-switch">
                            <input
                              type="checkbox"
                              :checked="isBitSet(setting.value, index)"
                              @change="toggleBit(setting, index)"
                            />
                            <span class="toggle-slider"></span>
                          </label>
                        </template>
                      </div>

                      <!-- Default display for other data types -->
                      <div v-else>
                        <span class="setting-value-display">{{ setting.value || '—' }}</span>
                        <span class="setting-unit" v-if="setting.unit && setting.value">{{ setting.unit }}</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="filteredFirmwareSettings.length === 0">
                    <td colspan="3" class="no-results">No settings found matching "{{ firmwareSearchQuery }}"</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Footer info -->
            <div class="firmware-footer">
              <span>Last updated: {{ new Date(firmwareData.timestamp).toLocaleString() }}</span>
              <span>{{ filteredFirmwareSettings.length }} of {{ Object.keys(firmwareData.settings || {}).length }} settings</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer with Close Button -->
      <div class="settings-footer">
        <button class="close-button" @click="saveConnectionSettings">
          Save
        </button>
        <button class="close-button" @click="showSettings = false">
          Close
        </button>
      </div>
    </div>
  </Dialog>

  <!-- Mandatory Setup Dialog (non-dismissible) -->
  <Dialog v-if="showSetupDialog" :show-header="false" size="small-plus">
    <div class="setup-container">
      <div class="setup-header">
        <h2 class="setup-title">CNC Controller Setup</h2>
        <p class="setup-subtitle">Configure your CNC connection to continue</p>
      </div>

      <div class="setup-content">
        <div class="setting-item">
          <label class="setting-label">Connection Type</label>
          <select class="setting-select setting-input--right" v-model="setupSettings.type" @change="loadSetupUsbPorts(); validateSetupForm()">
            <option value="USB">USB</option>
            <option value="Ethernet">Ethernet</option>
          </select>
        </div>
        <div class="setting-item" v-if="setupSettings.type === 'USB'">
          <label class="setting-label">Serial Port (USB)</label>
          <div class="custom-dropdown">
            <button
              class="dropdown-trigger setting-input--right"
              :class="{ 'invalid': !setupValidation.usbPort }"
              @click="setupUsbDropdownOpen = !setupUsbDropdownOpen"
              type="button"
            >
              <span>{{ getSelectedSetupPortDisplay() }}</span>
              <span class="dropdown-arrow">▼</span>
            </button>
            <div v-if="setupUsbDropdownOpen" class="dropdown-menu">
              <div
                v-if="setupUsbPorts.length === 0"
                class="dropdown-item disabled"
              >
                No USB ports available
              </div>
              <div
                v-for="port in setupUsbPorts"
                :key="port.path"
                class="dropdown-item"
                @click="selectSetupUsbPort(port)"
              >
                <div class="port-path">{{ port.path }}</div>
                <div class="port-manufacturer">{{ port.manufacturer || 'Unknown Manufacturer' }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="setting-item">
          <label class="setting-label">Baud Rate</label>
          <select class="setting-select setting-input--right" v-model="setupSettings.baudRate">
            <option value="9600">9600</option>
            <option value="19200">19200</option>
            <option value="38400">38400</option>
            <option value="57600">57600</option>
            <option value="115200">115200</option>
            <option value="230400">230400</option>
            <option value="460800">460800</option>
            <option value="921600">921600</option>
          </select>
        </div>
        <div class="setting-item">
          <label class="setting-label">IP Address</label>
          <input
            type="text"
            class="setting-input setting-input--right"
            v-model="setupSettings.ipAddress"
            :disabled="setupSettings.type === 'USB'"
            :class="{ 'invalid': !setupValidation.ipAddress && setupSettings.type === 'Ethernet' }"
            placeholder="192.168.5.1"
            @blur="validateSetupIP"
          >
        </div>
        <div class="setting-item">
          <label class="setting-label">Port</label>
          <input
            type="number"
            class="setting-input setting-input--right"
            v-model="setupSettings.port"
            :disabled="setupSettings.type === 'USB'"
            :class="{ 'invalid': !setupValidation.port && setupSettings.type === 'Ethernet' }"
            min="1"
            max="65535"
            @blur="validateSetupForm"
          >
        </div>
      </div>

      <div class="setup-footer">
        <button class="setup-save-button" @click="saveSetupSettings">
          Connect
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, watchEffect, onMounted, onUnmounted } from 'vue';
import AppShell from './components/AppShell.vue';
import TopToolbar from './components/TopToolbar.vue';
import ToolpathViewport from './components/ToolpathViewport.vue';
import RightPanel from './components/RightPanel.vue';
import UtilityBar from './components/UtilityBar.vue';
import Dialog from './components/Dialog.vue';
import { api } from './lib/api.js';

const theme = ref<'light' | 'dark'>('dark'); // Default to dark mode
const workspace = ref('G54');
const viewport = ref<'top' | 'front' | 'iso'>('iso');
const defaultView = ref<'top' | 'front' | 'iso'>('iso'); // Track default view from settings
const showSettings = ref(false);
const showSetupDialog = ref(false);

// Settings tabs configuration
const activeTab = ref('general');
const settingsTabs = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'firmware', label: 'Firmware', icon: '🔧' }
];

// Immediately reflect Default G-Code Preview changes in the live viewport
watch(defaultView, (newView) => {
  viewport.value = newView;
});

// Color customization
const accentColor = ref('#1abc9c');
const gradientColor = ref('#34d399');

const currentGradient = computed(() => {
  return `linear-gradient(135deg, ${accentColor.value} 0%, ${gradientColor.value} 100%)`;
});

// Connection settings
const connectionSettings = reactive({
  type: 'USB',
  baudRate: '115200',
  ipAddress: '192.168.5.1',
  port: 23,
  serverPort: 8090,
  usbPort: ''
});

// Setup dialog connection settings (separate from main settings)
const setupSettings = reactive({
  type: 'USB',
  baudRate: '115200',
  ipAddress: '192.168.5.1',
  port: 23,
  usbPort: ''
});

// Console settings
const consoleSettings = reactive({
  autoClearConsole: true
});

// Firmware settings
const firmwareData = ref(null);
const isFirmwareLoading = ref(false);
const firmwareError = ref(null);
const firmwareSearchQuery = ref('');
const firmwareChanges = ref({}); // Track pending changes: { settingId: newValue }

// USB ports
const availableUsbPorts = ref([]);
const setupUsbPorts = ref([]);

// IP validation
const isValidIP = ref(true);
const isValidSetupIP = ref(true);

// Setup validation
const setupValidation = reactive({
  usbPort: true,
  ipAddress: true,
  port: true
});

// Main settings validation
const mainValidation = reactive({
  usbPort: true,
  ipAddress: true,
  port: true
});

// Custom dropdown states
const setupUsbDropdownOpen = ref(false);
const mainUsbDropdownOpen = ref(false);

// Load available USB ports
const loadUsbPorts = async () => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/usb-ports`);
    if (response.ok) {
      const ports = await response.json();
      return ports;
    }
  } catch (error) {
    console.error('Error loading USB ports:', error);
  }
  return [];
};

const loadMainUsbPorts = async () => {
  availableUsbPorts.value = await loadUsbPorts();

  // Trigger validation when connection type changes
  validateMainForm();
};

const loadSetupUsbPorts = async () => {
  setupUsbPorts.value = await loadUsbPorts();
};

// Custom dropdown functions
const selectSetupUsbPort = (port) => {
  setupSettings.usbPort = port.path;
  setupUsbDropdownOpen.value = false;
  // Trigger validation
  validateSetupForm();
};

const selectMainUsbPort = (port) => {
  connectionSettings.usbPort = port.path;
  mainUsbDropdownOpen.value = false;

  // Validate USB port selection
  if (connectionSettings.type === 'USB') {
    mainValidation.usbPort = !!connectionSettings.usbPort;
  }
};

const getSelectedSetupPortDisplay = () => {
  if (!setupSettings.usbPort) return 'Select USB Port...';
  const port = setupUsbPorts.value.find(p => p.path === setupSettings.usbPort);
  return port ? port.path : setupSettings.usbPort;
};

const getSelectedMainPortDisplay = () => {
  if (!connectionSettings.usbPort) return 'Select USB Port...';
  const port = availableUsbPorts.value.find(p => p.path === connectionSettings.usbPort);
  return port ? port.path : connectionSettings.usbPort;
};

// Close dropdowns when clicking outside
const handleClickOutside = (event) => {
  const target = event.target;
  if (!target.closest('.custom-dropdown')) {
    setupUsbDropdownOpen.value = false;
    mainUsbDropdownOpen.value = false;
  }
};

// Add click outside listener
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const openSettings = async () => {
  showSettings.value = true;
  // Load USB ports if connection type is USB
  if (connectionSettings.type === 'USB') {
    await loadMainUsbPorts();
  }
};

const loadFirmwareData = async (forceRefresh = false) => {
  try {
    isFirmwareLoading.value = true;
    firmwareError.value = null;

    // GET endpoint now handles everything: checks file, queries controller if needed
    const data = await api.getFirmwareSettings(forceRefresh);
    firmwareData.value = data;
  } catch (error) {
    console.error('Error loading firmware data:', error);
    firmwareError.value = error.message;
  } finally {
    isFirmwareLoading.value = false;
  }
};

// Load firmware data when firmware tab is opened
watch(activeTab, (newTab) => {
  if (newTab === 'firmware' && !firmwareData.value && !isFirmwareLoading.value) {
    loadFirmwareData();
  }
});

// Check if there are pending firmware changes
const hasFirmwareChanges = computed(() => {
  return Object.keys(firmwareChanges.value).length > 0;
});

// Computed property to filter firmware settings based on search query
const filteredFirmwareSettings = computed(() => {
  if (!firmwareData.value || !firmwareData.value.settings) {
    return [];
  }

  const settings = Object.values(firmwareData.value.settings).map((setting: any) => ({
    ...setting,
    id: setting.id.toString()
  }));

  if (!firmwareSearchQuery.value) {
    return settings.sort((a: any, b: any) => parseInt(a.id) - parseInt(b.id));
  }

  const query = firmwareSearchQuery.value.toLowerCase();
  return settings.filter((setting: any) => {
    return (
      setting.id.includes(query) ||
      setting.name?.toLowerCase().includes(query) ||
      setting.group?.name?.toLowerCase().includes(query)
    );
  }).sort((a: any, b: any) => parseInt(a.id) - parseInt(b.id));
});

// Helper function to check if a bit is set
const isBitSet = (value: string | number, bitIndex: number): boolean => {
  const numValue = typeof value === 'string' ? parseInt(value) : value;
  return ((numValue >> bitIndex) & 1) === 1;
};

// Function to toggle a bit in a bitfield setting
const toggleBit = (setting: any, bitIndex: number) => {
  // Get current value (either from pending changes or original value)
  const currentValue = firmwareChanges.value[setting.id] !== undefined
    ? firmwareChanges.value[setting.id]
    : (typeof setting.value === 'string' ? parseInt(setting.value) : (setting.value || 0));

  const newValue = currentValue ^ (1 << bitIndex); // XOR to toggle the bit

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Function to track numeric setting changes (dataTypes 0-6: integers and float)
const updateNumericSetting = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Parse and validate numeric value
  // DataType 6 = float, others (0-5) are integers
  const numValue = setting.dataType === 6 ? parseFloat(newValue) : parseInt(newValue);

  if (isNaN(numValue)) {
    console.error('Invalid numeric value');
    return;
  }

  // Validate min/max
  const min = setting.min ? parseFloat(setting.min) : -Infinity;
  const max = setting.max ? parseFloat(setting.max) : Infinity;

  if (numValue < min || numValue > max) {
    console.error(`Value must be between ${min} and ${max}`);
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = numValue;
};

const updateStringSetting = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Validate min/max length
  const minLength = setting.min ? parseInt(setting.min) : 0;
  const maxLength = setting.max ? parseInt(setting.max) : Infinity;

  if (newValue.length < minLength || newValue.length > maxLength) {
    console.error(`String length must be between ${minLength} and ${maxLength}`);
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Submit all pending firmware changes
const submitFirmwareChanges = async () => {
  if (!hasFirmwareChanges.value) {
    return;
  }

  try {
    // Send each change as a $<id>=<value> command
    for (const [settingId, newValue] of Object.entries(firmwareChanges.value)) {
      await api.sendCommand(`$${settingId}=${newValue}`);

      // Update the local value in firmwareData
      if (firmwareData.value.settings[settingId]) {
        firmwareData.value.settings[settingId].value = newValue.toString();
      }
    }

    // Clear changes after successful submission
    firmwareChanges.value = {};

    console.log('Firmware settings updated successfully');
  } catch (error) {
    console.error('Error submitting firmware changes:', error);
    alert('Failed to update firmware settings: ' + error.message);
  }
};

const updateAccentColor = (color: string) => {
  accentColor.value = color;
  applyColors();
};

const updateGradientColor = (color: string) => {
  gradientColor.value = color;
  applyColors();
};

const applyColors = () => {
  const root = document.documentElement;
  root.style.setProperty('--color-accent', accentColor.value);
  root.style.setProperty('--gradient-accent', currentGradient.value);
  // Notify listeners (e.g., 3D viewport) that accent color changed
  try {
    window.dispatchEvent(new CustomEvent('accent-color-change', { detail: { color: accentColor.value } }));
  } catch {}
};

const validateIP = () => {
  if (connectionSettings.type === 'USB') {
    isValidIP.value = true;
    return;
  }

  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  isValidIP.value = ipRegex.test(connectionSettings.ipAddress);
};

const validateSetupIP = () => {
  if (setupSettings.type === 'USB') {
    isValidSetupIP.value = true;
    setupValidation.ipAddress = true;
    return;
  }

  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const isValid = ipRegex.test(setupSettings.ipAddress);
  isValidSetupIP.value = isValid;
  setupValidation.ipAddress = isValid;
};

const validateSetupForm = () => {
  let isValid = true;

  // Validate USB port if USB connection
  if (setupSettings.type === 'USB') {
    setupValidation.usbPort = !!setupSettings.usbPort;
    if (!setupValidation.usbPort) isValid = false;

    // Clear Ethernet validation for USB
    setupValidation.ipAddress = true;
    setupValidation.port = true;
  }

  // Validate Ethernet fields if Ethernet connection
  if (setupSettings.type === 'Ethernet') {
    // Clear USB validation for Ethernet
    setupValidation.usbPort = true;

    // Validate IP
    validateSetupIP();
    if (!setupValidation.ipAddress) isValid = false;

    // Validate port
    setupValidation.port = !!(setupSettings.port && setupSettings.port > 0 && setupSettings.port <= 65535);
    if (!setupValidation.port) isValid = false;
  }

  return isValid;
};

const validateMainPort = () => {
  if (connectionSettings.type === 'USB') {
    mainValidation.port = true;
    return;
  }

  mainValidation.port = !!(connectionSettings.port && connectionSettings.port > 0 && connectionSettings.port <= 65535);
};

const validateMainForm = () => {
  let isValid = true;

  // Validate USB port if USB connection
  if (connectionSettings.type === 'USB') {
    mainValidation.usbPort = !!connectionSettings.usbPort;
    if (!mainValidation.usbPort) isValid = false;

    // Clear Ethernet validation for USB
    mainValidation.port = true;
  }

  // Validate Ethernet settings if Ethernet connection
  if (connectionSettings.type === 'Ethernet') {
    mainValidation.usbPort = true;

    // Validate IP (using existing validateIP function and isValidIP)
    validateIP();
    mainValidation.ipAddress = isValidIP.value;
    if (!mainValidation.ipAddress) isValid = false;

    // Validate port
    validateMainPort();
    if (!mainValidation.port) isValid = false;
  }

  return isValid;
};

const getApiBaseUrl = () => {
  // In development, use the same hostname but port 8090
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:8090`;
  }
  // In production, use relative URLs (same origin)
  return '';
};

const loadConnectionSettings = async () => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/settings`);

    if (response.status === 204) {
      // No settings file exists, show mandatory setup dialog
      showSetupDialog.value = true;
      // Load USB ports for setup dialog
      await loadSetupUsbPorts();
      return;
    }

    if (response.ok) {
      const settings = await response.json();

      // Map server settings to frontend format
      connectionSettings.type = settings.connectionType === 'usb' ? 'USB' : 'Ethernet';
      connectionSettings.baudRate = settings.baudRate?.toString() || '115200';
      connectionSettings.ipAddress = settings.ip || '192.168.5.1';
      connectionSettings.port = settings.port || 23;
      connectionSettings.serverPort = settings.serverPort || 8090;
      connectionSettings.usbPort = settings.usbPort || '';

      // Load application settings
      if (settings.theme) theme.value = settings.theme;
      if (settings.workspace) workspace.value = settings.workspace;
      if (settings.defaultGcodeView) {
        defaultView.value = settings.defaultGcodeView;
        viewport.value = settings.defaultGcodeView;
      }
      if (settings.accentColor) accentColor.value = settings.accentColor;
      if (settings.gradientColor) gradientColor.value = settings.gradientColor;

      // Load console settings
      if (settings.autoClearConsole !== undefined) consoleSettings.autoClearConsole = settings.autoClearConsole;

      // Load USB ports if USB connection type
      if (connectionSettings.type === 'USB') {
        await loadMainUsbPorts();
      }
    }
  } catch (error) {
    console.error('Error loading connection settings:', error);
  }
};

const saveConnectionSettings = async () => {
  // Validate form before saving
  if (!validateMainForm()) {
    return;
  }

  try {
    // Prepare the complete settings object with all settings
    const settingsToSave = {
      connectionType: connectionSettings.type?.toLowerCase() || 'usb',
      baudRate: parseInt(connectionSettings.baudRate) || 115200,
      ip: connectionSettings.ipAddress || '192.168.5.1',
      port: parseInt(connectionSettings.port) || 23,
      serverPort: parseInt(connectionSettings.serverPort) || 8090,
      usbPort: connectionSettings.usbPort || '',
      theme: theme.value,
      workspace: workspace.value,
      defaultGcodeView: defaultView.value,
      accentColor: accentColor.value,
      gradientColor: gradientColor.value,
      autoClearConsole: consoleSettings.autoClearConsole
    };

    const response = await fetch(`${getApiBaseUrl()}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settingsToSave)
    });

    if (response.ok) {
      const result = await response.json();
      showSettings.value = false;
    } else {
      const error = await response.json();
      console.error('Failed to save settings:', error.error);
    }
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

const saveSetupSettings = async () => {
  try {
    // Validate the entire form
    if (!validateSetupForm()) {
      return;
    }

    // Prepare the setup settings for saving
    const settingsToSave = {
      connectionType: setupSettings.type?.toLowerCase() || 'usb',
      baudRate: parseInt(setupSettings.baudRate) || 115200,
      ip: setupSettings.ipAddress || '192.168.5.1',
      port: parseInt(setupSettings.port) || 23,
      serverPort: 8090, // Default server port
      usbPort: setupSettings.usbPort || ''
    };

    const response = await fetch(`${getApiBaseUrl()}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settingsToSave)
    });

    if (response.ok) {
      const result = await response.json();

      // Close setup dialog and load settings
      showSetupDialog.value = false;
      await loadConnectionSettings();
    } else {
      const error = await response.json();
      console.error('Failed to save setup settings:', error.error);
    }
  } catch (error) {
    console.error('Error saving setup settings:', error);
  }
};

const clearConsole = () => {
  consoleLines.value = [];
  commandLinesMap.clear();
};

const status = reactive({
  connected: false,
  machineState: 'idle' as 'idle' | 'run' | 'hold' | 'alarm' | 'offline' | 'door' | 'check' | 'home' | 'sleep' | 'tool',
  machineCoords: { x: 0, y: 0, z: 0, a: 0 },
  workCoords: { x: 0, y: 0, z: 0, a: 0 },
  wco: { x: 0, y: 0, z: 0, a: 0 },
  alarms: [] as string[],
  feedRate: 0,
  spindleRpm: 0,
  feedrateOverride: 100,
  rapidOverride: 100,
  spindleOverride: 100,
  tool: 0
});

// Track WebSocket connection state separately
const websocketConnected = ref(false);

const jogConfig = reactive({
  stepSize: 1,
  stepOptions: [0.1, 1, 10]
});

  const serverState = reactive({
    machineState: null as any,
    jobLoaded: null as { filename: string; currentLine: number; totalLines: number; status: 'running' | 'paused' | 'stopped' } | null
  });

type ConsoleStatus = 'pending' | 'success' | 'error';
type ConsoleLine = {
  id: string | number;
  level: string;
  message: string;
  timestamp: string;
  status?: ConsoleStatus;
  type?: 'command' | 'response';
  originId?: string | null;
  meta?: Record<string, unknown> | null;
};

type StatusReport = {
  machineState?: string;
  WCO?: string;
  MPos?: string;
  FS?: string;
  feedrateOverride?: number;
  rapidOverride?: number;
  spindleOverride?: number;
  [key: string]: unknown;
};

const consoleLines = ref<ConsoleLine[]>([]);
// Map for O(1) command lookup by ID with array index
const commandLinesMap = new Map<string | number, { line: ConsoleLine, index: number }>();

const applyStatusReport = (report: StatusReport | null | undefined) => {
  if (!report) {
    return;
  }

  if (report.status) {
    status.machineState = report.status as typeof status.machineState;
  }

  if (report.workspace) {
    workspace.value = report.workspace as string;
  }

  if (report.WCO) {
    const [x, y, z] = report.WCO.split(',').map(Number);
    status.wco = { x, y, z, a: 0 };
  }

  if (report.MPos) {
    const [x, y, z] = report.MPos.split(',').map(Number);
    status.machineCoords = { x, y, z, a: 0 };
    status.workCoords.x = status.machineCoords.x - status.wco.x;
    status.workCoords.y = status.machineCoords.y - status.wco.y;
    status.workCoords.z = status.machineCoords.z - status.wco.z;
  }

  if (report.FS) {
    const [feed, spindle] = report.FS.split(',').map(Number);
    status.feedRate = feed;
    status.spindleRpm = spindle;
  }

  // Update override values if present
  if (typeof report.feedrateOverride === 'number') {
    status.feedrateOverride = report.feedrateOverride;
  }
  if (typeof report.rapidOverride === 'number') {
    status.rapidOverride = report.rapidOverride;
  }
  if (typeof report.spindleOverride === 'number') {
    status.spindleOverride = report.spindleOverride;
  }

  // Update tool number if present
  if (typeof report.tool === 'number') {
    status.tool = report.tool;
  }
};

onMounted(async () => {
  // Load connection settings first (this will load the colors)
  await loadConnectionSettings();

  // Apply colors after settings are loaded
  applyColors();

  // Listen for WebSocket connection events
  api.on('connected', () => {
    console.log('WebSocket connected');
    websocketConnected.value = true;
  });

  api.on('disconnected', () => {
    console.log('WebSocket disconnected');
    websocketConnected.value = false;
  });

  api.on('error', () => {
    console.log('WebSocket connection error');
    websocketConnected.value = false;
  });

  // Set initial WebSocket state - check if already connected or connecting
  if (api.ws) {
    websocketConnected.value = api.ws.readyState === 1; // WebSocket.OPEN = 1
  } else {
    websocketConnected.value = false;
  }

  // Seed UI from last known server state (in case initial WS events were missed)
  try {
    const last = api.lastServerState;
    if (last && typeof last === 'object') {
      Object.assign(serverState, last);
      // Only treat as connected when payload reports connected
      status.connected = !!serverState.machineState?.connected;
      if (serverState.machineState?.connected && serverState.machineState) {
        applyStatusReport(serverState.machineState);
      } else if (!serverState.machineState?.connected) {
        status.machineState = 'offline';
      }
    }
  } catch (e) {
    console.warn('Unable to seed initial server state:', e);
  }

  // Initialize purely from WebSocket server-state-updated events
  api.onServerStateUpdated((newServerState) => {
    const previousJobFilename = serverState.jobLoaded?.filename;
    Object.assign(serverState, newServerState);
    // Only treat as connected when payload reports connected
    status.connected = !!serverState.machineState?.connected;

    // Reset viewport to default view when a new G-code file is loaded
    if (serverState.jobLoaded?.filename && serverState.jobLoaded.filename !== previousJobFilename) {
      viewport.value = defaultView.value;
    }

    // Only apply machine state when connected
    if (serverState.machineState?.connected && serverState.machineState) {
      applyStatusReport(serverState.machineState);
    } else if (!serverState.machineState?.connected) {
      status.machineState = 'offline';
    }
  });

  // (Removed duplicate server-state-updated listener)

  // Listen for new commands
  const addOrUpdateCommandLine = (payload) => {
    if (!payload) return null;

    if (api.isJogCancelCommand(payload.command)) {
      return null;
    }

    let message = payload.displayCommand || payload.command || 'Command';
    const timestamp = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    // Format error messages specially
    if (payload.status === 'error' && payload.error?.message) {
      const lineInfo = payload.meta?.lineNumber ? ` (Line: ${payload.meta.lineNumber})` : '';
      message = `${message}; --> ${payload.error.message}${lineInfo}`;
    }

    // Use Map for O(1) lookup instead of array.find()
    const existingEntry = commandLinesMap.get(payload.id);

    if (existingEntry) {
      // Create new object to trigger Vue reactivity
      const updatedLine = {
        ...existingEntry.line,
        message,
        timestamp,
        status: payload.status ?? existingEntry.line.status,
        level: payload.status === 'error' ? 'error' : existingEntry.line.level,
        originId: payload.originId ?? existingEntry.line.originId,
        meta: payload.meta ?? existingEntry.line.meta
      };

      // Update both structures with O(1) operations
      consoleLines.value[existingEntry.index] = updatedLine;
      commandLinesMap.set(payload.id, { line: updatedLine, index: existingEntry.index });

      return { line: updatedLine, timestamp };
    }

    const newLine = {
        id: payload.id ?? `${Date.now()}-pending`,
        level: payload.status === 'error' ? 'error' : 'info',
        message,
        timestamp,
        status: payload.status ?? 'pending',
        type: 'command',
        originId: payload.originId ?? null,
        meta: payload.meta ?? null
      };

    // Add to both array (for reactivity) and map (for fast lookup)
    const newIndex = consoleLines.value.length;
    consoleLines.value.push(newLine);
    commandLinesMap.set(newLine.id, { line: newLine, index: newIndex });

    // Enforce buffer size limit - keep only last 50 lines for performance
    const maxLines = 50;
    if (consoleLines.value.length > maxLines) {
      const removed = consoleLines.value.shift(); // Remove oldest line
      if (removed) {
        commandLinesMap.delete(removed.id);
      }
      // Rebuild map indices after shift
      consoleLines.value.forEach((line, idx) => {
        const entry = commandLinesMap.get(line.id);
        if (entry) {
          entry.index = idx;
        }
      });
    }

    return { line: newLine, timestamp };
  };

  api.on('cnc-command', (commandEvent) => {
    addOrUpdateCommandLine(commandEvent);
  });

  // Listen for command responses
  api.onData((data) => {
    const responseLine = { id: Date.now(), level: 'info', message: data, timestamp: '', type: 'response' };
    const newIndex = consoleLines.value.length;
    consoleLines.value.push(responseLine);
    commandLinesMap.set(responseLine.id, { line: responseLine, index: newIndex });

    // Enforce buffer size limit - keep only last 50 lines for performance
    const maxLines = 50;
    if (consoleLines.value.length > maxLines) {
      const removed = consoleLines.value.shift(); // Remove oldest line
      if (removed) {
        commandLinesMap.delete(removed.id);
      }
      // Rebuild map indices after shift
      consoleLines.value.forEach((line, idx) => {
        const entry = commandLinesMap.get(line.id);
        if (entry) {
          entry.index = idx;
        }
      });
    }
  });

  // Auto-clear console when a new job starts (detect by line number 1)
  let lastJobStartTime = 0;

  api.on('cnc-command-result', (result) => {
    if (!result) return;

    if (api.isJogCancelCommand(result.command)) {
      return;
    }

    // Auto-clear console when starting a new job (line 1)
    // if (result.meta?.lineNumber === 1 && result.status === 'pending') {
    //   const now = Date.now();
    //   // Only clear if it's been more than 2 seconds since last job start (avoid duplicate clears)
    //   if (now - lastJobStartTime > 2000) {
    //     console.log('New job detected, clearing console history');
    //     clearConsole();
    //     lastJobStartTime = now;
    //   }
    // }

    const updateResult = addOrUpdateCommandLine(result);
  });


});

const applyTheme = (value: 'light' | 'dark') => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(value === 'dark' ? 'theme-dark' : 'theme-light');
  document.documentElement.style.colorScheme = value;
};

watchEffect(() => applyTheme(theme.value));

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
};

const themeLabel = computed(() => (theme.value === 'dark' ? 'Dark' : 'Light'));

</script>

<style scoped>
/* Settings Container */
.settings-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
}

/* Tabs */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: var(--radius-medium) var(--radius-medium) 0 0;
  padding: var(--gap-sm) var(--gap-md) 0 var(--gap-md);
  gap: 2px;
}

.tab-button {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  padding: var(--gap-sm) var(--gap-md);
  background: transparent;
  border: none;
  border-radius: var(--radius-small) var(--radius-small) 0 0;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.95rem;
  font-weight: 500;
  margin-top: var(--gap-xs);
  position: relative;
}

.tab-button:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  transform: translateY(-1px);
}

.tab-button.active {
  background: var(--color-surface);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-elevated);
  border-bottom: 2px solid var(--color-accent);
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gradient-accent);
  border-radius: 2px 2px 0 0;
}

.tab-icon {
  font-size: 1.1rem;
}

.tab-label {
  font-weight: 600;
}

/* Tab Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  position: relative;
}

.tab-panel {
  padding: var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg);
  flex: 1;
}

/* Settings Sections */
.settings-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.section-title {
  margin: 0 0 var(--gap-md) 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--gap-xs);
}

.settings-note {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
  text-align: left;
  font-style: italic;
  margin-top: 4px;
}

.setting-item--with-note {
  align-items: flex-start;
}

.setting-item-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  margin-right: var(--gap-md);
}

/* Setting Items */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-sm) 0;
  border-bottom: 1px solid var(--color-border);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-weight: 500;
  color: var(--color-text-primary);
  flex: 1;
  margin-right: var(--gap-md);
  white-space: nowrap;
}

/* Form Controls */
.setting-select,
.setting-input {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 12px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
  transition: all 0.2s ease;
  min-width: 120px;
}

.setting-select:focus,
.setting-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.setting-select:hover,
.setting-input:hover {
  border-color: var(--color-accent);
}

.setting-value {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.setting-input:disabled {
  background: var(--color-surface);
  color: var(--color-text-secondary);
  opacity: 0.6;
  cursor: not-allowed;
}

.setting-input:disabled:hover {
  border-color: var(--color-border);
}

.setting-input.invalid {
  border-color: #dc3545;
  box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.1);
}

.setting-input.invalid:focus {
  border-color: #dc3545;
  box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.2);
}

.setting-input--right {
  text-align: right;
}

.setting-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--color-accent);
  cursor: pointer;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input[type="checkbox"] {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 24px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 2px;
  top: 2px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--gradient-accent);
  border-color: var(--color-accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(26px);
}

.toggle-switch:hover .toggle-slider {
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

/* Color Picker */
.color-picker-container {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

.color-picker {
  width: 40px;
  height: 32px;
  border: none;
  border-radius: var(--radius-small);
  cursor: pointer;
  background: transparent;
  padding: 0;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
  border: none;
  border-radius: var(--radius-small);
}

.color-picker::-webkit-color-swatch {
  border: 2px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: all 0.2s ease;
}

.color-picker:hover::-webkit-color-swatch {
  border-color: var(--color-accent);
  transform: scale(1.05);
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
}

.gradient-preview {
  border-radius: var(--radius-small);
  width: 32px;
}

.color-value {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 4px 8px;
  border-radius: var(--radius-small);
  min-width: 70px;
  text-align: center;
}

/* Settings Footer */
.settings-footer {
  padding: var(--gap-md);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--gap-md);
  margin-top: auto;
  flex-shrink: 0;
}

.close-button {
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  padding: 12px 32px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
}

.close-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.close-button:active {
  transform: translateY(0);
}

/* Save Button */
.setting-item--action {
  justify-content: flex-end;
  padding-top: var(--gap-md);
  border-bottom: none;
}

.save-button {
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 24px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
}

.save-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.save-button:active {
  transform: translateY(0);
}

/* Responsive Design */
@media (max-width: 768px) {
  .settings-container {
    max-height: 80vh;
  }

  .tabs {
    flex-direction: column;
    gap: 0;
    padding: var(--gap-xs);
  }

  .tab-button {
    margin-top: 0;
    margin-bottom: 2px;
    border-radius: var(--radius-small);
  }

  .tab-button.active::after {
    display: none;
  }

  .tab-button.active {
    border-left: 3px solid var(--color-accent);
    border-bottom: none;
  }

  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gap-xs);
  }

  .setting-label {
    margin-right: 0;
    margin-bottom: var(--gap-xs);
  }

  .setting-select,
  .setting-input {
    width: 100%;
    min-width: unset;
  }
}

/* Setup Dialog Styles */
.setup-container {
  display: flex;
  flex-direction: column;
  width: auto;
  max-width: 680px; /* Allow a bit more width for setup only */
  min-width: 480px; /* Ensure dialog is comfortably wider */
  min-height: auto;
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
}

.setup-header {
  padding: var(--gap-sm) var(--gap-md) var(--gap-xs) var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: var(--radius-medium) var(--radius-medium) 0 0;
  text-align: center;
}

.setup-title {
  margin: 0 0 var(--gap-xs) 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.setup-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.setup-content {
  padding: var(--gap-sm) var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  flex: 1;
}

.setup-footer {
  padding: var(--gap-xs) var(--gap-md) var(--gap-sm) var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: 0 0 var(--radius-medium) var(--radius-medium);
  display: flex;
  justify-content: center;
}

.setup-save-button {
  padding: var(--gap-sm) var(--gap-lg);
  background: linear-gradient(135deg, var(--color-accent) 0%, #16a085 100%);
  color: white;
  border: none;
  border-radius: var(--radius-medium);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 120px;
  position: relative;
  overflow: hidden;
}

.setup-save-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.setup-save-button:active {
  transform: translateY(0);
}

.setup-save-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Responsive design for setup dialog */
@media (max-width: 768px) {
  .setup-container {
    max-width: 90vw;
    margin: var(--gap-md);
  }

  .setup-header,
  .setup-content,
  .setup-footer {
    padding-left: var(--gap-md);
    padding-right: var(--gap-md);
  }

  .setup-title {
    font-size: 1.3rem;
  }
}

/* Custom USB Port Dropdown Styles */
.custom-dropdown {
  position: relative;
  width: 100%;
  max-width: 280px;
  margin-left: auto;
}

.dropdown-trigger {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-xs) var(--gap-sm);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.dropdown-trigger span:first-child {
  text-align: right;
  flex: 1;
}

.dropdown-trigger:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.dropdown-trigger:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(26, 188, 156, 0.2);
}

.dropdown-trigger.invalid {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.dropdown-trigger.invalid:hover {
  border-color: #dc2626;
  background: rgba(239, 68, 68, 0.15);
}

.dropdown-trigger.invalid:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

.dropdown-arrow {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  transition: transform 0.2s ease;
}

.dropdown-trigger[aria-expanded="true"] .dropdown-arrow {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  box-shadow: var(--shadow-elevated);
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 2px;
}

.dropdown-item {
  padding: var(--gap-sm);
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-bottom: 1px solid var(--color-border);
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: var(--color-surface-muted);
}

.dropdown-item.disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background: var(--color-surface-muted);
}

.dropdown-item.disabled:hover {
  background: var(--color-surface-muted);
}

.port-path {
  font-size: 0.9rem;
  color: var(--color-text-primary);
  font-weight: 500;
  line-height: 1.2;
  text-align: right;
}

.port-manufacturer {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-style: italic;
  margin-top: 2px;
  line-height: 1.2;
  text-align: right;
}

/* Mobile responsive for custom dropdown */
@media (max-width: 768px) {
  .dropdown-menu {
    max-height: 150px;
  }

  .port-path {
    font-size: 0.85rem;
  }

  .port-manufacturer {
    font-size: 0.7rem;
  }
}

/* Firmware Tab Styles */
.firmware-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  gap: var(--gap-md);
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-hint {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-style: italic;
}

.firmware-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  gap: var(--gap-md);
  text-align: center;
}

.error-message {
  color: #dc3545;
  font-weight: 500;
  padding: var(--gap-md);
  background: rgba(220, 53, 69, 0.1);
  border: 1px solid rgba(220, 53, 69, 0.3);
  border-radius: var(--radius-small);
}

.retry-button {
  padding: var(--gap-sm) var(--gap-lg);
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-button:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.3);
}

.firmware-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  text-align: center;
  color: var(--color-text-secondary);
  font-style: italic;
}

.tab-panel--firmware {
  padding: 0;
  gap: 0;
  overflow: hidden;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
}

.firmware-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.firmware-header {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.firmware-search-input {
  flex: 1;
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.firmware-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.clear-search-button {
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-search-button:hover {
  background: var(--color-border);
}

.refresh-button {
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-button:hover:not(:disabled) {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  transform: translateY(-1px);
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.firmware-table-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.firmware-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.firmware-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface-muted);
}

.firmware-table thead::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--color-border);
}

.firmware-table th {
  padding: var(--gap-sm) var(--gap-md);
  text-align: left;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 2px solid var(--color-border);
  background: var(--color-surface-muted);
}

.firmware-table th.col-setting {
  text-align: center;
}

.firmware-table th.col-value {
  text-align: right;
}

.firmware-table tbody tr:first-child td {
  padding-top: var(--gap-lg);
}

.firmware-table tbody tr:last-child td {
  padding-bottom: var(--gap-lg);
}

.firmware-table td {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.firmware-table td:first-child {
  padding-left: var(--gap-md);
}

.firmware-table td:last-child {
  padding-right: var(--gap-md);
}

.firmware-row:nth-child(even) {
  background: var(--color-surface-muted);
}

.firmware-row:hover {
  background: var(--color-border);
}

.col-setting {
  width: 10%;
  min-width: 80px;
  text-align: center;
}

.col-description {
  width: 65%;
}

.col-value {
  width: 25%;
  text-align: right;
}

.setting-id {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 1.3rem;
}

.setting-group {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
  background: var(--color-surface-muted);
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
}

.setting-name {
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}

.setting-hal-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  line-height: 1.4;
  white-space: pre-line;
}

.setting-details {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  display: flex;
  gap: var(--gap-md);
}

.setting-value-display {
  font-weight: 600;
  color: var(--color-accent);
  font-size: 1rem;
}

.setting-unit {
  margin-left: 4px;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.no-results {
  text-align: center;
  padding: var(--gap-xl);
  color: var(--color-text-secondary);
  font-style: italic;
}

.firmware-footer {
  display: flex;
  justify-content: space-between;
  padding: var(--gap-sm) var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

/* Bitfield Toggle Switches */
.bitfield-toggles {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--gap-sm) var(--gap-md);
  align-items: center;
  width: 100%;
}

.bitfield-item {
  display: contents;
}

.bitfield-name {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-align: left;
}

.toggle-switch {
  justify-self: center;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

.toggle-switch input:focus + .toggle-slider {
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.2);
}

/* Numeric and String Input */
.numeric-input-container,
.string-input-container {
  display: flex;
  justify-content: flex-end;
}

.setting-numeric-input,
.setting-string-input {
  width: 60%;
  min-width: 100px;
  max-width: 300px;
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  text-align: right;
  transition: all 0.2s ease;
}

.setting-numeric-input:focus,
.setting-string-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
  background: var(--color-surface);
}

.setting-numeric-input:invalid,
.setting-string-input:invalid {
  border-color: #dc3545;
}

.setting-numeric-input::placeholder,
.setting-string-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.firmware-json-details {
  margin-top: var(--gap-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
}

.firmware-json-details summary {
  padding: var(--gap-sm) var(--gap-md);
  cursor: pointer;
  font-weight: 500;
  color: var(--color-text-primary);
  user-select: none;
  transition: background 0.2s ease;
}

.firmware-json-details summary:hover {
  background: var(--color-surface);
}

.firmware-json {
  margin: 0;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-small) var(--radius-small);
  font-size: 0.85rem;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
  color: var(--color-text-secondary);
}
</style>
