import { reactive } from 'vue';
import { api } from './api.js';

// Shared settings store
export const settingsStore = reactive({
  data: null,
  loaded: false,
  error: null
});

// Load settings once at app startup
export async function loadSettings() {
  try {
    settingsStore.data = await api.getSettings();
    settingsStore.loaded = true;
  } catch (error) {
    console.error('Failed to load settings:', error);
    settingsStore.error = error;
    settingsStore.loaded = true;
  }
}

// Get settings (returns cached data)
export function getSettings() {
  return settingsStore.data;
}

// Update settings and refresh store
export async function updateSettings(updates) {
  const result = await api.updateSettings(updates);
  if (result.settings) {
    settingsStore.data = result.settings;
  }
  return result;
}

// Save settings and refresh store
export async function saveSettings(settings) {
  const result = await api.saveSettings(settings);
  if (result.settings) {
    settingsStore.data = result.settings;
  }
  return result;
}
