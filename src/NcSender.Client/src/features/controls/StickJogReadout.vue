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
  <span class="stick-readout">{{ text }}</span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import { gamepadBindingStore } from './gamepad-binding-store';
import { jogPanelFeed, jogVector, readStick, snapAngle, stickTarget, type StickJogSettings } from './stick-jog';

const READOUT_INTERVAL_MS = 100;

const props = defineProps<{ settings: StickJogSettings }>();
const appStore = useAppStore();
const text = ref('');
let timer: number | null = null;

// What the stick would jog at now: the first gamepad pushed, as jogging reads
// it. Jogging is off while the Controls tab is open.
const update = () => {
  const gamepads = navigator.getGamepads().filter((gp): gp is Gamepad => Boolean(gp));
  if (gamepads.length === 0) {
    text.value = 'No gamepad';
    return;
  }
  const bindings = gamepadBindingStore.getAllBindings();
  let target = null;
  for (const gamepad of gamepads) {
    target = stickTarget(readStick(gamepad, bindings), props.settings.deadZone);
    if (target) break;
  }
  if (!target) {
    text.value = 'Stick centered';
    return;
  }
  const imperial = appStore.unitsPreference.value === 'imperial';
  const { feed } = jogVector(target, props.settings, jogPanelFeed());
  const speed = `${imperial ? feed.toFixed(1) : Math.round(feed)} ${imperial ? 'in/min' : 'mm/min'}`;
  const where = target.kind === 'xy' ? `${snapAngle(target.angle)}°` : `Z ${target.sign > 0 ? 'up' : 'down'}`;
  text.value = `${where} at ${speed}`;
};

onMounted(() => {
  update();
  timer = window.setInterval(update, READOUT_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
});
</script>

<style scoped>
.stick-readout {
  display: inline-block;
  min-width: 12em;
  white-space: pre;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent);
}
</style>
