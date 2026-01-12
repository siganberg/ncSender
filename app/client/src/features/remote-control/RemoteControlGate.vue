<!--
  This file is part of ncSender.

  ncSender is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  ncSender is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with ncSender. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div class="remote-control-gate" :class="{ 'remote-control-gate--mobile': mobile }">
    <div class="gate-card">
      <div class="logo-section">
        <span class="logo">ncSender</span>
      </div>

      <h1 class="title">Remote Control Disabled</h1>

      <p class="description">
        For your safety, remote machine control has been disabled by the host computer.
      </p>

      <div class="warning-box">
        <div class="warning-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="warning-content">
          <strong>SAFETY NOTICE</strong>
          <p>CNC machines are dangerous. Remote control is disabled by default to prevent unintended machine movement from remote connections.</p>
        </div>
      </div>

      <div class="instructions-section">
        <h3 class="instructions-title">To enable remote control:</h3>
        <ol class="instructions-list">
          <li>Open ncSender on the host computer</li>
          <li>Go to Settings</li>
          <li>Enable "Allow Remote Control"</li>
        </ol>
      </div>

      <div class="actions">
        <button class="file-manager-btn" @click="openFileManager">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Open File Manager
        </button>
      </div>

      <p class="help-text">
        You can still upload and manage G-code files while remote control is disabled.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  mobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-file-manager'): void;
}>();

const openFileManager = () => {
  emit('open-file-manager');
};
</script>

<style scoped>
.remote-control-gate {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #1a1f2e 0%, #0f1318 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
  box-sizing: border-box;
}

.gate-card {
  background: #1e2330;
  border-radius: 12px;
  padding: 40px;
  max-width: 520px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-section {
  text-align: center;
  margin-bottom: 24px;
}

.logo {
  font-size: 32px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.5px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  margin: 0 0 12px 0;
}

.description {
  color: #8b95a5;
  font-size: 15px;
  text-align: center;
  margin: 0 0 24px 0;
  line-height: 1.5;
}

.warning-box {
  display: flex;
  gap: 14px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.warning-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  color: #f59e0b;
}

.warning-icon svg {
  width: 100%;
  height: 100%;
}

.warning-content {
  flex: 1;
}

.warning-content strong {
  display: block;
  color: #f59e0b;
  font-size: 12px;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.warning-content p {
  margin: 0;
  color: #d1d5db;
  font-size: 14px;
  line-height: 1.5;
}

.instructions-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

.instructions-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 12px 0;
}

.instructions-list {
  margin: 0;
  padding-left: 20px;
  color: #8b95a5;
  font-size: 14px;
  line-height: 1.8;
}

.instructions-list li {
  margin-bottom: 4px;
}

.actions {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.file-manager-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1abc9c;
  border: none;
  border-radius: 8px;
  padding: 14px 28px;
  color: white;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.file-manager-btn:hover {
  background: #16a085;
}

.btn-icon {
  width: 20px;
  height: 20px;
}

.help-text {
  text-align: center;
  color: #6b7280;
  font-size: 13px;
  margin: 0;
  line-height: 1.5;
}

/* Mobile adjustments */
.remote-control-gate--mobile {
  padding: 10px;
}

.remote-control-gate--mobile .gate-card {
  padding: 24px 20px;
  max-width: none;
}

.remote-control-gate--mobile .logo {
  font-size: 26px;
}

.remote-control-gate--mobile .title {
  font-size: 18px;
}

.remote-control-gate--mobile .description {
  font-size: 14px;
  margin-bottom: 20px;
}

.remote-control-gate--mobile .warning-box {
  padding: 12px;
  margin-bottom: 20px;
}

.remote-control-gate--mobile .warning-icon {
  width: 20px;
  height: 20px;
}

.remote-control-gate--mobile .warning-content strong {
  font-size: 11px;
}

.remote-control-gate--mobile .warning-content p {
  font-size: 13px;
}

.remote-control-gate--mobile .instructions-section {
  padding: 12px 16px;
  margin-bottom: 20px;
}

.remote-control-gate--mobile .instructions-title {
  font-size: 13px;
}

.remote-control-gate--mobile .instructions-list {
  font-size: 13px;
  line-height: 1.7;
}

.remote-control-gate--mobile .file-manager-btn {
  padding: 12px 24px;
  font-size: 15px;
  width: 100%;
  justify-content: center;
}

.remote-control-gate--mobile .help-text {
  font-size: 12px;
}
</style>
