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
      <!-- Rotate options (Top and 3D view) -->
      <template v-if="isTopOr3dView">
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
          <span class="menu-label">Offset Material</span>
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

      <!-- Move Spindle (Top view only - 3D view X/Y projection is inaccurate) -->
      <template v-if="props.view === 'top' && isConnected">
        <div class="menu-divider"></div>

        <div class="menu-section">
          <div class="menu-item" @click="handleMoveSpindle">
            <span class="menu-icon">⌖</span>
            <span class="menu-label">Move To</span>
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

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

const isTopOr3dView = computed(() => props.view === 'top' || props.view === 'iso');

const emit = defineEmits<{
  (e: 'rotate', degrees: 90 | -90): void;
  (e: 'mirror', axis: 'x' | 'y'): void;
  (e: 'offset'): void;
  (e: 'reset'): void;
  (e: 'move-spindle'): void;
  (e: 'close'): void;
}>();

const menuRef = ref<HTMLElement | null>(null);

// The menu's real size, measured once it is in the DOM. The item list
// varies by view and connection state, so a guessed height put the bottom
// of the menu off-screen on short viewports.
const menuSize = ref({ w: 180, h: 220 });
const viewport = ref({ w: window.innerWidth, h: window.innerHeight });
const measure = async () => {
  await nextTick();
  const vv = window.visualViewport;
  viewport.value = { w: vv?.width ?? window.innerWidth, h: vv?.height ?? window.innerHeight };
  const el = menuRef.value;
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) menuSize.value = { w: r.width, h: r.height };
  }
};
watch(() => [props.visible, props.x, props.y, props.view, props.hasFile, props.isConnected], () => { if (props.visible) measure(); }, { immediate: true });

const menuStyle = computed(() => {
  const pad = 8;
  const { w: menuWidth, h: menuHeight } = menuSize.value;
  const { w: vw, h: vh } = viewport.value;

  // Open to the right/below the pointer; flip to the left/above when that
  // side has no room; then clamp so the menu always stays on screen.
  let left = props.x;
  if (left + menuWidth + pad > vw) left = props.x - menuWidth;
  left = Math.max(pad, Math.min(left, vw - menuWidth - pad));

  let top = props.y;
  if (top + menuHeight + pad > vh) top = props.y - menuHeight;
  top = Math.max(pad, Math.min(top, vh - menuHeight - pad));

  return {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${vh - pad * 2}px`
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
  overflow-y: auto;
  box-sizing: border-box;
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
</style>
