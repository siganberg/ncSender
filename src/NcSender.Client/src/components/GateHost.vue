
<template>
  <template v-for="(gate, index) in gates" :key="gate.gateId">
    <Dialog
      :show-header="false"
      size="small"
      :close-on-backdrop-click="false"
      :z-index="10050 + index"
    >
      <GatePanel :gate="gate" @respond="onRespond" @fire-step="onFireStep" />
    </Dialog>
  </template>
</template>

<script setup lang="ts">
import Dialog from './Dialog.vue';
import GatePanel from './GatePanel.vue';
import { useGateDialog } from '../composables/useGateDialog';

const { gates, respond, fireStep } = useGateDialog();

function onRespond(gateId: string, value: string): void { respond(gateId, value); }
function onFireStep(gateId: string, stepIndex: number): void { fireStep(gateId, stepIndex); }
</script>
