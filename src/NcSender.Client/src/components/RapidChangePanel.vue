<!--
  RapidChangeATC Air (the wireless board in a RapidChange ATC magazine): its two
  sensors and its dust cover, inside the Accessories dialog. Every setting is
  kept on the device. Nothing moves when this opens: a servo moves only when
  a position is stepped, or Go / Open / Close is pressed.

  The same file serves both editions, so all text comes in through `labels`.
-->
<template>
  <section v-if="!connected" class="rc-card">
    <div class="rc-card-header"><h3 class="rc-card-title">{{ labels.settings }}</h3></div>
    <p class="rc-note rc-note--flush">{{ labels.connectFirst }}</p>
  </section>

  <section v-else-if="!settings" class="rc-card">
    <div class="rc-card-header"><h3 class="rc-card-title">{{ labels.settings }}</h3></div>
    <p v-if="error" class="rc-msg">{{ error }}</p>
    <p v-else class="rc-note rc-note--flush">{{ labels.reading }}</p>
  </section>

  <template v-else>
    <section class="rc-card">
      <div class="rc-card-header"><h3 class="rc-card-title">{{ labels.sensors }}</h3></div>
      <table class="rc-inputs">
        <thead>
          <tr><th>{{ labels.sensor }}</th><th>{{ labels.state }}</th><th>{{ labels.invert }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in sensors" :key="s.key">
            <td><span class="rc-input-name">{{ s.label }}</span></td>
            <td>
              <span class="rc-input-state">
                <span :class="['rc-led', { 'rc-led--active': s.triggered, 'rc-led--unknown': state == null }]"></span>
                {{ state == null ? '—' : s.triggered ? labels.triggered : labels.idle }}
              </span>
            </td>
            <td>
              <ToggleSwitch :model-value="settings[s.key]" :disabled="saving"
                            @update:model-value="(v: boolean) => save({ [s.key]: v })" />
            </td>
          </tr>
        </tbody>
      </table>
      <div class="rc-row">
        <span class="rc-row-label">{{ labels.filter }}<span class="rc-unit">ms</span></span>
        <div class="rc-step">
          <button type="button" class="rc-step__btn" :aria-label="labels.decrease" :disabled="draft.filterMs <= 0"
                  @pointerdown.prevent="hold('filterMs', -1)" @pointerup="release" @pointerleave="release"
                  @pointercancel="release" @contextmenu.prevent>−</button>
          <input class="rc-step__input" type="number" inputmode="numeric" :value="draft.filterMs"
                 @change="typed('filterMs', $event)" />
          <button type="button" class="rc-step__btn" :aria-label="labels.increase" :disabled="draft.filterMs >= 50"
                  @pointerdown.prevent="hold('filterMs', 1)" @pointerup="release" @pointerleave="release"
                  @pointercancel="release" @contextmenu.prevent>+</button>
        </div>
      </div>
      <p class="rc-note">{{ labels.sensorsNote }}</p>
    </section>

    <section class="rc-card" :class="{ 'rc-card--tall': settings.hasCover }">
      <div class="rc-card-header">
        <h3 class="rc-card-title">{{ labels.cover }}</h3>
        <div v-if="settings.hasCover" class="rc-actions">
          <span v-if="state" class="rc-cover-state">{{ state.coverOpen ? labels.coverIsOpen : labels.coverIsClosed }}</span>
          <button type="button" class="rc-btn" :disabled="moving" @click="moveCover(true)">{{ labels.open }}</button>
          <button type="button" class="rc-btn" :disabled="moving" @click="moveCover(false)">{{ labels.close }}</button>
        </div>
      </div>
      <div class="rc-row rc-row--first">
        <span class="rc-row-label">{{ labels.hasCover }}</span>
        <ToggleSwitch :model-value="settings.hasCover" :disabled="saving"
                      @update:model-value="(v: boolean) => save({ hasCover: v })" />
      </div>

      <template v-if="settings.hasCover">
        <div v-for="servo in servos" :key="servo.id" class="rc-servo">
          <div class="rc-servo-head">
            <span class="rc-servo-title">{{ servo.title }}</span>
            <button type="button" class="rc-btn rc-btn--primary" :disabled="saving || !servoDirty(servo)"
                    @click="saveServo(servo)">{{ labels.savePositions }}</button>
          </div>
          <div v-for="f in servo.fields" :key="f.key" class="rc-row">
            <span class="rc-row-label">{{ f.label }}<span class="rc-unit">µs</span></span>
            <div class="rc-row-controls">
              <div class="rc-step">
                <button type="button" class="rc-step__btn" :aria-label="labels.decrease" :disabled="draft[f.key] <= 500"
                        @pointerdown.prevent="hold(f.key, -10, servo.id)" @pointerup="release" @pointerleave="release"
                        @pointercancel="release" @contextmenu.prevent>−</button>
                <input class="rc-step__input" type="number" inputmode="numeric" :value="draft[f.key]"
                       @change="typed(f.key, $event, servo.id)" />
                <button type="button" class="rc-step__btn" :aria-label="labels.increase" :disabled="draft[f.key] >= 2500"
                        @pointerdown.prevent="hold(f.key, 10, servo.id)" @pointerup="release" @pointerleave="release"
                        @pointercancel="release" @contextmenu.prevent>+</button>
              </div>
              <button type="button" class="rc-btn" @click="go(servo.id, draft[f.key])">{{ labels.go }}</button>
            </div>
          </div>
        </div>

        <div class="rc-row">
          <span class="rc-row-label">{{ labels.travelTime }}<span class="rc-unit">ms</span></span>
          <div class="rc-step">
            <button type="button" class="rc-step__btn" :aria-label="labels.decrease" :disabled="draft.moveMs <= 100"
                    @pointerdown.prevent="hold('moveMs', -50)" @pointerup="release" @pointerleave="release"
                    @pointercancel="release" @contextmenu.prevent>−</button>
            <input class="rc-step__input" type="number" inputmode="numeric" :value="draft.moveMs"
                   @change="typed('moveMs', $event)" />
            <button type="button" class="rc-step__btn" :aria-label="labels.increase" :disabled="draft.moveMs >= 5000"
                    @pointerdown.prevent="hold('moveMs', 50)" @pointerup="release" @pointerleave="release"
                    @pointercancel="release" @contextmenu.prevent>+</button>
          </div>
        </div>
        <p class="rc-note">{{ labels.coverNote }}</p>
      </template>
      <p v-else class="rc-note">{{ labels.noCoverNote }}</p>
    </section>

    <p v-if="error" class="rc-msg">{{ error }}</p>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { getApiBaseUrl } from '../lib/api-base';

const props = defineProps<{ connected: boolean; labels: Record<string, string> }>();

interface Settings {
  hasCover: boolean;
  frontOpenUs: number; frontCloseUs: number; backOpenUs: number; backCloseUs: number;
  moveMs: number; invertTls: boolean; invertIr: boolean; filterMs: number;
}
interface State { tls: boolean; ir: boolean; coverOpen: boolean; hasCover: boolean; awake: boolean }
type NumKey = 'frontOpenUs' | 'frontCloseUs' | 'backOpenUs' | 'backCloseUs' | 'moveMs' | 'filterMs';
type ServoId = 'F' | 'B';

const LIMITS: Record<NumKey, [number, number]> = {
  frontOpenUs: [500, 2500], frontCloseUs: [500, 2500], backOpenUs: [500, 2500], backCloseUs: [500, 2500],
  moveMs: [100, 5000], filterMs: [0, 50],
};

const root = `${getApiBaseUrl()}/api/accessories/ncrapidchange`;
const settings = ref<Settings | null>(null);
const state = ref<State | null>(null);
const error = ref('');
const saving = ref(false);
const moving = ref(false);
// What the steppers show. Servo positions stay here until Save positions;
// the two times are sent a moment after the last change.
const draft = reactive<Record<NumKey, number>>({
  frontOpenUs: 0, frontCloseUs: 0, backOpenUs: 0, backCloseUs: 0, moveMs: 0, filterMs: 0,
});

const sensors = computed(() => [
  { key: 'invertTls' as const, label: props.labels.toolSetter, triggered: !!state.value?.tls },
  { key: 'invertIr' as const, label: props.labels.irBeam, triggered: !!state.value?.ir },
]);
const servos = computed(() => [
  { id: 'F' as ServoId, title: props.labels.frontServo, fields: [
    { key: 'frontOpenUs' as NumKey, label: props.labels.openPosition },
    { key: 'frontCloseUs' as NumKey, label: props.labels.closedPosition },
  ] },
  { id: 'B' as ServoId, title: props.labels.backServo, fields: [
    { key: 'backOpenUs' as NumKey, label: props.labels.openPosition },
    { key: 'backCloseUs' as NumKey, label: props.labels.closedPosition },
  ] },
]);
type Servo = (typeof servos.value)[number];

function servoDirty(servo: Servo) {
  const s = settings.value;
  return !!s && servo.fields.some(f => draft[f.key] !== s[f.key]);
}

async function call<T>(path: string, body?: unknown, quiet = false): Promise<T | null> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (quiet) headers['X-NcSender-Quiet-Log'] = '1';
  const res = await fetch(root + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || err?.message || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) as T : null;
}

