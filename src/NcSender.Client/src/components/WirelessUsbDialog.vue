<template>
  <Dialog :show-header="true" @close="$emit('close')">
    <template #title>
      <span>Wireless USB</span>
      <span v-if="licensed" class="title-licensed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <polyline points="9 12 11 14 15 10"/>
        </svg>
        Activated
      </span>
    </template>

    <div class="wusb-content">
      <!-- Connection status -->
      <div class="status-card"
           :class="{ 'status-card--ok': connected && licensed, 'status-card--warn': connected && !licensed }">
        <div class="status-card__icon">
          <svg v-if="loading" class="spinner" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
          </svg>
          <svg v-else width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="status-card__content">
          <div class="status-card__title">
            <span v-if="loading">Checking…</span>
            <span v-else-if="connected">Wireless USB connected</span>
            <span v-else>Not connected</span>
          </div>
          <div class="status-card__subtitle" v-if="!loading">
            <span v-if="connected && licensed" class="ok-text">Activated and ready</span>
            <span v-else-if="connected" class="warn-text">Activation required</span>
            <span v-else>Plug in your ncSender Wireless USB</span>
          </div>
        </div>
        <div v-if="connected && licensed && !loading" class="status-card__badge">
          <span class="pulse"></span> Active
        </div>
        <div v-else-if="connected && !loading" class="status-card__badge status-card__badge--warn">
          Inactive
        </div>
      </div>

      <!-- Activation (connected, not licensed) -->
      <div v-if="connected && !licensed && !loading" class="section">
        <div class="section__title">Activate this Wireless USB</div>
        <p class="section__hint">
          Enter the Installation ID that came with your Wireless USB to activate it.
        </p>
        <div class="activate-col">
          <input
            v-model="installationId"
            class="text-input"
            type="text"
            placeholder="Installation ID"
            :disabled="activating"
            @keyup.enter="activate"
          />
          <div class="activate-actions">
            <button class="btn btn--primary" :disabled="!installationId || activating" @click="activate">
              {{ activating ? 'Activating…' : 'Activate' }}
            </button>
          </div>
        </div>
        <div v-if="activationError" class="msg msg--error">{{ activationError }}</div>
      </div>

      <!-- Devices (connected, licensed) — one shared Pair button opens the
           pairing window for any device type; each row shows Unpair if paired,
           or Get One if not. -->
      <div v-if="connected && licensed && !loading" class="section">
        <div class="section__head">
          <div class="section__title">Devices</div>
          <button v-if="!pairing" class="btn btn--ghost" @click="pairDevice"
            title="Open a 30s window so any wireless device (pendant, AutoDustBoot, RGB LED) can pair">
            + Pair New Device
          </button>
          <button v-else class="btn btn--danger-ghost" @click="cancelPairing">Cancel</button>
        </div>
        <div class="device-list" :class="{ 'device-list--locked': pairing }">
          <div v-for="r in deviceRows" :key="r.key" class="device-row">
            <span class="dot" :class="{ 'dot--on': r.paired && r.connected, 'dot--idle': r.paired && !r.connected }"></span>
            <div class="device-info">
              <span class="device-name">{{ r.label }}</span>
              <span class="device-sub">
                {{ r.paired ? (r.connected ? 'Connected' : 'Paired · idle') : (r.desc || 'Not paired') }}
              </span>
            </div>
            <div class="device-actions">
              <button v-if="r.paired" class="btn btn--danger-ghost"
                :disabled="pairing || unpairing === r.key" @click="askUnpair(r.key)">
                {{ unpairing === r.key ? 'Unpairing…' : 'Unpair' }}
              </button>
              <a v-else-if="r.store" class="btn btn--link" :class="{ 'btn--link-disabled': pairing }"
                :href="r.store" target="_blank" rel="noopener">Get One</a>
            </div>
          </div>
        </div>
        <p v-if="pairing" class="section__hint">
          Pairing window open (30s) — put the device into pairing mode now.
        </p>
      </div>
    </div>

    <!-- Unpair confirm -->
    <Dialog v-if="unpairTarget" @close="unpairTarget = null" :show-header="false" size="small">
      <ConfirmPanel
        title="Unpair device"
        :message="`Unpair ${prettyName(unpairTarget)} from this Wireless USB? You'll need to re-pair it to use it again.`"
        confirm-text="Unpair"
        cancel-text="Cancel"
        variant="danger"
        @confirm="doUnpair"
        @cancel="unpairTarget = null"
      />
    </Dialog>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Dialog from './Dialog.vue';
import ConfirmPanel from './ConfirmPanel.vue';
import { getApiBaseUrl } from '../lib/api-base';

defineEmits(['close']);

const baseUrl = getApiBaseUrl();

