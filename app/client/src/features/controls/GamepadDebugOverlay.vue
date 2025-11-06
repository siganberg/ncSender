<template>
  <div v-if="enabled" class="gamepad-debug-overlay">
    <div class="debug-header">
      <h4>Gamepad Debug</h4>
      <button @click="$emit('close')" class="btn-close">×</button>
    </div>
    <div v-if="gamepads.length === 0" class="no-gamepad">
      No gamepad connected
    </div>
    <div v-for="(gamepad, idx) in gamepads" :key="idx" class="gamepad-info">
      <div class="gamepad-name">{{ gamepad.id }}</div>
      <div class="axes-grid">
        <div v-for="(axis, axisIdx) in gamepad.axes" :key="axisIdx" class="axis-item">
          <div class="axis-label">Axis {{ axisIdx }}</div>
          <div class="axis-bar-container">
            <div
              class="axis-bar"
              :class="{
                'above-threshold': Math.abs(axis) > threshold,
                'full-strength': Math.abs(axis) > fullStrengthThreshold
              }"
              :style="{ width: (Math.abs(axis) * 100) + '%' }"
            ></div>
          </div>
          <div class="axis-value">
            {{ axis.toFixed(3) }}
            <span v-if="Math.abs(axis) > threshold" class="threshold-label">
              {{ Math.abs(axis) > fullStrengthThreshold ? 'FULL' : 'ACTIVE' }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="gamepad.buttons.length > 0" class="buttons-section">
        <div class="section-title">Buttons</div>
        <div class="buttons-grid">
          <div
            v-for="(button, btnIdx) in gamepad.buttons"
            :key="btnIdx"
            class="button-item"
            :class="{ pressed: button.pressed }"
          >
            {{ btnIdx }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

defineProps<{
  enabled: boolean;
}>();

defineEmits<{
  close: [];
}>();

const threshold = 0.5;
const fullStrengthThreshold = 0.95;

interface GamepadState {
  id: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

const gamepads = ref<GamepadState[]>([]);
let pollInterval: number | null = null;

const pollGamepads = () => {
  const gamepadList = navigator.getGamepads();
  gamepads.value = Array.from(gamepadList)
    .filter(g => g !== null)
    .map(g => ({
      id: g!.id,
      axes: Array.from(g!.axes),
      buttons: Array.from(g!.buttons).map(b => ({ pressed: b.pressed, value: b.value }))
    }));
};

onMounted(() => {
  pollInterval = window.setInterval(pollGamepads, 50);
});

onBeforeUnmount(() => {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
});
</script>

<style scoped>
.gamepad-debug-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--color-surface);
  border: 2px solid var(--color-accent);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  font-family: monospace;
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--gap-md);
  padding-bottom: var(--gap-sm);
  border-bottom: 1px solid var(--color-border);
}

.debug-header h4 {
  margin: 0;
  color: var(--color-accent);
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  line-height: 1;
}

.btn-close:hover {
  color: var(--color-accent);
}

.no-gamepad {
  color: var(--color-text-secondary);
  font-style: italic;
  text-align: center;
  padding: var(--gap-lg);
}

.gamepad-info {
  margin-bottom: var(--gap-lg);
}

.gamepad-name {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin-bottom: var(--gap-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.axes-grid {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.axis-item {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.axis-label {
  width: 60px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.axis-bar-container {
  flex: 1;
  height: 20px;
  background: var(--color-surface-muted);
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.axis-bar {
  height: 100%;
  background: var(--color-text-secondary);
  transition: width 0.05s linear, background-color 0.1s;
}

.axis-bar.above-threshold {
  background: var(--color-accent);
}

.axis-bar.full-strength {
  background: #ff6b6b;
}

.axis-value {
  width: 100px;
  text-align: right;
  font-size: 0.85rem;
  color: var(--color-text-primary);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.threshold-label {
  font-size: 0.7rem;
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--color-accent);
  color: white;
  font-weight: bold;
}

.threshold-label:has-text(FULL) {
  background: #ff6b6b;
}

.buttons-section {
  margin-top: var(--gap-md);
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}

.section-title {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: var(--gap-sm);
}

.buttons-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.button-item {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.button-item.pressed {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}
</style>
