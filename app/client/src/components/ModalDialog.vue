<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" @click="handleOverlayClick">
        <div class="modal-container" @click.stop>
          <div class="modal-content" ref="modalContent" v-html="content" data-plugin-content></div>
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

  const styles = contentEl.querySelectorAll('style');

  const existingStyles = document.head.querySelectorAll('style[data-modal-style]');
  existingStyles.forEach(s => s.remove());

  styles.forEach((styleEl) => {
    const newStyle = document.createElement('style');
    const cssText = styleEl.textContent;
    if (!cssText.includes('#plugin-modal-content')) {
      newStyle.textContent = cssText;
    }
    newStyle.setAttribute('data-modal-style', 'true');
    document.body.appendChild(newStyle);
  });

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

const cleanupStyles = () => {
  const modalStylesHead = document.head.querySelectorAll('style[data-modal-style]');
  modalStylesHead.forEach(style => style.remove());
  const modalStylesBody = document.body.querySelectorAll('style[data-modal-style]');
  modalStylesBody.forEach(style => style.remove());
};

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden';
    nextTick(() => {
      nextTick(() => {
        executeScripts();
      });
    });
  } else {
    document.body.style.overflow = '';
    cleanupStyles();
  }
});

watch(() => props.content, () => {
  if (props.isOpen) {
    nextTick(() => {
      nextTick(() => {
        executeScripts();
      });
    });
  }
});

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
  document.body.style.overflow = '';
  cleanupStyles();
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
  backdrop-filter: blur(0.5px);
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
}

.modal-content {
  max-width: 90%;
  max-height: 90%;
  overflow: auto;
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
