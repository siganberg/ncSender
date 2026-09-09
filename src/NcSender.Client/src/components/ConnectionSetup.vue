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

<!--
  CNC connection setup: USB or Ethernet, the port details, and a live
  status card. Used inline on Settings > General and as the first step of
  the machine setup wizard. Saving writes `connection` to settings; the
  server's auto-connect picks the change up on its own.
-->
<template>
  <div class="cs">
    <div class="cs__choice" role="radiogroup" aria-label="Connection type">
      <button type="button" class="cs__choice-card" :class="{ 'is-active': conn.type === 'usb' }" role="radio" :aria-checked="conn.type === 'usb'" @click="conn.type = 'usb'">
        <span class="cs__choice-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="1" /><circle cx="4" cy="20" r="1" /><path d="M4.7 19.3 19 5" /><path d="m21 3-3 1 2 2Z" /><path d="M9.26 7.68 5 12l2 5" /><path d="m10 14 5 2 3.5-3.5" /><path d="m18 12 1-1 1 1-1 1Z" /></svg>
        </span>
        <span class="cs__choice-text">
          <span class="cs__choice-title">USB <span v-if="savedConn.type === 'usb'" class="cs__current">Current</span></span>
          <span class="cs__choice-note">A cable from this computer to the controller board.</span>
        </span>
        <span class="cs__choice-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
      </button>
      <button type="button" class="cs__choice-card" :class="{ 'is-active': conn.type === 'ethernet' }" role="radio" :aria-checked="conn.type === 'ethernet'" @click="conn.type = 'ethernet'">
        <span class="cs__choice-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" /></svg>
        </span>
        <span class="cs__choice-text">
          <span class="cs__choice-title">Ethernet <span v-if="savedConn.type === 'ethernet'" class="cs__current">Current</span></span>
          <span class="cs__choice-note">The controller is on the network with its own IP address.</span>
        </span>
        <span class="cs__choice-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
      </button>
    </div>

    <template v-if="conn.type === 'usb'">
      <div class="cs__grid2">
        <label class="cs__field">
          <span class="cs__field-label">Serial port</span>
          <div class="cs__select-row">
            <select class="cs__input" v-model="conn.usbPort">
              <option value="">Auto-detect</option>
              <option v-for="p in usbPorts" :key="p.path" :value="p.path">{{ p.path }}{{ p.manufacturer ? ' · ' + p.manufacturer : '' }}</option>
            </select>
            <button type="button" class="cs__btn cs__btn--ghost cs__btn--sm" :disabled="portsLoading" @click="loadUsbPorts">{{ portsLoading ? '…' : 'Rescan' }}</button>
          </div>
          <span class="cs__field-hint">Auto-detect tries every port that looks like a controller.</span>
        </label>
        <label class="cs__field">
          <span class="cs__field-label">Baud rate</span>
          <select class="cs__input" v-model.number="conn.baudRate">
            <option v-for="b in baudRates" :key="b" :value="b">{{ b }}</option>
          </select>
          <span class="cs__field-hint">grblHAL boards use 115200.</span>
        </label>
      </div>
    </template>
    <template v-else>
      <div class="cs__grid3">
        <label class="cs__field">
          <span class="cs__field-label">IP address</span>
          <input class="cs__input" v-model.trim="conn.ip" placeholder="192.168.5.1" />
        </label>
        <label class="cs__field">
          <span class="cs__field-label">Port</span>
          <input class="cs__input" type="number" min="1" max="65535" v-model.number="conn.port" />
        </label>
        <label class="cs__field">
          <span class="cs__field-label">Protocol</span>
          <select class="cs__input" v-model="conn.protocol" @change="onProtocolChange">
            <option value="telnet">Telnet</option>
            <option value="websocket">WebSocket</option>
          </select>
        </label>
      </div>
    </template>

    <div class="cs__status" :class="connected ? 'is-ok' : (saving ? 'is-busy' : 'is-bad')">
      <span class="cs__led" :class="connected ? 'cs__led--ok' : (saving ? 'cs__led--busy' : 'cs__led--bad')"></span>
      <div class="cs__status-text">
        <div class="cs__status-title">{{ connected ? `Connected via ${savedConn.type === 'ethernet' ? 'Ethernet' : 'USB'}` : (saving ? 'Connecting…' : 'Not connected') }}</div>
        <div class="cs__status-note">{{ connected ? savedConnDetail : (saving ? 'Waiting for the controller to answer.' : (idleHint || 'Save the connection and ncSender will connect on its own.')) }}</div>
      </div>
      <button type="button" class="cs__btn" :class="connected ? 'cs__btn--ghost' : 'cs__btn--primary'" :disabled="saving || !valid" @click="save">{{ saving ? 'Saving…' : (connected ? 'Reconnect' : 'Save & connect') }}</button>
    </div>
    <div v-if="error" class="cs__error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/lib/api.js';
