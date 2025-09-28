<template>
  <section class="card">
    <header class="card__header">
      <h2>Jog Controls</h2>
      <div class="step-selector">
        <span>Step</span>
        <button
          v-for="value in jogConfig.stepOptions"
          :key="value"
          :class="['chip', { active: value === jogConfig.stepSize }]"
        >
          {{ value }}
        </button>
      </div>
    </header>
    <div class="jog-layout">
      <!-- XY Joystick Layout -->
      <div class="xy-joystick">
        <!-- Top Row -->
        <button class="control corner" aria-label="Jog X negative Y positive">↖</button>
        <button class="control axis" aria-label="Jog Y positive">Y+</button>
        <button class="control corner" aria-label="Jog X positive Y positive">↗</button>
        
        <!-- Middle Row -->
        <button class="control axis" aria-label="Jog X negative">X-</button>
        <div class="center-indicator"></div>
        <button class="control axis" aria-label="Jog X positive">X+</button>
        
        <!-- Bottom Row -->
        <button class="control corner" aria-label="Jog X negative Y negative">↙</button>
        <button class="control axis" aria-label="Jog Y negative">Y-</button>
        <button class="control corner" aria-label="Jog X positive Y negative">↘</button>
      </div>
      
      <!-- Z Controls on the side -->
      <div class="z-controls">
        <button class="control z-button" aria-label="Jog Z positive">Z+</button>
        <button class="control z-button" aria-label="Jog Z negative">Z-</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
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
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.step-selector {
  display: flex;
  align-items: center;
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

.chip.active {
  background: var(--gradient-accent);
  color: #fff;
}

.jog-layout {
  display: flex;
  gap: var(--gap-md);
  align-items: center;
}

.xy-joystick {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 180px;
}

.center-indicator {
  width: 100%;
  height: 100%;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  position: relative;
}

.center-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: var(--color-text-secondary);
  border-radius: 50%;
}

.control {
  border-radius: var(--radius-small);
  border: none;
  background: var(--color-surface-muted);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.control:hover {
  background: var(--color-accent);
  color: white;
  transform: scale(1.02);
}

.control:active {
  transform: scale(0.98);
}

.control.corner {
  font-size: 1.2rem;
  background: var(--color-surface-muted);
}

.control.axis {
  background: var(--color-surface-muted);
  font-weight: bold;
}

.z-controls {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
}

.z-button {
  width: 60px;
  flex: 1; /* Each button takes equal height */
  background: var(--color-surface-muted);
  font-weight: bold;
}

.z-controls {
  height: 180px; /* Match the height of xy-joystick */
}

@media (max-width: 959px) {
  .jog-layout {
    flex-direction: column;
    gap: var(--gap-sm);
  }
  
  .xy-joystick {
    width: 150px;
    height: 150px;
  }
  
  .z-controls {
    flex-direction: row;
    height: auto;
    width: 150px;
  }
  
  .z-button {
    flex: 1;
    height: 50px;
  }
}
</style>
