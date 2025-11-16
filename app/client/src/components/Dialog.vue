<template>
  <div class="dialog-backdrop" @click.self="handleBackdropClick" :style="{ zIndex }">
    <div
      class="dialog"
      :class="[size ? `dialog--${size}` : '']"
      :style="customStyle"
    >
      <header v-if="showHeader" class="dialog__header">
        <h2 class="dialog__title"><slot name="title">Dialog</slot></h2>
        <button class="dialog__close" @click="$emit('close')" aria-label="Close dialog">&times;</button>
      </header>
      <div class="dialog__content">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  showHeader?: boolean;
  size?: 'small' | 'small-plus' | 'medium-minus' | 'medium' | 'large';
  zIndex?: number;
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
  minWidth?: string;
  minHeight?: string;
  closeOnBackdropClick?: boolean;
}>()

const customStyle = computed(() => {
  const style: Record<string, string> = {};

  if (props.width) style.width = props.width;
  if (props.height) style.height = props.height;
  if (props.maxWidth) style.maxWidth = props.maxWidth;
  if (props.maxHeight) style.maxHeight = props.maxHeight;
  if (props.minWidth) style.minWidth = props.minWidth;
  if (props.minHeight) style.minHeight = props.minHeight;

  return Object.keys(style).length > 0 ? style : undefined;
});

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const handleBackdropClick = () => {
  if (props.closeOnBackdropClick !== false) {
    emit('close');
  }
};
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.dialog {
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1);
  max-width: 90vw;
  max-height: 90vh;
  width: auto;
  height: auto;
  display: flex;
  flex-direction: column;
}

/* Dialog size variants */
.dialog--small {
  max-width: 500px;
  width: auto;
}

.dialog--small-plus {
  max-width: 680px;
  width: auto;
}

.dialog--medium-minus {
  width: auto;
  height: auto;
}

.dialog--medium {
  max-width: none;
  width: 50vw;
  min-width: 600px;
  height: 70vh;
}

@media (orientation: portrait) {
  .dialog--medium {
    width: 85vw !important;
    min-width: unset !important;
  }
}

@media (orientation: landscape) {
  .dialog--medium {
    width: 65vw !important;
    min-width: unset !important;
  }
}

.dialog--large {
  max-width: 1200px;
  width: 90vw;
  height: 90vh;
}

.dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-sm);
  border-bottom: 1px solid var(--color-border);
}

.dialog__title {
  margin: 0;
  font-size: 1.5rem;
}

.dialog__close {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: var(--color-text-secondary);
}

.dialog__content {
  padding: 0;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
</style>
