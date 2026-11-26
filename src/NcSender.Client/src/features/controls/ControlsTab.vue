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
  <div class="ct">
    <div v-if="!featureEnabled" class="ct__off">
      <h3>{{ L('disabledTitle') }}</h3>
      <p>Enable the <code>keyboardShortcuts</code> feature flag to configure bindings.</p>
    </div>

    <template v-else>
      <div class="ct__top">
        <label class="ct__find">
          <span>{{ L('find') }}</span>
          <input v-model="searchQuery" type="text" class="ct__find-input" :placeholder="L('searchPlaceholder')" />
        </label>
        <div class="ct__tabs" role="tablist">
          <button
            v-for="d in DEVICES" :key="d" type="button" role="tab" class="ct__tab"
            :class="{ 'ct__tab--on': tab === d }" :aria-selected="tab === d" @click="selectTab(d)"
          >{{ L(d === 'keyboard' ? 'tabKeyboard' : 'tabGamepad') }}</button>
        </div>
      </div>

      <div class="ct__status">
        <span v-if="tab === 'gamepad'" class="ct__dot" :class="{ 'ct__dot--on': !!pad }" aria-hidden="true"></span>
        <div class="ct__status-text">
          <strong>{{ statusTitle }}</strong>
          <span>{{ statusHint }}</span>
        </div>
        <span class="ct__status-label">{{ L(tab === 'keyboard' ? 'useKeyboard' : 'useGamepad') }}</span>
        <ToggleSwitch :model-value="deviceEnabled" @update:modelValue="toggleDevice" />
      </div>

      <p v-if="captureError" class="ct__error">{{ captureError }}</p>

      <div ref="scrollEl" class="ct__scroll" :class="{ 'ct__scroll--off': !deviceEnabled }">
        <div class="ct__layout" :style="{ gridTemplateColumns: `repeat(${columns.length || 1}, minmax(0, 1fr))` }">
          <div v-for="(column, index) in columns" :key="index" class="ct__col">
          <section v-for="group in column" :key="group.label" class="ct__card">
            <div class="ct__card-head">
              <h3>{{ group.label }}</h3>
              <span v-if="group.jog && tab === 'keyboard'">{{ L('jogHint') }}</span>
            </div>

            <!-- Gamepad: where each assigned control sits; the numbers are the rows'. -->
            <template v-if="group.jog && tab === 'gamepad'">
            <svg v-if="padIsStandard" class="ct__pad-drawing" viewBox="0 0 520 320" role="img" :aria-label="L('controllerLabel')">
              <ellipse class="ct__shadow" cx="260" cy="300" rx="170" ry="10" />
              <rect class="ct__bumper" x="112" y="38" width="96" height="26" rx="13" transform="rotate(-7 160 51)" />
              <rect class="ct__bumper" x="312" y="38" width="96" height="26" rx="13" transform="rotate(7 360 51)" />
              <path class="ct__shell" d="M140 62C170 52 215 56 260 56C305 56 350 52 380 62C420 74 448 120 462 190C472 240 470 286 440 296C412 304 388 270 360 232C348 216 332 210 312 210L208 210C188 210 172 216 160 232C132 270 108 304 80 296C50 286 48 240 58 190C72 120 100 74 140 62Z" />
              <path class="ct__sheen" d="M146 72C176 63 218 66 260 66C302 66 344 63 374 72C404 82 426 112 440 160" />
              <circle class="ct__well" cx="160" cy="128" r="31" /><circle class="ct__cap" cx="160" cy="128" r="21" /><circle class="ct__cap-ring" cx="160" cy="128" r="13" />
              <circle class="ct__well" cx="314" cy="178" r="31" /><circle class="ct__cap" cx="314" cy="178" r="21" /><circle class="ct__cap-ring" cx="314" cy="178" r="13" />
              <path class="ct__dpad" d="M197 152h18a4 4 0 0 1 4 4v13h13a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-13v13a4 4 0 0 1-4 4h-18a4 4 0 0 1-4-4v-13h-13a4 4 0 0 1-4-4v-10a4 4 0 0 1 4-4h13v-13a4 4 0 0 1 4-4z" />
              <g class="ct__face">
                <circle cx="376" cy="100" r="14" /><circle cx="376" cy="156" r="14" /><circle cx="348" cy="128" r="14" /><circle cx="404" cy="128" r="14" />
              </g>
              <g class="ct__face-letter">
                <text x="376" y="105">Y</text><text x="376" y="161">A</text><text x="348" y="133">X</text><text x="404" y="133">B</text>
              </g>
              <rect class="ct__small" x="226" y="112" width="20" height="12" rx="6" /><rect class="ct__small" x="274" y="112" width="20" height="12" rx="6" />
              <circle class="ct__guide" cx="260" cy="90" r="11" />
              <g v-for="m in markers" :key="m.n">
                <circle class="ct__marker" :cx="m.x" :cy="m.y" r="11" />
                <text class="ct__marker-n" :x="m.x" :y="m.y + 4.5">{{ m.n }}</text>
              </g>
            </svg>
            <p v-else class="ct__note">{{ L('otherPad') }}</p>
            </template>

            <!-- Keyboard: the jog keys laid out the way they move the machine. -->
            <div v-if="group.jog && tab === 'keyboard' && group.pad.length" class="ct__jogpad">
              <div class="ct__xy">
                <template v-for="cell in XY_CELLS" :key="cell.key">
                  <button
                    v-if="cell.id && padAction(group, cell.id)" type="button" class="ct__key"
                    :class="{ 'ct__key--wait': capturingId === cell.id }" :title="padAction(group, cell.id)!.label"
                    @click="begin(cell.id)"
                  >
                    <span class="ct__key-axis">{{ cell.axis }}</span>
                    <span class="ct__key-value">{{ capturingId === cell.id ? L('pressKey') : (labelFor(cell.id) || L('addKey')) }}</span>
                  </button>
                  <span v-else-if="cell.stop" class="ct__key-stop" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                  </span>
                  <span v-else class="ct__key-corner" aria-hidden="true">{{ cell.axis }}</span>
                </template>
              </div>
              <div class="ct__z">
                <template v-for="cell in Z_CELLS" :key="cell.key">
                  <button
                    v-if="cell.id && padAction(group, cell.id)" type="button" class="ct__key"
                    :class="{ 'ct__key--wait': capturingId === cell.id }" :title="padAction(group, cell.id)!.label"
                    @click="begin(cell.id)"
                  >
                    <span class="ct__key-axis">{{ cell.axis }}</span>
                    <span class="ct__key-value">{{ capturingId === cell.id ? L('pressKey') : (labelFor(cell.id) || L('addKey')) }}</span>
                  </button>
                </template>
              </div>
            </div>

            <!-- Gamepad: how the sticks jog, and the variable-speed settings. -->
            <template v-if="group.mode">
              <div class="ct__modes">
                <button
                  v-for="m in MODES" :key="m.name" type="button" class="ct__mode"
                  :class="{ 'ct__mode--on': stick.enabled === m.variable }" :aria-pressed="stick.enabled === m.variable"
                  :disabled="!deviceEnabled" @click="saveStick({ enabled: m.variable })"
                >
                  <span class="ct__mode-name">{{ L(m.name) }}</span>
                  <span class="ct__mode-hint">{{ L(m.hint) }}</span>
                </button>
              </div>
              <!-- What the stick would send, live. Nothing moves while this page is open. -->
              <div v-if="stick.enabled" class="ct__try">
                <svg class="ct__try-pad" viewBox="-30 -30 60 60" aria-hidden="true">
                  <circle class="ct__try-ring" r="27" />
                  <circle class="ct__try-zone" :r="27 * stick.deadZone" />
                  <line v-if="tryOut.active" class="ct__try-line" x1="0" y1="0" :x2="tryOut.x * 27" :y2="tryOut.y * 27" />
                  <circle class="ct__try-dot" :class="{ 'ct__try-dot--on': tryOut.active }" :cx="tryOut.x * 27" :cy="tryOut.y * 27" r="5" />
                </svg>
                <div class="ct__try-text">
                  <strong>{{ L('tryTitle') }}</strong>
                  <span>{{ L('tryHint') }}</span>
                </div>
                <div class="ct__try-read">
                  <strong>{{ tryOut.speed }}</strong>
                  <span>{{ tryOut.detail }}</span>
                </div>
              </div>
              <div v-if="stick.enabled" class="ct__rows">
                <div class="ct__row">
                  <span class="ct__row-label">{{ L('topSpeed') }}</span>
                  <button type="button" class="ct__x ct__step" :disabled="!deviceEnabled || stick.topSpeed <= TOP_SPEED_MIN" :aria-label="L('lower')" @click="bumpSpeed(-1)">−</button>
                  <span class="ct__step-value">{{ speedText }}</span>
                  <button type="button" class="ct__x ct__step" :disabled="!deviceEnabled || stick.topSpeed >= TOP_SPEED_MAX" :aria-label="L('raise')" @click="bumpSpeed(1)">+</button>
                </div>
                <div class="ct__row">
                  <span class="ct__row-label">{{ L('deadZone') }}</span>
                  <button type="button" class="ct__x ct__step" :disabled="!deviceEnabled || stick.deadZone <= 0.045" :aria-label="L('lower')" @click="bumpDeadZone(-1)">−</button>
                  <span class="ct__step-value">{{ Math.round(stick.deadZone * 100) }} %</span>
                  <button type="button" class="ct__x ct__step" :disabled="!deviceEnabled || stick.deadZone >= 0.395" :aria-label="L('raise')" @click="bumpDeadZone(1)">+</button>
                </div>
                <div class="ct__row">
                  <span class="ct__row-label">{{ L('response') }}</span>
                  <div class="ct__seg">
                    <button
                      v-for="r in RESPONSES" :key="r.name" type="button" class="ct__seg-btn"
                      :class="{ 'ct__seg-btn--on': response === r.expo }" :aria-pressed="response === r.expo"
                      :disabled="!deviceEnabled" @click="saveStick({ expo: r.expo })"
                    >{{ L(r.name) }}</button>
                  </div>
                </div>
                <div v-for="axis in STICK_ROWS" :key="axis.id" class="ct__row" :class="{ 'ct__row--wait': capturingId === axis.id }">
                  <span class="ct__row-label">{{ L('stickAxis', { axis: axis.label }) }}</span>
                  <template v-if="capturingId === axis.id">
                    <span class="ct__chip ct__chip--wait">{{ L('pushStick') }}</span>
                    <button type="button" class="ct__x" :title="L('cancel')" :aria-label="L('cancel')" @click.stop="cancelCapture">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
                    </button>
                  </template>
                  <template v-else>
                    <button
                      type="button" class="ct__chip" :class="{ 'ct__chip--empty': !labelFor(axis.id) }"
                      :disabled="!deviceEnabled" @click="begin(axis.id)"
                    >{{ labelFor(axis.id) || L('sameAsJog') }}</button>
                    <button
                      v-if="labelFor(axis.id)" type="button" class="ct__x" :disabled="!deviceEnabled"
                      :title="L('removeGamepadBinding')" :aria-label="L('removeGamepadBinding')" @click.stop="clear(axis.id)"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
                    </button>
                  </template>
                </div>
              </div>
            </template>

            <div v-if="group.rows.length" class="ct__rows">
              <div v-for="action in group.rows" :key="action.id" class="ct__row" :class="{ 'ct__row--wait': capturingId === action.id }">
                <span v-if="tab === 'gamepad' && numberFor(action.id)" class="ct__n">{{ numberFor(action.id) }}</span>
                <span class="ct__row-label" :title="action.description || undefined">{{ action.label }}</span>
                <span v-if="action.requiresLongPress" class="ct__hold">{{ L('hold') }}</span>
                <template v-if="capturingId === action.id">
                  <span class="ct__chip ct__chip--wait">{{ L(tab === 'keyboard' ? 'pressKey' : 'pressButton') }}</span>
                  <button type="button" class="ct__x" :title="L('cancel')" :aria-label="L('cancel')" @click.stop="cancelCapture">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button" class="ct__chip" :class="{ 'ct__chip--empty': !labelFor(action.id) }"
                    :disabled="!deviceEnabled" :title="rawFor(action.id) || undefined" @click="begin(action.id)"
                  >{{ labelFor(action.id) || L(tab === 'keyboard' ? 'addKey' : 'addButton') }}</button>
                  <button
                    v-if="labelFor(action.id)" type="button" class="ct__x" :disabled="!deviceEnabled"
                    :title="L(tab === 'keyboard' ? 'removeKeyboardBinding' : 'removeGamepadBinding')"
                    :aria-label="L(tab === 'keyboard' ? 'removeKeyboardBinding' : 'removeGamepadBinding')"
                    @click.stop="clear(action.id)"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
                  </button>
                </template>
              </div>
            </div>
          </section>
          </div>

          <p v-if="!groups.length" class="ct__note">{{ L('noMatches') }}</p>
        </div>
      </div>

      <div class="ct__foot">
        <span class="ct__foot-hint">{{ capturingAction ? capturingText : L(deviceEnabled ? 'changeHint' : 'enableHint') }}</span>
        <button type="button" class="ct__reset" :disabled="isResetting" @click="showResetConfirm = true">
          {{ L(tab === 'keyboard' ? 'resetKeyboard' : 'resetGamepad') }}
        </button>
      </div>
    </template>
  </div>

  <Dialog v-if="showResetConfirm" @close="showResetConfirm = false" :show-header="false" size="small">
    <ConfirmPanel
      :title="L(tab === 'keyboard' ? 'resetKeyboard' : 'resetGamepad')"
      :message="L(tab === 'keyboard' ? 'resetKeyboardMessage' : 'resetGamepadMessage')"
      :cancel-text="L('cancel')"
      :confirm-text="L('reset')"
      variant="danger"
      @cancel="showResetConfirm = false"
      @confirm="confirmReset"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import { commandRegistry } from '@/lib/command-registry';