import { settingsStore } from '@/lib/settings-store.js';
import { useAppStore } from '@/composables/use-app-store';

defineProps<{
  /** Extra hint shown in the status card while not connected. */
  idleHint?: string;
}>();

const store = useAppStore();
const connected = computed(() => !!store.isConnected.value);

type ConnType = 'usb' | 'ethernet';
const conn = reactive({ type: 'usb' as ConnType, usbPort: '', baudRate: 115200, ip: '192.168.5.1', port: 23, protocol: 'telnet' });
const baudRates = [115200, 230400, 250000, 460800, 921600];
const usbPorts = ref<{ path: string; manufacturer?: string | null }[]>([]);
const portsLoading = ref(false);
const saving = ref(false);
const error = ref('');
const valid = computed(() => conn.type === 'usb'
  ? conn.baudRate > 0
  : /^(\d{1,3}\.){3}\d{1,3}$/.test(conn.ip) && conn.port >= 1 && conn.port <= 65535);

// What the app is actually using right now (auto-detect writes the port it
// found back into settings, so this shows the real device).
const savedConn = computed(() => {
  const c = (settingsStore.data as any)?.connection ?? {};
  return { type: String(c.type ?? 'usb').toLowerCase(), usbPort: c.usbPort ?? '', baudRate: c.baudRate ?? 115200, ip: c.ip ?? '', port: c.port ?? 23, protocol: c.protocol ?? 'telnet' };
});
const savedConnDetail = computed(() => savedConn.value.type === 'ethernet'
  ? `${savedConn.value.ip}:${savedConn.value.port}, ${savedConn.value.protocol === 'websocket' ? 'WebSocket' : 'Telnet'}`
  : `${savedConn.value.usbPort || 'Auto-detected port'} at ${savedConn.value.baudRate} baud`);

const seed = () => {
  const c = (settingsStore.data as any)?.connection ?? {};
  if (c.type) conn.type = String(c.type).toLowerCase() === 'ethernet' ? 'ethernet' : 'usb';
  if (typeof c.usbPort === 'string') conn.usbPort = c.usbPort;
  if (c.baudRate) conn.baudRate = Number(c.baudRate) || 115200;
  if (c.ip) conn.ip = c.ip;
  if (c.port) conn.port = Number(c.port) || 23;
  if (c.protocol) conn.protocol = c.protocol;
};
const onProtocolChange = () => {
  if (conn.port === 23 || conn.port === 81) conn.port = conn.protocol === 'websocket' ? 81 : 23;
};
const loadUsbPorts = async () => {
  portsLoading.value = true;
  try {
    const res = await fetch(`${api.baseUrl}/api/usb-ports`);
    usbPorts.value = res.ok ? await res.json() : [];
  } catch { usbPorts.value = []; }
  finally { portsLoading.value = false; }
};
const save = async () => {
  saving.value = true;
  error.value = '';
  try {
    const { updateSettings } = await import('@/lib/settings-store.js');
    await updateSettings({
      connection: conn.type === 'usb'
        ? { type: 'usb', usbPort: conn.usbPort, baudRate: conn.baudRate }
        : { type: 'ethernet', ip: conn.ip, port: conn.port, protocol: conn.protocol },
    });
  } catch (err: any) {
    error.value = `Could not save the connection: ${err?.message ?? err}`;
  } finally {
    // Leave "Connecting…" up for a moment; the card flips to Connected on
    // its own once the controller answers.
    setTimeout(() => { saving.value = false; }, 4000);
  }
};

onMounted(() => { seed(); loadUsbPorts(); });
</script>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 22px; }

