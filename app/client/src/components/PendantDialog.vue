<template>
  <Dialog
    :show-header="true"
    @close="$emit('close')"
  >
    <template #title>Pendant</template>
    <div class="pendant-content">
      <!-- Connection Status Card -->
      <div class="status-card" :class="{ 'status-card--connected': isConnected }">
        <div class="status-card__icon">
          <svg v-if="loading" class="spinner" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
          </svg>
          <!-- WiFi Icon -->
          <svg v-else-if="wifiPendant" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <circle cx="12" cy="20" r="1" fill="currentColor"/>
          </svg>
          <!-- USB Trident Icon -->
          <svg v-else-if="usbPendant" width="32" height="32" viewBox="40 5 113 180" fill="currentColor">
            <path d="M81.114 37.464l16.415-28.96 16.834 28.751-12.164.077-.174 70.181c.988-.552 2.027-1.09 3.096-1.643 6.932-3.586 15.674-8.11 15.998-28.05h-8.533V53.251h24.568V77.82h-7.611c-.334 25.049-11.627 30.892-20.572 35.519-3.232 1.672-6.012 3.111-6.975 5.68l-.09 36.683a14.503 14.503 0 0 1 10.68 14.02 14.5 14.5 0 0 1-14.533 14.532 14.5 14.5 0 0 1-14.533-14.532 14.504 14.504 0 0 1 9.454-13.628l.057-22.801c-2.873-1.613-5.62-2.704-8.139-3.705-11.142-4.43-18.705-7.441-18.857-33.4a14.381 14.381 0 0 1-10.43-13.869c0-7.946 6.482-14.428 14.428-14.428 7.946 0 14.428 6.482 14.428 14.428 0 6.488-4.21 11.889-10.004 13.74.116 20.396 5.54 22.557 13.528 25.732 1.61.641 3.303 1.312 5.069 2.114l.214-86.517-12.154.076z"/>
          </svg>
          <!-- Not Connected Icon -->
          <svg v-else width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <circle cx="12" cy="20" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div class="status-card__content">
          <div class="status-card__title">
            <span v-if="loading">Checking connection...</span>
            <span v-else-if="isConnected">Connected</span>
            <span v-else>Not Connected</span>
          </div>
          <div class="status-card__subtitle" v-if="!loading">
            <template v-if="wifiPendant">
              <span class="status-ip">{{ wifiPendant.ip }}</span>
              <span v-if="wifiPendant.version" class="status-version">v{{ wifiPendant.version }}</span>
            </template>
            <template v-else-if="usbPendant">
              <span class="status-ip">{{ usbPendant.port }}</span>
              <span v-if="usbPendant.version" class="status-version">v{{ usbPendant.version }}</span>
            </template>
            <template v-else>
              No pendant detected
            </template>
          </div>
        </div>
        <div v-if="isConnected && !loading" class="status-card__badge">
          <span class="pulse"></span>
          {{ wifiPendant ? 'WiFi' : 'USB' }}
        </div>
      </div>

      <!-- License Status (when licensed) -->
      <div v-if="activePendant?.licensed" class="licensed-card">
        <div class="licensed-card__icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
        </div>
        <div class="licensed-card__content">
          <div class="licensed-card__title">License Active</div>
          <div class="licensed-card__subtitle">Your pendant is fully licensed and ready to use.</div>
        </div>
      </div>

      <!-- Firmware Update -->
      <div v-if="isConnected" class="firmware-card">
        <div class="firmware-card__header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Firmware Update</span>
          <button v-if="!fwUpdating" class="firmware-card__refresh" @click="checkFirmware" :disabled="fwChecking">
            <svg :class="{ 'spinner': fwChecking }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
        <div class="firmware-card__body">
          <!-- Checking -->
          <div v-if="fwChecking && !fwInfo" class="firmware-status firmware-status--checking">
            <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
            </svg>
            <span>Checking for updates...</span>
          </div>

          <!-- Up to date -->
          <div v-else-if="fwInfo && !fwInfo.updateAvailable && !fwUpdating && !fwSuccess" class="firmware-status firmware-status--uptodate">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>Firmware is up to date{{ fwInfo.currentVersion ? ` (v${fwInfo.currentVersion})` : '' }}</span>
            <button v-if="!fwSelectedFile" class="firmware-flash-file-btn" @click="($refs.fwFileInput as HTMLInputElement).click()">
              Flash from file
            </button>
          </div>

          <!-- Update available -->
          <div v-else-if="fwInfo && fwInfo.updateAvailable && !fwUpdating && !fwSuccess" class="firmware-update-available">
            <div class="firmware-versions">
              <span v-if="fwInfo.currentVersion" class="firmware-version-current">v{{ fwInfo.currentVersion }}</span>
              <svg v-if="fwInfo.currentVersion" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
              <span class="firmware-version-latest">v{{ fwInfo.latestVersion }} available</span>
            </div>
            <div v-if="fwInfo.deviceModel === null" class="form-field" style="margin-bottom: 8px;">
              <label>Device Model</label>
              <select v-model="fwModelOverride" class="firmware-select">
                <option value="">Select model...</option>
                <option value="pibot">PiBot (ESP32)</option>
                <option value="ncsender">ncSender (Waveshare ESP32-S3)</option>
              </select>
            </div>
            <div class="firmware-update-actions">
              <button class="firmware-update-btn" @click="startFirmwareUpdate" :disabled="fwInfo.deviceModel === null && !fwModelOverride">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Update Now</span>
              </button>
              <button v-if="!fwSelectedFile" class="firmware-flash-file-btn" @click="($refs.fwFileInput as HTMLInputElement).click()">
                Flash from file
              </button>
            </div>
          </div>

          <!-- Updating -->
          <div v-else-if="fwUpdating" class="firmware-status firmware-status--updating">
            <div class="firmware-progress-bar">
              <div class="firmware-progress-fill" :style="{ width: fwProgress + '%' }"></div>
            </div>
            <div class="firmware-progress-row">
              <span class="firmware-progress-text">{{ fwStatusText }} {{ fwProgress }}%</span>
              <button class="firmware-cancel-btn" @click="cancelFirmwareFlash">Cancel</button>
            </div>
          </div>

          <!-- Success -->
          <div v-else-if="fwSuccess" class="firmware-status firmware-status--success">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>{{ fwSuccessVersion ? `Updated to v${fwSuccessVersion}!` : 'Flash complete!' }} Pendant is rebooting...</span>
          </div>

          <!-- Error -->
          <Transition name="fade">
            <div v-if="fwError" class="message message--error" style="margin-top: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span>{{ fwError }}</span>
            </div>
          </Transition>

          <!-- Flash from file -->
          <input ref="fwFileInput" type="file" accept=".bin" style="display: none" @change="onFileSelected" />
          <div v-if="!fwUpdating && fwSelectedFile" class="firmware-flash-file-row">
            <span class="firmware-selected-file">{{ fwSelectedFile.name }}</span>
            <button class="firmware-flash-btn" @click="flashFromFile">Flash</button>
            <button class="firmware-flash-clear-btn" @click="fwSelectedFile = null">&times;</button>
          </div>
        </div>
      </div>

      <!-- Activation Section (when connected but not licensed) -->
      <div v-if="isConnected && activePendant?.version && !activePendant?.licensed" class="activation-card">
        <div class="activation-card__header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>License Activation</span>
        </div>

        <div class="activation-card__body">
          <!-- Manual IP field when not connected via USB or WiFi -->
          <div v-if="!usbPendant && !wifiPendant" class="form-field">
            <label>Pendant IP Address</label>
            <div class="input-wrapper">
              <input
                v-model="manualPendantIp"
                type="text"
                placeholder="192.168.1.100"
                :disabled="activating"
                @keyup.enter="activateLicense"
              />
            </div>
            <span class="form-hint">Enter the IP address shown on your pendant, or connect via USB</span>
          </div>

          <div class="form-field">
            <label>Installation ID</label>
            <div class="input-wrapper">
              <input
                v-model="installationId"
                type="text"
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                :disabled="activating || activationSuccess"
                :readonly="activationSuccess"
                @keyup.enter="activateLicense"
              />
            </div>
          </div>

          <button
            v-if="!activationSuccess"
            class="activate-button"
            @click="activateLicense"
            :disabled="!canActivate || activating"
          >
            <svg v-if="activating" class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>{{ activating ? 'Activating...' : 'Activate License' }}</span>
          </button>

          <!-- Status Messages -->
          <Transition name="fade">
            <div v-if="activationError" class="message message--error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span>{{ activationError }}</span>
            </div>
          </Transition>

          <Transition name="fade">
            <div v-if="activationSuccess" class="message message--success">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>License activated successfully!</span>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import Dialog from './Dialog.vue';
