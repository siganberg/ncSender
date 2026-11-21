<!--
  The AutoZeroAir tab of the probe dialog: the moving picture with the step
  list under it, and the choices beside it as buttons and pictures. It owns no
  settings: the dialog keeps and saves them, and starts the probe.
-->
<template>
  <div class="aza-wrap">
  <div class="aza">
    <div class="aza__stagecol">
      <!-- Where the machine is, in one row above the picture. -->
      <div class="aza__pos"><slot name="position"></slot></div>
      <div class="aza__stage">
        <AutoZeroAirFigure
          ref="figure"
          :axis="axis"
          :mode="mode"
          :corner="sitsOn"
          :bit="pictureBit"
          :still="isProbing"
          :probe-active="probeActive"
          :label="tr('pictureLabel')"
          :top-label="tr('topView')"
          @progress="progress = $event"
        />
        <div class="aza__badge" :class="{ 'is-hit': probeActive || progress.touching }">
          <i></i>{{ probeActive || progress.touching ? tr('touching') : tr('ready') }}
        </div>
        <!-- The connection test switch, by the light it is about. -->
        <div class="aza__extras"><slot name="extras"></slot></div>
        <div class="aza__done" :class="{ 'is-on': progress.done }">{{ tr('zeroSet', { what: setsAll }) }}</div>
      </div>
      <ol class="aza__steps">
        <li
          v-for="(step, i) in routine.steps"
          :key="step.key"
          :class="{ 'is-now': i === progress.step, 'is-was': i < progress.step }"
        >
          <b>{{ i + 1 }}</b>
          <span>{{ tr(`steps.${step.key}`) }}</span>
          <em>{{ tr('sets', { what: step.sets }) }}</em>
        </li>
      </ol>
      <p class="aza__about">{{ tr(`lead.${routine.lead}`) }} {{ tr(`end.${routine.end}`) }}</p>
    </div>

    <div class="aza__side">
      <div class="aza__grp">
        <span class="aza__lbl">{{ tr('setZeroFor') }}</span>
        <!-- One track with the accent block sliding to the choice, as the toolbar's units switch. -->
        <div class="aza__seg" role="group" :aria-label="tr('setZeroFor')" :style="{ '--aza-at': AXES.indexOf(axis) }">
          <span class="aza__seg-thumb" aria-hidden="true"></span>
          <button
            v-for="a in AXES"
            :key="a"
            type="button"
            :aria-pressed="axis === a"
            :disabled="isProbing"
            @click="emit('update:axis', a)"
          >{{ a }}</button>
        </div>
      </div>

      <div class="aza__grp">
        <span class="aza__lbl">{{ tr('touch') }}</span>
        <div class="aza__tiles">
          <button type="button" class="aza__tile" :aria-pressed="mode === 'hole'" :disabled="isProbing" @click="emit('update:mode', 'hole')">
            <svg viewBox="0 0 120 54" aria-hidden="true"><rect x="38" y="5" width="44" height="44" rx="5" class="aza__ic-block" /><circle cx="60" cy="27" r="13" class="aza__ic-hole" /><path d="M51 27h18M60 18v18" class="aza__ic-reach" /><circle cx="60" cy="27" r="3.5" class="aza__ic-bit" /></svg>
            <strong>{{ tr('inHole') }}</strong>
            <small>{{ tr('inHoleNote') }}</small>
          </button>
          <button type="button" class="aza__tile" :aria-pressed="mode === 'edge'" :disabled="isProbing" @click="emit('update:mode', 'edge')">
            <svg viewBox="0 0 120 54" aria-hidden="true"><rect x="46" y="5" width="44" height="44" rx="5" class="aza__ic-block" /><circle cx="68" cy="27" r="13" class="aza__ic-hole" /><template v-if="axis === 'Z'"><path d="M50 45v-6h6" class="aza__ic-reach aza__ic-reach--solid" /><circle cx="56" cy="39" r="3.5" class="aza__ic-bit" /></template><template v-else><path d="M37 20h8" class="aza__ic-reach aza__ic-reach--solid" /><circle cx="33" cy="20" r="3.5" class="aza__ic-bit" /></template></svg>
            <strong>{{ tr(axis === 'Z' ? 'onTop' : 'outside') }}</strong>
            <small>{{ tr(axis === 'Z' ? 'onTopNote' : 'outsideNote') }}</small>
          </button>
        </div>
      </div>

      <div v-if="needsBit" class="aza__grp">
        <span class="aza__lbl">{{ tr('bitDiameter') }}</span>
        <!-- The dialog's own bit diameter list: saved sizes, Current Tool, add and remove. -->
        <slot name="bit"></slot>
      </div>

      <div class="aza__grp">
        <span class="aza__lbl">{{ tr('sitsOn') }}</span>
        <div class="aza__whererow">
          <div class="aza__where">
            <button
              v-for="spot in spots"
              :key="spot.key"
              type="button"
              :style="{ left: `${spot.x}%`, top: `${spot.y}%` }"
              :aria-pressed="spot.on"
              :aria-label="tr(`where.${spot.key}`)"
              :disabled="isProbing"
              @click="pick(spot.key)"
            ></button>
          </div>
          <p>{{ tr(`where.${whereKey}`) }}<span>{{ tr(axis === 'X' || axis === 'Y' ? 'tapSide' : 'tapCorner') }}</span></p>
        </div>
      </div>

      <div class="aza__note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <div><b>{{ tr(`start.${routine.start}.title`) }}</b> {{ tr(`start.${routine.start}.text`) }}</div>
      </div>


      <!-- The jog pad under the choices, next to Start. -->
      <div class="aza__jog">
        <slot name="jog"></slot>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AutoZeroAirFigure from './AutoZeroAirFigure.vue';
