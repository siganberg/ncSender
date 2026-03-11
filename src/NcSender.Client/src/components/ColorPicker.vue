<template>
  <div class="color-picker-wrapper" ref="wrapperRef">
    <button
      type="button"
      class="color-swatch"
      :style="{ backgroundColor: modelValue }"
      @click="togglePopup"
    ></button>
    <div v-if="isOpen" class="color-popup">
      <ColorPicker
        theme="dark"
        :color="modelValue"
        :sucker-hide="true"
        @changeColor="handleColorChange"
        @inputFocus="handleInputFocus"
        @inputBlur="handleInputBlur"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { ColorPicker } from 'vue-color-kit';
import 'vue-color-kit/dist/vue-color-kit.css';

const props = defineProps({
  modelValue: {
    type: String,
    default: '#000000'
  }
});

const emit = defineEmits(['update:modelValue', 'change', 'inputFocus', 'inputBlur']);

const isOpen = ref(false);
const wrapperRef = ref(null);

const togglePopup = () => {
  isOpen.value = !isOpen.value;
};

const closePopup = () => {
  if (!isOpen.value) return;
  isOpen.value = false;
  emit('change');
};

const handleColorChange = (color) => {
  const hex = color.hex;
  emit('update:modelValue', hex);
};

const handleInputFocus = (event) => {
  emit('inputFocus', event);
};

const handleInputBlur = (event) => {
  emit('inputBlur', event);
};

const handleClickOutside = (event) => {
  if (wrapperRef.value && !wrapperRef.value.contains(event.target)) {
    closePopup();
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.color-picker-wrapper {
  position: relative;
  display: inline-block;
}

.color-swatch {
  width: 40px;
  height: 32px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.color-swatch:hover {
  border-color: var(--color-accent);
  transform: scale(1.05);
}

.color-popup {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: 8px;
  box-shadow: var(--shadow-elevated);
  z-index: 1000;
}
</style>

<style>
/* Override vue-color-kit styles for dark theme */
.hu-color-picker {
  background: var(--color-surface) !important;
  box-shadow: none !important;
  padding: 8px !important;
}

/* Hide the preset color swatches at bottom */
.hu-color-picker .colors {
  display: none !important;
}

/* Style the inputs */
.hu-color-picker .color-type .name {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
}

.hu-color-picker .color-type .value {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
  border: 1px solid var(--color-border) !important;
}

.hu-color-picker .color-type .value:focus {
  border-color: var(--color-accent) !important;
}

/* Hide alpha/transparency slider (checkered bar) */
.hu-color-picker [class*="alpha"] {
  display: none !important;
}

/* Hide RGBA row - target second color-type div */
.hu-color-picker .color-type + .color-type {
  display: none !important;
}

/* Add right margin to color preview canvas */
.hu-color-picker .color-show canvas {
  width: calc(100% - 8px) !important;
}

</style>
