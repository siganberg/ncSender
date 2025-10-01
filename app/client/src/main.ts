import { createApp } from 'vue';
import App from './App.vue';
import '@/assets/styles/base.css';

// Disable context menu globally for touch screen compatibility
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
}, { passive: false });

// Disable text selection on touch devices, except in console
document.addEventListener('selectstart', (e) => {
  // Allow text selection in console
  const target = e.target as Node;
  if (target && target.nodeType === Node.ELEMENT_NODE) {
    if ((target as Element).closest('.console-output')) {
      return true;
    }
  } else if (target && target.parentElement) {
    if (target.parentElement.closest('.console-output')) {
      return true;
    }
  }
  e.preventDefault();
  return false;
}, { passive: false });

const app = createApp(App);

// Patch Vue's addEventListener to use passive: false for touch events
const originalAddEventListener = Element.prototype.addEventListener;
Element.prototype.addEventListener = function(type: string, listener: any, options?: any) {
  if (type === 'touchstart' || type === 'touchmove' || type === 'wheel') {
    if (typeof options === 'boolean') {
      options = { capture: options, passive: false };
    } else if (typeof options === 'object' && options !== null) {
      options = { ...options, passive: false };
    } else {
      options = { passive: false };
    }
  }
  return originalAddEventListener.call(this, type, listener, options);
};

app.mount('#app');
