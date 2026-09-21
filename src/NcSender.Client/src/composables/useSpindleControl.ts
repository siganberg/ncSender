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

const RPM_STEP = 1000;
const RPM_FALLBACK_MIN = 1000;
const RPM_FALLBACK_MAX = 24000;

// Presets step in 5000s so the list is short enough to show whole — a
// scrolling popup over the canvas is exactly what this is replacing. The
// machine's own min and max always bookend it, so the extremes are one tap
// away even when they are not round numbers.
const PRESET_STEP = 5000;

export function useSpindleControl() {
  const appStore = useAppStore();

  const spindleRPM = ref(10000);

  const rpmMax = computed(() => appStore.spindleRPMMax.value ?? RPM_FALLBACK_MAX);
  // Never floor the range at 0 — a 0-rpm spindle command is useless for M3/M4.
  const rpmMin = computed(() => Math.max(appStore.spindleRPMMin.value ?? RPM_FALLBACK_MIN, RPM_STEP));

  const rpmPresets = computed(() => {
    const out: number[] = [rpmMin.value];
    const first = Math.ceil(rpmMin.value / PRESET_STEP) * PRESET_STEP;
    for (let v = first; v <= rpmMax.value; v += PRESET_STEP) out.push(v);
    out.push(rpmMax.value);
    return [...new Set(out)].sort((a, b) => a - b);
  });

  const clampRpm = (v: number) => Math.min(rpmMax.value, Math.max(rpmMin.value, v));
  const stepRpm = (delta: number) => {
    // Snap to the increment grid so a preset like 8000 still steps to 9000
    // rather than carrying an offset forever.
    const next = Math.round((spindleRPM.value + delta * RPM_STEP) / RPM_STEP) * RPM_STEP;
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