import { keyBindingStore } from './key-binding-store';
import { comboFromEvent } from './keyboard-utils';
import { gamepadBindingStore } from './gamepad-binding-store';
import { detectGamepadInput, parseGamepadBinding } from './gamepad-utils';
import { settingsStore, updateSettings } from '@/lib/settings-store.js';
import {
  STICK_ACTIONS, TOP_SPEED_MAX, TOP_SPEED_MIN, jogVector, readStick, readStickJogSettings, snapAngle, stickTarget,
  type StickJogSettings
} from './stick-jog';

// The page's own texts (Community has no translations).
const STRINGS: Record<string, string> = {
  "tryTitle": "Try it: the machine does not move on this screen",
  "tryHint": "Push the stick to see what it would send.",
  "tryPush": "push",
  "tryIdle": "Centered",
  "jogMode": "Jog mode",
  "modeStep": "Step and hold",
  "modeStepHint": "Tap for a step, hold to keep moving.",
  "modeVariable": "Variable speed",
  "modeVariableHint": "The stick sets direction and speed.",
  "topSpeed": "Top speed",
  "deadZone": "Dead zone",
  "response": "Response",
  "responseEven": "Even",
  "responseGentle": "Gentle",
  "responseVeryGentle": "Very gentle",
  "stickAxis": "Stick for {axis}",
  "sameAsJog": "Same as Jog",
  "pushStick": "Push the stick",
  "lower": "Lower",
  "raise": "Raise",
  "errors.saveStick": "Failed to save the jog mode",
  "hold": "Hold",
  "addButton": "Add a button",
  "addKey": "Add a key",
  "cancel": "Cancel",
  "capturingButton": "Press the button or push the stick for \"{action}\".",
  "capturingKey": "Press the key for \"{action}\".",
  "changeHint": "Tap a key or button to change it. One already in use moves to the new action.",
  "controllerLabel": "Controller with its assigned controls numbered",
  "disabledTitle": "Keyboard shortcuts are disabled.",
  "enableHint": "Switch it on to change its controls.",
  "errors.assignGamepad": "Failed to assign gamepad binding",
  "errors.assignKey": "Failed to assign key binding",
  "errors.clearGamepad": "Failed to clear gamepad binding",
  "errors.clearKey": "Failed to clear key binding",
  "errors.reset": "Failed to reset keyboard shortcuts",
  "errors.toggle": "Failed to update keyboard toggle",
  "find": "Find",
  "gamepadConnected": "Connected",
  "gamepadNone": "No gamepad found",
  "gamepadNoneHint": "Connect one and press any button on it.",
  "jogHint": "Tap for one step, hold to keep moving",
  "keyboardHint": "Tap a key to change it, then press the new one. A key already in use moves to the new action.",
  "keyboardTitle": "Keyboard shortcuts",
  "noMatches": "Nothing matches.",
  "otherPad": "This controller doesn't report the standard layout, so the drawing can't show where its controls are. The rows below still work.",
  "pressButton": "Press a button",
  "pressKey": "Press a key",
  "removeGamepadBinding": "Remove gamepad binding",
  "removeKeyboardBinding": "Remove keyboard binding",
  "requireLongPress": "REQUIRE LONG PRESS",
  "reset": "Reset",
  "resetGamepad": "Reset gamepad to defaults",
  "resetGamepadMessage": "Every gamepad assignment goes back to its default. This cannot be undone.",
  "resetKeyboard": "Reset keyboard to defaults",
  "resetKeyboardMessage": "Every keyboard shortcut goes back to its default. This cannot be undone.",
  "searchPlaceholder": "Search Actions...",
  "tabGamepad": "Gamepad",
  "tabKeyboard": "Keyboard",
  "tapToChange": "The numbers match the rows below",
  "useGamepad": "Use gamepad",
  "useKeyboard": "Use keyboard",
  "whatEach": "Where the controls are"
};
const L = (key: string, params?: Record<string, unknown>) =>
  (STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));

