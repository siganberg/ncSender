<!--
  G-code Offset Dialog
  Simple dialog for entering X/Y offset values for toolpath translation.
-->

<template>
  <Dialog v-if="show" @close="handleClose" size="small" :close-on-backdrop-click="false">
    <div class="offset-dialog">
      <div class="dialog-header">
        <h2>Move/Offset Toolpath</h2>
      </div>

      <div class="dialog-content">
        <p class="dialog-description">
          Enter offset values to translate the toolpath. Positive X moves right, positive Y moves up.
        </p>

        <div class="input-row">
          <div class="input-group">
            <label class="input-label">X Offset</label>
            <input
              type="number"
              v-model.number="offsetX"
              step="0.1"
              class="offset-input"
              ref="xInput"
              @keydown.enter="handleApply"
            />
          </div>
          <div class="input-group">
            <label class="input-label">Y Offset</label>
            <input
              type="number"
              v-model.number="offsetY"
              step="0.1"
              class="offset-input"
              @keydown.enter="handleApply"
            />
          </div>
        </div>

        <div class="quick-actions">
          <button class="quick-btn" @click="setPreset(-10, 0)" title="Move left 10">← 10</button>
          <button class="quick-btn" @click="setPreset(10, 0)" title="Move right 10">10 →</button>
          <button class="quick-btn" @click="setPreset(0, 10)" title="Move up 10">↑ 10</button>
          <button class="quick-btn" @click="setPreset(0, -10)" title="Move down 10">10 ↓</button>
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn btn-secondary" @click="handleClose">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          @click="handleApply"
          :disabled="!isValid"
        >
          Apply Offset
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import Dialog from '@/components/Dialog.vue';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (e: 'apply', offsetX: number, offsetY: number): void;
  (e: 'close'): void;
}>();

const offsetX = ref(0);
const offsetY = ref(0);
const xInput = ref<HTMLInputElement | null>(null);

const isValid = computed(() => {
  return (offsetX.value !== 0 || offsetY.value !== 0) &&
         !isNaN(offsetX.value) && !isNaN(offsetY.value);
});

function setPreset(x: number, y: number) {
  offsetX.value = x;
  offsetY.value = y;
}

function handleApply() {
  if (!isValid.value) return;
  emit('apply', offsetX.value, offsetY.value);
  resetAndClose();
}

function handleClose() {
  resetAndClose();
}

function resetAndClose() {
  offsetX.value = 0;
  offsetY.value = 0;
  emit('close');
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    offsetX.value = 0;
    offsetY.value = 0;
    nextTick(() => {
      xInput.value?.focus();
      xInput.value?.select();
    });
  }
});
</script>

<style scoped>
.offset-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-md);
  min-width: 320px;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.dialog-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.input-row {
  display: flex;
  gap: var(--gap-md);
}

.input-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
}

.input-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.offset-input {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 1rem;
  text-align: right;
  font-family: var(--font-mono);
}

.offset-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.quick-actions {
  display: flex;
  gap: var(--gap-xs);
  justify-content: center;
}

.quick-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-secondary, rgba(255,255,255,0.05));
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.quick-btn:hover {
  background: var(--color-surface-hover, rgba(255,255,255,0.1));
  color: var(--color-text);
  border-color: var(--color-primary);
}

.dialog-actions {
  display: flex;
  justify-content: center;
  gap: var(--gap-sm);
  padding-top: var(--gap-sm);
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-primary, #3b82f6);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #2563eb);
}

.btn-secondary {
  background: var(--color-surface-secondary, rgba(255,255,255,0.1));
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface-hover, rgba(255,255,255,0.15));
}
</style>
