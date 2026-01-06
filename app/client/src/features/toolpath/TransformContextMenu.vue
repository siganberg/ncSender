<!--
  G-code Transform Context Menu
  Right-click context menu for toolpath transformations.
-->

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="transform-context-menu"
      :style="menuStyle"
      @click.stop
    >
      <!-- Rotate options (Top view only) -->
      <template v-if="isTopView">
        <div class="menu-section">
          <div class="menu-item" :class="{ disabled: !hasFile }" @click="hasFile && handleRotateCW()">
            <span class="menu-icon">↻</span>
            <span class="menu-label">Rotate 90° CW</span>
          </div>
          <div class="menu-item" :class="{ disabled: !hasFile }" @click="hasFile && handleRotateCCW()">
            <span class="menu-icon">↺</span>
            <span class="menu-label">Rotate 90° CCW</span>
          </div>
        </div>

        <div class="menu-divider"></div>

        <div class="menu-section">
          <div class="menu-item" :class="{ disabled: !hasFile }" @click="hasFile && handleMirrorX()">
            <span class="menu-icon">↔</span>
            <span class="menu-label">Mirror X Axis</span>
          </div>
          <div class="menu-item" :class="{ disabled: !hasFile }" @click="hasFile && handleMirrorY()">
            <span class="menu-icon">↕</span>
            <span class="menu-label">Mirror Y Axis</span>
          </div>
        </div>

        <div class="menu-divider"></div>
      </template>

      <!-- Move/Offset (Top and Front view) -->
      <div class="menu-section">
        <div class="menu-item" :class="{ disabled: !hasFile }" @click="hasFile && handleOffset()">
          <span class="menu-icon">⤡</span>
          <span class="menu-label">Move/Offset...</span>
        </div>
      </div>

      <!-- Reset (Both Top and Front view) -->
      <div v-if="canReset && hasFile" class="menu-divider"></div>

      <div v-if="canReset && hasFile" class="menu-section">
        <div class="menu-item" @click="handleReset">
          <span class="menu-icon">↩</span>
          <span class="menu-label">Reset to Original</span>
        </div>
      </div>

      <!-- Move Spindle (Top view only, when connected) -->
      <template v-if="isTopView && isConnected">
        <div class="menu-divider"></div>

        <div class="menu-section">
          <!-- Coordinate header -->
          <div class="menu-header">
            <span class="axis-label">X=</span>{{ worldX }}<span class="coord-spacer"></span><span class="axis-label">Y=</span>{{ worldY }}
          </div>

          <div class="menu-item" @click="handleMoveSpindle">
            <span class="menu-icon">⌖</span>
            <span class="menu-label">Move Spindle Here</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Click-outside overlay -->
    <div
      v-if="visible"
      class="context-menu-overlay"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  view?: string;
  hasFile?: boolean;
  canReset?: boolean;
  isConnected?: boolean;
  worldX?: number;
  worldY?: number;
}>();

const isTopView = computed(() => props.view === 'top');

const emit = defineEmits<{
  (e: 'rotate', degrees: 90 | -90): void;
  (e: 'mirror', axis: 'x' | 'y'): void;
  (e: 'offset'): void;
  (e: 'reset'): void;
  (e: 'move-spindle'): void;
  (e: 'close'): void;
}>();

const menuRef = ref<HTMLElement | null>(null);

const menuStyle = computed(() => {
  // Position menu at click location, adjust if near screen edge
  let left = props.x;
  let top = props.y;

  // Menu dimensions (approximate)
  const menuWidth = 180;
  const menuHeight = 220;

  // Adjust for screen boundaries
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 10;
  }
  if (top + menuHeight > window.innerHeight) {
    top = window.innerHeight - menuHeight - 10;
  }

  return {
    left: `${left}px`,
    top: `${top}px`
  };
});

const handleRotateCW = () => {
  emit('rotate', 90);
  emit('close');
};

const handleRotateCCW = () => {
  emit('rotate', -90);
  emit('close');
};

const handleMirrorX = () => {
  // Mirror X Axis = flip horizontally = reflect X coordinates (mirror across Y axis)
  emit('mirror', 'y');
  emit('close');
};

const handleMirrorY = () => {
  // Mirror Y Axis = flip vertically = reflect Y coordinates (mirror across X axis)
  emit('mirror', 'x');
  emit('close');
};

const handleOffset = () => {
  emit('offset');
  emit('close');
};

const handleReset = () => {
  emit('reset');
  emit('close');
};

const handleMoveSpindle = () => {
  emit('move-spindle');
  emit('close');
};

// Close on Escape key
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    emit('close');
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
}

.transform-context-menu {
  position: fixed;
  z-index: 10000;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  min-width: 170px;
  padding: 6px 0;
  user-select: none;
}

.menu-section {
  padding: 2px 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.menu-item:hover:not(.disabled) {
  background: var(--color-surface-muted);
}

.menu-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.menu-icon {
  width: 20px;
  text-align: center;
  font-size: 1.1rem;
  color: var(--color-text-secondary);
}

.menu-label {
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 8px;
}

.menu-header {
  padding: 6px 14px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-align: center;
  font-family: var(--font-mono);
}

.axis-label {
  color: var(--color-accent);
}

.coord-spacer {
  display: inline-block;
  width: 12px;
}
</style>
