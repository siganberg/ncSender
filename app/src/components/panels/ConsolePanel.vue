<template>
  <section class="card">
    <header class="card__header">
      <h2>Console</h2>
      <div class="filters">
        <button class="chip">All</button>
        <button class="chip">Info</button>
        <button class="chip">Warnings</button>
      </div>
    </header>
    <div class="console-output" role="log" aria-live="polite">
      <article
        v-for="line in lines"
        :key="line.id"
        :class="['console-line', `console-line--${line.level}`]"
      >
        <span class="time">{{ line.timestamp }}</span>
        <span class="message">{{ line.message }}</span>
      </article>
    </div>
    <form class="console-input" @submit.prevent>
      <input type="text" placeholder="Send command" />
      <button type="submit" class="primary">Send</button>
    </form>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  lines?: Array<{ id: number; level: string; message: string; timestamp: string }>;
}>(), {
  lines: () => []
});
</script>

<style scoped>
.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 240px;
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h2 {
  margin: 0;
}

.filters {
  display: flex;
  gap: var(--gap-xs);
}

.chip {
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.console-output {
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  padding: var(--gap-xs);
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
}

.console-line {
  background: var(--color-surface);
  border-radius: var(--radius-small);
  padding: 8px 12px;
  display: flex;
  gap: var(--gap-xs);
  border-left: 4px solid transparent;
}

.console-line--warning {
  border-color: #f7b731;
}

.console-line--error {
  border-color: #ff6b6b;
}

.time {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  min-width: 64px;
}

.message {
  flex: 1;
}

.console-input {
  display: flex;
  gap: var(--gap-xs);
}

.console-input input {
  flex: 1;
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  padding: 12px;
  font-size: 0.95rem;
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.console-input .primary {
  border: none;
  border-radius: var(--radius-small);
  padding: 12px 18px;
  cursor: pointer;
  background: var(--gradient-accent);
  color: #fff;
}
</style>
