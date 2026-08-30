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
        <nav class="acc-nav" v-if="loading">
          <div v-for="n in 5" :key="n" class="acc-skel-row"><span class="acc-skel-bar"></span></div>
        </nav>
        <nav class="acc-nav" v-else>
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
          <button class="acc-pair-btn" v-if="!pairing" :disabled="!dongleReady || busy"
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
        <div class="acc-panel-header" v-if="loading">
          <h2 class="acc-panel-title">Accessories</h2>
          <p class="acc-panel-sub">Checking what is connected…</p>
        </div>
        <div class="acc-panel-header" v-else>
          <h2 class="acc-panel-title">
            {{ selected?.name || 'Accessories' }}
            <sup v-if="selected?.availability" class="acc-avail-inline">{{ selected.availability }}</sup>
          </h2>
          <p class="acc-panel-sub">{{ subtitle }}</p>
        </div>

        <div class="acc-panel" v-if="loading">
          <section class="acc-card"><div class="acc-skel-bar acc-skel-bar--wide"></div></section>
          <section class="acc-card"><div class="acc-skel-bar acc-skel-bar--wide"></div></section>
        </div>

        <div class="acc-panel" v-else-if="selected">
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
              <button v-if="selected.connected && !flashing[selected.id]"
                      class="btn btn--primary"
                      :class="{ 'btn--idle': !selected.updateAvailable, 'btn--blocked': busy }"
                      :aria-disabled="!selected.updateAvailable"
                      :title="selected.updateAvailable
                                ? `Install v${selected.latestVersion}`
                                : 'Up to date — press and hold to flash a local .bin'"
                      @click="update(selected)"
                      @pointerdown="holdStart(selected)"
                      @pointerup="holdCancel" @pointerleave="holdCancel"
                      @contextmenu.prevent>
                <div class="long-press-indicator long-press-horizontal"
                     :style="{ width: `${holdProgress}%` }"></div>
                <span class="acc-btn-label">
                  {{ selected.updateAvailable ? `Update to v${selected.latestVersion}` : 'Update' }}
                </span>
              </button>
              <input ref="fileInput" type="file" accept=".bin" class="acc-file" @change="onFilePicked" />
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
              <p class="acc-flash-warn">
                Keep {{ selected.name }} powered and connected until this finishes.
                <span class="acc-note-dim">
                  It writes to a spare slot and only switches over once verified, so an
                  interrupted update leaves the current firmware working — but you will
                  have to start again.
                </span>
              </p>
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
              Up to date. <span class="acc-note-dim">Press and hold Update to flash a local .bin.</span>
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

          <!-- Configuration lives in the device's own plugin. This view owns
               firmware and activation; what the device is set up to DO is the
               plugin's business, and pointing at it is better than leaving the
               reader hunting for settings that were never here. -->
          <section class="acc-card" v-if="selected.pluginName">
            <div class="acc-card-header"><h3 class="acc-card-title">Configuration</h3></div>
            <p class="acc-note">
              Install the <strong>{{ selected.pluginName }}</strong> plugin to configure this
              {{ selected.name }}. Firmware and activation stay here.
            </p>
          </section>

          <!-- Pairing — never offered for the Wireless USB: it is the radio,
               so it cannot be paired to itself. -->
          <section class="acc-card" v-if="selected.id !== 'wireless-usb'">
            <div class="acc-card-header">
              <h3 class="acc-card-title">Pairing</h3>
              <button v-if="selected.paired" class="btn btn--danger-ghost"
                      :disabled="pairing || busy || unpairing === selected.id"
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

    <Dialog v-if="mismatch" @close="mismatch = null" :show-header="false" size="small">
      <ConfirmPanel
        title="This does not look like the right firmware"
        :message="`&quot;${mismatch.file.name}&quot; is not named like ${mismatch.target.name} firmware ` +
                  `(expected ${mismatch.target.assetPrefix}…). These accessories share the same ` +
                  `processor, so the wrong image will install and run — leaving the device working ` +
                  `as something else. Flash it anyway?`"
        confirm-text="Flash anyway" cancel-text="Cancel" variant="danger"
        @confirm="confirmMismatch" @cancel="mismatch = null" />
    </Dialog>

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
  availability?: string | null;
  pluginName?: string | null;
  assetPrefix?: string;
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

