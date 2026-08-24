
<template>
  <template v-for="(gate, index) in gates" :key="gate.gateId">
    <Dialog
      :show-header="false"
      size="small"
      :close-on-backdrop-click="false"
      :z-index="10050 + index"
    >
      <div class="gate-panel" :class="`gate-panel--${gate.variant || 'info'}`">
        <h3 class="gate-panel__title">{{ gate.title }}</h3>
        <p v-if="gate.message" class="gate-panel__message">{{ gate.message }}</p>
        <div class="gate-panel__actions">
          <button
            v-for="btn in gate.buttons"
            :key="btn.value"
            :class="['gate-panel__btn', styleClass(btn)]"
            @click="respond(gate.gateId, btn.value)"
          >
            {{ btn.label }}
          </button>
        </div>
      </div>
    </Dialog>
  </template>
</template>

<script setup lang="ts">
import Dialog from './Dialog.vue';
import { useGateDialog, type GateButton } from '../composables/useGateDialog';

const { gates, respond } = useGateDialog();

function styleClass(btn: GateButton): string {
  switch (btn.style) {
    case 'danger':  return 'gate-panel__btn--danger';
    case 'primary': return 'gate-panel__btn--primary';
    default:        return 'gate-panel__btn--secondary';
  }
}
</script>

<style scoped>
.gate-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
}

.gate-panel__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.gate-panel__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.gate-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sm);
  justify-content: center;
  margin-top: var(--gap-sm);
}

.gate-panel__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.gate-panel__btn--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.gate-panel__btn--secondary:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.gate-panel__btn--primary {
  background: var(--gradient-accent);
  color: #fff;
}

.gate-panel__btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(26, 188, 156, 0.25);
}

.gate-panel__btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}

.gate-panel__btn--danger:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}
</style>