function adopt(s: Settings) {
  settings.value = s;
  (Object.keys(LIMITS) as NumKey[]).forEach((k) => { draft[k] = s[k]; });
}

async function loadSettings(retry = false) {
  error.value = '';
  try {
    const s = await call<Settings>('/settings', undefined, retry);
    if (s) adopt(s);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

async function save(patch: Partial<Settings>) {
  saving.value = true;
  error.value = '';
  try {
    const s = await call<Settings>('/settings', patch);
    if (s) {
      // Unsaved servo positions stay as they are being stepped.
      const keep = { ...draft };
      const before = settings.value;
      adopt(s);
      if (before) {
        (['frontOpenUs', 'frontCloseUs', 'backOpenUs', 'backCloseUs'] as NumKey[]).forEach((k) => {
          if (!(k in patch) && keep[k] !== before[k]) draft[k] = keep[k];
        });
      }
    }
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    if (settings.value) { draft.moveMs = settings.value.moveMs; draft.filterMs = settings.value.filterMs; }
  } finally {
    saving.value = false;
  }
}

function saveServo(servo: Servo) {
  return save(servo.id === 'F'
    ? { frontOpenUs: draft.frontOpenUs, frontCloseUs: draft.frontCloseUs }
    : { backOpenUs: draft.backOpenUs, backCloseUs: draft.backCloseUs });
}

// One move in flight per servo; a newer position waits and replaces any
// older one still waiting, so holding a stepper cannot flood the radio.
const goBusy: Record<ServoId, boolean> = { F: false, B: false };
const goNext: Record<ServoId, number | null> = { F: null, B: null };
async function go(servo: ServoId, us: number) {
  if (goBusy[servo]) { goNext[servo] = us; return; }
  goBusy[servo] = true;
  error.value = '';
  try {
    await call('/servo-go', { servo, us });
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    goNext[servo] = null;
  } finally {
    goBusy[servo] = false;
    const next = goNext[servo];
    goNext[servo] = null;
    if (next != null && next !== us) go(servo, next);
  }
}

async function moveCover(open: boolean) {
  moving.value = true;
  error.value = '';
  try {
    await call('/cover', { open });
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    moving.value = false;
  }
}

// The two times: sent once the stepping stops.
let timeTimer: ReturnType<typeof setTimeout> | null = null;
function changed(key: NumKey, servo?: ServoId) {
  if (servo) { go(servo, draft[key]); return; }
  if (timeTimer) clearTimeout(timeTimer);
  timeTimer = setTimeout(() => {
    timeTimer = null;
    const s = settings.value;
    if (!s) return;
    const patch: Partial<Settings> = {};
    if (draft.moveMs !== s.moveMs) patch.moveMs = draft.moveMs;
    if (draft.filterMs !== s.filterMs) patch.filterMs = draft.filterMs;
    if (Object.keys(patch).length) save(patch);
  }, 600);
}

function setValue(key: NumKey, value: number, servo?: ServoId) {
  const [min, max] = LIMITS[key];
  const v = Math.min(max, Math.max(min, Math.round(value)));
  if (v === draft[key]) return;
  draft[key] = v;
  changed(key, servo);
}

function typed(key: NumKey, ev: Event, servo?: ServoId) {
  const input = ev.target as HTMLInputElement;
  const v = Number(input.value);
  if (input.value.trim() === '' || Number.isNaN(v)) { input.value = String(draft[key]); return; }
  setValue(key, v, servo);
  input.value = String(draft[key]);
}

// Press steps once; holding repeats.
let holdDelay: ReturnType<typeof setTimeout> | null = null;
let holdRepeat: ReturnType<typeof setInterval> | null = null;
function release() {
  if (holdDelay) { clearTimeout(holdDelay); holdDelay = null; }
  if (holdRepeat) { clearInterval(holdRepeat); holdRepeat = null; }
}
function hold(key: NumKey, step: number, servo?: ServoId) {
  release();
  setValue(key, draft[key] + step, servo);
  holdDelay = setTimeout(() => {
    holdRepeat = setInterval(() => setValue(key, draft[key] + step, servo), 90);
  }, 450);
}

// Live sensor and cover state while the page is open.
let stateTimer: ReturnType<typeof setInterval> | null = null;
let statePending = false;
async function pollState() {
  if (statePending) return;
  statePending = true;
  try {
    state.value = await call<State>('/state', undefined, true);
  } catch {
    state.value = null;
  } finally {
    statePending = false;
  }
}
function stop() {
  if (stateTimer) { clearInterval(stateTimer); stateTimer = null; }
  if (timeTimer) { clearTimeout(timeTimer); timeTimer = null; }
  release();
}
function start() {
  stop();
  if (!props.connected) { settings.value = null; state.value = null; return; }
  loadSettings();
  pollState();
  let ticks = 0;
  stateTimer = setInterval(() => {
    pollState();
    // Settings that did not load are asked for again, slowly and off the log.
    if (!settings.value && !saving.value && ++ticks % 5 === 0) loadSettings(true);
  }, 1000);
}
watch(() => props.connected, start);
onMounted(start);
onUnmounted(stop);
</script>

<style scoped>
/* The Accessories dialog's card look; its own styles are scoped to it. */
.rc-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-medium, 8px); padding: 14px;
}
.rc-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.rc-card-title { font-size: 0.95rem; font-weight: 600; color: var(--color-text-primary); margin: 0; }
.rc-actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rc-cover-state { font-size: 0.85rem; color: var(--color-text-secondary); margin-right: 4px; }