const CATALOG = [
  { key: 'pendant',      label: 'Pendant',      desc: 'Handheld jog + machine control', store: 'https://franciscreation.com/ncsender-wireless-pendant' },
  { key: 'autodustboot', label: 'AutoDustBoot', desc: 'Automatic dust boot control',    store: 'https://franciscreation.com/search?q=autodustboot' },
  { key: 'rgbled',       label: 'RGB LED',      desc: 'Machine status lighting',         store: 'https://franciscreation.com/ncsender-rgb-led' },
];

interface DongleDevice { name: string; connected: boolean; }

const loading = ref(true);
const connected = ref(false);
const licensed = ref(false);
const devices = ref<DongleDevice[]>([]);

const installationId = ref('');
const activating = ref(false);
const activationError = ref('');

const pairing = ref(false);
const unpairing = ref<string | null>(null);
const unpairTarget = ref<string | null>(null);
// The pendant is relayed untagged, so it never shows in /api/dongle/devices;
// its paired state is derived from the pendant connection (ESP-NOW = via dongle).
const pendantViaDongle = ref(false);

let refreshTimer: ReturnType<typeof setInterval> | null = null;

// One row per device type: catalog entries first (Pendant / AutoDustBoot / RGB LED),
// then any paired device that isn't in the catalog. Paired rows offer Unpair; the
// rest offer Pair + Get One.
const deviceRows = computed(() => {
  const byKey = new Map(devices.value.map(d => [d.name.toLowerCase(), d]));
  const rows = CATALOG.map(c => {
    const d = byKey.get(c.key);
    byKey.delete(c.key);
    let paired = !!d, connected = d?.connected ?? false;
    if (c.key === 'pendant' && pendantViaDongle.value) { paired = true; connected = true; }
    return { key: c.key, label: c.label, desc: c.desc, store: c.store, paired, connected };
  });
  for (const [key, d] of byKey) {
    rows.push({ key, label: prettyName(key), desc: '', store: null, paired: true, connected: d.connected });
  }
  return rows;
});

// Devices that can pair but aren't in the store catalog yet. They still need
// their real capitalisation — the generic fallback below title-cases the routing
// tag, turning 'xprobe' into 'Xprobe'. Keeping them out of CATALOG matters:
// catalog entries render a row with a "Get One" link even when unpaired, which
// would advertise hardware that isn't on sale.
const DISPLAY_NAMES: Record<string, string> = {
  xprobe: 'xProbe',
};

function prettyName(name: string): string {
  const key = name.toLowerCase();
  const hit = CATALOG.find(c => c.key === key);
  if (hit) return hit.label;
  return DISPLAY_NAMES[key] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

async function loadStatus() {
  try {
    const licRes = await fetch(`${baseUrl}/api/dongle/license`);
    if (licRes.ok) {
      const lic = await licRes.json();
      connected.value = !!lic.connected;
      licensed.value = !!lic.licensed;
    }
    if (connected.value && licensed.value) {
      const devRes = await fetch(`${baseUrl}/api/dongle/devices`);
      if (devRes.ok) {
        const list = await devRes.json();
        devices.value = (Array.isArray(list) ? list : []).map((d: any) => ({
          name: d.name ?? d.Name ?? '',
          connected: d.connected ?? d.Connected ?? false,
        }));
      }
      // Pendant paired state comes from the pendant connection (untagged relay).
      try {
        const pRes = await fetch(`${baseUrl}/api/pendant/status`);
        if (pRes.ok) {
          const p = await pRes.json();
          pendantViaDongle.value = !!p.dongleConnected && p.activeConnectionType === 'espnow';
        }
      } catch { /* ignore */ }
    } else {
      devices.value = [];
      pendantViaDongle.value = false;
    }
  } catch {
    // leave prior state; connection may be transient
  } finally {
    loading.value = false;
  }
}

async function activate() {
  if (!installationId.value || activating.value) return;
  activating.value = true;
  activationError.value = '';
  try {
    const res = await fetch(`${baseUrl}/api/dongle/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: installationId.value.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Activation failed (HTTP ${res.status})`);
    }
    installationId.value = '';
    await loadStatus();
  } catch (e: any) {
    activationError.value = e?.message || 'Activation failed';
  } finally {
    activating.value = false;
  }
}

let pairTimer: ReturnType<typeof setTimeout> | null = null;
async function pairDevice() {
  if (pairing.value) return;
  try {
    const res = await fetch(`${baseUrl}/api/dongle/pair`, { method: 'POST' });
    if (!res.ok) throw new Error();
    pairing.value = true;
    // The dongle beacons for ~30s; reflect that, then refresh + release the lock.
    if (pairTimer) clearTimeout(pairTimer);
    pairTimer = setTimeout(() => { pairing.value = false; pairTimer = null; loadStatus(); }, 30000);
  } catch {
    pairing.value = false;
  }
}

