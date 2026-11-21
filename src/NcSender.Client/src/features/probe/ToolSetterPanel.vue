<!--
  The Tool Length Setter tab of the probe dialog: the moving picture with the
  step list under it, and the setter's settings beside it. It owns no settings:
  the dialog keeps and saves them, supplies the fields (#fields) and starts the
  probe.
-->
<template>
  <div class="aza-wrap">
  <div class="aza">
    <div class="aza__stagecol">
      <!-- Where the machine is, in one row above the picture. -->
      <div class="aza__pos"><slot name="position"></slot></div>
      <div class="aza__stage">
        <ToolSetterFigure
          ref="figure"
          :bit="pictureBit"
          :still="isProbing"
          :probe-active="probeActive"
          :label="tr('pictureLabel')"
          @progress="progress = $event"
        />
        <div class="aza__badge" :class="{ 'is-hit': probeActive || progress.touching }">
          <i></i>{{ probeActive || progress.touching ? tr('touching') : tr('ready') }}
        </div>
        <!-- The connection test switch, by the light it is about. -->
        <div class="aza__extras"><slot name="extras"></slot></div>
        <div class="aza__done" :class="{ 'is-on': progress.done }">{{ tr('zeroSet', { what: 'Z' }) }}</div>
      </div>
      <ol class="aza__steps">
        <li
          v-for="(step, i) in routine.steps"
          :key="step.key"
          :class="{ 'is-now': i === progress.step, 'is-was': i < progress.step }"
        >
          <b>{{ i + 1 }}</b>
          <span>{{ tr(`steps.${step.key}`) }}</span>
          <em v-if="step.sets">{{ tr('sets', { what: step.sets }) }}</em>
        </li>
      </ol>
      <p class="aza__about">{{ tr('about') }}</p>
    </div>

    <div class="aza__side">
      <!-- The dialog's own fields for the setter: its height and how it is touched. -->
      <div class="aza__fields"><slot name="fields"></slot></div>

      <div class="aza__note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <div><b>{{ tr('start.title') }}</b> {{ tr('start.text') }}</div>
      </div>

      <!-- The jog pad under the settings, next to Start. -->
      <div class="aza__jog">
        <slot name="jog"></slot>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import ToolSetterFigure from './ToolSetterFigure.vue';
import { buildToolSetterRoutine } from './toolsetter-routine';
import { useToolSetterText } from './toolsetter-text';

const props = defineProps<{
  isProbing: boolean;
  probeActive: boolean;
}>();

// The dialog passes every picture panel the same props: those that are not this one's are dropped.
defineOptions({ inheritAttrs: false });

const tr = useToolSetterText();
const figure = ref<InstanceType<typeof ToolSetterFigure> | null>(null);
const progress = ref({ step: -1, done: false, touching: false });
// The picture always shows the same bit, thick enough to read.
const pictureBit = 6;
const routine = buildToolSetterRoutine();

watch(() => props.isProbing, (now, before) => { if (before && !now) figure.value?.restart(); });
</script>

<style src="./probe-panel.css"></style>