type Device = 'keyboard' | 'gamepad';
const DEVICES: Device[] = ['keyboard', 'gamepad'];
const TAB_KEY = 'ncsender.controls.tab';

function savedTab(): Device {
  try { return localStorage.getItem(TAB_KEY) === 'gamepad' ? 'gamepad' : 'keyboard'; } catch { return 'keyboard'; }
}
const tab = ref<Device>(savedTab());
function selectTab(next: Device) {
  if (tab.value === next) return;
  cancelCapture();
  tab.value = next;
  try { localStorage.setItem(TAB_KEY, next); } catch { /* a remembered tab is a convenience only */ }
}

const featureEnabled = computed(() => keyBindingStore.isFeatureEnabled.value);
const deviceEnabled = computed(() =>
  tab.value === 'keyboard' ? keyBindingStore.areShortcutsEnabled.value : keyBindingStore.isGamepadEnabled.value);

const searchQuery = ref('');
const captureError = ref<string | null>(null);
const isResetting = ref(false);
const showResetConfirm = ref(false);

// ---- bindings ----------------------------------------------------------
const bindingMap = reactive<Record<string, string>>({});
const gamepadBindingMap = reactive<Record<string, string>>({});
function fill(target: Record<string, string>, source: Record<string, string | null>) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.entries(source).forEach(([id, value]) => { if (value !== null) target[id] = value; });
}
const syncBindingMap = () => fill(bindingMap, keyBindingStore.getAllBindings());
const syncGamepadBindingMap = () => fill(gamepadBindingMap, gamepadBindingStore.getAllBindings());
syncBindingMap();
syncGamepadBindingMap();
watch(() => keyBindingStore.state.bindings, syncBindingMap, { deep: true });
watch(() => gamepadBindingStore.state.bindings, syncGamepadBindingMap, { deep: true });

