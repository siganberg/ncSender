<template>
  <div class="toolbar">
    <div class="toolbar__left">
      <span class="logo">ncSender</span>
      <div class="workspace">Workspace: {{ workspace }}</div>
    </div>
    <div class="toolbar__actions">
      <div class="job-progress">
        <ProgressBar />
      </div>
      <div class="actions-row">
        <button class="ghost">Connect</button>
        <div class="divider" aria-hidden="true"></div>
        <button class="primary">Start</button>
        <button class="ghost" :disabled="jobState !== 'running'">Pause</button>
        <button class="ghost" :disabled="jobState === 'idle'">Stop</button>
        <button class="danger">Emergency Stop</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ProgressBar from './ProgressBar.vue';
defineProps<{
  jobState: 'idle' | 'running' | 'paused';
  workspace: string;
}>();

const emit = defineEmits<{
  (e: 'toggle-theme'): void;
}>();
</script>

<style scoped>
.toolbar {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  padding: var(--gap-sm) var(--gap-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-sm);
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.logo {
  font-weight: 700;
  font-size: 1.25rem;
}

.workspace {
  padding: 4px 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.toolbar__actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--gap-xs);
  min-width: 420px;
}

.job-progress {
  width: 100%;
}

.actions-row {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

button {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 18px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  color: #fff;
  background: var(--gradient-accent);
  box-shadow: 0 8px 16px -12px rgba(26, 188, 156, 0.7);
}

button.ghost {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

button.danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.3));
  color: #fff;
}

.divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 var(--gap-xs);
}

@media (max-width: 959px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar__actions {
    min-width: 0;
  }

  .actions-row { flex-wrap: wrap; justify-content: center; }
}
</style>