import { getApiBaseUrl } from '../lib/api-base';

const emit = defineEmits(['close']);

const loading = ref(true);
const usbPendant = ref<{ id: string; port: string; version?: string; licensed?: boolean; deviceId?: string } | null>(null);
const wifiPendant = ref<{ id: string; ip: string; version?: string; licensed?: boolean } | null>(null);
const installationId = ref('');
const manualPendantIp = ref('');
const activating = ref(false);
const activationError = ref('');
const activationSuccess = ref(false);

// Firmware update state
const fwChecking = ref(false);
const fwInfo = ref<{ currentVersion: string; latestVersion: string; updateAvailable: boolean; releaseNotes: string; deviceModel: string | null } | null>(null);
const fwUpdating = ref(false);
const fwProgress = ref(0);
const fwStatusText = ref('');
const fwError = ref('');
const fwSuccess = ref(false);
const fwSuccessVersion = ref('');
const fwModelOverride = ref('');
const fwFileInput = ref<HTMLInputElement | null>(null);
const fwSelectedFile = ref<File | null>(null);

const isConnected = computed(() => wifiPendant.value || usbPendant.value);
const activePendant = computed(() => wifiPendant.value || usbPendant.value);

watch(() => activePendant.value?.licensed, (licensed) => {
  if (!licensed) {
    activationSuccess.value = false;
    activationError.value = '';
  }
});

