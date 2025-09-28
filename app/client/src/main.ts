import { createApp } from 'vue';
import App from './App.vue';
import '@/assets/styles/base.css';

// Disable context menu globally for touch screen compatibility
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
});

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
});

createApp(App).mount('#app');
