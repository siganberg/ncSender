<!--
  The Standard Block tab of the probe dialog: the moving picture with the step
  list under it, and the choices beside it. It owns no settings: the dialog
  keeps and saves them, supplies the bit list (#bit) and the block's sizes
  (#fields), and starts the probe.
-->
<template>
  <div class="aza-wrap">
  <div class="aza">
    <div class="aza__stagecol">
      <!-- Where the machine is, in one row above the picture. -->
      <div class="aza__pos"><slot name="position"></slot></div>
      <div class="aza__stage">
        <StandardBlockFigure
          ref="figure"
          :axis="axis"
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

      <div v-if="needsBit" class="aza__grp">
        <span class="aza__lbl">{{ tr('bitDiameter') }}</span>
        <!-- The dialog's own bit diameter list: saved sizes, Current Tool, add and remove. -->
        <slot name="bit"></slot>
      </div>

      <!-- The dialog's own fields for this block: its thicknesses and the distances the routine uses. -->
      <div class="aza__fields"><slot name="fields"></slot></div>

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
import StandardBlockFigure from './StandardBlockFigure.vue';
import { buildStandardBlockRoutine, standardBlockCorner, type SbAxis } from './standardblock-routine';
import { useStandardBlockText } from './standardblock-text';

const props = defineProps<{
  axis: string;
  corner: string | null;
  side: string | null;
  isProbing: boolean;
  probeActive: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:axis', value: string): void;
  (e: 'update:corner', value: string): void;
  (e: 'update:side', value: string): void;
}>();

// The dialog passes every picture panel the same props: those that are not this one's are dropped.
defineOptions({ inheritAttrs: false });

const tr = useStandardBlockText();
const AXES: SbAxis[] = ['XYZ', 'XY', 'Z', 'X', 'Y'];
const figure = ref<InstanceType<typeof StandardBlockFigure> | null>(null);
const progress = ref({ step: -1, done: false, touching: false });

// The dialog can arrive on an axis this block has no routine for.
const axis = computed<SbAxis>(() => (AXES.includes(props.axis as SbAxis) ? props.axis as SbAxis : 'XYZ'));
// The picture always shows the same bit, thick enough to read: it is about
// the moves, and the bit diameter chosen only shifts them by a hair.
const pictureBit = 6;
const routine = computed(() => buildStandardBlockRoutine(axis.value, pictureBit));
const sitsOn = computed(() => standardBlockCorner(axis.value, props.corner, props.side));
const needsBit = computed(() => axis.value !== 'Z');
const setsAll = computed(() => routine.value.steps.map((s) => s.sets).filter((s) => s !== 'X0 Y0').join(' '));

// Where the block sits: a corner, or for one axis the side it is against.
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