.cs__choice { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.cs__choice-card {
  position: relative; display: flex; align-items: center; gap: 14px; text-align: left;
  padding: 20px; border-radius: 12px; cursor: pointer; font: inherit;
  border: 2px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary);
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.cs__choice-card:hover { border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border)); transform: translateY(-1px); }
.cs__choice-card.is-active { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)); }
.cs__choice-icon {
  width: 48px; height: 48px; border-radius: 12px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-border) 60%, transparent); color: var(--color-text-secondary);
}
.cs__choice-card.is-active .cs__choice-icon { background: var(--color-accent); color: #fff; }
.cs__choice-icon svg { width: 26px; height: 26px; }
.cs__choice-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cs__choice-title { font-weight: 700; font-size: 1.05rem; }
.cs__choice-note { font-size: 0.82rem; color: var(--color-text-secondary); line-height: 1.4; }
.cs__choice-check {
  position: absolute; top: 10px; right: 10px; width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-accent); color: #fff; opacity: 0; transform: scale(0.6);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.cs__choice-check svg { width: 13px; height: 13px; }
.cs__choice-card.is-active .cs__choice-check { opacity: 1; transform: scale(1); }
.cs__current {
  display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 999px; vertical-align: 2px;
  font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  background: rgba(40, 167, 69, 0.18); color: #3ecf8e;
}

.cs__grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.cs__grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
.cs__field { display: flex; flex-direction: column; gap: 8px; }
.cs__field-label { font-weight: 600; color: var(--color-text-primary); font-size: 0.92rem; }
.cs__field-hint { font-size: 0.8rem; color: var(--color-text-secondary); }
.cs__input {
  padding: 13px 14px; border-radius: 8px; font-size: 1.05rem;
  border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary);
}
.cs__input:focus { outline: none; border-color: var(--color-accent); }
select.cs__input { appearance: auto; }
.cs__select-row { display: flex; gap: 8px; }
.cs__select-row .cs__input { flex: 1 1 auto; min-width: 0; }

.cs__status {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px; border-radius: 12px; border: 1.5px solid var(--color-border);
}
.cs__status-text { flex: 1 1 auto; min-width: 0; }
.cs__status-title { font-weight: 600; color: var(--color-text-primary); }
.cs__status-note { font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px; line-height: 1.45; }
.cs__status.is-ok { border-color: rgba(40, 167, 69, 0.6); background: rgba(40, 167, 69, 0.08); }
.cs__status.is-bad { border-color: rgba(220, 53, 69, 0.6); background: rgba(220, 53, 69, 0.08); }
.cs__status.is-busy { border-color: rgba(245, 158, 11, 0.6); background: rgba(245, 158, 11, 0.08); }
.cs__led { width: 22px; height: 22px; border-radius: 50%; flex: 0 0 auto; }
.cs__led--ok { background: #28a745; box-shadow: 0 0 10px rgba(40, 167, 69, 0.9), 0 0 20px rgba(40, 167, 69, 0.45); }
.cs__led--busy { background: #f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.9), 0 0 20px rgba(245, 158, 11, 0.45); }
.cs__led--bad { background: #dc3545; box-shadow: 0 0 10px rgba(220, 53, 69, 0.9), 0 0 20px rgba(220, 53, 69, 0.5); }
.cs__error { padding: 10px 14px; border-radius: 10px; background: rgba(217, 83, 79, 0.15); color: #ff8888; font-size: 0.9rem; }

.cs__btn {
  display: inline-flex; align-items: center; gap: 8px; justify-content: center;
  min-width: 120px; padding: 11px 18px; border-radius: 10px;
  font-size: 0.95rem; font-weight: 600; cursor: pointer; border: 1.5px solid transparent;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.cs__btn:disabled { opacity: 0.5; cursor: default; }
.cs__btn:not(:disabled):hover { transform: translateY(-1px); }
.cs__btn--ghost { background: transparent; border-color: var(--color-border); color: var(--color-text-primary); }
.cs__btn--primary { background: var(--color-accent); color: #fff; }
.cs__btn--sm { min-width: 0; padding: 8px 12px; font-size: 0.85rem; }

@media (max-width: 640px) {
  .cs__choice, .cs__grid2, .cs__grid3 { grid-template-columns: 1fr; }
  .cs__status { flex-wrap: wrap; }
  .cs__status .cs__btn { width: 100%; }
}
</style>
