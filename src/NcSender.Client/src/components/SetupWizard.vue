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
  <Dialog :show-header="false" size="small-plus" max-width="980px" :z-index="10045" @close="requestClose">
    <div class="wiz">
      <!-- Step rail -->
      <aside class="wiz__rail">
        <div class="wiz__brand">
          <span class="wiz__brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
          </span>
          <div>
            <div class="wiz__brand-title">Machine Setup</div>
            <div class="wiz__brand-sub">grblHAL settings</div>
          </div>
        </div>
        <ol class="wiz__steps">
          <li
            v-for="(s, i) in steps"
            :key="s.id"
            class="wiz__step"
            :class="{ 'is-active': i === stepIndex, 'is-done': i < stepIndex }"
            @click="i < stepIndex && !applying && (stepIndex = i)"
          >
            <span class="wiz__step-num">
              <svg v-if="i < stepIndex" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="wiz__step-label">{{ s.label }}</span>
          </li>
        </ol>
        <div class="wiz__conn" :class="{ 'is-ok': connected }">
          <span class="wiz__conn-dot"></span>
          <span>{{ connected ? 'Controller connected' : 'Waiting for controller' }}</span>
        </div>
      </aside>

      <!-- Page -->
      <section class="wiz__page">
        <header class="wiz__head">
          <h2 class="wiz__title">{{ step.title }}</h2>
          <p class="wiz__sub">{{ step.subtitle }}</p>
        </header>

        <div class="wiz__body">
          <!-- 0 Welcome -->
          <div v-if="step.id === 'welcome'" class="wiz__welcome">
            <p class="wiz__lead">A new or freshly flashed controller needs a handful of settings before it can be trusted to move. This guide checks each one live on your machine.</p>
            <div class="wiz__cards">
              <div v-for="c in welcomeCards" :key="c.title" class="wiz__card">
                <span class="wiz__card-icon" v-html="c.icon"></span>
                <span class="wiz__card-text">
                  <span class="wiz__card-title">{{ c.title }}</span>
                  <span class="wiz__card-note">{{ c.note }}</span>
                </span>
              </div>
            </div>
            <div class="wiz__facts">
              <span class="wiz__fact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>About five minutes</span>
              <span class="wiz__fact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>Nothing is written until you review it</span>
              <span class="wiz__fact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>Run again any time from <strong class="wiz__path">Settings &gt; General</strong></span>
            </div>
            <div class="wiz__notice"><svg class="wiz__notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01" /><path d="M11 12h1v4h1" /></svg><span><strong>Machine already set up and working?</strong> Skip this wizard. It is meant for a new controller, and re-applying settings to a working machine is not needed.</span></div>
          </div>

          <!-- 1 Connection -->
          <div v-else-if="step.id === 'connection'" class="wiz__form wiz__form--roomy">
            <ConnectionSetup idle-hint="Save the connection and ncSender will connect on its own. Next unlocks once the controller answers." />
          </div>


          <div v-else-if="step.id === 'travel'" class="wiz__form wiz__form--roomy">
            <p class="wiz__muted">Enter how far each axis can move from one end to the other. These become $130, $131 and $132 (max travel), which the soft limits and the work area in the visualizer are built on.</p>
            <div class="wiz__axes">
              <label v-for="ax in axes" :key="ax" class="wiz__axis" :class="'wiz__axis--' + ax.toLowerCase()">
                <span class="wiz__axis-badge">{{ ax }}</span>
                <span class="wiz__axis-text">
                  <span class="wiz__axis-title">{{ ax }} travel</span>
                  <span class="wiz__field-hint">Controller has ${{ travelIds[ax] }} = {{ fwText(travelIds[ax]) }} mm</span>
                </span>
                <span class="wiz__axis-input">
                  <input type="number" step="any" min="0" class="wiz__input" :value="displayLen(travel[ax])" @change="travel[ax] = parseLen(($event.target as HTMLInputElement).value)" />
                  <span class="wiz__axis-unit">{{ unitLabel }}</span>
                </span>
              </label>
            </div>
          </div>

          <!-- 2 Pins -->
          <div v-else-if="step.id === 'pins'" class="wiz__form">
            <p class="wiz__muted">Press each switch by hand and watch its light, the same colours as the pin states in the toolbar: <span class="wiz__led-key wiz__led-key--green"></span> green while released, <span class="wiz__led-key wiz__led-key--red"></span> red while pressed. If it shows the other way round, turn on Invert for that row: the change is sent to the controller right away, so the light shows the result.</p>
            <div v-if="!connected" class="wiz__notice">Connect the controller to see live pin states.</div>
            <div class="wiz__pins">
              <div v-for="row in pinRows" :key="row.key" class="wiz__pin">
                <div class="wiz__pin-name">{{ row.label }}<span class="wiz__pin-setting">{{ row.settingLabel }}</span></div>
                <div class="wiz__pin-state">
                  <span class="wiz__led" :class="{ 'wiz__led--active': row.triggered }" :title="row.triggered ? 'Triggered' : 'Not triggered'"></span>
                </div>
                <label class="wiz__toggle-row">
                  <span>Invert</span>
                  <ToggleSwitch :model-value="row.inverted" :disabled="!connected || writing" @update:model-value="(v: boolean) => row.setInverted(v)" />
                </label>
              </div>
            </div>
            <template v-if="hasMotorFault">
              <div class="wiz__section">
                <div class="wiz__row-title">Motor fault inputs ($744 enable, $745 invert)</div>
                <div class="wiz__row-note">Closed-loop steppers and servo drives report a fault on a dedicated input. Enabling it lets the controller stop the moment a drive faults, so it is recommended on. If a healthy motor raises a motor fault alarm as soon as you enable it, the input reads backwards: turn on Invert for that axis. Both are sent to the controller right away.</div>
              </div>
              <div class="wiz__pins">
                <div v-for="ax in faultAxes" :key="'mf' + ax" class="wiz__pin wiz__pin--fault">
                  <div class="wiz__pin-name">{{ ax }} motor fault</div>
                  <label class="wiz__toggle-row">
                    <span>Enable</span>
                    <ToggleSwitch :model-value="(motorFaultEnable & faultBit(ax)) !== 0" :disabled="!connected || writing" @update:model-value="(v: boolean) => setMotorFault('744', faultBit(ax), v)" />
                  </label>
                  <label class="wiz__toggle-row">
                    <span>Invert</span>
                    <ToggleSwitch :model-value="(motorFaultInvert & faultBit(ax)) !== 0" :disabled="!connected || writing || (motorFaultEnable & faultBit(ax)) === 0" @update:model-value="(v: boolean) => setMotorFault('745', faultBit(ax), v)" />
                  </label>
                </div>
              </div>
            </template>
            <div v-if="writeError" class="wiz__error">{{ writeError }}</div>
          </div>

          <!-- 3 Homing -->
          <div v-else-if="step.id === 'homing'" class="wiz__form">
            <div class="wiz__row">
              <div class="wiz__row-text">
                <div class="wiz__row-title">Enable homing ($22) <span class="wiz__reco">Recommended: On, 75</span></div>
                <div class="wiz__row-note">Recommended value 75: homing on, single-axis commands, machine origin set to 0 after homing, and locks that can be overridden. Homing is what makes soft limits and parking possible.</div>
              </div>
              <ToggleSwitch v-model="homingEnabled" />
            </div>
            <div v-if="homingEnabled" class="wiz__advanced">
              <div class="wiz__bits-head">
                <span class="wiz__field-label">Homing options <span class="wiz__unit">$22 = {{ homingMask }}</span></span>
                <button type="button" class="wiz__link" :disabled="homingMask === RECOMMENDED_HOMING_MASK" @click="homingMask = RECOMMENDED_HOMING_MASK">Use recommended (75)</button>
              </div>
              <div class="wiz__bits">
                <label v-for="opt in homingOptions" :key="opt.bit" class="wiz__bit">
                  <span>{{ opt.name }}</span>
                  <span class="wiz__toggle-sm"><ToggleSwitch :model-value="(homingMask & (1 << opt.bit)) !== 0" @update:model-value="() => toggleHomingBit(opt.bit)" /></span>
                </label>
              </div>
            </div>

            <div class="wiz__field">
              <span class="wiz__field-label">Machine home location</span>
              <span class="wiz__field-hint">Where the machine ends up after homing, seen from the front. This sets how ncSender draws the work area (same as <strong class="wiz__path">Settings &gt; General &gt; Machine Home Location</strong>); it does not change the controller's homing direction.</span>
              <div class="wiz__bed-wrap">
                <div class="wiz__bed" role="radiogroup" aria-label="Home corner">
                  <span class="wiz__bed-edge wiz__bed-edge--back">Back</span>
                  <span class="wiz__bed-edge wiz__bed-edge--front">Front</span>
                  <button
                    v-for="c in corners"
                    :key="c.id"
                    type="button"
                    class="wiz__bed-corner"
                    :class="['pos-' + c.id, { 'is-active': homeCorner === c.id }]"
                    role="radio"
                    :aria-checked="homeCorner === c.id"
                    :title="c.label"
                    @click="homeCorner = c.id"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
                  </button>
                </div>
                <div class="wiz__bed-caption"><strong>{{ cornerLabel }}</strong><span>Seen from the front of the machine, where you stand.</span></div>
              </div>
            </div>

            <label class="wiz__row">
              <span class="wiz__row-text">
                <span class="wiz__row-title">Pull-off after homing ($27)</span>
                <span class="wiz__row-note">How far each axis backs off its switch after homing. 2 to 5 mm is typical.</span>
              </span>
              <span class="wiz__axis-input wiz__axis-input--sm">
                <input type="number" step="any" min="0" class="wiz__input" :value="displayLen(pullOff)" @change="pullOff = parseLen(($event.target as HTMLInputElement).value)" />
                <span class="wiz__axis-unit">{{ unitLabel }}</span>
              </span>
            </label>
          </div>

          <!-- 4 Safety -->
          <div v-else-if="step.id === 'safety'" class="wiz__form">
            <div class="wiz__row">
              <div class="wiz__row-text">
                <div class="wiz__row-title">Soft limits ($20) <span class="wiz__reco">Recommended: On</span></div>
                <div class="wiz__row-note">Reject any move that would leave the travel you entered. Needs homing, so the controller knows where it is.</div>
              </div>
              <ToggleSwitch v-model="softLimits" :disabled="!homingEnabled" />
            </div>
            <div v-if="!homingEnabled" class="wiz__notice">Soft limits stay off while homing is disabled.</div>
            <div class="wiz__row">
              <div class="wiz__row-text">
                <div class="wiz__row-title">Hard limits ($21) <span class="wiz__reco">Recommended: Off</span></div>
                <div class="wiz__row-note">Stop the machine immediately if a limit switch triggers during a job. Electrical noise can trip it mid-cut, so leave it off unless your switches are well shielded and every one reads correctly.</div>
              </div>
              <ToggleSwitch v-model="hardLimits" />
            </div>
            <div class="wiz__row">
              <div class="wiz__row-text">
                <div class="wiz__row-title">Limit jog commands to travel ($40) <span class="wiz__reco">Recommended: On</span></div>
                <div class="wiz__row-note">Clamp jog moves to the machine travel instead of raising an alarm when a jog would overshoot.</div>
              </div>
              <ToggleSwitch v-model="limitJog" />
            </div>
          </div>

          <!-- 5 Review -->
          <div v-else-if="step.id === 'review'" class="wiz__form">
            <template v-if="!applied">
              <p class="wiz__muted">These settings will be sent to the controller in order. Values already applied live on the switches page are not repeated. Every one of them can still be changed later, one by one, under <strong class="wiz__path">Settings &gt; Firmware</strong>.</p>
              <div v-if="pendingChanges.length === 0" class="wiz__notice wiz__notice--ok"><svg class="wiz__notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg><span>Everything already matches. Nothing to send.</span></div>
              <table v-else class="wiz__table">
                <thead><tr><th>Setting</th><th>Now</th><th>New</th></tr></thead>
                <tbody>
                  <tr v-for="c in pendingChanges" :key="c.id">
                    <td><code>${{ c.id }}</code> {{ c.name }}</td>
                    <td class="wiz__old">{{ c.from }}</td>
                    <td class="wiz__new">{{ c.to }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!connected" class="wiz__notice">Connect the controller to apply.</div>
              <div v-if="applyError" class="wiz__error">{{ applyError }}</div>
            </template>
            <template v-else>
              <div class="wiz__done">
                <span class="wiz__done-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                <h3>Setup applied</h3>
                <p class="wiz__muted">{{ appliedCount }} setting{{ appliedCount === 1 ? '' : 's' }} written. Home the machine before the first move so the new travel and limits start from a known position.</p>
                <p class="wiz__muted">Need to fine-tune any of these later? Each value is editable on its own under <strong class="wiz__path">Settings &gt; Firmware</strong>.</p>
              </div>
            </template>
          </div>
        </div>

        <footer class="wiz__foot">
          <div class="wiz__foot-left">
            <button v-if="stepIndex === 0" type="button" class="wiz__btn wiz__btn--ghost" @click="skip">Skip for now</button>
            <button v-else-if="!applied" type="button" class="wiz__btn wiz__btn--ghost" :disabled="applying" @click="stepIndex--">Back</button>
          </div>
          <div class="wiz__foot-right">
            <button v-if="step.id !== 'review'" type="button" class="wiz__btn wiz__btn--primary" :disabled="step.id === 'connection' && !connected" @click="stepIndex++">Next</button>
            <button v-else-if="!applied && pendingChanges.length" type="button" class="wiz__btn wiz__btn--primary" :disabled="!connected || applying" @click="apply">
              <span v-if="applying" class="wiz__spinner"></span>{{ applying ? 'Applying…' : 'Apply' }}
            </button>
            <button v-else-if="!applied" type="button" class="wiz__btn wiz__btn--primary" @click="finishNoChanges">Finish</button>
            <button v-else type="button" class="wiz__btn wiz__btn--primary" @click="finish">Finish</button>
          </div>
        </footer>
      </section>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Dialog from './Dialog.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import ConnectionSetup from './ConnectionSetup.vue';
import { api } from '@/lib/api.js';
import { settingsStore } from '@/lib/settings-store.js';
import { useAppStore } from '@/composables/use-app-store';
import { mmToInches, inchesToMm } from '@/lib/units';

const emit = defineEmits<{ (e: 'close', completed: boolean): void }>();
const store = useAppStore();

// ---- Steps ----
const steps = [
  { id: 'welcome', label: 'Welcome', title: 'Set up your machine', subtitle: 'A few controller settings, checked live, in about five minutes.' },
  { id: 'connection', label: 'Connection', title: 'Connect to the controller', subtitle: 'How ncSender reaches the board.' },
  { id: 'travel', label: 'Travel', title: 'Machine travel', subtitle: 'How far each axis can move.' },
  { id: 'pins', label: 'Switches & probe', title: 'Limit switches and probe', subtitle: 'Confirm each input reads the right way round.' },
  { id: 'homing', label: 'Homing', title: 'Homing', subtitle: 'Enable homing and pick the home corner.' },
  { id: 'safety', label: 'Safety', title: 'Safety limits', subtitle: 'Keep jogs and jobs inside the machine.' },
  { id: 'review', label: 'Review', title: 'Review and apply', subtitle: 'Everything that will be written to the controller.' },
];
const stepIndex = ref(0);
const step = computed(() => steps[stepIndex.value]);

const ICON = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const welcomeCards = [
  { title: 'Connection', note: 'USB or Ethernet to the controller.', icon: ICON('<circle cx="10" cy="7" r="1"/><circle cx="4" cy="20" r="1"/><path d="M4.7 19.3 19 5"/><path d="m21 3-3 1 2 2Z"/><path d="M9.26 7.68 5 12l2 5"/><path d="m10 14 5 2 3.5-3.5"/><path d="m18 12 1-1 1 1-1 1Z"/>') },
  { title: 'Travel', note: 'How far X, Y and Z can move.', icon: ICON('<path d="M3 12h18"/><path d="M6 9l-3 3 3 3"/><path d="M18 9l3 3-3 3"/><path d="M12 3v18"/>') },
  { title: 'Switches & probe', note: 'Checked live, inverted if they read backwards.', icon: ICON('<path d="M4 14h4l2-6 4 12 2-6h4"/>') },
  { title: 'Homing', note: 'Recommended options and the home corner.', icon: ICON('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>') },
  { title: 'Safety', note: 'Soft limits and limit-aware jogging.', icon: ICON('<path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z"/>') },
];

// ---- Home corner seed from the app's homeLocation setting ----
const seedHomeCorner = () => {
  const loc = (settingsStore.data as any)?.homeLocation;
  if (CORNER_IDS.includes(loc)) homeCorner.value = loc;
};

// ---- Firmware settings (current values from the controller cache) ----
type FwSetting = { id: number; value: string; format?: string | null; name?: string; halDetails?: string[] };
const fw = ref<Record<string, FwSetting>>({});
const fwLoaded = ref(false);
const connected = computed(() => !!store.isConnected.value);
const fwText = (id: string) => fw.value[id]?.value ?? '?';
const fwNum = (id: string, fallback = 0) => {
  const n = parseFloat(fw.value[id]?.value ?? '');
  return Number.isFinite(n) ? n : fallback;
};

const loadFirmware = async (refresh: boolean) => {
  try {
    const data = await api.getFirmwareSettings({ refresh });
    fw.value = (data?.settings ?? {}) as Record<string, FwSetting>;
    fwLoaded.value = true;
    seedFromFirmware();
  } catch (err) {
    console.error('Setup wizard: failed to load firmware settings', err);
  }
};

// ---- Units ----
const isImperial = computed(() => store.unitsPreference.value === 'imperial');
const unitLabel = computed(() => (isImperial.value ? 'in' : 'mm'));
const displayLen = (mm: number) => (isImperial.value ? Number(mmToInches(mm).toFixed(4)) : Number(mm.toFixed(3)));
const parseLen = (raw: string) => {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return isImperial.value ? inchesToMm(n) : n;
};

// ---- Travel ----
const axes = ['X', 'Y', 'Z'] as const;
type Axis = typeof axes[number];
const travelIds: Record<Axis, string> = { X: '130', Y: '131', Z: '132' };
const travel = reactive<Record<Axis, number>>({ X: 0, Y: 0, Z: 0 });

// ---- Pins ($5 limit invert, $6 probe invert, $21 hard limits) ----
const limitInvert = ref(0);
const probeInvert = ref(0);
const hardLimits = ref(false);
const writing = ref(false);
const writeError = ref('');
const pinChar = (ch: string) => (store.status.Pn || '').includes(ch);
const axisBit: Record<Axis, number> = { X: 1, Y: 2, Z: 4 };
const probeIsBitfield = computed(() => (fw.value['6']?.format ?? '').includes(','));
const hasToolsetter = computed(() => (store.status.probeCount ?? 0) > 1);

const writeSetting = async (id: string, value: number | string) => {
  writing.value = true;
  writeError.value = '';
  try {
    const result: any = await api.sendCommand(`$${id}=${value}`, { meta: { sourceId: 'client' } });
    if (result?.status === 'error') throw new Error(result?.errorMessage || `error writing $${id}`);
    if (fw.value[id]) fw.value[id].value = String(value);
  } catch (err: any) {
    writeError.value = `Could not write $${id}: ${err?.message ?? err}`;
    throw err;
  } finally {
    writing.value = false;
  }
};

const setLimitInvert = async (bit: number, on: boolean) => {
  const next = on ? (limitInvert.value | bit) : (limitInvert.value & ~bit);
  try { await writeSetting('5', next); limitInvert.value = next; } catch { /* surfaced via writeError */ }
};
const setProbeInvert = async (bit: number, on: boolean) => {
  const next = probeIsBitfield.value
    ? (on ? (probeInvert.value | bit) : (probeInvert.value & ~bit))
    : (on ? 1 : 0);
  try { await writeSetting('6', next); probeInvert.value = next; } catch { /* surfaced via writeError */ }
};

const pinRows = computed(() => {
  const rows = axes.map((ax) => ({
    key: ax,
    label: `${ax} limit switch`,
    settingLabel: '$5',
    triggered: pinChar(ax),
    inverted: (limitInvert.value & axisBit[ax]) !== 0,
    setInverted: (v: boolean) => setLimitInvert(axisBit[ax], v),
  }));
  rows.push({
    key: 'P',
    label: 'Probe',
    settingLabel: '$6',
    triggered: pinChar('P'),
    inverted: (probeInvert.value & 1) !== 0,
    setInverted: (v: boolean) => setProbeInvert(1, v),
  } as any);
  if (hasToolsetter.value) {
    rows.push({
      key: 'T',
      label: 'Toolsetter',
      settingLabel: '$6',
      triggered: pinChar('T'),
      inverted: (probeInvert.value & 2) !== 0,
      setInverted: (v: boolean) => setProbeInvert(2, v),
    } as any);
  }
  return rows;
});

// ---- Motor fault inputs ($744 enable mask, $745 invert mask), when the board has them ----
const motorFaultEnable = ref(0);
const motorFaultInvert = ref(0);
const hasMotorFault = computed(() => !!fw.value['744']);
// Axis letters in bit order; A only when the board reports a 4th axis travel.
const faultAxes = computed(() => (fw.value['133'] ? ['X', 'Y', 'Z', 'A'] : ['X', 'Y', 'Z']));
const faultBit = (ax: string) => 1 << faultAxes.value.indexOf(ax);
const setMotorFault = async (id: '744' | '745', bit: number, on: boolean) => {
  const target = id === '744' ? motorFaultEnable : motorFaultInvert;
  const next = on ? (target.value | bit) : (target.value & ~bit);
  try { await writeSetting(id, next); target.value = next; } catch { /* surfaced via writeError */ }
};

// ---- Homing ($22 mask, $23 direction, $27 pull-off) ----
const RECOMMENDED_HOMING_MASK = 75;
const homingEnabled = ref(false);
const homingMask = ref(0);
const DEFAULT_HOMING_BITS = [
  'Enable', 'Enable single axis commands', 'Homing on startup required', 'Set machine origin to 0',
  'Two switches share one input', 'Allow manual', 'Override locks', 'Keep homed status on reset',
];
const homingBitLabels = computed(() => {
  const fmt = (fw.value['22']?.format ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return fmt.length >= 2 ? fmt : DEFAULT_HOMING_BITS;
});
// Bit 0 (Enable) is the main switch above; N/A slots are unused bits.
const homingOptions = computed(() => homingBitLabels.value
  .map((name, bit) => ({ name, bit }))
  .filter(o => o.bit !== 0 && o.name.toUpperCase() !== 'N/A'));
const toggleHomingBit = (bit: number) => { homingMask.value ^= (1 << bit); };
watch(homingEnabled, (on) => {
  if (on && (homingMask.value & 1) === 0) homingMask.value = homingMask.value === 0 ? RECOMMENDED_HOMING_MASK : (homingMask.value | 1);
  if (!on) softLimits.value = false;
});
watch(homingMask, (m) => { homingEnabled.value = (m & 1) !== 0; });

type Corner = 'back-left' | 'back-right' | 'front-left' | 'front-right';
const corners: { id: Corner; label: string }[] = [
  { id: 'back-left', label: 'Back left' }, { id: 'back-right', label: 'Back right' },
  { id: 'front-left', label: 'Front left' }, { id: 'front-right', label: 'Front right' },
];
const homeCorner = ref<Corner>('back-left');
const cornerLabel = computed(() => corners.find(c => c.id === homeCorner.value)?.label ?? '');
const CORNER_IDS: Corner[] = ['back-left', 'back-right', 'front-left', 'front-right'];
const pullOff = ref(3);

// ---- Safety ----
const softLimits = ref(false);
const limitJog = ref(false);

// ---- Seed from firmware ----
const seedFromFirmware = () => {
  for (const ax of axes) travel[ax] = fwNum(travelIds[ax], travel[ax]);
  limitInvert.value = fwNum('5', 0);
  probeInvert.value = fwNum('6', 0);
  hardLimits.value = fwNum('21', 0) !== 0;
  motorFaultEnable.value = fwNum('744', 0);
  motorFaultInvert.value = fwNum('745', 0);
  homingMask.value = fwNum('22', 0);
  homingEnabled.value = (homingMask.value & 1) !== 0;
  pullOff.value = fwNum('27', 3);
  softLimits.value = fwNum('20', 0) !== 0;
  limitJog.value = fwNum('40', 0) !== 0;
};

// ---- Review / apply ----
const fmtNum = (n: number) => Number(n.toFixed(3)).toString();
const desired = computed(() => ([
  { id: '130', name: 'X max travel (mm)', to: fmtNum(travel.X) },
  { id: '131', name: 'Y max travel (mm)', to: fmtNum(travel.Y) },
  { id: '132', name: 'Z max travel (mm)', to: fmtNum(travel.Z) },
  { id: '21', name: 'Hard limits', to: hardLimits.value ? '1' : '0' },
  { id: '22', name: 'Homing cycle', to: String(homingEnabled.value ? homingMask.value : (homingMask.value & ~1)) },
  { id: '27', name: 'Homing pull-off (mm)', to: fmtNum(pullOff.value) },
  { id: '20', name: 'Soft limits', to: softLimits.value ? '1' : '0' },
  { id: '40', name: 'Limit jog commands', to: limitJog.value ? '1' : '0' },
]));
const pendingChanges = computed(() => desired.value
  .map(d => ({ ...d, from: fw.value[d.id]?.value ?? '?' }))
  .filter(d => {
    const a = parseFloat(d.from); const b = parseFloat(d.to);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) > 1e-6 : d.from !== d.to;
  }));

const applying = ref(false);
const applied = ref(false);
const appliedCount = ref(0);
const applyError = ref('');

const persistCompletion = async () => {
  try {
    const { updateSettings } = await import('@/lib/settings-store.js');
    await updateSettings({ setupWizardCompleted: true, homeLocation: homeCorner.value });
  } catch (err) { console.error('Setup wizard: failed to save completion', err); }
};

const apply = async () => {
  applying.value = true;
  applyError.value = '';
  let count = 0;
  try {
    // Soft limits refuse to switch on before homing is enabled, so write $22
    // (and the rest) before $20; the order of `desired` already does that.
    for (const c of pendingChanges.value) {
      await writeSetting(c.id, c.to);
      count += 1;
    }
    appliedCount.value = count;
    applied.value = true;
    await persistCompletion();
    api.getFirmwareSettings({ refresh: true }).catch(() => { /* cache catch-up only */ });
  } catch (err: any) {
    applyError.value = `Stopped after ${count} setting${count === 1 ? '' : 's'}: ${err?.message ?? err}`;
  } finally {
    applying.value = false;
  }
};

const finish = () => emit('close', true);
// Nothing to send: record completion (and the home corner) and just close.
const finishNoChanges = async () => {
  await persistCompletion();
  emit('close', true);
};
const skip = async () => {
  try {
    const { updateSettings } = await import('@/lib/settings-store.js');
    await updateSettings({ setupWizardCompleted: true });
  } catch (err) { console.error(err); }
  emit('close', true);
};
const requestClose = () => emit('close', applied.value);

onMounted(() => { loadFirmware(connected.value); seedHomeCorner(); });
watch(connected, (on) => { if (on && !fwLoaded.value) loadFirmware(true); });
</script>

<style scoped>
.wiz {
  display: flex;
  width: min(980px, 94vw);
  height: min(820px, 92vh);
  border-radius: 16px;
  overflow: hidden;
}

/* ---- Rail ---- */
.wiz__rail {
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 18px;
  background: color-mix(in srgb, var(--color-surface-muted) 55%, var(--color-surface));
  border-right: 1px solid var(--color-border);
}
.wiz__brand { display: flex; align-items: center; gap: 10px; }
.wiz__brand-icon {
  width: 38px; height: 38px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  color: var(--color-accent);
}
.wiz__brand-icon svg { width: 20px; height: 20px; }
.wiz__brand-title { font-weight: 700; color: var(--color-text-primary); }
.wiz__brand-sub { font-size: 0.78rem; color: var(--color-text-secondary); }

.wiz__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wiz__step {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 10px;
  color: var(--color-text-secondary); font-size: 0.92rem;
}
.wiz__step.is-done { cursor: pointer; }
.wiz__step.is-active { background: var(--color-surface); color: var(--color-text-primary); font-weight: 600; box-shadow: inset 0 0 0 1px var(--color-border); }
.wiz__step-num {
  width: 24px; height: 24px; border-radius: 50%; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.75rem; font-weight: 700;
  background: color-mix(in srgb, var(--color-border) 70%, transparent);
  color: var(--color-text-secondary);
}
.wiz__step.is-active .wiz__step-num { background: var(--color-accent); color: #fff; }
.wiz__step.is-done .wiz__step-num { background: color-mix(in srgb, var(--color-accent) 22%, transparent); color: var(--color-accent); }
.wiz__step-num svg { width: 13px; height: 13px; }

.wiz__conn { margin-top: auto; display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--color-text-secondary); }
.wiz__conn-dot { width: 8px; height: 8px; border-radius: 50%; background: #d9534f; }
.wiz__conn.is-ok .wiz__conn-dot { background: #3ecf8e; }

/* ---- Page ---- */
.wiz__page { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.wiz__head { padding: 26px 32px 6px; }
.wiz__title { margin: 0; font-size: 1.45rem; font-weight: 700; color: var(--color-text-primary); }
.wiz__sub { margin: 4px 0 0; color: var(--color-text-secondary); }
.wiz__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 32px 12px; }
.wiz__foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 32px 20px; border-top: 1px solid var(--color-border);
}
.wiz__foot-right { display: flex; gap: 10px; }

.wiz__welcome { display: flex; flex-direction: column; gap: 18px; padding-top: 4px; }
.wiz__welcome p, .wiz__muted { color: var(--color-text-secondary); line-height: 1.55; margin: 0 0 12px; }
.wiz__lead { font-size: 1.05rem; margin: 0 !important; }
.wiz__cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.wiz__card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 12px; border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-muted) 40%, var(--color-surface));
}
.wiz__card-icon {
  width: 42px; height: 42px; border-radius: 11px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent);
}
.wiz__card-icon :deep(svg) { width: 22px; height: 22px; }
.wiz__card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wiz__card-title { font-weight: 700; color: var(--color-text-primary); }
.wiz__card-note { font-size: 0.85rem; color: var(--color-text-secondary); line-height: 1.4; }
.wiz__facts { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.wiz__fact { display: inline-flex; align-items: center; gap: 7px; font-size: 0.88rem; color: var(--color-text-secondary); }
.wiz__fact svg { width: 16px; height: 16px; color: var(--color-accent); flex: 0 0 auto; }
.wiz__notice strong { color: var(--color-text-primary); }
.wiz__notice {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px; margin: 8px 0;
  border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
  color: var(--color-text-primary); font-size: 0.9rem; line-height: 1.45;
}
.wiz__notice-icon { width: 18px; height: 18px; flex: 0 0 auto; margin-top: 1px; color: var(--color-accent); }
.wiz__notice--ok { border-color: color-mix(in srgb, #28a745 45%, var(--color-border)); background: color-mix(in srgb, #28a745 10%, var(--color-surface)); }
.wiz__notice--ok .wiz__notice-icon { color: #28a745; }
.wiz__error { padding: 10px 14px; border-radius: 10px; margin: 8px 0; background: rgba(217, 83, 79, 0.15); color: #ff8888; font-size: 0.9rem; }

.wiz__form { display: flex; flex-direction: column; gap: 14px; }
.wiz__form--roomy { gap: 26px; padding-top: 6px; }
.wiz__form--roomy .wiz__grid3 { gap: 22px; }
.wiz__form--roomy .wiz__field { gap: 8px; }
.wiz__form--roomy .wiz__input { padding: 13px 14px; font-size: 1.05rem; }
.wiz__grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.wiz__field { display: flex; flex-direction: column; gap: 6px; }
.wiz__field--narrow { max-width: 320px; }
.wiz__field-label { font-weight: 600; color: var(--color-text-primary); font-size: 0.92rem; }
.wiz__unit { font-weight: 500; color: var(--color-text-secondary); margin-left: 4px; }
.wiz__field-hint { font-size: 0.8rem; color: var(--color-text-secondary); }
.wiz__input {
  padding: 10px 12px; border-radius: 8px; font-size: 1rem;
  border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary);
}
.wiz__input:focus { outline: none; border-color: var(--color-accent); }

.wiz__axes { display: flex; flex-direction: column; gap: 16px; }
.wiz__axis {
  display: grid; grid-template-columns: 56px 1fr 220px; align-items: center; gap: 18px;
  padding: 16px 20px; border-radius: 12px; border: 1px solid var(--color-border);
}
.wiz__axis-badge {
  width: 56px; height: 56px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; font-weight: 800; color: #fff;
}
.wiz__axis--x .wiz__axis-badge { background: #e04343; }
.wiz__axis--y .wiz__axis-badge { background: #2fb36a; }
.wiz__axis--z .wiz__axis-badge { background: #3b82f6; }
.wiz__axis-text { display: flex; flex-direction: column; gap: 4px; }
.wiz__axis-title { font-weight: 700; font-size: 1.05rem; color: var(--color-text-primary); }
.wiz__axis-input { position: relative; display: flex; }
.wiz__axis-input .wiz__input { width: 100%; padding-right: 48px; font-size: 1.15rem; text-align: right; }
.wiz__axis-input--sm { flex: 0 0 150px; }
.wiz__row-title, .wiz__row-note { display: block; }
.wiz__axis-unit { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--color-text-secondary); font-weight: 600; pointer-events: none; }
.wiz__row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 14px; border-radius: 10px; border: 1px solid var(--color-border);
}
.wiz__row-title { font-weight: 600; color: var(--color-text-primary); }
.wiz__path { color: var(--color-accent); font-weight: 700; }
.wiz__reco {
  display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; vertical-align: 1px;
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent);
}
.wiz__row-note { font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px; line-height: 1.45; }

.wiz__pins { display: flex; flex-direction: column; gap: 8px; }
.wiz__pin {
  display: grid; grid-template-columns: 1fr 80px 130px; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 10px; border: 1px solid var(--color-border);
}
.wiz__pin--fault { grid-template-columns: 1fr 130px 130px; }
.wiz__section { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.wiz__pin-name { font-weight: 600; color: var(--color-text-primary); }
.wiz__pin-setting { margin-left: 8px; font-size: 0.75rem; font-weight: 500; color: var(--color-text-secondary); }
.wiz__pin-state { display: flex; align-items: center; justify-content: center; }
/* Same LED language as the toolbar pin states: green idle, red triggered. */
.wiz__led {
  width: 18px; height: 18px; border-radius: 50%;
  background: #28a745;
  box-shadow: 0 0 8px rgba(40, 167, 69, 0.8), 0 0 16px rgba(40, 167, 69, 0.4);
  transition: background 0.1s ease, box-shadow 0.1s ease;
}
.wiz__led--active {
  background: #dc3545;
  box-shadow: 0 0 10px rgba(220, 53, 69, 0.9), 0 0 20px rgba(220, 53, 69, 0.5);
}
.wiz__led-key { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: -1px; margin: 0 2px; }
.wiz__led-key--green { background: #28a745; box-shadow: 0 0 6px rgba(40, 167, 69, 0.8); }
.wiz__led-key--red { background: #dc3545; box-shadow: 0 0 6px rgba(220, 53, 69, 0.9); }
.wiz__toggle-row { display: flex; align-items: center; gap: 10px; justify-self: end; font-size: 0.9rem; color: var(--color-text-secondary); }

.wiz__advanced { margin-top: -6px; }
.wiz__link { background: none; border: none; padding: 0; color: var(--color-accent); cursor: pointer; font: inherit; font-size: 0.88rem; text-decoration: underline; }
.wiz__bits-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.wiz__link:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
.wiz__bits { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; }
.wiz__bit {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 12px; border-radius: 8px; border: 1px solid var(--color-border);
  font-size: 0.86rem; color: var(--color-text-secondary);
}
/* Sub-setting toggles: same component, rendered at 70% */
.wiz__toggle-sm { display: inline-flex; transform: scale(0.7); transform-origin: right center; }

/* Machine bed seen from above; tap a corner to choose where homing ends. */
.wiz__bed-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 6px; }
.wiz__bed {
  position: relative;
  width: 150px; height: 150px; margin: 34px 30px 40px 30px;
  border-radius: 8px;
  border: 2px solid var(--color-text-secondary);
  background:
    linear-gradient(color-mix(in srgb, var(--color-text-secondary) 45%, transparent) 1px, transparent 1px) 0 0 / 100% 20%,
    linear-gradient(90deg, color-mix(in srgb, var(--color-text-secondary) 45%, transparent) 1px, transparent 1px) 0 0 / 20% 100%,
    color-mix(in srgb, var(--color-surface-muted) 60%, var(--color-surface));
}
.wiz__bed-edge {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 1;
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--color-text-secondary); white-space: nowrap;
}
.wiz__bed-edge--back { top: -32px; }
.wiz__bed-edge--front { bottom: -34px; }
.wiz__bed-corner {
  position: absolute; width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--color-text-secondary); background: var(--color-surface); color: var(--color-text-secondary);
  cursor: pointer; padding: 0;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.wiz__bed-corner svg { width: 17px; height: 17px; opacity: 0.35; }
.wiz__bed-corner:hover { transform: scale(1.08); border-color: var(--color-accent); color: var(--color-accent); }
.wiz__bed-corner.is-active { background: var(--color-accent); border-color: var(--color-accent); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 30%, transparent); }
.wiz__bed-corner.is-active svg { opacity: 1; }
.wiz__bed-corner.pos-back-left { top: -18px; left: -18px; }
.wiz__bed-corner.pos-back-right { top: -18px; right: -18px; }
.wiz__bed-corner.pos-front-left { bottom: -18px; left: -18px; }
.wiz__bed-corner.pos-front-right { bottom: -18px; right: -18px; }
.wiz__bed-caption { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; color: var(--color-text-secondary); font-size: 0.85rem; }
.wiz__bed-caption strong { color: var(--color-text-primary); font-size: 1.05rem; }

.wiz__table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.wiz__table th { text-align: left; font-weight: 600; color: var(--color-text-secondary); padding: 6px 10px; border-bottom: 1px solid var(--color-border); }
.wiz__table td { padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent); color: var(--color-text-primary); }
.wiz__table code { color: var(--color-text-secondary); margin-right: 6px; }
.wiz__old { color: var(--color-text-secondary); }
.wiz__new { color: #3ecf8e; font-weight: 600; }

.wiz__done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 24px 0; }
.wiz__done-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(62, 207, 142, 0.18); color: #3ecf8e; }
.wiz__done-icon svg { width: 32px; height: 32px; }
.wiz__done h3 { margin: 6px 0 0; color: var(--color-text-primary); }

.wiz__btn {
  display: inline-flex; align-items: center; gap: 8px; justify-content: center;
  min-width: 120px; padding: 11px 18px; border-radius: 10px;
  font-size: 0.95rem; font-weight: 600; cursor: pointer; border: 1.5px solid transparent;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.wiz__btn:disabled { opacity: 0.5; cursor: default; }
.wiz__btn:not(:disabled):hover { transform: translateY(-1px); }
.wiz__btn--ghost { background: transparent; border-color: var(--color-border); color: var(--color-text-primary); }
.wiz__btn--primary { background: var(--color-accent); color: #fff; }
.wiz__spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; animation: wiz-spin 0.8s linear infinite; }
@keyframes wiz-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .wiz { flex-direction: column; height: 92vh; }
  .wiz__rail { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; border-right: none; border-bottom: 1px solid var(--color-border); overflow-x: auto; }
  .wiz__brand, .wiz__conn { display: none; }
  .wiz__steps { flex-direction: row; }
  .wiz__step-label { display: none; }
  .wiz__step.is-active .wiz__step-label { display: inline; }
  .wiz__grid3, .wiz__cards { grid-template-columns: 1fr; }
  .wiz__axis { grid-template-columns: 44px 1fr; }
  .wiz__axis-input { grid-column: 1 / -1; }
  .wiz__pin { grid-template-columns: 1fr auto; }
  .wiz__toggle-row { grid-column: 1 / -1; justify-self: start; }
  .wiz__head, .wiz__body, .wiz__foot { padding-left: 18px; padding-right: 18px; }
}
</style>
