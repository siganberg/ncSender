<!--
  The 3D Probe tab of the probe dialog: the moving picture with the step list
  under it, and the choices beside it. It owns no settings: the dialog keeps
  and saves them, supplies the fields (#fields) and starts the probe.
-->
<template>
  <div class="aza-wrap">
  <div class="aza">
    <div class="aza__stagecol">
      <div class="aza__pos"><slot name="position"></slot></div>
      <div class="aza__stage">
        <Probe3dFigure
          ref="figure"
          :axis="axis"
          :corner="corner ?? 'BottomLeft'"
          :side="side"
          :center-axes="centerAxes"
          :probe-z-first="probeZFirst"
          :still="isProbing"
          :probe-active="probeActive"
          :label="tr('pictureLabel')"
          :top-label="shared('topView')"
          @progress="progress = $event"
        />
        <div class="aza__badge" :class="{ 'is-hit': probeActive || progress.touching }">
          <i></i>{{ probeActive || progress.touching ? shared('touching') : shared('ready') }}
        </div>
        <div class="aza__extras"><slot name="extras"></slot></div>
        <div class="aza__done" :class="{ 'is-on': progress.done }">{{ measureOnly ? tr('measured', { what: setsAll }) : shared('zeroSet', { what: setsAll }) }}</div>
      </div>
      <ol class="aza__steps">
        <li
          v-for="(step, i) in routine.steps"
          :key="step.key"
          :class="{ 'is-now': i === progress.step, 'is-was': i < progress.step }"
        >
          <b>{{ i + 1 }}</b>
          <span>{{ tr(`steps.${step.key}`) }}</span>
          <em>{{ measureOnly ? tr('finds', { what: step.sets }) : shared('sets', { what: step.sets }) }}</em>
        </li>
      </ol>
      <p class="aza__about"><b>{{ tr(`start.${routine.start}`) }}</b> {{ tr(`end.${routine.end}`) }}</p>
    </div>

    <div class="aza__side">
      <div class="aza__grp">
        <span class="aza__lbl">{{ shared('setZeroFor') }}</span>
        <!-- One track with the accent block sliding to the choice; no block while a Center probe is chosen. -->
        <div class="aza__seg" :class="{ 'is-none': edgeIndex < 0 }" role="group" :aria-label="shared('setZeroFor')" :style="{ '--aza-at': Math.max(0, edgeIndex) }">
          <span class="aza__seg-thumb" aria-hidden="true"></span>
          <button
            v-for="a in EDGES"
            :key="a"
            type="button"
            :aria-pressed="axis === a"
            :disabled="isProbing"
            @click="emit('update:axis', a)"
          >{{ a }}</button>
        </div>
      </div>

      <div class="aza__grp">
        <span class="aza__lbl">{{ tr('findCenter') }}</span>
        <div class="aza__tiles">
          <button type="button" class="aza__tile aza__tile--row" :aria-pressed="axis === 'Center - Inner'" :disabled="isProbing" @click="emit('update:axis', 'Center - Inner')">
            <svg viewBox="0 0 44 44" aria-hidden="true"><rect x="3" y="3" width="38" height="38" rx="5" class="aza__ic-block" /><rect x="11" y="13" width="22" height="18" rx="2" class="aza__ic-hole" /><path d="M14 22h16M22 16v12" class="aza__ic-reach" /><circle cx="22" cy="22" r="3" class="aza__ic-bit" /></svg>
            <strong>{{ tr('inner') }}</strong>
          </button>
          <button type="button" class="aza__tile aza__tile--row" :aria-pressed="axis === 'Center - Outer'" :disabled="isProbing" @click="emit('update:axis', 'Center - Outer')">
            <svg viewBox="0 0 44 44" aria-hidden="true"><rect x="11" y="13" width="22" height="18" rx="2" class="aza__ic-block" /><path d="M3 22h8M33 22h8M22 5v8M22 31v8" class="aza__ic-reach aza__ic-reach--solid" /><circle cx="22" cy="22" r="3" class="aza__ic-bit" /></svg>
            <strong>{{ tr('outer') }}</strong>
          </button>
        </div>
      </div>

      <!-- The dialog's own fields for this probe: sizes, offsets and switches. -->
      <div class="aza__fields"><slot name="fields"></slot></div>

      <div v-if="spots.length" class="aza__grp">
        <span class="aza__lbl">{{ tr(axis === 'X' || axis === 'Y' ? 'whereSide' : 'whereCorner') }}</span>
        <div class="aza__whererow">
          <div class="aza__where">
            <button
              v-for="spot in spots"
              :key="spot.key"
              type="button"
              :style="{ left: `${spot.x}%`, top: `${spot.y}%` }"
              :aria-pressed="spot.on"
              :aria-label="shared(`where.${spot.key}`)"
              :disabled="isProbing"
              @click="pick(spot.key)"
            ></button>
          </div>
          <p>{{ shared(`where.${whereKey}`) }}<span>{{ tr(axis === 'X' || axis === 'Y' ? 'tapSide' : 'tapCorner') }}</span></p>
        </div>
      </div>

      <div class="aza__jog">
        <slot name="jog"></slot>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Probe3dFigure from './Probe3dFigure.vue';
import { buildProbe3dRoutine, isProbe3dAxis, type P3dAxis } from './probe3d-routine';
import { useAutoZeroAirText } from './autozeroair-text';
import { useProbe3dText } from './probe3d-text';

// The dialog passes every picture panel the same props: those that are not this one's are dropped.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  axis: string;
  corner: string | null;
  side: string | null;
  centerAxes?: string;
  probeZFirst?: boolean;
  measureOnly?: boolean;
  isProbing: boolean;
  probeActive: boolean;
}>(), { centerAxes: 'XY', probeZFirst: false, measureOnly: false });