const canActivate = computed(() => {
  if (!installationId.value) return false;
  // Can activate if USB connected, WiFi connected, or manual IP provided
  if (!usbPendant.value && !wifiPendant.value && !manualPendantIp.value) return false;
  return true;
});

const fetchStatus = async (showLoading = true) => {
  if (showLoading) {
    loading.value = true;
  }
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/pendant/status`);
    if (!response.ok) throw new Error('Failed to fetch pendant status');
    const data = await response.json();
    usbPendant.value = data.usbPendant;
    wifiPendant.value = data.wifiPendant;
  } catch (error) {
    console.error('Failed to fetch pendant status:', error);
  } finally {
    if (showLoading) {
      loading.value = false;
    }
  }
};

const checkFirmware = async () => {
  fwChecking.value = true;
  fwError.value = '';
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/pendant/firmware/check`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to check for updates');
    }
    fwInfo.value = await response.json();
  } catch (error: any) {
    fwError.value = error.message || 'Could not check for updates';
  } finally {
    fwChecking.value = false;
  }
};

const showFwSuccess = (version: string) => {
  fwSuccess.value = true;
  fwSuccessVersion.value = version;
  fwUpdating.value = false;
  setTimeout(() => {
    fwSuccess.value = false;
    fwInfo.value = null;
    checkFirmware();
  }, 10000);
};

const startFirmwareUpdate = async () => {
  fwUpdating.value = true;
  fwProgress.value = 0;
  fwStatusText.value = 'Starting...';
  fwError.value = '';
  fwSuccess.value = false;

  try {
    const baseUrl = getApiBaseUrl();
    const body: Record<string, string> = {};
    if (fwModelOverride.value) {
      body.deviceModel = fwModelOverride.value;
    }

    const response = await fetch(`${baseUrl}/api/pendant/firmware/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Update failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.substring(6));
          if (event.type === 'progress') {
            fwProgress.value = event.percent || 0;
            fwStatusText.value = event.status || 'Flashing firmware...';
          } else if (event.type === 'complete') {
            showFwSuccess(event.version || '');
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Update failed');
          }
        } catch (e: any) {
          if (e.message && e.message !== 'Update failed') {
            // JSON parse error — ignore partial data
          } else {
            throw e;
          }
        }
      }
    }
  } catch (error: any) {
    fwError.value = error.message || 'Firmware update failed';
    fwUpdating.value = false;
  }
};

const onFileSelected = () => {
  const file = fwFileInput.value?.files?.[0];
  if (file) fwSelectedFile.value = file;
  if (fwFileInput.value) fwFileInput.value.value = '';
};

const flashFromFile = async () => {
  const file = fwSelectedFile.value;
  if (!file) return;

  fwSelectedFile.value = null;
  fwUpdating.value = true;
  fwProgress.value = 0;
  fwStatusText.value = 'Flashing firmware...';
  fwError.value = '';
  fwSuccess.value = false;

  try {
    const baseUrl = getApiBaseUrl();
    const arrayBuffer = await file.arrayBuffer();

    const response = await fetch(`${baseUrl}/api/pendant/firmware/flash-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: arrayBuffer
    });

    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Flash failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.substring(6));
          if (event.type === 'progress') {
            fwProgress.value = event.percent || 0;
            fwStatusText.value = event.status || 'Flashing firmware...';
          } else if (event.type === 'complete') {
            showFwSuccess('');
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Flash failed');
          }
        } catch (e: any) {
          if (e.message && e.message !== 'Flash failed') {
            // JSON parse error — ignore partial data
          } else {
            throw e;
          }
        }
      }
    }
  } catch (error: any) {
    fwError.value = error.message || 'Firmware flash failed';
    fwUpdating.value = false;
  }
};

