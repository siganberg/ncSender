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
  <div class="panel-stack">
    <JogPanel
      :jog-config="jogConfig"
      :is-disabled="isJogDisabled"
      :machine-coords="status.machineCoords"
      :grid-size-x="gridSizeX"
      :grid-size-y="gridSizeY"
      :z-max-travel="zMaxTravel"
      :machine-orientation="machineOrientation"
      @update:step-size="emit('update:jogStep', $event)"
      @update:feed-rate="emit('update:jogFeedRate', $event)"
    />
    <StatusPanel :status="status" />
    <ConsolePanel
      :lines="consoleLines"
      :connected="status.connected"
      :sender-status="senderStatus"
      @clear="emit('clearConsole')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import JogPanel from '../features/jog/JogPanel.vue';
import StatusPanel from '../features/status/StatusPanel.vue';
import ConsolePanel from '../features/console/ConsolePanel.vue';

const emit = defineEmits<{
  (e: 'update:jogStep', value: number): void;
  (e: 'clearConsole'): void;
  (e: 'update:jogFeedRate', value: number): void;
}>();

type AxisHome = 'min' | 'max';
type MachineOrientation = {
  xHome: AxisHome;
  yHome: AxisHome;
  zHome: AxisHome;
  homeCorner: 'front-left' | 'front-right' | 'back-left' | 'back-right';
};

const props = defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    alarms: string[];
    feedRate: number;
    spindleRpmTarget: number;
    spindleRpmActual: number;
  };
  consoleLines: Array<{ id: string | number; level: string; message: string; timestamp: string; status?: 'pending' | 'success' | 'error'; type?: 'command' | 'response'; sourceId?: string }>;
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
    feedRate?: number;
  };
  jobLoaded?: { filename: string; currentLine: number; totalLines: number; status: 'running' | 'paused' | 'stopped' } | null;
  gridSizeX?: number;
  gridSizeY?: number;
  zMaxTravel?: number | null;
  senderStatus?: string;
  machineOrientation?: MachineOrientation;
}>();

const normalizedSenderStatus = computed(() => (props.senderStatus || '').toLowerCase());

const isJogDisabled = computed(() => {
  if (!props.status.connected) return true;
  if (props.jobLoaded?.status === 'running') return true;

  const status = normalizedSenderStatus.value;
  // Note: 'alarm' is NOT included here - Home button must be clickable to fix alarms
  // Motion controls are disabled in alarm state via motionControlsDisabled in JogPanel
  return status === 'homing' || status === 'probing' || status === 'tool-changing';
});
</script>

<style scoped>
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  overflow-y: auto;
  min-height: 0;
}

/* Give Console more space by making other panels fixed size */
.panel-stack > :nth-child(1) {
  /* JogPanel - fixed size */
  flex: 0 0 auto;
}

.panel-stack > :nth-child(2) {
  /* StatusPanel - fixed size */
  flex: 0 0 auto;
}

.panel-stack > :nth-child(3) {
  /* ConsolePanel - let it take remaining space */
  flex: 1;
  min-height: 0;
}

@media (max-width: 1279px) {
  .panel-stack {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: var(--gap-sm);
    overflow-y: auto;
    min-height: 0;
    height: 100%;
    align-items: stretch; /* ensure items stretch to row height */
  }

  /* In portrait, give Jog slightly more width than Status */
  @media (orientation: portrait) {
    .panel-stack {
      grid-template-columns: 5fr 4fr; /* gentle 55/45 split */
    }
  }

  /* Jog and Status panels in top row adapt to content with min-height */
  .panel-stack > :nth-child(1) {
    /* JogPanel */
    grid-column: 1;
    grid-row: 1;
    min-height: 280px;
    height: 100%;
  }

  .panel-stack > :nth-child(2) {
    /* StatusPanel */
    grid-column: 2;
    grid-row: 1;
    min-height: 280px;
    height: 100%;
  }

  .panel-stack > :nth-child(3) {
    /* ConsolePanel - takes remaining space */
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