import { autoZeroAirCorner, buildAutoZeroAirRoutine, type AzaAxis, type AzaMode } from './autozeroair-routine';
import { useAutoZeroAirText } from './autozeroair-text';

const props = defineProps<{
  axis: string;
  mode: AzaMode;
  corner: string | null;
  side: string | null;
  isProbing: boolean;
  probeActive: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:axis', value: string): void;
  (e: 'update:mode', value: AzaMode): void;
  (e: 'update:corner', value: string): void;
  (e: 'update:side', value: string): void;
}>();

const tr = useAutoZeroAirText();
const AXES: AzaAxis[] = ['XYZ', 'XY', 'Z', 'X', 'Y'];
const figure = ref<InstanceType<typeof AutoZeroAirFigure> | null>(null);
const progress = ref({ step: -1, done: false, touching: false });

// The dialog can arrive on an axis this probe has no routine for.
const axis = computed<AzaAxis>(() => (AXES.includes(props.axis as AzaAxis) ? props.axis as AzaAxis : 'XYZ'));
// The picture always shows the same bit, thick enough to read: it is about
// the moves, and the bit diameter chosen only shifts them by a hair.
const pictureBit = 6;
const routine = computed(() => buildAutoZeroAirRoutine(axis.value, props.mode, pictureBit));
const sitsOn = computed(() => autoZeroAirCorner(axis.value, props.corner, props.side));
const needsBit = computed(() => props.mode === 'edge' && axis.value !== 'Z');
const setsAll = computed(() => routine.value.steps.map((s) => s.sets).filter((s) => s !== 'X0 Y0').join(' '));

// Where the probe sits: a corner, or for one axis the side it is against.
const spots = computed(() => {
  if (axis.value === 'X') {
    return [{ key: 'Left', x: 0, y: 100 }, { key: 'Right', x: 100, y: 100 }].map((s) => ({ ...s, on: (props.side ?? 'Left') === s.key }));
  }
  if (axis.value === 'Y') {
    return [{ key: 'Back', x: 0, y: 0 }, { key: 'Front', x: 0, y: 100 }].map((s) => ({ ...s, on: (props.side ?? 'Front') === s.key }));
  }
  return [
    { key: 'TopLeft', x: 0, y: 0 }, { key: 'TopRight', x: 100, y: 0 },
    { key: 'BottomLeft', x: 0, y: 100 }, { key: 'BottomRight', x: 100, y: 100 },
  ].map((s) => ({ ...s, on: sitsOn.value === s.key }));
});
const whereKey = computed(() => spots.value.find((s) => s.on)?.key ?? sitsOn.value);
const pick = (key: string) => {
  if (axis.value === 'X' || axis.value === 'Y') emit('update:side', key);
  else emit('update:corner', key);
};

