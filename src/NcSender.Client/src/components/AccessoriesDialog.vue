<template>
  <Dialog :show-header="false" width="900px" height="78vh" max-width="95vw" @close="$emit('close')">
    <div class="acc-container">
      <!-- Sidebar: one entry per accessory, so the list is always visible and
           the panel only ever shows the one you picked. Mirrors QuickCut. -->
      <aside class="acc-sidebar">
        <div class="acc-sidebar-header">
          <span class="acc-eyebrow">ncSender</span>
          <span class="acc-title">Accessories</span>
        </div>
        <nav class="acc-nav">
          <button v-for="a in rows" :key="a.id" type="button" class="acc-nav-btn"
                  :class="{ active: selectedId === a.id }" @click="selectedId = a.id">
            <span class="dot" :class="dotClass(a)"></span>
            <span class="acc-nav-label">{{ a.name }}</span>
            <!-- A badge here rather than in the panel: the point of the list is
                 to show, at a glance, which device wants something. -->
            <span v-if="flashing[a.id]" class="acc-pill acc-pill--busy">…</span>
            <span v-else-if="a.connected && a.licensed === false" class="acc-pill acc-pill--warn">!</span>
            <span v-else-if="a.updateAvailable" class="acc-pill acc-pill--accent">↑</span>
          </button>
        </nav>
        <div class="acc-sidebar-actions">
          <button class="acc-pair-btn" v-if="!pairing" :disabled="!dongleReady"
                  :title="dongleReady ? `Open a ${PAIR_WINDOW_SECONDS}s pairing window`
                                      : 'Requires an activated Wireless USB'"
                  @click="pairDevice">
            <span class="acc-pair-plus" aria-hidden="true">+</span> Pair Device
          </button>
          <button class="acc-pair-btn acc-pair-btn--live" v-else @click="cancelPairing"
                  title="Cancel pairing">
            <span class="acc-pair-count">Pairing… {{ pairSecondsLeft }}s</span>
            <span class="acc-pair-cancel">click to cancel</span>
          </button>
        </div>
        <!-- Close lives in the sidebar footer, matching Settings — it is the
             same kind of action in the same kind of dialog, so it belongs in
             the same place and wears the same weight. -->
        <div class="acc-sidebar-footer">
          <button class="acc-sidebar-close" @click="$emit('close')">Close</button>
        </div>
      </aside>

      <!-- Detail panel -->
      <div class="acc-main">
        <div class="acc-panel-header">
          <h2 class="acc-panel-title">{{ selected?.name || 'Accessories' }}</h2>
          <p class="acc-panel-sub">{{ subtitle }}</p>
        </div>

        <div class="acc-panel" v-if="selected">
          <!-- Connection -->
          <section class="acc-card">
            <div class="acc-card-header">
              <h3 class="acc-card-title">Connection</h3>
              <span class="acc-status" :class="statusClass">{{ statusText }}</span>
            </div>
            <div class="acc-grid">
              <div class="acc-field">
                <label>Reached over</label>
                <div class="acc-value">{{ selected.connected ? transportLabel(selected) : '—' }}</div>
              </div>
              <div class="acc-field">
                <label>Activation</label>
                <div class="acc-value">
                  {{ selected.licensed === true ? 'Activated'
                     : selected.licensed === false ? 'Not activated' : '—' }}
                </div>
              </div>
              <div class="acc-field acc-field--wide" v-if="selected.deviceId">
                <label>Device ID</label>
                <button type="button" class="acc-copy" :title="selected.deviceId"
                        @click="copyDeviceId(selected.deviceId)">
                  <span class="acc-value acc-value--mono">{{ shortId(selected.deviceId) }}</span>
                  <span class="acc-copy-icon" aria-hidden="true">
                    <svg v-if="copied" width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </span>
                  <span class="acc-copy-label">{{ copied ? 'Copied' : 'Copy' }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Firmware -->
          <section class="acc-card">
            <div class="acc-card-header">
              <h3 class="acc-card-title">Firmware</h3>
              <button v-if="selected.connected && selected.updateAvailable && !flashing[selected.id]"
                      class="btn btn--primary" @click="update(selected)">
                Update to v{{ selected.latestVersion }}
              </button>
            </div>
            <div class="acc-grid">
              <div class="acc-field">
                <label>Installed</label>
                <div class="acc-value">{{ selected.currentVersion ? 'v' + selected.currentVersion : '—' }}</div>
              </div>
              <div class="acc-field">
                <label>Latest</label>
                <div class="acc-value">{{ selected.latestVersion ? 'v' + selected.latestVersion : '—' }}</div>
              </div>
            </div>
            <div v-if="flashing[selected.id]" class="acc-flash">
              <div class="acc-flash-msg">{{ flashing[selected.id].message }}</div>
              <div class="acc-progress">
                <div class="acc-progress__bar" :style="{ width: (flashing[selected.id].percent || 0) + '%' }"></div>
              </div>
            </div>
            <p v-else-if="selected.updateCheckError" class="acc-note acc-note--warn">
              {{ selected.updateCheckError }}
            </p>
            <p v-else-if="!selected.connected" class="acc-note">
              Connect this accessory to see its firmware.
            </p>
            <p v-else-if="!selected.updateAvailable && selected.latestVersion" class="acc-note">
              Up to date.
            </p>
          </section>

          <!-- Activation -->
          <section class="acc-card" v-if="selected.connected && selected.licensed === false">
            <div class="acc-card-header"><h3 class="acc-card-title">Activation</h3></div>
            <p class="acc-note">Enter the Installation ID that came with your {{ selected.name }}.</p>
            <div class="acc-activate-row">
              <input v-model="installationId" class="text-input" type="text" placeholder="Installation ID"
                     :disabled="activating" @keyup.enter="activate" />
              <button class="btn btn--primary" :disabled="!installationId || activating" @click="activate">
                {{ activating ? 'Activating…' : 'Activate' }}
              </button>
            </div>
            <p v-if="activationError" class="msg msg--error">{{ activationError }}</p>
          </section>

          <!-- Pairing — never offered for the Wireless USB: it is the radio,
               so it cannot be paired to itself. -->
          <section class="acc-card" v-if="selected.id !== 'wireless-usb'">
            <div class="acc-card-header">
              <h3 class="acc-card-title">Pairing</h3>
              <button v-if="selected.paired" class="btn btn--danger-ghost"
                      :disabled="pairing || unpairing === selected.id"
                      @click="unpairTarget = selected.id">
                {{ unpairing === selected.id ? 'Unpairing…' : 'Unpair' }}
              </button>
            </div>
            <p class="acc-note">
              {{ selected.paired
                 ? 'Paired to this Wireless USB.'
                 : 'Not paired. Use “Pair Device” and put it into pairing mode.' }}
            </p>
          </section>
        </div>
      </div>
    </div>

    <Dialog v-if="unpairTarget" @close="unpairTarget = null" :show-header="false" size="small">
      <ConfirmPanel
        title="Unpair device"
        :message="`Unpair ${nameFor(unpairTarget)} from this Wireless USB? You'll need to re-pair it to use it again.`"
        confirm-text="Unpair" cancel-text="Cancel" variant="danger"
        @confirm="doUnpair" @cancel="unpairTarget = null" />
    </Dialog>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
import Dialog from './Dialog.vue';
import ConfirmPanel from './ConfirmPanel.vue';
import { getApiBaseUrl } from '../lib/api-base';
import { api } from '../lib/api.js';

defineEmits(['close']);
const baseUrl = getApiBaseUrl();

interface Accessory {
  id: string; name: string; transport: string;
  connected: boolean; licensed: boolean | null;
  deviceId: string; currentVersion: string; latestVersion: string;
  updateAvailable: boolean; downloadUrl: string; updateCheckError?: string | null;
  paired?: boolean;
}

const loading = ref(true);
const accessories = ref<Accessory[]>([]);
const pairedNames = ref<string[]>([]);
const flashing = reactive<Record<string, { percent: number; message: string }>>({});

const pairing = ref(false);
// Matches PAIR_WINDOW_MS in the dongle firmware. If one changes, so must the
// other — a countdown that outlives the beacon is worse than none.
const PAIR_WINDOW_SECONDS = 60;
const pairSecondsLeft = ref(0);
let pairTicker: ReturnType<typeof setInterval> | null = null;
const unpairing = ref<string | null>(null);
const unpairTarget = ref<string | null>(null);

// Which accessory the panel is showing. Defaults to whatever most wants
// attention, so opening the dialog lands on the thing you came for.
const selectedId = ref<string>('wireless-usb');
const installationId = ref('');
const activating = ref(false);
const activationError = ref('');

const offs: Array<() => void> = [];

// Connected first, then paired-but-offline, then the rest — so whatever needs
// attention is nearest the top rather than wherever the catalogue happens to
// list it.
const rows = computed(() => {
  const paired = new Set(pairedNames.value.map(n => n.toLowerCase()));
  return accessories.value
    .map(a => ({
      ...a,
      // Reachable over the radio means paired — that is the only way it could
      // be reachable. This matters for the pendant, which the dongle relays
      // UNTAGGED and so never lists in $DEVICES: going by that list alone had
      // a connected pendant reporting "Not paired".
      paired: a.id === 'wireless-usb'
        ? a.connected
        : paired.has(a.id) || (a.connected && a.transport === 'wireless'),
    }))
    .sort((x, y) => Number(y.connected) - Number(x.connected)
                 || Number(!!y.paired) - Number(!!x.paired));
});

const selected = computed(() => rows.value.find(a => a.id === selectedId.value) ?? rows.value[0]);

const subtitle = computed(() => {
  const a = selected.value;
  if (!a) return '';
  if (!a.connected) return a.paired ? 'Paired, but not currently connected.' : 'Not connected.';
  if (a.licensed === false) return 'Connected — activation required before it will work.';
  if (a.updateAvailable) return `Firmware v${a.latestVersion} is available.`;
  return 'Connected and up to date.';
});

const statusText = computed(() => {
  const a = selected.value;
  if (!a) return '';
  if (!a.connected) return a.paired ? 'Offline' : 'Not connected';
  if (a.licensed === false) return 'Not activated';
  return 'Connected';
});

const statusClass = computed(() => {
  const a = selected.value;
  if (!a || !a.connected) return 'acc-status--off';
  return a.licensed === false ? 'acc-status--warn' : 'acc-status--ok';
});

const copied = ref(false);

async function copyDeviceId(id: string) {
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
  } catch {
    // Same fallback the licence dialog uses: the clipboard API needs a secure
    // context, and ncSender is routinely reached over plain http on a LAN.
    const input = document.createElement('input');
    input.value = id;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

function shortId(id: string) {
  return id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

const dongleReady = computed(() => {
  const d = accessories.value.find(a => a.id === 'wireless-usb');
  return !!d?.connected && d?.licensed === true;
});

function transportLabel(a: Accessory) {
  return a.transport === 'wireless' ? 'Wireless' : 'USB';
}
function dotClass(a: Accessory) {
  if (a.connected && a.licensed === false) return 'dot--warn';
  if (a.connected) return 'dot--on';
  return a.paired ? 'dot--idle' : '';
}
function nameFor(id: string | null) {
  return accessories.value.find(a => a.id === id)?.name ?? id ?? '';
}

// `check` hits GitHub for every product, so it runs when the dialog opens and
// after a flash — not on the poll that only needs connection state.
async function load(checkUpdates = false) {
  try {
    const res = await fetch(`${baseUrl}/api/accessories${checkUpdates ? '?check=true' : ''}`);
    if (res.ok) accessories.value = await res.json();
    const devRes = await fetch(`${baseUrl}/api/dongle/devices`);
    if (devRes.ok) {
      const list = await devRes.json();
      pairedNames.value = (Array.isArray(list) ? list : []).map((d: any) => d.name ?? '');
    }
  } catch { /* transient — the next poll retries */ }
  finally {
    if (loading.value) {
      // First load: land on whatever needs attention rather than always the
      // first row — activation first, then an available update.
      const pick = accessories.value.find(a => a.connected && a.licensed === false)
                ?? accessories.value.find(a => a.updateAvailable)
                ?? accessories.value.find(a => a.connected);
      if (pick) selectedId.value = pick.id;
      loading.value = false;
    }
  }
}

async function update(a: Accessory) {
  flashing[a.id] = { percent: 0, message: 'Starting…' };
  try {
    const res = await fetch(`${baseUrl}/api/accessories/${a.id}/update`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      flashing[a.id] = { percent: 0, message: err.error || 'Update failed' };
      setTimeout(() => delete flashing[a.id], 4000);
    }
  } catch {
    delete flashing[a.id];
  }
}

async function activate() {
  // The activation card only renders for the accessory currently selected, so
  // that is the target. It used to consult a separate ref set by a per-row
  // button that no longer exists after the layout change — leaving this
  // function returning immediately and the button doing nothing at all.
  const target = selected.value;
  if (!target || !installationId.value) return;
  activating.value = true;
  activationError.value = '';
  try {
    // Only the Wireless USB has an activation endpoint today; the wireless
    // peers report no licence state yet, so their rows never offer this.
    const res = await fetch(`${baseUrl}/api/dongle/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: installationId.value.trim() }),
    });
    if (res.ok) { installationId.value = ''; await load(true); }
    else {
      const err = await res.json().catch(() => ({}));
      activationError.value = err.error || 'Activation failed';
    }
  } catch (e: any) {
    activationError.value = e?.message || 'Activation failed';
  } finally { activating.value = false; }
}

function stopPairTicker() {
  if (pairTicker) { clearInterval(pairTicker); pairTicker = null; }
  pairSecondsLeft.value = 0;
}

async function pairDevice() {
  pairing.value = true;
  pairSecondsLeft.value = PAIR_WINDOW_SECONDS;
  try { await fetch(`${baseUrl}/api/dongle/pair`, { method: 'POST' }); } catch { /* ignore */ }

  stopPairTicker();
  pairSecondsLeft.value = PAIR_WINDOW_SECONDS;
  pairTicker = setInterval(() => {
    pairSecondsLeft.value -= 1;
    if (pairSecondsLeft.value <= 0) {
      stopPairTicker();
      pairing.value = false;
      load();          // a device may have joined on the last tick
    }
  }, 1000);
}

async function cancelPairing() {
  stopPairTicker();
  pairing.value = false;
  try { await fetch(`${baseUrl}/api/dongle/pair/cancel`, { method: 'POST' }); } catch { /* ignore */ }
  load();
}
async function doUnpair() {
  const name = unpairTarget.value; unpairTarget.value = null;
  if (!name) return;
  unpairing.value = name;
  try { await fetch(`${baseUrl}/api/dongle/devices/${name}/unpair`, { method: 'POST' }); }
  catch { /* ignore */ }
  finally { unpairing.value = null; await load(); }
}

onMounted(() => {
  // Release check runs ONCE, on open — it reaches out to GitHub for every
  // product, so it is not something to repeat on a timer.
  load(true);

  // Everything after that is event-driven. The server already tells us when a
  // device connects, drops or is paired, so polling every few seconds only
  // asked the same question over and over and answered it identically. A
  // coalescing delay keeps a burst of events (a dongle reattach re-seeds four
  // devices at once) to a single refresh.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshSoon = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; load(false); }, 400);
  };
  offs.push(() => { if (refreshTimer) clearTimeout(refreshTimer); });

  const track = (ev: string, fn: (d: any) => void) => { offs.push(api.on(ev, fn)); };

  track('dongle:device-changed', refreshSoon);
  track('pendant:status-changed', refreshSoon);

  const idOf = (d: any) => d?.device ?? '';
  track('plugin-ota:progress', (d: any) => {
    const id = idOf(d); if (!id) return;
    flashing[id] = { percent: d.percent ?? 0, message: `Updating… ${d.percent ?? 0}%` };
  });
  track('plugin-ota:message', (d: any) => {
    const id = idOf(d); if (!id || !flashing[id]) return;
    flashing[id] = { percent: flashing[id].percent, message: d.message ?? flashing[id].message };
  });
  track('plugin-ota:done', (d: any) => {
    const id = idOf(d); if (!id) return;
    flashing[id] = { percent: 100, message: 'Updated — restarting' };
    // The device reboots and re-reports its version, so re-check rather than
    // assume the new one took.
    setTimeout(async () => { delete flashing[id]; await load(true); }, 4000);
  });
  track('plugin-ota:error', (d: any) => {
    const id = idOf(d); if (!id) return;
    flashing[id] = { percent: 0, message: d.message || 'Update failed' };
    setTimeout(() => delete flashing[id], 6000);
  });
});

onUnmounted(() => {
  stopPairTicker();
  offs.forEach(off => off?.());
});
</script>

<style scoped>
/* Two-pane shell, matching the QuickCut plugin so the app reads as one product. */
/* Dialog renders our slot inside .dialog__content; without making that a flex
   column the two-pane shell has no height to fill and collapses to its text. */
:deep(.dialog__content) {
  display: flex; flex-direction: column; padding: 0;
  flex: 1 1 auto; min-height: 0; overflow: hidden;
}
.acc-container { display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; overflow: hidden; }

.acc-sidebar {
  display: flex; flex-direction: column; flex-shrink: 0; width: 220px;
  border-right: 1px solid var(--color-border);
  padding: 18px 12px 14px;
}
.acc-sidebar-header {
  display: flex; flex-direction: column; gap: 2px;
  padding: 0 4px 16px; margin-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}
.acc-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-accent); opacity: 0.85;
}
.acc-title { font-size: 1.05rem; font-weight: 600; color: var(--color-text-primary); }

.acc-nav { display: flex; flex-direction: column; gap: 6px; }
.acc-nav-btn {
  appearance: none; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: transparent; border: none; border-radius: 8px;
  color: var(--color-text-secondary); font-size: 0.9rem; text-align: left; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.acc-nav-btn:hover { background: color-mix(in srgb, var(--color-text-primary, #fff) 5%, transparent); color: var(--color-text-primary); }
.acc-nav-btn.active {
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--color-accent) 16%, transparent) 0%,
    color-mix(in srgb, var(--color-accent) 8%, transparent) 100%);
  color: var(--color-text-primary);
}
.acc-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* A one-glyph badge, so the list answers "which of these wants something?"
   without the reader parsing five rows of prose. */
.acc-pill {
  flex-shrink: 0; min-width: 16px; height: 16px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; padding: 0 4px;
}
.acc-pill--warn   { background: #e0a03022; color: #e0a030; }
.acc-pill--accent { background: color-mix(in srgb, var(--color-accent) 20%, transparent); color: var(--color-accent); }
.acc-pill--busy   { background: var(--color-surface-raised); color: var(--color-text-secondary); }

.acc-sidebar-actions { margin-top: auto; padding-top: 14px; }

/* Accent-outlined rather than the flat ghost it was: this is the only action
   in the sidebar and it was reading as disabled text. */
.acc-pair-btn {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 38px; padding: 9px 14px;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: 8px;
  color: var(--color-accent);
  font-size: 0.86rem; font-weight: 600; letter-spacing: 0.01em; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.acc-pair-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  border-color: var(--color-accent);
}
.acc-pair-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.acc-pair-plus { font-size: 1rem; line-height: 1; }

/* While the window is open the button becomes the countdown, and reveals
   Cancel on hover — one control, two jobs, no second button to hunt for. */
/* Two stacked lines, both centred: the countdown, and a standing note that
   the button cancels. Saying so outright beats hiding it behind a hover —
   there is nothing to discover, and it reads the same on a touchscreen. */
.acc-pair-btn--live {
  flex-direction: column; gap: 1px; padding: 7px 14px; min-height: 44px;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  border-color: var(--color-accent);
}
.acc-pair-count { font-variant-numeric: tabular-nums; }  /* no width jitter as it ticks */
.acc-pair-cancel {
  font-size: 0.68rem; font-weight: 500; letter-spacing: 0.01em;
  color: var(--color-text-secondary); opacity: 0.85;
}

.acc-sidebar-footer {
  padding-top: 14px; margin-top: 12px;
  border-top: 1px solid var(--color-border);
  display: flex; justify-content: center;
}
/* Same treatment as the Settings dialog's Close. */
.acc-sidebar-close {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-width: 130px; min-height: 44px; padding: 12px 32px;
  background: var(--gradient-accent, var(--color-accent));
  border: none; border-radius: 8px; color: #fff; cursor: pointer;
  font-size: 0.95rem; font-weight: 600; letter-spacing: 0.01em;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--color-accent) 25%, transparent);
  transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
}
.acc-sidebar-close:hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-accent) 35%, transparent);
}
.acc-sidebar-close:active { transform: translateY(1px); }

.acc-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.acc-panel-header {
  flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px;
  padding: 16px 20px; border-bottom: 1px solid var(--color-border);
}
.acc-panel-title { font-size: 1.05rem; font-weight: 700; color: var(--color-text-primary); margin: 0; }
.acc-panel-sub { font-size: 0.85rem; color: var(--color-text-secondary); margin: 0; }

.acc-panel {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px; padding: 16px 20px 20px;
}

.acc-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-medium, 8px); padding: 14px;
}
.acc-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.acc-card-title { font-size: 0.95rem; font-weight: 600; color: var(--color-text-primary); margin: 0; }

.acc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px 20px; }
.acc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.acc-field label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; color: var(--color-text-secondary); text-transform: uppercase; }
.acc-value { font-size: 0.95rem; color: var(--color-text-primary); line-height: 1.3; }
.acc-value--mono { font-family: var(--font-mono, monospace); font-size: 0.8rem; }
.acc-field--wide { grid-column: 1 / -1; }

/* The id is long, opaque and the one thing here anyone needs to paste
   elsewhere — into an activation form or a support message — so the whole
   value is the target rather than a small icon beside it. */
.acc-copy {
  appearance: none; display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 8px; margin: -2px -8px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--color-text-primary); cursor: pointer; text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.acc-copy:hover { background: var(--color-surface-raised); border-color: var(--color-border); }
.acc-copy-icon { display: inline-flex; color: var(--color-text-secondary); }
.acc-copy-label { font-size: 0.72rem; font-weight: 600; color: var(--color-text-secondary); letter-spacing: 0.02em; }
.acc-copy:hover .acc-copy-icon, .acc-copy:hover .acc-copy-label { color: var(--color-accent); }

.acc-status { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.acc-status--ok   { background: #2ecc7122; color: #2ecc71; }
.acc-status--warn { background: #e0a03022; color: #e0a030; }
.acc-status--off  { background: var(--color-surface-raised); color: var(--color-text-secondary); }

.acc-note { margin: 10px 0 0; font-size: 0.82rem; color: var(--color-text-secondary); }
.acc-note--warn { color: #e0a030; }

.acc-flash { margin-top: 12px; }
.acc-flash-msg { font-size: 0.82rem; color: var(--color-text-primary); margin-bottom: 6px; }
.acc-progress { height: 5px; border-radius: 3px; background: var(--color-surface-raised); overflow: hidden; }
.acc-progress__bar { height: 100%; background: var(--color-accent); transition: width 0.25s ease; }

.acc-activate-row { display: flex; gap: 8px; margin-top: 10px; }
.acc-activate-row .text-input { flex: 1; }


.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-secondary); opacity: 0.35; flex-shrink: 0; }
.dot--on { background: #2ecc71; opacity: 1; }
.dot--warn { background: #e0a030; opacity: 1; }
.dot--idle { background: #e0a030; opacity: 0.55; }

/* Buttons, inputs and messages are styled per component in this codebase
   rather than globally, so replacing this dialog's stylesheet left its
   controls unstyled. Carried over from the dialog this one replaces. */
.btn {
  padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
  border: 1px solid transparent; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
}
.btn:disabled { opacity: 0.55; cursor: default; }
.btn--primary { background: var(--md-primary-fg-color, #1abc9c); color: #fff; }
.btn--ghost { background: transparent; border-color: rgba(128,128,128,0.35); color: inherit; }
.btn--danger-ghost { background: transparent; border-color: rgba(220,53,69,0.5); color: #dc3545; }
.text-input {
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  font-size: 0.9rem; letter-spacing: 0.02em;
  background: rgba(128,128,128,0.1); border: 1px solid rgba(128,128,128,0.25);
  color: inherit;
}
.text-input:focus { outline: none; border-color: var(--md-primary-fg-color, #1abc9c); }
.msg { font-size: 0.82rem; padding: 8px 10px; border-radius: 6px; }
.msg--error { color: #dc3545; background: rgba(220,53,69,0.1); }
</style>