// ---- the connected gamepad ---------------------------------------------
const pad = ref<{ name: string; standard: boolean } | null>(null);
function readPad() {
  // A keyboard's receiver can report as a gamepad too: a real one (standard layout) wins.
  const all = Array.from(navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g);
  const found = all.find((g) => g.mapping === 'standard') ?? all[0];
  const next = found ? { name: found.id.split(' (')[0].trim() || found.id, standard: found.mapping === 'standard' } : null;
  if (next?.name !== pad.value?.name || next?.standard !== pad.value?.standard) pad.value = next;
}
// Without a gamepad to ask, the usual layout is assumed.
const padIsStandard = computed(() => pad.value?.standard ?? true);

// A standard gamepad's controls by name, and where they sit in the drawing.
const BUTTONS: { name: string; x: number; y: number }[] = [
  { name: 'A', x: 376, y: 156 }, { name: 'B', x: 404, y: 128 }, { name: 'X', x: 348, y: 128 }, { name: 'Y', x: 376, y: 100 },
  { name: 'LB', x: 176, y: 47 }, { name: 'RB', x: 344, y: 47 }, { name: 'LT', x: 136, y: 52 }, { name: 'RT', x: 384, y: 52 },
  { name: 'View', x: 236, y: 118 }, { name: 'Menu', x: 284, y: 118 }, { name: 'LS', x: 160, y: 128 }, { name: 'RS', x: 314, y: 178 },
  { name: 'D-pad ↑', x: 206, y: 160 }, { name: 'D-pad ↓', x: 206, y: 196 }, { name: 'D-pad ←', x: 188, y: 178 }, { name: 'D-pad →', x: 224, y: 178 }
];
const STICKS = [{ name: 'LS', x: 160, y: 128 }, { name: 'RS', x: 314, y: 178 }];

function padControl(binding: string | undefined): { name: string; x: number; y: number } | null {
  const parsed = parseGamepadBinding(binding ?? '');
  if (!parsed) return null;
  if (parsed.type === 'button') return BUTTONS[parsed.index] ?? null;
  const stick = STICKS[Math.floor(parsed.index / 2)];
  if (!stick) return null;
  const horizontal = parsed.index % 2 === 0;
  const plus = parsed.direction === 'positive';
  const arrow = horizontal ? (plus ? '→' : '←') : (plus ? '↓' : '↑');
  return {
    name: `${stick.name} ${arrow}`,
    x: stick.x + (horizontal ? (plus ? 19 : -19) : 0),
    y: stick.y + (horizontal ? 0 : (plus ? 19 : -19))
  };
}

// ---- gamepad jog mode ----------------------------------------------------
const MODES = [
  { name: 'modeStep', hint: 'modeStepHint', variable: false },
  { name: 'modeVariable', hint: 'modeVariableHint', variable: true }
];
const RESPONSES = [
  { name: 'responseEven', expo: 0 }, { name: 'responseGentle', expo: 0.5 }, { name: 'responseVeryGentle', expo: 1 }
];
const STICK_ROWS = [
  { id: STICK_ACTIONS.X, label: 'X+' }, { id: STICK_ACTIONS.Y, label: 'Y+' }, { id: STICK_ACTIONS.Z, label: 'Z+' }
];
const STICK_IDS: string[] = Object.values(STICK_ACTIONS);
const STEP_IDS = ['CycleSteps', 'SetStep0.1', 'SetStep1', 'SetStep10'];
const isStickAction = (id: string | null) => !!id && STICK_IDS.includes(id);

const stick = computed(() => readStickJogSettings((settingsStore.data as any)?.gamepadAnalog));
// The nearest of the three response choices to what is saved.
const response = computed(() => RESPONSES.reduce((a, b) =>
  (Math.abs(b.expo - stick.value.expo) < Math.abs(a.expo - stick.value.expo) ? b : a)).expo);
const imperial = computed(() => (settingsStore.data as any)?.unitsPreference === 'imperial');
const speedText = computed(() => (imperial.value
  ? `${(stick.value.topSpeed / 25.4).toFixed(0)} in/min`
  : `${Math.round(stick.value.topSpeed)} mm/min`));