// Catalogue order, always: Wireless USB, Pendant, AutoDustBoot, RGB LED,
// xProbe. This used to sort by connection state, which meant rows swapped
// places whenever a device came or went — you would reach for one and press
// another. A device's position is now something you can learn.
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
    }));
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

// True while ANY accessory is being flashed. Actions are withheld across the
// whole dialog, not just the busy row: pairing, unpairing and a second flash
// all contend for the same radio and the same dongle, and starting one mid
// transfer is how a good push turns into a failed one.
const busy = computed(() => Object.keys(flashing).length > 0);

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

// Press-and-hold opens a file picker, so a local .bin can be flashed even when
// the device reports itself up to date. Carried over from the per-device
// plugins this dialog replaces, where it is how a build gets onto hardware
// before it has been released. Held rather than clicked precisely because it
// bypasses the version check.
const fileInput = ref<HTMLInputElement | null>(null);
const holdTarget = ref<Accessory | null>(null);
const holdProgress = ref(0);
const HOLD_MS = 1000;
let holdRaf: number | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdStartAt = 0;
let holdFired = false;

// Fills left-to-right as the press is held, matching the jog panel's Home and
// zero buttons — same indicator element, same accent-at-0.22. A hold that
// gives no feedback is indistinguishable from a button that does not work.
function holdStart(a: Accessory) {
  if (busy.value) return;          // no second flash while one is running
  holdFired = false;
  holdTarget.value = a;
  holdStartAt = performance.now();
  holdProgress.value = 0;

  // The fill is animated with rAF, but completion is driven by a timer.
  // rAF is throttled to nothing when the window is occluded, and a hold that
  // silently fails to fire because the user glanced at another window is a
  // worse bug than a fill that pauses.
  const tick = () => {
    const elapsed = performance.now() - holdStartAt;
    holdProgress.value = Math.min(100, (elapsed / HOLD_MS) * 100);
    if (holdRaf !== null) holdRaf = requestAnimationFrame(tick);
  };
  holdRaf = requestAnimationFrame(tick);

  holdTimer = setTimeout(() => {
    holdFired = true;               // suppress the click that follows the release
    holdCancel();
    fileInput.value?.click();
  }, HOLD_MS);
}

function holdCancel() {
  if (holdRaf !== null) { cancelAnimationFrame(holdRaf); holdRaf = null; }
  if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
  holdProgress.value = 0;
}

async function onFilePicked(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  const target = holdTarget.value;
  input.value = '';                 // so picking the same file twice still fires
  if (!file || !target) return;

  // Check the file looks like this device's firmware before sending it.
  // Most of these accessories are the same ESP32-S3, so a mismatched image
  // passes the header check the device itself makes and boots as the wrong
  // product — an xProbe build on the Wireless USB leaves you with a dongle
  // that no longer relays anything. The device cannot catch this; only the
  // name can.
  const prefix = target.assetPrefix || '';
  if (prefix && !file.name.toLowerCase().startsWith(prefix.toLowerCase())) {
    mismatch.value = { file, target };
    return;
  }
  await sendFirmware(target, file);
}

const mismatch = ref<{ file: File; target: Accessory } | null>(null);

function confirmMismatch() {
  const m = mismatch.value;
  mismatch.value = null;
  if (m) sendFirmware(m.target, m.file);
}