function cancelPairing() {
  if (pairTimer) { clearTimeout(pairTimer); pairTimer = null; }
  pairing.value = false;
  fetch(`${baseUrl}/api/dongle/pair/cancel`, { method: 'POST' }).catch(() => {});
  loadStatus();
}

function askUnpair(name: string) { unpairTarget.value = name; }

async function doUnpair() {
  const name = unpairTarget.value;
  unpairTarget.value = null;
  if (!name) return;
  unpairing.value = name;
  try {
    await fetch(`${baseUrl}/api/dongle/devices/${encodeURIComponent(name)}/unpair`, { method: 'POST' });
    await loadStatus();
  } finally {
    unpairing.value = null;
  }
}

onMounted(() => {
  loadStatus();
  refreshTimer = setInterval(loadStatus, 3000);
});
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });
</script>

<style scoped>
.wusb-content { display: flex; flex-direction: column; gap: 16px; padding: 20px; min-width: 460px; max-width: 520px; }

.title-licensed {
  display: inline-flex; align-items: center; gap: 4px; margin-left: 10px;
  font-size: 0.72rem; font-weight: 600; color: #28a745;
}

.status-card {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px;
  background: rgba(128, 128, 128, 0.08); border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
}
.status-card--ok { border-color: rgba(40, 167, 69, 0.4); background: rgba(40, 167, 69, 0.08); }
.status-card--ok .status-card__icon { color: #28a745; }
.status-card--warn { border-color: rgba(255, 193, 7, 0.45); background: rgba(255, 193, 7, 0.08); }
.status-card--warn .status-card__icon { color: #d9a406; }
.status-card__icon { color: var(--md-primary-fg-color, #1abc9c); display: flex; }
.status-card__content { flex: 1; min-width: 0; }
.status-card__title { font-weight: 600; }
.status-card__subtitle { font-size: 0.82rem; opacity: 0.85; margin-top: 2px; }
.ok-text { color: #28a745; }
.warn-text { color: #d9a406; font-weight: 600; }
.status-card__badge {
  display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem;
  font-weight: 700; color: #28a745; text-transform: uppercase; letter-spacing: 0.04em;
}
.status-card__badge--warn { color: #d9a406; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: #28a745; box-shadow: 0 0 0 0 rgba(40,167,69,0.6); animation: pulse 1.8s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(40,167,69,0.5); } 70% { box-shadow: 0 0 0 7px rgba(40,167,69,0); } 100% { box-shadow: 0 0 0 0 rgba(40,167,69,0); } }
.spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.section { display: flex; flex-direction: column; gap: 10px; }
.section__head { display: flex; align-items: center; justify-content: space-between; }
.section__title { font-weight: 600; font-size: 0.9rem; }
.section__hint { font-size: 0.82rem; opacity: 0.75; margin: 0; }

.activate-col { display: flex; flex-direction: column; gap: 10px; }
.activate-actions { display: flex; justify-content: flex-end; }
.text-input {
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  font-size: 0.9rem; letter-spacing: 0.02em;
  background: rgba(128,128,128,0.1); border: 1px solid rgba(128,128,128,0.25);
  color: inherit;
}
.text-input:focus { outline: none; border-color: var(--md-primary-fg-color, #1abc9c); }

.device-list { display: flex; flex-direction: column; gap: 6px; }
/* While a pairing window is open, lock the whole list so no device can be
   unpaired / bought mid-pair. */
.device-list--locked { opacity: 0.5; pointer-events: none; }
.btn--link-disabled { opacity: 0.5; pointer-events: none; }
.device-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: rgba(128,128,128,0.06); border: 1px solid rgba(128,128,128,0.15); border-radius: 8px;
}
.device-info { display: flex; flex-direction: column; min-width: 0; }
.device-name { font-weight: 600; }
.device-sub { font-size: 0.76rem; opacity: 0.68; }
.device-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: rgba(128,128,128,0.4); flex: none; }
.dot--on { background: #28a745; }
.dot--idle { background: #ffc107; }

.btn--link { background: transparent; border-color: transparent; color: var(--md-primary-fg-color, #1abc9c); padding: 8px; }
.btn--link:hover { text-decoration: underline; }

.btn {
  padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
  border: 1px solid transparent; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
}
.btn:disabled { opacity: 0.55; cursor: default; }
.btn--primary { background: var(--md-primary-fg-color, #1abc9c); color: #fff; }
.btn--ghost { background: transparent; border-color: rgba(128,128,128,0.35); color: inherit; }
.btn--ghost:hover { border-color: var(--md-primary-fg-color, #1abc9c); }
.btn--danger-ghost { background: transparent; border-color: rgba(220,53,69,0.5); color: #dc3545; }
.btn--danger-ghost:hover { background: rgba(220,53,69,0.1); }

.msg { font-size: 0.82rem; padding: 8px 10px; border-radius: 6px; }
.msg--error { color: #dc3545; background: rgba(220,53,69,0.1); }
</style>
