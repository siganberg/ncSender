
<template>
  <template v-for="(gate, index) in gates" :key="gate.gateId">
    <Dialog
      :show-header="false"
      size="small"
      max-width="min(660px, 94vw)"
      :close-on-backdrop-click="false"
      :z-index="10050 + index"
    >
      <WorkOffsetGate v-if="gate.data?.kind === 'work-offset'" :gate="gate" @respond="onRespond" />
      <UnhomedGate v-else-if="gate.data?.kind === 'unhomed'" :gate="gate" @respond="onRespond" />
      <StepGate v-else-if="gate.data?.kind === 'steps'" :gate="gate" @respond="onRespond" @fire-step="onFireStep" />
      <GatePanel v-else :gate="gate" @respond="onRespond" @fire-step="onFireStep" />
    </Dialog>
  </template>
</template>

<script setup lang="ts">
import Dialog from './Dialog.vue';
import GatePanel from './GatePanel.vue';
import StepGate from './StepGate.vue';
import UnhomedGate from './UnhomedGate.vue';
import WorkOffsetGate from './WorkOffsetGate.vue';
import { useGateDialog } from '../composables/useGateDialog';

const { gates, respond, fireStep } = useGateDialog();

function onRespond(gateId: string, value: string): void { respond(gateId, value); }
function onFireStep(gateId: string, stepIndex: number): void { fireStep(gateId, stepIndex); }
</script>
