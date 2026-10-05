import { computed, ref, watch } from 'vue';
import { useAppStore } from './use-app-store';
import { api } from '../lib/api.js';

// Spindle run controls for the visualizer's Spindle panel.
//
// That panel shows the spindle override while a program runs, which is the
// only time an override means anything. The rest of the time the space was
// dead, so it becomes the spindle control instead — the rpm value it is
// already showing is the one you want to set.
//
// The stepper is +/- in fixed increments with a tap on the value for a
// preset list. On a touchscreen a native <select> is a poor target and
// opens an OS picker over the canvas; stepping covers the common nudge and
// the presets cover the big jumps.
//
// Laser mode is Pro-only, so there is no test-fire half here.

const RPM_FALLBACK_MIN = 0;
const RPM_FALLBACK_MAX = 24000;

// Spindles range from a few thousand rpm (high-torque) to 50k+ (high-speed),
// so the increments scale with the machine's $31..$30 range instead of being
// fixed. The preset spacing starts at the round number that splits the range
// into about five and tightens until there are at least six presets, so the
// list stays short enough to show whole — a scrolling popup over the canvas is
// exactly what this is replacing — but is never too sparse to be useful. The
// +/- step is a fifth of the preset spacing. A 0-24000 router gets presets
// every 5000 and a 1000 step.
const PRESETS_ACROSS_RANGE = 5;
const MIN_PRESETS = 6;
const STEPS_PER_PRESET = 5;
const NICE_MANTISSAS = [1, 2, 2.5, 5];

// Smallest whole 1/2/2.5/5 x 10^n at or above the value, so increments stay round.
const roundUpToNiceNumber = (value: number) => {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const nice = [...NICE_MANTISSAS, 10].map((m) => m * magnitude).find((n) => n >= value && Number.isInteger(n));
  return nice ?? 10 * magnitude;
};

// The next whole 1/2/2.5/5 x 10^n below the value, or the value itself at 1.
const nextSmallerNiceNumber = (value: number) => {
  for (let magnitude = 10 ** Math.floor(Math.log10(value)); magnitude >= 1; magnitude /= 10) {
    const smaller = [...NICE_MANTISSAS].reverse().map((m) => m * magnitude)
      .find((n) => n < value && Number.isInteger(n));
    if (smaller) return smaller;
  }
  return value;
};

const planPresets = (configuredMin: number, max: number) => {
  let presetStep = roundUpToNiceNumber((max - configuredMin) / PRESETS_ACROSS_RANGE);
  for (;;) {
    const rpmStep = roundUpToNiceNumber(presetStep / STEPS_PER_PRESET);
    // Never floor the range at 0 — a 0-rpm spindle command is useless for M3/M4.
    const min = Math.min(configuredMin > 0 ? configuredMin : rpmStep, max);
    // The machine's own min and max always bookend the list, so the extremes
    // are one tap away even when they are not round numbers.
    const presets = new Set([min, max]);
    for (let v = Math.ceil(min / presetStep) * presetStep; v <= max; v += presetStep) presets.add(v);
    const smaller = nextSmallerNiceNumber(presetStep);
    if (presets.size >= MIN_PRESETS || smaller === presetStep) {
      return { min, rpmStep, presets: [...presets].sort((a, b) => a - b) };
    }
    presetStep = smaller;
  }
};

export function useSpindleControl() {
  const appStore = useAppStore();

  const spindleRPM = ref(10000);

  const rpmMax = computed(() => appStore.spindleRPMMax.value ?? RPM_FALLBACK_MAX);
  const plan = computed(() => planPresets(appStore.spindleRPMMin.value ?? RPM_FALLBACK_MIN, rpmMax.value));
  const rpmMin = computed(() => plan.value.min);
  const rpmStep = computed(() => plan.value.rpmStep);
  const rpmPresets = computed(() => plan.value.presets);

  const clampRpm = (v: number) => Math.min(rpmMax.value, Math.max(rpmMin.value, v));
  const stepRpm = (delta: number) => {
    // Snap to the increment grid so a preset like 8000 still steps to 9000
    // rather than carrying an offset forever.
    const step = rpmStep.value;
    const next = Math.round((spindleRPM.value + delta * step) / step) * step;
    spindleRPM.value = clampRpm(next);
  };
  const canStepRpmDown = computed(() => spindleRPM.value > rpmMin.value);
  const canStepRpmUp = computed(() => spindleRPM.value < rpmMax.value);

  // Keep the selection inside the machine's range once $30/$31 arrive — a
  // stale 10000 against a $30 of 8000 would otherwise sit there unreachable.
  watch([rpmMin, rpmMax], () => { spindleRPM.value = clampRpm(spindleRPM.value); }, { immediate: true });

  const send = (command: string) =>
    api.sendCommandViaWebSocket({ command, displayCommand: command, meta: { sourceId: 'client' } });

  // Which way it was last started, so a speed change while running keeps
  // turning the same direction instead of silently reversing.
  const lastDirection = ref<'cw' | 'ccw'>('cw');

  const sendSpindleCW = () => { lastDirection.value = 'cw'; send(`M3 S${spindleRPM.value}`); };
  const sendSpindleCCW = () => { lastDirection.value = 'ccw'; send(`M4 S${spindleRPM.value}`); };
  const sendSpindleStop = () => send('M5');

  // Re-issue at the new speed. Only called while the spindle is actually
  // turning — when it is off, stepping just changes what CW/CCW will use.
  const resendAtCurrentSpeed = () =>
    send(`${lastDirection.value === 'cw' ? 'M3' : 'M4'} S${spindleRPM.value}`);

  // Is the spindle actually turning? Drives the panel's swap to a Stop
  // button, so it reads the reported state rather than what we last sent.
  const isSpindleTurning = computed(() =>
    (appStore.status.spindleRpmActual ?? 0) > 0 || appStore.status.spindleActive === true
  );

  return {
    spindleRPM, rpmPresets, stepRpm, canStepRpmDown, canStepRpmUp,
    sendSpindleCW, sendSpindleCCW, sendSpindleStop, isSpindleTurning,
    resendAtCurrentSpeed,
  };
}