async function saveStick(changes: Partial<StickJogSettings>) {
  if (changes.enabled === false) cancelCapture();
  try {
    await updateSettings({ gamepadAnalog: { ...stick.value, ...changes } });
    captureError.value = null;
  } catch (error: any) {
    console.error('Failed to save the jog mode:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L('errors.saveStick');
  }
}
const SPEED_STEP = 250;
function bumpSpeed(dir: number) {
  const next = Math.round(stick.value.topSpeed / SPEED_STEP) * SPEED_STEP + dir * SPEED_STEP;
  void saveStick({ topSpeed: Math.min(TOP_SPEED_MAX, Math.max(TOP_SPEED_MIN, next)) });
}
function bumpDeadZone(dir: number) {
  const next = Math.round(stick.value.deadZone * 50 + dir) / 50;
  void saveStick({ deadZone: Math.min(0.4, Math.max(0.04, next)) });
}

// What the stick would send right now, for the "Try it" readout. The gamepad
// manager sends nothing while this page is open.
const tryOut = reactive({ active: false, x: 0, y: 0, speed: '', detail: '' });
const speedLabel = (mmPerMin: number) => (imperial.value
  ? `${(mmPerMin / 25.4).toFixed(1)} in/min` : `${Math.round(mmPerMin)} mm/min`);
function readTry() {
  const settings = stick.value;
  let raw = { x: 0, y: 0, z: 0 };
  let target = null;
  for (const gamepad of navigator.getGamepads?.() ?? []) {
    if (!gamepad) continue;
    raw = readStick(gamepad, gamepadBindingStore.getAllBindings());
    target = stickTarget(raw, settings.deadZone);
    if (target) break;
  }
  // The dot is where the stick is: X to the right, Y+ up; a Z push shows on the vertical.
  const shown = target?.kind === 'z' ? { x: 0, y: raw.z } : { x: raw.x, y: raw.y };
  const length = Math.max(1, Math.hypot(shown.x, shown.y));
  tryOut.x = shown.x / length;
  tryOut.y = -shown.y / length;
  tryOut.active = !!target;
  if (!target) {
    tryOut.speed = speedLabel(0);
    tryOut.detail = L('tryIdle');
    return;
  }
  const feed = jogVector(target, settings, settings.topSpeed).feed;
  tryOut.speed = speedLabel(feed);
  const where = target.kind === 'z' ? (target.sign > 0 ? 'Z+' : 'Z-') : `${snapAngle(target.angle)}°`;
  tryOut.detail = `${where} · ${Math.round(target.push * 100)} % ${L('tryPush')}`;
}
let tryTimer: number | null = null;
watch(() => tab.value === 'gamepad' && stick.value.enabled, (on) => {
  if (tryTimer !== null) { clearInterval(tryTimer); tryTimer = null; }
  if (on) { readTry(); tryTimer = window.setInterval(readTry, 50); }
}, { immediate: true });

// Each pad's axes as a stick capture starts: an axis counts only once it
// moves well away from there, so a trigger resting at -1 is not taken.
let stickRest: Record<number, number[]> = {};
function restingAxes() {
  const rest: Record<number, number[]> = {};
  for (const gamepad of navigator.getGamepads?.() ?? []) if (gamepad) rest[gamepad.index] = [...gamepad.axes];
  return rest;
}
function detectStickAxis(gamepad: Gamepad) {
  const rest = stickRest[gamepad.index] ?? [];
  for (let i = 0; i < gamepad.axes.length; i++) {
    const value = gamepad.axes[i];
    if (Math.abs(value) > 0.95 && Math.abs(value - (rest[i] ?? 0)) > 0.95) {
      return { type: 'axis', index: i, direction: value > 0 ? 'positive' : 'negative' };
    }
  }
  return null;
}

// ---- what the current tab shows ----------------------------------------
const rawFor = (id: string) => (tab.value === 'keyboard' ? bindingMap[id] : gamepadBindingMap[id]) ?? '';
// A key combination as shown: arrows as arrows, long names short.
const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn', Escape: 'Esc', Delete: 'Del', Insert: 'Ins'
};
// "Shift++" is Shift with the plus key: split on the separators only.
const keyLabel = (combo: string) => combo.split(/\+(?!$)/).map((part) => KEY_NAMES[part] ?? part).join('+');

function labelFor(id: string): string {
  const raw = rawFor(id);
  if (!raw) return raw;
  if (tab.value === 'keyboard') return keyLabel(raw);
  return (padIsStandard.value && padControl(raw)?.name) || raw;
}

const PAD_IDS = ['JogXPlus', 'JogXMinus', 'JogYPlus', 'JogYMinus', 'JogZPlus', 'JogZMinus'];
// Laid out like the jog panel: corner arrows and the red stop are there for
// the look only (diagonals come from two keys held together).
const XY_CELLS = [
  { key: 'a', id: '', axis: '↖', stop: false }, { key: 'b', id: 'JogYPlus', axis: 'Y+', stop: false }, { key: 'c', id: '', axis: '↗', stop: false },
  { key: 'd', id: 'JogXMinus', axis: 'X-', stop: false }, { key: 'e', id: '', axis: '', stop: true }, { key: 'f', id: 'JogXPlus', axis: 'X+', stop: false },
  { key: 'g', id: '', axis: '↙', stop: false }, { key: 'h', id: 'JogYMinus', axis: 'Y-', stop: false }, { key: 'i', id: '', axis: '↘', stop: false }
];
const Z_CELLS = [
  { key: 'a', id: 'JogZPlus', axis: 'Z+' }, { key: 'c', id: 'JogZMinus', axis: 'Z-' }
];
// The diagonal jogs come from two jog keys held together: nothing to bind.
const HIDDEN = ['JogXPlusYPlus', 'JogXPlusYMinus', 'JogXMinusYPlus', 'JogXMinusYMinus'];

const registryState = commandRegistry.getState();
type Action = (typeof registryState.actions)[string];