const cancelFirmwareFlash = async () => {
  try {
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/api/pendant/firmware/cancel`, { method: 'POST' });
  } catch {}
  fwUpdating.value = false;
  fwError.value = 'Firmware update cancelled';
  setTimeout(() => { fwError.value = ''; }, 15000);
};

const activateLicense = async () => {
  if (!canActivate.value) return;

  activating.value = true;
  activationError.value = '';
  activationSuccess.value = false;

  try {
    const baseUrl = getApiBaseUrl();

    // WiFi activation (preferred - direct HTTP to pendant)
    if (wifiPendant.value || manualPendantIp.value) {
      const pendantIp = wifiPendant.value?.ip || manualPendantIp.value;
      let deviceId = '';

      try {
        const infoResponse = await fetch(`http://${pendantIp}/api/info`);
        if (infoResponse.ok) {
          const info = await infoResponse.json();
          if (info.deviceId) deviceId = info.deviceId;
        }
      } catch {
        // Pendant not reachable
      }

      if (!deviceId) {
        activationError.value = 'Could not retrieve device ID from pendant';
        activating.value = false;
        return;
      }

      const response = await fetch(`${baseUrl}/api/pendant/activate-wifi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: installationId.value,
          deviceId,
          pendantIp
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Activation failed');
      }

      const data = await response.json();
      if (data.success) {
        activationSuccess.value = true;
        installationId.value = '';
        manualPendantIp.value = '';
        if (wifiPendant.value) {
          wifiPendant.value.licensed = true;
        }
      }
    } else if (usbPendant.value) {
      // USB activation (fallback)
      if (!usbPendant.value.deviceId) {
        activationError.value = 'Device ID not available. Please reconnect the pendant.';
        activating.value = false;
        return;
      }

      const response = await fetch(`${baseUrl}/api/pendant/activate-usb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: installationId.value
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'USB activation failed');
      }

      const data = await response.json();
      if (data.success) {
        activationSuccess.value = true;
        installationId.value = '';
        if (usbPendant.value) {
          usbPendant.value.licensed = true;
        }
      }
    }
  } catch (error: any) {
    activationError.value = error.message || 'Activation failed';
  } finally {
    activating.value = false;
  }
};

let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  fetchStatus(true).then(() => {
    if (isConnected.value) {
      checkFirmware();
    }
  });
  // Refresh status periodically to pick up license status updates
  refreshInterval = setInterval(() => {
    if (!activating.value && !fwUpdating.value) {
      fetchStatus(false);
    }
  }, 3000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});
</script>

<style scoped>
.pendant-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 520px;
}

/* Status Card */
.status-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(100, 100, 100, 0.1) 0%, rgba(80, 80, 80, 0.05) 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
}

.status-card--connected {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(34, 197, 94, 0.05) 100%);
  border-color: rgba(34, 197, 94, 0.2);
}

.status-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.status-card--connected .status-card__icon {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.status-card__content {
  flex: 1;
  min-width: 0;
}

.status-card__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
}

.status-card--connected .status-card__title {
  color: #22c55e;
}