.rc-inputs { width: 100%; border-collapse: collapse; table-layout: fixed; }
.rc-inputs th:nth-child(2), .rc-inputs td:nth-child(2) { width: 9.5rem; }
.rc-inputs th:last-child, .rc-inputs td:last-child { width: 5rem; text-align: right; white-space: nowrap; }
.rc-inputs th { text-align: left; padding: 0 0 8px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; color: var(--color-text-secondary); text-transform: uppercase; }
.rc-inputs td { padding: 12px 0; border-top: 1px solid var(--color-border); vertical-align: middle; }
.rc-inputs td:last-child > * { display: inline-flex; }
.rc-input-name { font-size: 0.95rem; font-weight: 500; color: var(--color-text-primary); }
.rc-input-state { display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; color: var(--color-text-primary); }
.rc-led { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; background: #28a745; box-shadow: 0 0 8px rgba(40, 167, 69, 0.8), 0 0 16px rgba(40, 167, 69, 0.4); }
.rc-led--active { background: #dc3545; box-shadow: 0 0 10px rgba(220, 53, 69, 0.9), 0 0 20px rgba(220, 53, 69, 0.5); }
.rc-led--unknown { background: var(--color-border); box-shadow: none; }

.rc-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px 12px; flex-wrap: wrap;
  padding: 10px 0; border-top: 1px solid var(--color-border);
}
.rc-row--first { border-top: 0; padding-top: 0; }
.rc-row-label { font-size: 0.9rem; color: var(--color-text-primary); }
.rc-unit { margin-left: 6px; font-size: 0.8rem; color: var(--color-text-secondary); }
.rc-row-controls { display: inline-flex; align-items: center; gap: 8px; }

.rc-servo { margin-top: 4px; }
.rc-servo-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 12px 0 8px; border-top: 1px solid var(--color-border);
}
.rc-servo-title { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; color: var(--color-text-secondary); text-transform: uppercase; }