watch(() => props.isProbing, (now, before) => { if (before && !now) figure.value?.restart(); });
</script>

<style scoped>
.aza-wrap { grid-column: 1 / -1; align-self: stretch; min-width: 0; container-type: inline-size; }
.aza {
  /* At least the height there is; taller content grows it and the dialog scrolls, nothing is cut off. */
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 384px;
  grid-template-areas: "stage side";
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium, 8px);
  overflow: hidden;
  --aza-raised: color-mix(in srgb, var(--color-text-secondary) 16%, var(--color-surface));
  --aza-line: color-mix(in srgb, var(--color-text-secondary) 30%, transparent);
  --aza-ink: #06231d;
}
.aza__stagecol { grid-area: stage; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--color-border); }
/* The picture takes all the height the steps leave. */
.aza__pos { container-type: inline-size; padding: 10px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-muted); }
.aza__stage { position: relative; flex: 1 1 auto; min-height: 280px; }
.aza__badge {
  position: absolute; left: 12px; top: 10px; display: flex; align-items: center; gap: 8px;
  padding: 5px 11px; border-radius: 999px; font-size: 0.78rem; font-weight: 600;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-surface) 84%, transparent);
  border: 1px solid var(--aza-line);
}
.aza__badge i { width: 9px; height: 9px; border-radius: 50%; background: #3ccf63; box-shadow: 0 0 0 3px color-mix(in srgb, #3ccf63 25%, transparent); }
.aza__badge.is-hit i { background: #e45858; box-shadow: 0 0 0 3px color-mix(in srgb, #e45858 30%, transparent); }
.aza__extras {
  position: absolute; right: 12px; top: 8px; display: flex; align-items: center;
  padding: 5px 8px 5px 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface) 84%, transparent);
  border: 1px solid var(--aza-line);
}
.aza__done {
  position: absolute; left: 12px; bottom: 12px; padding: 6px 13px; border-radius: 999px;
  background: var(--color-accent); color: var(--aza-ink); font-size: 0.82rem; font-weight: 700; white-space: nowrap;
  opacity: 0; transition: opacity 0.25s ease; pointer-events: none;
}
.aza__done.is-on { opacity: 1; }

.aza__steps { list-style: none; margin: 0; padding: 10px 12px 8px; display: grid; gap: 4px; }
.aza__steps li {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center;
  padding: 6px 10px; border-radius: 9px; border: 1px solid transparent;
  color: var(--color-text-secondary); font-size: 0.88rem;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.aza__steps b { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--aza-raised); font-size: 0.74rem; }
.aza__steps em { font-style: normal; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap; }
.aza__steps li.is-now { background: color-mix(in srgb, var(--color-accent) 13%, var(--color-surface)); border-color: color-mix(in srgb, var(--color-accent) 38%, transparent); color: var(--color-text-primary); }
.aza__steps li.is-now b { background: var(--color-accent); color: var(--aza-ink); }
.aza__steps li.is-now em { color: var(--color-accent); }
.aza__steps li.is-was b { background: color-mix(in srgb, var(--color-accent) 32%, var(--aza-raised)); color: var(--color-text-primary); }

.aza__side { grid-area: side; min-width: 0; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.aza__about { margin: 0; padding: 0 14px 12px; color: var(--color-text-secondary); font-size: 0.8rem; }
.aza__grp { display: grid; gap: 7px; }
.aza__lbl { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-secondary); }
.aza button { font-family: inherit; color: var(--color-text-primary); cursor: pointer; touch-action: manipulation; }
.aza button:disabled { opacity: 0.45; cursor: default; }
.aza button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

