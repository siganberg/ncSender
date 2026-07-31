<template>
  <span class="nc-info-tooltip-wrap">
    <button
      ref="triggerRef"
      type="button"
      class="nc-info-tooltip-trigger"
      :aria-label="text"
      :aria-expanded="visible"
      @click.stop="onClick"
      @mouseenter="onHover(true)"
      @mouseleave="onHover(false)"
      @blur="hide"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    </button>
    <Teleport to="body">
      <span
        v-if="visible"
        class="nc-info-tooltip-bubble"
        role="tooltip"
        :style="bubbleStyle"
      >{{ text }}</span>
    </Teleport>
  </span>
</template>

<script setup>
import { ref, onBeforeUnmount, nextTick } from 'vue'

defineProps({
  text: { type: String, required: true }
})

const triggerRef = ref(null)
const visible = ref(false)
const hoverActive = ref(false)
const bubbleStyle = ref({})

async function position() {
  await nextTick()
  const btn = triggerRef.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  // Anchor above the icon by default. Fixed position escapes any
  // clipping container (modals, scroll parents, etc.) via Teleport.
  bubbleStyle.value = {
    position: 'fixed',
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top - 8}px`,
    transform: 'translate(-50%, -100%)',
    zIndex: 10000
  }
}

async function show() {
  visible.value = true
  await position()
}

function hide() {
  // Delay slightly so a mouseleave immediately followed by a click on the
  // same trigger doesn't race with the click toggle.
  setTimeout(() => {
    if (!hoverActive.value) visible.value = false
  }, 0)
}

function onHover(entering) {
  hoverActive.value = entering
  if (entering) show()
  else hide()
}

// Tap toggle for touch devices (hover doesn't exist). Click also fires
// on mouse, so if the tooltip is already visible from hover, tapping
// the icon again dismisses it — matches user expectation.
function onClick() {
  if (visible.value) {
    hoverActive.value = false
    visible.value = false
  } else {
    show()
  }
}

// Dismiss when tapping anywhere else on the page — the standard "tap
// outside to close" pattern touch users expect. Attached lazily so
// the initial click that opened the tooltip doesn't immediately close it.
let outsideHandler = null
function attachOutsideHandler() {
  if (outsideHandler) return
  outsideHandler = (e) => {
    if (!triggerRef.value) return
    if (triggerRef.value.contains(e.target)) return
    hoverActive.value = false
    visible.value = false
    detachOutsideHandler()
  }
  document.addEventListener('pointerdown', outsideHandler, true)
}
function detachOutsideHandler() {
  if (!outsideHandler) return
  document.removeEventListener('pointerdown', outsideHandler, true)
  outsideHandler = null
}

// Watch visibility to attach/detach the outside-tap listener.
import { watch } from 'vue'
watch(visible, (v) => {
  if (v) attachOutsideHandler()
  else detachOutsideHandler()
})

onBeforeUnmount(detachOutsideHandler)
</script>

<style scoped>
.nc-info-tooltip-wrap {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.nc-info-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  margin-left: 6px;
  color: var(--color-text-secondary);
  cursor: help;
  outline: none;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  transition: color 0.12s ease;
}
.nc-info-tooltip-trigger:hover,
.nc-info-tooltip-trigger:focus,
.nc-info-tooltip-trigger[aria-expanded="true"] {
  color: var(--color-accent);
}
</style>

<style>
/* Bubble is teleported to <body> so :scoped doesn't reach it. Global
   style below is namespaced with `nc-` to avoid collisions. */
.nc-info-tooltip-bubble {
  background: var(--color-surface, #1f2733);
  color: var(--color-text-primary, #e6ecf2);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.4;
  font-weight: normal;
  text-align: left;
  max-width: 280px;
  min-width: 180px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  white-space: normal;
  pointer-events: none;
}
.nc-info-tooltip-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: var(--color-surface, #1f2733);
}
</style>
