<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" @click="handleOverlayClick">
        <div class="modal-container" @click.stop>
          <div class="modal-content" ref="modalContent" v-html="content"></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  content: {
    type: String,
    default: ''
  },
  closable: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['close']);
const modalContent = ref(null);

const handleOverlayClick = () => {
  if (props.closable) {
    emit('close');
  }
};

const handleEscape = (e) => {
  if (e.key === 'Escape' && props.closable && props.isOpen) {
    emit('close');
  }
};

const executeScripts = () => {
  const contentEl = modalContent.value;
  if (!contentEl) return;

  const scripts = contentEl.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');

    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });

    newScript.textContent = oldScript.textContent;

    oldScript.parentNode?.replaceChild(newScript, oldScript);
  });
};

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden';
    nextTick(() => {
      executeScripts();
    });
  } else {
    document.body.style.overflow = '';
  }
});

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
  document.body.style.overflow = '';
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.modal-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.modal-content {
  pointer-events: auto;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
}

/* Allow plugin content to control its own styling */
.modal-content :deep(*) {
  color: var(--color-text-primary);
}

/* Ensure plugin styles and scripts work */
.modal-content :deep(style) {
  display: block;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform 0.2s ease;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95);
}
</style>
