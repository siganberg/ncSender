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
  if (!contentEl) {
    console.log('[ModalDialog] No content element');
    return;
  }

  console.log('[ModalDialog] Content HTML:', contentEl.innerHTML.substring(0, 200));

  const styles = contentEl.querySelectorAll('style');
  console.log('[ModalDialog] Found', styles.length, 'style tags');

  // Remove existing modal styles from head to prevent duplicates
  const existingStyles = document.head.querySelectorAll('style[data-modal-style]');
  existingStyles.forEach(s => s.remove());

  styles.forEach((styleEl) => {
    const newStyle = document.createElement('style');
    // Increase specificity by scoping to the modal content
    let cssText = styleEl.textContent;
    // Check if styles need scoping
    if (!cssText.includes('#plugin-modal-content')) {
      // Don't modify - just add as-is and let CSS cascade work
      newStyle.textContent = cssText;
    }
    newStyle.setAttribute('data-modal-style', 'true');
    // Append to body instead of head for higher specificity
    document.body.appendChild(newStyle);
    console.log('[ModalDialog] Added style to body, length:', newStyle.textContent.length);

    // Also log first 200 chars to verify content
    console.log('[ModalDialog] Style preview:', cssText.substring(0, 200));
  });

  const scripts = contentEl.querySelectorAll('script');
  console.log('[ModalDialog] Found', scripts.length, 'script tags');

  const buttons = contentEl.querySelectorAll('button');
  console.log('[ModalDialog] Found', buttons.length, 'buttons');
  buttons.forEach((btn, i) => {
    const rect = btn.getBoundingClientRect();
    console.log(`[ModalDialog] Button ${i}:`, btn.className, 'offsetHeight:', btn.offsetHeight, 'rect:', rect);
  });

  const container = contentEl.querySelector('.rcs-safety-container');
  if (container) {
    console.log('[ModalDialog] Container rect:', container.getBoundingClientRect());
  }
  console.log('[ModalDialog] Content element rect:', contentEl.getBoundingClientRect());

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

watch(() => props.content, (newContent) => {
  console.log('[ModalDialog] Content changed, length:', newContent?.length, 'isOpen:', props.isOpen);
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
