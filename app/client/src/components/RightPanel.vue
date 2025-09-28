<template>
  <div class="panel-stack">
    <JogPanel 
      :jog-config="jogConfig" 
      :is-disabled="!status.connected || status.machineState?.toLowerCase() === 'home'" 
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
    grid-template-rows: 1fr 1fr;
    gap: var(--gap-sm);
    overflow-y: auto;
    min-height: 0;
    height: 100%;
  }

  .panel-stack > :nth-child(3) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
