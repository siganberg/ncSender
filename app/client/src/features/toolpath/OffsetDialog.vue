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
          <template v-if="isTopView">
            Enter offset values to translate the toolpath. Positive X moves right, positive Y moves up.
          </template>
          <template v-else>
            Enter Z offset to translate the toolpath vertically. Positive Z moves up.
          </template>
        </p>

        <!-- X and Y inputs (Top view only) -->
        <template v-if="isTopView">
          <div class="input-row">
            <label class="input-label">X Offset</label>
            <div class="input-with-buttons">
              <button class="adjust-btn" @click="adjustX(-10)" title="Decrease by 10">-10</button>
              <input
                type="number"
                v-model.number="offsetX"
                step="0.1"
                class="offset-input"
                ref="xInput"
                @keydown.enter="handleApply"
              />
              <button class="adjust-btn" @click="adjustX(10)" title="Increase by 10">+10</button>
            </div>
          </div>

          <div class="input-row">
            <label class="input-label">Y Offset</label>
            <div class="input-with-buttons">
              <button class="adjust-btn" @click="adjustY(-10)" title="Decrease by 10">-10</button>
              <input
                type="number"
                v-model.number="offsetY"
                step="0.1"
                class="offset-input"
                @keydown.enter="handleApply"
              />
              <button class="adjust-btn" @click="adjustY(10)" title="Increase by 10">+10</button>
            </div>
          </div>
        </template>

        <!-- Z input (Front/Side view only) -->
        <div v-if="!isTopView" class="input-row">
          <label class="input-label">Z Offset</label>
          <div class="input-with-buttons">
            <button class="adjust-btn" @click="adjustZ(-1)" title="Decrease by 1">-1</button>
            <input
              type="number"
              v-model.number="offsetZ"
              step="0.1"
              class="offset-input"
              ref="zInput"
              @keydown.enter="handleApply"
            />
            <button class="adjust-btn" @click="adjustZ(1)" title="Increase by 1">+1</button>
          </div>
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
  view?: string;
}>();

const isTopView = computed(() => props.view === 'top');
const isFrontView = computed(() => props.view === 'front');

const emit = defineEmits<{
  (e: 'apply', offsetX: number, offsetY: number, offsetZ: number): void;
  (e: 'close'): void;
}>();

const offsetX = ref(0);
const offsetY = ref(0);
const offsetZ = ref(0);
const xInput = ref<HTMLInputElement | null>(null);
const zInput = ref<HTMLInputElement | null>(null);

const isValid = computed(() => {
  if (isTopView.value) {
    // Top view: check X and Y
    return (offsetX.value !== 0 || offsetY.value !== 0) &&
           !isNaN(offsetX.value) && !isNaN(offsetY.value);
  } else {
    // Front/Side view: check Z only
    return offsetZ.value !== 0 && !isNaN(offsetZ.value);
  }
});

function adjustX(amount: number) {
  offsetX.value = Math.round((offsetX.value + amount) * 1000) / 1000;
}

function adjustY(amount: number) {
  offsetY.value = Math.round((offsetY.value + amount) * 1000) / 1000;
}

function adjustZ(amount: number) {
  offsetZ.value = Math.round((offsetZ.value + amount) * 1000) / 1000;
}

function handleApply() {
  if (!isValid.value) return;
  emit('apply', offsetX.value, offsetY.value, offsetZ.value);
  resetAndClose();
}

function handleClose() {
  resetAndClose();
}

function resetAndClose() {
  offsetX.value = 0;
  offsetY.value = 0;
  offsetZ.value = 0;
  emit('close');
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    offsetX.value = 0;
    offsetY.value = 0;
    offsetZ.value = 0;
    nextTick(() => {
      if (isTopView.value) {
        xInput.value?.focus();
        xInput.value?.select();
      } else {
        zInput.value?.focus();
        zInput.value?.select();
      }
    });
  }
});
</script>

<style scoped>
:deep(.dialog--small) {
  max-width: 280px;
}

.offset-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-md);
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  text-align: center;
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
  text-align: center;
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
}

.input-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  text-align: center;
}

.input-with-buttons {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.adjust-btn {
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary, #3b82f6);
  color: white;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 42px;
}

.adjust-btn:hover {
  background: var(--color-primary-hover, #2563eb);
}

.adjust-btn:active {
  transform: scale(0.95);
}

.offset-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.9rem;
  text-align: center;
  font-family: var(--font-mono);
  min-width: 70px;
}

.offset-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.dialog-actions {
  display: flex;
  justify-content: center;
  gap: var(--gap-sm);
  padding-top: var(--gap-sm);
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
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