.status-card__subtitle {
  font-size: 13px;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-ip {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.status-version {
  font-size: 11px;
  opacity: 0.7;
}

.status-card__badges {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}

.status-card__badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(34, 197, 94, 0.15);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: #22c55e;
}

.status-card__badge--licensed {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

/* Licensed Card */
.licensed-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(251, 191, 36, 0.03) 100%);
  border: 1px solid rgba(251, 191, 36, 0.15);
  border-radius: 16px;
}

.licensed-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  background: rgba(251, 191, 36, 0.15);
  border-radius: 14px;
  color: #fbbf24;
  flex-shrink: 0;
}

.licensed-card__content {
  flex: 1;
}

.licensed-card__title {
  font-size: 16px;
  font-weight: 600;
  color: #fbbf24;
  margin-bottom: 4px;
}

.licensed-card__subtitle {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.pulse {
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.9); }
}

/* Activation Card */
.activation-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
}

.activation-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.activation-card__header svg {
  color: var(--color-text-secondary);
}

.activation-card__body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Form Fields */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.input-wrapper {
  position: relative;
}

.input-wrapper input {
  width: 100%;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--color-text);
  font-size: 15px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  transition: all 0.2s ease;
  box-sizing: border-box;
  text-align: center;
}

.input-wrapper input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.input-wrapper input:focus {
  outline: none;
  border-color: var(--color-primary);
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb, 59, 130, 246), 0.15);
}

.input-wrapper input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-hint {
  font-size: 11px;
  color: var(--color-text-secondary);
  opacity: 0.7;
}

/* Activate Button */
.activate-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 14px 20px;
  background: var(--color-accent);
  border: none;
  border-radius: 10px;
  color: #0d1117;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 4px;
}

.activate-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.activate-button:active:not(:disabled) {
  transform: translateY(0);
}

.activate-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* Messages */
.message {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
}

.message--error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.message--success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

/* Spinner Animation */
.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Firmware Update Card */
.firmware-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
}

.firmware-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text);
}

.firmware-card__header svg {
  color: var(--color-text-secondary);
}

.firmware-card__refresh {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}

.firmware-card__refresh:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
}

.firmware-card__refresh:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.firmware-card__body {
  padding: 16px 20px;
}

.firmware-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.firmware-status--checking {
  color: var(--color-text-secondary);
}

.firmware-status--uptodate {
  color: #4ade80;
  flex-wrap: wrap;
}

.firmware-status--uptodate .firmware-flash-file-btn {
  margin-left: auto;
}

.firmware-status--success {
  color: #4ade80;
}

.firmware-status--updating {
  flex-direction: column;
  gap: 8px;
}

.firmware-progress-bar {
  width: 100%;
  height: 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.firmware-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent), color-mix(in srgb, var(--color-accent), white 30%), var(--color-accent));
  background-size: 200% 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
  min-width: 0;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.firmware-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.firmware-progress-text {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.firmware-cancel-btn {
  background: rgba(239, 68, 68, 0.85);
  border: 1px solid rgba(239, 68, 68, 0.9);
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.firmware-cancel-btn:hover {
  background: rgba(239, 68, 68, 1);
  border-color: rgba(239, 68, 68, 1);
}

.firmware-update-available {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.firmware-versions {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
}

.firmware-version-current {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 14px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.06);
  padding: 4px 10px;
  border-radius: 6px;
}

.firmware-version-latest {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 14px;
  color: #4ade80;
  background: rgba(34, 197, 94, 0.1);
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 600;
}

.firmware-versions svg {
  color: var(--color-text-secondary);
}

.firmware-select {
  width: 100%;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
}

.firmware-update-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.firmware-update-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 80%, black) 100%);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.firmware-update-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.firmware-update-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.firmware-flash-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.firmware-flash-file-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 0;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.2s ease;
}

.firmware-flash-file-btn:hover {
  color: var(--color-text);
}

.firmware-selected-file {
  font-size: 12px;
  color: var(--color-text);
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 4px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.firmware-flash-btn {
  background: #3b82f6;
  border: none;
  color: white;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 24px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.firmware-flash-btn:hover {
  background: #2563eb;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.firmware-flash-clear-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  transition: color 0.2s ease;
  flex-shrink: 0;
}

.firmware-flash-clear-btn:hover {
  color: #f87171;
}
</style>