.aza__seg {
  position: relative; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
  height: 46px; padding: 3px; border-radius: 12px; isolation: isolate;
  border: 1px solid var(--aza-line); background: var(--color-surface-muted);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
}
.aza__seg-thumb {
  position: absolute; z-index: 0; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 5);
  border-radius: 9px; background: var(--color-accent); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transform: translateX(calc(var(--aza-at, 0) * 100%));
  transition: transform 0.25s cubic-bezier(0.3, 0.7, 0.3, 1);
}
.aza__seg button {
  position: relative; z-index: 1; border: 0; border-radius: 9px; background: transparent;
  color: var(--color-text-secondary); font-size: 0.95rem; font-weight: 700; transition: color 0.25s ease;
}
.aza__seg button[aria-pressed="true"] { color: var(--aza-ink); }

.aza__tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.aza__tile { display: grid; gap: 3px; align-content: start; text-align: left; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--aza-line); background: var(--aza-raised); }
.aza__tile svg { width: 100%; height: 38px; }
.aza__tile strong { font-size: 0.92rem; }
.aza__tile small { color: var(--color-text-secondary); font-size: 0.76rem; line-height: 1.35; }
.aza__tile[aria-pressed="true"] { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 16%, var(--aza-raised)); box-shadow: inset 0 0 0 1px var(--color-accent); }
.aza__ic-block { fill: color-mix(in srgb, var(--color-text-secondary) 45%, var(--color-surface)); stroke: var(--color-text-secondary); stroke-width: 1.5; }
.aza__ic-hole { fill: var(--color-surface); stroke: var(--color-text-secondary); stroke-width: 1.5; }
.aza__ic-bit { fill: var(--color-accent); }
.aza__ic-reach { fill: none; stroke: var(--color-accent); stroke-width: 1.5; stroke-dasharray: 1 3; stroke-linecap: round; }
.aza__ic-reach--solid { stroke-dasharray: none; }

.aza__whererow { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 8px; align-items: center; }
.aza__where { position: relative; margin: 14px 16px; aspect-ratio: 4 / 3; border-radius: 8px; background: color-mix(in srgb, #c9a06a 80%, #000); border: 1px solid var(--aza-line); }
.aza__where button { position: absolute; width: 28px; height: 28px; padding: 0; border-radius: 50%; transform: translate(-50%, -50%); border: 2px solid rgba(0, 0, 0, 0.45); background: var(--aza-raised); }
.aza__where button[aria-pressed="true"] { background: var(--color-accent); border-color: var(--aza-ink); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 35%, transparent); }
.aza__whererow p { margin: 0; font-size: 0.88rem; font-weight: 600; }
.aza__whererow p span { display: block; font-weight: 400; font-size: 0.78rem; color: var(--color-text-secondary); }

.aza__note { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; padding: 8px 12px; border-radius: 11px; background: var(--color-surface-muted); border: 1px solid var(--color-border); font-size: 0.86rem; color: var(--color-text-secondary); }
.aza__note svg { width: 20px; height: 20px; margin-top: 1px; color: var(--color-accent); }
.aza__note b { color: var(--color-text-primary); }

.aza__jog {
  margin-top: auto; padding-top: 10px; border-top: 1px solid var(--color-border);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}

/* Narrow: one column, the picture before the choices. */
@container (max-width: 760px) {
  .aza { grid-template-columns: minmax(0, 1fr); grid-template-areas: "stage" "side"; }
  .aza__stagecol { border-right: 0; border-bottom: 1px solid var(--color-border); }
  .aza__stage { flex: 0 0 auto; min-height: 0; aspect-ratio: 16 / 10; }
}
@media (prefers-reduced-motion: reduce) { .aza__steps li, .aza__done, .aza__seg-thumb, .aza__seg button { transition: none; } }
</style>
