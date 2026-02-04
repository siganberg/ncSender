<template>
  <Dialog
    :show-header="true"
    size="small"
    @close="$emit('close')"
  >
    <template #title>Pendant</template>
    <div class="pendant-content">
      <!-- Connection Status Card -->
      <div class="status-card" :class="{ 'status-card--connected': wifiPendant }">
        <div class="status-card__icon">
          <svg v-if="loading" class="spinner" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
          </svg>
          <svg v-else-if="wifiPendant" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <circle cx="12" cy="20" r="1" fill="currentColor"/>
          </svg>
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
            <span v-else-if="wifiPendant">Connected</span>
            <span v-else>Not Connected</span>
          </div>
          <div class="status-card__subtitle" v-if="!loading">
            <template v-if="wifiPendant">
              <span class="status-ip">{{ wifiPendant.ip }}</span>
              <span v-if="wifiPendant.version" class="status-version">v{{ wifiPendant.version }}</span>
            </template>
            <template v-else>
              No pendant detected on network
            </template>
          </div>
        </div>
        <div v-if="wifiPendant && !loading" class="status-card__badge">
          <span class="pulse"></span>
          WiFi
        </div>
      </div>

      <!-- License Status (when licensed) -->
      <div v-if="wifiPendant?.licensed" class="licensed-card">
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

      <!-- Activation Section (when not licensed) -->
      <div v-else class="activation-card">
        <div class="activation-card__header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>License Activation</span>
        </div>

        <div class="activation-card__body">
          <!-- Manual IP field when not connected -->
          <div v-if="!wifiPendant" class="form-field">
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
            <span class="form-hint">Enter the IP address shown on your pendant</span>
          </div>

          <div class="form-field">
            <label>Installation ID</label>
            <div class="input-wrapper">
              <input
                v-model="installationId"
                type="text"
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                :disabled="activating"
                @keyup.enter="activateLicense"
              />
            </div>
          </div>

          <button
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
import { ref, computed, onMounted } from 'vue';
import Dialog from './Dialog.vue';
import { getApiBaseUrl } from '../lib/api-base';

const emit = defineEmits(['close']);

const loading = ref(true);
const wifiPendant = ref<{ id: string; ip: string; version?: string; licensed?: boolean } | null>(null);
const installationId = ref('');
const manualPendantIp = ref('');
const activating = ref(false);
const activationError = ref('');
const activationSuccess = ref(false);

const canActivate = computed(() => {
  if (!installationId.value) return false;
  if (!wifiPendant.value && !manualPendantIp.value) return false;
  return true;
});

const fetchStatus = async () => {
  loading.value = true;
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/pendant/status`);
    if (!response.ok) throw new Error('Failed to fetch pendant status');
    const data = await response.json();
    wifiPendant.value = data.wifiPendant;
  } catch (error) {
    console.error('Failed to fetch pendant status:', error);
  } finally {
    loading.value = false;
  }
};

const activateLicense = async () => {
  if (!canActivate.value) return;

  activating.value = true;
  activationError.value = '';
  activationSuccess.value = false;

  const pendantIp = wifiPendant.value?.ip || manualPendantIp.value;
  let deviceId = '';

  // Always fetch device ID from pendant's /api/info endpoint
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

  try {
    const baseUrl = getApiBaseUrl();
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
    }
  } catch (error: any) {
    activationError.value = error.response?.data?.error || error.message || 'Activation failed';
  } finally {
    activating.value = false;
  }
};

onMounted(() => {
  fetchStatus();
});
</script>

<style scoped>
.pendant-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 480px;
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
  background: linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 80%, black) 100%);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 4px;
}

.activate-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb, 59, 130, 246), 0.3);
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
</style>
