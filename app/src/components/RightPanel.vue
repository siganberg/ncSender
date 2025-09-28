<template>
  <div class="panel-stack">
    <JogPanel :jog-config="jogConfig" />
    <StatusPanel :status="status" />
    <ConsolePanel :lines="consoleLines" />
  </div>
</template>

<script setup lang="ts">
import JogPanel from './panels/JogPanel.vue';
import StatusPanel from './panels/StatusPanel.vue';
import ConsolePanel from './panels/ConsolePanel.vue';

defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    alarms: string[];
    feedRate: number;
    spindleRpm: number;
  };
  consoleLines: Array<{ id: number; level: string; message: string; timestamp: string }>;
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
  };
}>();
</script>

<style scoped>
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: 1279px) {
  .panel-stack {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: var(--gap-sm);
    overflow-y: auto;
    min-height: 0;
  }
  
  .panel-stack > :nth-child(3) {
    grid-column: 1 / -1;
  }
}
</style>
