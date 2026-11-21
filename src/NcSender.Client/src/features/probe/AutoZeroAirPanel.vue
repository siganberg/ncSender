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
        <!-- The probe only senses the bit through its magnet lead. -->
        <div class="aza__foot">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15V9a6 6 0 0 1 12 0v6"/><path d="M4 15h4v5H4zM16 15h4v5h-4z"/></svg>
          {{ tr('magnet') }}
        </div>
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

// The dialog passes every picture panel the same props: those that are not this one's are dropped.
defineOptions({ inheritAttrs: false });

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

<style src="./probe-panel.css"></style>