async function sendFirmware(target: Accessory, file: File) {
  flashing[target.id] = { percent: 0, message: `Flashing ${file.name}…` };
  try {
    const form = new FormData();
    form.append('file', file);
    if (target.deviceId) form.append('deviceId', target.deviceId);
    // The dongle addresses itself by product id; peers by their radio name.
    const name = target.id === 'wireless-usb' ? 'wireless-usb' : target.id;
    const res = await fetch(`${baseUrl}/api/dongle/devices/${name}/ota`, {
      method: 'POST', body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      flashing[target.id] = { percent: 0, message: err.error || 'Flash failed' };
      setTimeout(() => delete flashing[target.id], 5000);
    }
  } catch {
    delete flashing[target.id];
  }
}

async function update(a: Accessory) {
  // A click that arrives because a hold just fired is not a click.
  if (holdFired) { holdFired = false; return; }
  if (busy.value || !a.updateAvailable) return;
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

/* A shape to look at while the first query runs. The list is queried live
   from the devices, so the first call is not instant — showing the layout
   immediately reads as loading rather than as a dialog that failed to open. */
.acc-skel-row { padding: 10px 12px; }
.acc-skel-bar {
  display: block; height: 10px; width: 70%; border-radius: 4px;
  background: var(--color-surface-raised);
  animation: acc-pulse 1.2s ease-in-out infinite;
}
.acc-skel-bar--wide { width: 100%; height: 14px; }
@keyframes acc-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.8; } }
.acc-nav-btn {
  position: relative;
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

/* Lifted out of the flow and floated over the row's top-right corner.
   In-flow it competed with the name for width and truncated it —
   "AutoDustBoot" became "AutoDust…", which is worse than the badge is
   valuable. Overlapping costs nothing here because the names are short and
   the badge sits above their x-height. */

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
/* The heading has room to spare, so here it can stay in the flow. */
.acc-avail-inline {
  display: inline-flex; align-items: center; justify-content: center;
  height: 14px; padding: 0 7px; border-radius: 7px;
  margin-left: 6px; transform: translateY(-4px);
  background: #e67e22; color: #14141f;
  font-size: 0.5rem; font-weight: 800; letter-spacing: 0.04em;
  text-transform: uppercase; line-height: 1; vertical-align: middle;
}
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
.acc-note-dim { opacity: 0.65; }

.acc-flash-warn {
  margin: 10px 0 0; font-size: 0.78rem; line-height: 1.45; color: #e0a030;
}
.acc-flash-warn .acc-note-dim { color: var(--color-text-secondary); }

/* Visibly withheld rather than merely inert, so it is clear the dialog is
   busy rather than broken. */
.btn--blocked { opacity: 0.4; pointer-events: none; }

.acc-file { display: none; }

/* Same indicator the jog panel uses for its hold buttons. */
.long-press-indicator {
  position: absolute; background: var(--color-accent);
  opacity: 0.22; pointer-events: none;
}
.long-press-horizontal { left: 0; top: 0; width: 0%; height: 100%; }
/* The button becomes the positioning context, and its label must sit above
   the fill rather than under it. */
.acc-card-header .btn { position: relative; overflow: hidden; }
.acc-btn-label { position: relative; z-index: 1; }
/* Looks disabled but is NOT the disabled attribute: a disabled button fires
   no pointer events, so the press-and-hold — the one gesture that matters
   when there is no update to offer — would never reach it. The click is
   refused in script instead. */
.btn--idle {
  opacity: 0.5;
  background: var(--color-surface-raised);
  box-shadow: none;
}
.btn--idle:hover { opacity: 0.65; }

.acc-flash { margin-top: 12px; }
.acc-flash-msg {
  font-size: 0.82rem; color: var(--color-text-primary); margin-bottom: 8px;
  font-variant-numeric: tabular-nums;   /* the percentage must not jitter */
}

.acc-progress {
  position: relative; height: 10px; border-radius: 5px; overflow: hidden;
  background: var(--color-surface-raised);
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.25);
}
.acc-progress__bar {
  position: relative; height: 100%; border-radius: 5px;
  background: var(--color-accent);
  /* Eased rather than linear: chunk acks arrive in bursts, and a linear
     transition makes that look like stuttering rather than progress. */
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
/* A sheen travelling along the filled portion. The percentage already says how
   far along it is; this says the transfer is still alive — which matters most
   during the long quiet stretch in the middle of a 900 KB push. */
.acc-progress__bar::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgb(255 255 255 / 0.28) 50%,
    transparent 80%);
  background-size: 220% 100%;
  animation: acc-sheen 1.4s ease-in-out infinite;
}
@keyframes acc-sheen {
  from { background-position: 160% 0; }
  to   { background-position: -60% 0; }
}
/* Respect a reduced-motion preference: the bar still fills, it just stops
   shimmering. */
@media (prefers-reduced-motion: reduce) {
  .acc-progress__bar::after { animation: none; }
}

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