/* − [value] +, the app's stepper look. */
.rc-step {
  display: inline-flex; align-items: stretch; height: 40px; box-sizing: border-box; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 28%, transparent);
  border-radius: 10px; background: var(--color-surface);
}
.rc-step:focus-within { border-color: var(--color-accent); }
.rc-step__btn {
  flex: 0 0 44px; border: 0; cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none;
  background: color-mix(in srgb, var(--color-text-secondary) 20%, var(--color-surface));
  color: var(--color-text-primary); font-family: inherit; font-size: 1.45rem; font-weight: 700; line-height: 1;
}
.rc-step__btn:active:not(:disabled) { background: color-mix(in srgb, var(--color-accent) 35%, var(--color-surface)); }
.rc-step__btn:disabled { opacity: 0.4; cursor: default; }
.rc-step__input {
  width: 7ch; min-width: 0; padding: 0; border: 0; background: transparent; outline: none; text-align: center;
  color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 600; font-variant-numeric: tabular-nums;
  appearance: textfield; -moz-appearance: textfield;
}
.rc-step__input::-webkit-outer-spin-button, .rc-step__input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.rc-btn {
  height: 40px; padding: 0 14px; border-radius: 8px; font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 28%, transparent);
  background: color-mix(in srgb, var(--color-text-secondary) 20%, var(--color-surface)); color: var(--color-text-primary);
}
.rc-btn--primary { background: var(--color-accent); border-color: transparent; color: #fff; }
.rc-btn:disabled { opacity: 0.55; cursor: default; }

.rc-note { margin: 10px 0 0; font-size: 0.82rem; color: var(--color-text-secondary); }
.rc-note--flush { margin-top: 0; }
.rc-msg { margin: 0; font-size: 0.82rem; padding: 8px 10px; border-radius: 6px; color: #dc3545; background: rgba(220, 53, 69, 0.1); }
</style>
