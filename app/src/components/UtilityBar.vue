<template>
  <div class="utility">
    <div class="status">
      <span class="indicator" :class="connected ? 'online' : 'offline'"></span>
      <span>{{ connected ? 'Machine Connected' : 'Machine Disconnected' }}</span>
    </div>
    <div class="spacer"></div>
    <ThemeToggle
      :theme="theme"
      @toggle-theme="$emit('toggle-theme')"
    />
  </div>
</template>

<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue';

defineProps<{
  connected: boolean;
  theme: 'light' | 'dark';
}>();

defineEmits<{
  (e: 'toggle-theme'): void;
}>();
</script>

<style scoped>
.utility {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  padding: 12px var(--gap-md);
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ff6b6b;
}

.indicator.online {
  background: var(--color-accent);
}

.indicator.offline {
  background: #ff6b6b;
}

.spacer {
  flex: 1;
}

.ghost {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 18px;
  background: var(--color-surface-muted);
  cursor: pointer;
}

@media (max-width: 959px) {
  .utility {
    flex-direction: column;
    align-items: stretch;
  }

  .spacer {
    display: none;
  }
}
</style>