const emit = defineEmits<{
  (e: 'update:axis', value: string): void;
  (e: 'update:corner', value: string): void;
  (e: 'update:side', value: string): void;
}>();

const tr = useProbe3dText();
// What reads the same on the AutoZeroAir tab is written once, there.
const shared = useAutoZeroAirText();
const EDGES: P3dAxis[] = ['XYZ', 'XY', 'Z', 'X', 'Y'];
const figure = ref<InstanceType<typeof Probe3dFigure> | null>(null);
const progress = ref({ step: -1, done: false, touching: false });

const axis = computed<P3dAxis>(() => (isProbe3dAxis(props.axis) ? props.axis : 'XYZ'));
const edgeIndex = computed(() => EDGES.indexOf(axis.value));
const routine = computed(() => buildProbe3dRoutine(axis.value, props.centerAxes, props.probeZFirst));
const setsAll = computed(() => {
  const all = routine.value.steps.map((s) => s.sets).filter((s) => !s.includes('0'));
  return all.join(' ');
});

// Which corner, or for one axis which side, is probed.
const spots = computed(() => {
  if (axis.value === 'X') {
    return [{ key: 'Left', x: 0, y: 50 }, { key: 'Right', x: 100, y: 50 }].map((s) => ({ ...s, on: (props.side ?? 'Left') === s.key }));
  }
  if (axis.value === 'Y') {
    return [{ key: 'Back', x: 50, y: 0 }, { key: 'Front', x: 50, y: 100 }].map((s) => ({ ...s, on: (props.side ?? 'Front') === s.key }));
  }
  if (axis.value === 'XYZ' || axis.value === 'XY') {
    return [
      { key: 'TopLeft', x: 0, y: 0 }, { key: 'TopRight', x: 100, y: 0 },
      { key: 'BottomLeft', x: 0, y: 100 }, { key: 'BottomRight', x: 100, y: 100 },
    ].map((s) => ({ ...s, on: (props.corner ?? 'BottomLeft') === s.key }));
  }
  return [];
});
const whereKey = computed(() => spots.value.find((s) => s.on)?.key ?? 'BottomLeft');
const pick = (key: string) => {
  if (axis.value === 'X' || axis.value === 'Y') emit('update:side', key);
  else emit('update:corner', key);
};

watch(() => props.isProbing, (now, before) => { if (before && !now) figure.value?.restart(); });
</script>

<style src="./probe-panel.css"></style>