const groups = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  const matches = (action: Action) => !query
    || action.label.toLowerCase().includes(query)
    || !!action.description?.toLowerCase().includes(query)
    || !!action.group?.toLowerCase().includes(query)
    || labelFor(action.id).toLowerCase().includes(query)
    || rawFor(action.id).toLowerCase().includes(query);

  const byGroup = new Map<string, { label: string; jog: boolean; mode: boolean; pad: Action[]; rows: Action[] }>();
  const actions = Object.values(registryState.actions)
    .filter((action) => !HIDDEN.includes(action.id) && !STICK_IDS.includes(action.id) && matches(action))
    .sort((a, b) => a.label.localeCompare(b.label));
  // The gamepad's jog mode is a card of its own (not while searching).
  const modeCard = tab.value === 'gamepad' && !query ? { label: L('jogMode'), jog: false, mode: true, pad: [] as Action[], rows: [] as Action[] } : null;
  for (const action of actions) {
    // The step-size buttons belong to Step and hold: on the gamepad they sit
    // in the Jog mode card, and are not offered with variable speed.
    if (tab.value === 'gamepad' && STEP_IDS.includes(action.id)) {
      if (stick.value.enabled) continue;
      if (modeCard) { modeCard.rows.push(action); continue; }
    }
    const label = action.group || '';
    let group = byGroup.get(label);
    if (!group) byGroup.set(label, group = { label, jog: false, mode: false, pad: [], rows: [] });
    const onPad = PAD_IDS.includes(action.id);
    if (onPad) group.jog = true;
    // The keyboard shows the six jog keys as a pad; the gamepad lists them.
    if (onPad && tab.value === 'keyboard') group.pad.push(action);
    else group.rows.push(action);
  }
  const list = [...byGroup.values()].sort((a, b) => Number(b.jog) - Number(a.jog) || a.label.localeCompare(b.label));
  if (modeCard) list.push(modeCard);
  return list;
});
const padAction = (group: { pad: Action[] }, id: string) => group.pad.find((action) => action.id === id);
// The cards in columns of about the same height: as many columns as fit,
// Jogging first, then each other group (tallest first) into whichever column
// is shortest so far. The last card of a column fills what is left, so the
// columns end level and no corner of the page is left empty.
const scrollEl = ref<HTMLElement | null>(null);
const columnCount = ref(3);
let resizeObserver: ResizeObserver | null = null;
function fitColumns() {
  const width = scrollEl.value?.clientWidth ?? 0;
  columnCount.value = width >= 1040 ? 3 : width >= 660 ? 2 : 1;
}

type Group = (typeof groups.value)[number];
// About how tall a card is, in rows: enough to share them out evenly.
function weight(group: Group): number {
  const extra = group.jog ? (tab.value === 'keyboard' ? 5 : 5.5) : 0;
  if (group.mode) return stick.value.enabled ? 12.5 : 3.6 + group.rows.length;
  return 1.4 + group.rows.length + extra;
}

const columns = computed(() => {
  const count = Math.max(1, Math.min(columnCount.value, groups.value.length));
  const cols: { height: number; groups: Group[] }[] = Array.from({ length: count }, () => ({ height: 0, groups: [] }));
  const put = (group: Group, column = cols.reduce((a, b) => (b.height < a.height ? b : a))) => {
    column.groups.push(group);
    column.height += weight(group);
  };
  const jog = groups.value.filter((group) => group.jog);
  jog.forEach((group) => put(group, cols[0]));
  // Jog mode heads the second column, beside Jogging.
  groups.value.filter((group) => group.mode).forEach((group) => put(group, cols[Math.min(1, count - 1)]));
  groups.value.filter((group) => !group.jog && !group.mode).sort((a, b) => weight(b) - weight(a)).forEach((group) => put(group));
  return cols.filter((column) => column.groups.length > 0).map((column) => column.groups);
});

// Bound controls get a number, shown in their row and on the drawing.
const numbered = computed(() => {
  const list: { id: string; n: number; x: number; y: number }[] = [];
  if (tab.value !== 'gamepad' || !padIsStandard.value) return list;
  for (const group of groups.value) {
    for (const action of group.rows) {
      const control = padControl(gamepadBindingMap[action.id]);
      if (control) list.push({ id: action.id, n: list.length + 1, x: control.x, y: control.y });
    }
  }
  return list;
});
const markers = computed(() => numbered.value);
const numberFor = (id: string) => numbered.value.find((entry) => entry.id === id)?.n ?? 0;

const statusTitle = computed(() =>
  tab.value === 'keyboard' ? L('keyboardTitle') : (pad.value?.name ?? L('gamepadNone')));
const statusHint = computed(() =>
  tab.value === 'keyboard' ? L('keyboardHint') : L(pad.value ? 'gamepadConnected' : 'gamepadNoneHint'));

// ---- changing a binding -------------------------------------------------
const captureActionId = ref<string | null>(null);
const captureGamepadActionId = ref<string | null>(null);
const capturingId = computed(() => (tab.value === 'keyboard' ? captureActionId.value : captureGamepadActionId.value));
const capturingAction = computed(() => (capturingId.value ? registryState.actions[capturingId.value] : null));
const capturingText = computed(() =>
  L(tab.value === 'keyboard' ? 'capturingKey' : 'capturingButton', { action: capturingAction.value?.label ?? '' }));

function begin(actionId: string) {
  if (!deviceEnabled.value) return;
  captureError.value = null;
  captureActionId.value = tab.value === 'keyboard' ? actionId : null;
  captureGamepadActionId.value = tab.value === 'gamepad' ? actionId : null;
  stickRest = restingAxes();
  keyBindingStore.setCaptureMode(true);
}

function cancelCapture() {
  captureActionId.value = null;
  captureGamepadActionId.value = null;
  keyBindingStore.setCaptureMode(false);
}

