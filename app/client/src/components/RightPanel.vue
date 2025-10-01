<template>
  <div class="panel-stack">
    <JogPanel
      :jog-config="jogConfig"
      :is-disabled="!status.connected || status.machineState?.toLowerCase() === 'home' || (jobStatus?.isRunning === true)"
      @update:step-size="emit('update:jogStep', $event)"
    />
    <StatusPanel :status="status" />
    <ConsolePanel :lines="consoleLines" :connected="status.connected" @clear="emit('clearConsole')" />
  </div>
</template>

<script setup lang="ts">
import JogPanel from './panels/JogPanel.vue';
import StatusPanel from './panels/StatusPanel.vue';
import ConsolePanel from './panels/ConsolePanel.vue';

const emit = defineEmits<{
  (e: 'update:jogStep', value: number): void;
  (e: 'clearConsole'): void;
}>();

defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    alarms: string[];
    feedRate: number;
    spindleRpm: number;
  };
  consoleLines: Array<{ id: string | number; level: string; message: string; timestamp: string; status?: 'pending' | 'success' | 'error'; type?: 'command' | 'response' }>;
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
  };
  jobStatus?: { isRunning: boolean; currentLine?: number; totalLines?: number } | null;
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
  }

  /* Jog and Status panels in top row adapt to content with min-height */
  .panel-stack > :nth-child(1) {
    /* JogPanel */
    grid-column: 1;
    grid-row: 1;
    min-height: 280px;
  }

  .panel-stack > :nth-child(2) {
    /* StatusPanel */
    grid-column: 2;
    grid-row: 1;
    min-height: 280px;
  }

  .panel-stack > :nth-child(3) {
    /* ConsolePanel - takes remaining space */
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
