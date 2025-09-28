<template>
  <section class="card">
    <header class="card__header">
      <h2>Status</h2>
      <span class="badge" :class="status.connected ? 'badge--online' : 'badge--offline'">
        {{ status.connected ? 'Connected' : 'Disconnected' }}
      </span>
    </header>
    <div class="coords">
      <div>
        <h3>Machine</h3>
        <ul>
          <li v-for="(value, axis) in status.machineCoords" :key="axis">
            <span>{{ axis.toUpperCase() }}</span>
            <span>{{ value.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
      <div>
        <h3>Work Offset</h3>
        <ul>
          <li v-for="(value, axis) in status.workCoords" :key="axis">
            <span>{{ axis.toUpperCase() }}</span>
            <span>{{ value.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
    </div>
    <div class="metrics">
      <div>
        <span class="label">Feed</span>
        <span class="value">{{ status.feedRate }} mm/min</span>
      </div>
      <div>
        <span class="label">Spindle</span>
        <span class="value">{{ status.spindleRpm }} rpm</span>
      </div>
    </div>
    <div v-if="status.alarms.length" class="alarms">
      <h3>Alarms</h3>
      <ul>
        <li v-for="alarm in status.alarms" :key="alarm">{{ alarm }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    alarms: string[];
    feedRate: number;
    spindleRpm: number;
  };
}>();
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
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h2, h3 {
  margin: 0;
}

.coords {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap-sm);
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

li {
  display: flex;
  justify-content: space-between;
  background: var(--color-surface-muted);
  padding: 8px 12px;
  border-radius: var(--radius-small);
}

.metrics {
  display: flex;
  gap: var(--gap-sm);
}

.metrics > div {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
}

.label {
  display: block;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.value {
  font-size: 1.1rem;
  font-weight: 600;
}

.badge {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
}

.badge--online {
  background: rgba(26, 188, 156, 0.15);
  color: var(--color-accent);
}

.badge--offline {
  background: rgba(255, 107, 107, 0.15);
  color: #ff6b6b;
}

.alarms {
  border-top: 1px solid var(--color-border);
  padding-top: var(--gap-xs);
}

@media (max-width: 959px) {
  .metrics {
    flex-direction: column;
  }
}
</style>