async function clear(actionId: string) {
  const keyboard = tab.value === 'keyboard';
  try {
    if (keyboard) await keyBindingStore.clearBindingForAction(actionId);
    else await gamepadBindingStore.clearBindingForAction(actionId);
  } catch (error: any) {
    console.error('Failed to clear binding:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L(keyboard ? 'errors.clearKey' : 'errors.clearGamepad');
  }
}

async function toggleDevice(value: boolean) {
  cancelCapture();
  try {
    if (tab.value === 'keyboard') await keyBindingStore.setShortcutsEnabled(value);
    else await keyBindingStore.setGamepadEnabled(value);
  } catch (error: any) {
    console.error('Failed to update the switch:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L('errors.toggle');
  }
}

const handleKeyCapture = async (event: KeyboardEvent) => {
  if (!captureActionId.value || !keyBindingStore.areShortcutsEnabled.value) return;
  event.preventDefault();
  event.stopPropagation();
  const combo = comboFromEvent(event);
  if (!combo) return;
  try {
    await keyBindingStore.assignBinding(captureActionId.value, combo);
    captureError.value = null;
    cancelCapture();
  } catch (error: any) {
    console.error('Failed to assign key binding:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L('errors.assignKey');
  }
};

async function handleGamepadCapture(input: any) {
  const actionId = captureGamepadActionId.value;
  if (!actionId || !keyBindingStore.isGamepadEnabled.value) return;
  // A stick action takes only a stick, and may share it with a Jog action,
  // which stands aside while variable speed is on.
  if (isStickAction(actionId) && input?.type !== 'axis') return;
  const isJog = (id: string) => PAD_IDS.includes(id);
  const sharesWith = isStickAction(actionId) ? isJog : isJog(actionId) ? (id: string) => isStickAction(id) : undefined;
  try {
    await gamepadBindingStore.assignBinding(actionId, input, sharesWith);
    captureError.value = null;
    cancelCapture();
  } catch (error: any) {
    console.error('Failed to assign gamepad binding:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L('errors.assignGamepad');
  }
}

async function confirmReset() {
  showResetConfirm.value = false;
  isResetting.value = true;
  captureError.value = null;
  try {
    if (tab.value === 'keyboard') await keyBindingStore.resetToDefaults();
    else await gamepadBindingStore.resetToDefaults();
  } catch (error: any) {
    console.error('Failed to reset bindings:', JSON.stringify(error?.message ?? error));
    captureError.value = error?.message || L('errors.reset');
  } finally {
    isResetting.value = false;
  }
}

let pollTimer: number | null = null;
let padTick = 0;
function poll() {
  // The gamepad's name ten times less often than a capture is polled.
  if (padTick++ % 10 === 0) readPad();
  if (!captureGamepadActionId.value) return;
  for (const gamepad of navigator.getGamepads?.() ?? []) {
    if (!gamepad) continue;
    const input = isStickAction(captureGamepadActionId.value) ? detectStickAxis(gamepad) : detectGamepadInput(gamepad);
    if (input) { void handleGamepadCapture(input); break; }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyCapture, true);
  pollTimer = window.setInterval(poll, 100);
  keyBindingStore.setControlsTabActive(true);
  fitColumns();
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(fitColumns);
    resizeObserver.observe(scrollEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyCapture, true);
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  if (tryTimer !== null) { clearInterval(tryTimer); tryTimer = null; }
  cancelCapture();
  resizeObserver?.disconnect();
  resizeObserver = null;
  keyBindingStore.setControlsTabActive(false);
});
</script>

<style scoped>
.ct {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: var(--gap-md);
  color: var(--color-text-primary);
}

.ct__off {
  padding: var(--gap-lg);
  text-align: center;
  background: var(--color-surface-muted);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-medium);
}
.ct__off code { padding: 2px 6px; background: var(--color-surface); border-radius: var(--radius-small); }

.ct__top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--gap-md); }
.ct__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}
.ct__tab {
  min-width: 120px;
  padding: 10px 22px !important;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  color: var(--color-text-secondary) !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 9px !important;
  box-shadow: none !important;
}
.ct__tab--on { font-weight: 600; color: #fff !important; background: var(--gradient-accent) !important; }
.ct__tab:focus-visible, .ct__chip:focus-visible, .ct__key:focus-visible, .ct__x:focus-visible, .ct__reset:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.ct__find { display: flex; align-items: center; gap: 10px; font-size: 0.92rem; color: var(--color-text-secondary); }
.ct__find-input {
  width: min(240px, 46vw);
  padding: 9px 12px;
  font: inherit;
  color: var(--color-text-primary);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
}

.ct__status {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}
.ct__dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--color-border); }
.ct__dot--on { background: #2ecc71; }
.ct__status-text { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.ct__status-text span { font-size: 0.88rem; color: var(--color-text-secondary); }
.ct__status-label { font-size: 0.92rem; color: var(--color-text-secondary); white-space: nowrap; }

.ct__error { margin: 0; color: #ff6b6b; }

.ct__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
.ct__scroll--off { opacity: 0.55; }
.ct__layout { display: grid; gap: var(--gap-md); align-items: stretch; min-height: 100%; }
.ct__col { display: flex; flex-direction: column; gap: var(--gap-md); min-width: 0; }
/* The last card of each column takes what is left, so the columns end level. */
.ct__col > .ct__card:last-child { flex: 1 1 auto; }

.ct__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 18px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}
.ct__card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
.ct__card-head h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
.ct__card-head span, .ct__note { font-size: 0.86rem; color: var(--color-text-secondary); }
.ct__note { margin: 0; }

.ct__pad-drawing { display: block; width: 100%; max-width: 360px; height: auto; margin: 0 auto; }
.ct__shadow { fill: #000; opacity: 0.28; }
.ct__bumper { fill: color-mix(in srgb, var(--color-text-primary) 10%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 22%, transparent); stroke-width: 1.5; }
.ct__shell { fill: color-mix(in srgb, var(--color-text-primary) 7%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 26%, transparent); stroke-width: 2; }
.ct__sheen { fill: none; stroke: color-mix(in srgb, var(--color-text-primary) 16%, transparent); stroke-width: 2; stroke-linecap: round; }
.ct__well { fill: color-mix(in srgb, #000 34%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 14%, transparent); stroke-width: 1.5; }
.ct__cap { fill: color-mix(in srgb, var(--color-text-primary) 16%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 30%, transparent); stroke-width: 1.5; }
.ct__cap-ring { fill: none; stroke: color-mix(in srgb, var(--color-text-primary) 18%, transparent); stroke-width: 1.5; }
.ct__dpad { fill: color-mix(in srgb, #000 30%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 24%, transparent); stroke-width: 1.5; }
.ct__face circle { fill: color-mix(in srgb, #000 26%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 26%, transparent); stroke-width: 1.5; }
.ct__face-letter text { fill: color-mix(in srgb, var(--color-text-primary) 46%, transparent); font-size: 13px; font-weight: 700; text-anchor: middle; }
.ct__small { fill: color-mix(in srgb, #000 26%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-text-primary) 22%, transparent); stroke-width: 1.2; }
.ct__guide { fill: color-mix(in srgb, var(--color-accent) 22%, var(--color-surface)); stroke: color-mix(in srgb, var(--color-accent) 60%, transparent); stroke-width: 1.5; }
.ct__marker { fill: var(--color-accent); stroke: #fff; stroke-width: 2; }
.ct__marker-n { fill: #fff; font-size: 12px; font-weight: 700; text-anchor: middle; }

.ct__jogpad {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 4px;
  height: 216px;
  padding: 16px 12px;
  box-sizing: content-box;
}
.ct__xy { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 4px; flex: 0 1 216px; min-width: 0; }
.ct__z { display: flex; flex-direction: column; gap: 4px; flex: 0 0 72px; }
.ct__z .ct__key { flex: 1 1 0; }
.ct__key, .ct__key-corner, .ct__key-stop {
  display: flex !important;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  padding: 2px !important;
  font: inherit;
  color: var(--color-text-primary) !important;
  background: var(--color-surface-muted) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-small) !important;
  box-shadow: none !important;
}
.ct__key { cursor: pointer; transition: all 0.2s ease; }
.ct__key:hover { border-color: var(--color-accent) !important; }
.ct__key-corner { font-size: 1.2rem; font-weight: 600; opacity: 0.4; }
.ct__key-stop { color: #fff !important; background: #dc2626 !important; border-color: #dc2626 !important; opacity: 0.55; }
.ct__key-stop svg { width: 20px; height: 20px; }
.ct__key-axis { font-size: 1rem; font-weight: 700; line-height: 1.1; }
.ct__key-value {
  max-width: 100%;
  padding: 1px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  border-radius: 5px;
}
.ct__key--wait { border-color: #e9b949 !important; background: color-mix(in srgb, #e9b949 14%, var(--color-surface-muted)) !important; }
.ct__key--wait .ct__key-value { color: #e9b949; background: color-mix(in srgb, #e9b949 16%, transparent); }

.ct__try {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
}
.ct__try-pad { flex: none; width: 60px; height: 60px; }
.ct__try-ring { fill: var(--color-surface-muted); stroke: var(--color-border); stroke-width: 1.5; }
.ct__try-zone { fill: none; stroke: var(--color-text-secondary); stroke-width: 1; stroke-dasharray: 2 2; opacity: 0.6; }
.ct__try-line { stroke: var(--color-accent); stroke-width: 2; stroke-linecap: round; opacity: 0.6; }
.ct__try-dot { fill: var(--color-text-secondary); }
.ct__try-dot--on { fill: var(--color-accent); }
.ct__try-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ct__try-text strong { font-size: 0.92rem; font-weight: 600; }
.ct__try-text span, .ct__try-read span { font-size: 0.82rem; color: var(--color-text-secondary); }
.ct__try-read { flex: none; min-width: 108px; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-mono, ui-monospace, Menlo, monospace); }
.ct__try-read strong { font-size: 0.95rem; font-weight: 600; }

.ct__modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ct__mode {
  display: flex !important;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px !important;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--color-text-primary) !important;
  background: var(--color-surface) !important;
  border: 1.5px solid var(--color-border) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
}
.ct__mode--on { border-color: var(--color-accent) !important; background: color-mix(in srgb, var(--color-accent) 16%, var(--color-surface)) !important; }
.ct__mode-name { font-size: 1rem; font-weight: 600; }
.ct__mode-hint { font-size: 0.82rem; color: var(--color-text-secondary); white-space: normal; }
.ct__step { font-size: 1.15rem; font-weight: 600; color: var(--color-text-primary) !important; }
.ct__step:hover:not(:disabled) { color: var(--color-text-primary) !important; border-color: var(--color-accent) !important; }
.ct__step:disabled { opacity: 0.4; cursor: default; }
.ct__step-value { flex: none; min-width: 96px; text-align: center; font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: 0.88rem; font-weight: 600; }
.ct__seg { flex: none; display: flex; gap: 3px; padding: 3px; background: var(--color-surface-muted); border: 1px solid var(--color-border); border-radius: 9px; }
.ct__seg-btn {
  padding: 6px 10px !important;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  color: var(--color-text-secondary) !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 6px !important;
  box-shadow: none !important;
}
.ct__seg-btn--on { font-weight: 600; color: #fff !important; background: var(--color-accent) !important; }

.ct__rows { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-small); overflow: hidden; }
.ct__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 7px 10px 7px 14px;
  background: var(--color-surface);
}
.ct__row + .ct__row { border-top: 1px solid var(--color-border); }
.ct__row--wait { background: color-mix(in srgb, #e9b949 10%, var(--color-surface)); }
.ct__n {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  font-size: 0.74rem;
  font-weight: 700;
  color: #fff;
  background: var(--color-accent);
  border-radius: 50%;
}
.ct__row-label { flex: 1 1 auto; min-width: 0; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct__hold {
  flex: none;
  padding: 2px 7px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  color: #e9b949;
  border: 1px solid color-mix(in srgb, #e9b949 55%, transparent);
  border-radius: 999px;
}

.ct__chip {
  flex: none;
  max-width: 46%;
  min-height: 34px;
  padding: 6px 12px !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--color-text-primary) !important;
  background: var(--color-surface-muted) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}
.ct__chip:hover:not(:disabled) { border-color: var(--color-accent) !important; }
.ct__chip:disabled, .ct__x:disabled { cursor: not-allowed; }
.ct__chip--empty { font-family: inherit; font-weight: 400; color: var(--color-text-secondary) !important; border-style: dashed !important; }
.ct__chip--wait {
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  color: #fff !important;
  background: color-mix(in srgb, #e9b949 18%, var(--color-surface-muted)) !important;
  border-color: #e9b949 !important;
  cursor: default;
}
.ct__x {
  flex: none;
  display: grid !important;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0 !important;
  cursor: pointer;
  color: var(--color-text-secondary) !important;
  background: var(--color-surface-muted) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}
.ct__x:hover:not(:disabled) { color: #ff6b6b !important; border-color: #ff6b6b !important; }
.ct__x svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

.ct__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-sm) var(--gap-md);
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}
.ct__foot-hint { flex: 1 1 240px; font-size: 0.88rem; color: var(--color-text-secondary); }
.ct__reset {
  padding: 11px 18px !important;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  color: var(--color-text-primary) !important;
  background: var(--color-surface-muted) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-small) !important;
  box-shadow: none !important;
}
.ct__reset:hover:not(:disabled) { border-color: var(--color-accent) !important; }
.ct__reset:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 720px) {
  .ct__tab { min-width: 0; flex: 1 1 0; }
  .ct__tabs { flex: 1 1 100%; }
}
</style>
