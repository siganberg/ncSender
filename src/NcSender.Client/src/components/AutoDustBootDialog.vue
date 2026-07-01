<template>
  <Dialog :show-header="true" @close="$emit('close')">
    <template #title>
      <span>AutoDustBoot</span>
    </template>

    <div class="adb-content">
      <!-- Pairing / connection status -->
      <div class="adb-status-card" :class="{ 'adb-status-card--connected': status?.connected }">
        <div class="adb-status-icon">
          <svg v-if="status?.connected" width="30" height="30" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <svg v-else width="30" height="30" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </div>
        <div class="adb-status-text">
          <div class="adb-status-title">
            {{ status?.connected ? 'Paired &amp; Connected' : 'Not detected' }}
          </div>
          <div class="adb-status-sub">
            <template v-if="status?.connected">
              Linked through the dongle · last seen {{ status.lastSeenMs }} ms ago
            </template>
            <template v-else>
              Not receiving data. Power on the AutoDustBoot and, if it was never paired,
              open the dongle pairing window ($PAIR) so it can bind.
            </template>
          </div>
        </div>
      </div>

      <!-- Live device details -->
      <div v-if="status?.connected" class="adb-details">
        <div class="adb-row"><span class="adb-key">State</span><span class="adb-val">{{ status.state ?? '—' }}</span></div>
        <div class="adb-row"><span class="adb-key">Position</span><span class="adb-val">{{ status.pos }}</span></div>
        <div class="adb-row"><span class="adb-key">Saved</span><span class="adb-val">{{ status.saved }}</span></div>
        <div class="adb-row"><span class="adb-key">Homed</span><span class="adb-val">{{ status.homed ? 'Yes' : 'No' }}</span></div>
      </div>

      <!-- Controls (only when the device is reachable) -->
      <div v-if="status?.connected" class="adb-controls">
        <div class="adb-jog">
          <button type="button" class="adb-ctl adb-ctl--jog"
            @mousedown="startJog('up')" @mouseup="stopJog" @mouseleave="stopJog"
            @touchstart.prevent="startJog('up')" @touchend.prevent="stopJog">
            ▲ Up <span class="adb-hint">(hold)</span>
          </button>
          <button type="button" class="adb-ctl adb-ctl--jog"
            @mousedown="startJog('down')" @mouseup="stopJog" @mouseleave="stopJog"
            @touchstart.prevent="startJog('down')" @touchend.prevent="stopJog">
            ▼ Down <span class="adb-hint">(hold)</span>
          </button>
        </div>
        <div class="adb-actionrow">
          <button type="button" class="adb-ctl" @click="send('goto:0')">Retract</button>
          <button type="button" class="adb-ctl" @click="send('goto:' + (status?.saved ?? 0))">Expand</button>
          <button type="button" class="adb-ctl" @click="send('home')">Home</button>
          <button type="button" class="adb-ctl" @click="send('save')" title="Save current position as the Expand target">Save</button>
        </div>
      </div>

      <div class="adb-actions">
        <button type="button" class="adb-btn" @click="$emit('close')">Close</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue';
import Dialog from './Dialog.vue';

interface AdbStatus {
  connected: boolean;
  lastSeenMs: number;
  state?: string;
  pos: number;
  saved: number;
  homed: boolean;
}

// Status is pushed from the parent (App.vue) via the WS event — no polling here.
defineProps<{ status: AdbStatus | null }>();
defineEmits(['close']);

const send = async (command: string) => {
  try {
    await fetch('/api/autodustboot/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
  } catch {
    // ignore — dongle may be absent
  }
};

// Long-press jog: repeat the command faster than the firmware's ~600ms keepalive,
// then send "stop" on release.
let jogTimer: ReturnType<typeof setInterval> | null = null;
const startJog = (dir: 'up' | 'down') => {
  send(dir);
  if (jogTimer) clearInterval(jogTimer);
  jogTimer = setInterval(() => send(dir), 300);
};
const stopJog = () => {
  if (!jogTimer) return;
  clearInterval(jogTimer);
  jogTimer = null;
  send('stop');
};

onUnmounted(() => {
  stopJog();
});
</script>

<style scoped>
.adb-content {
  padding: 4px 4px 8px;
  min-width: 380px;
}
.adb-status-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  background: var(--color-surface-muted, #f5f5f5);
  color: var(--color-text-secondary, #666);
}
.adb-status-card--connected {
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.08);
  color: var(--color-text-primary, #222);
}
.adb-status-icon { flex: 0 0 auto; color: var(--color-text-secondary, #888); }
.adb-status-card--connected .adb-status-icon { color: #22c55e; }
.adb-status-title { font-weight: 600; font-size: 1rem; margin-bottom: 3px; color: var(--color-text-primary, #222); }
.adb-status-sub { font-size: 0.82rem; line-height: 1.35; color: var(--color-text-secondary, #666); }
.adb-details {
  margin-top: 14px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  overflow: hidden;
}
.adb-row {
  display: flex;
  justify-content: space-between;
  padding: 9px 14px;
  font-size: 0.88rem;
}
.adb-row:not(:last-child) { border-bottom: 1px solid var(--color-border, #eee); }
.adb-key { color: var(--color-text-secondary, #666); }
.adb-val { font-variant-numeric: tabular-nums; color: var(--color-text-primary, #222); font-weight: 500; }
.adb-actions { display: flex; justify-content: flex-end; margin-top: 18px; }
.adb-btn {
  padding: 8px 22px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #ddd);
  background: var(--color-surface, #fff);
  color: var(--color-text-primary, #333);
  font-size: 0.88rem;
  cursor: pointer;
}
.adb-btn:hover { background: var(--color-surface-muted, #f0f0f0); }

.adb-controls { margin-top: 16px; }
.adb-jog { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.adb-actionrow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.adb-ctl {
  padding: 10px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border, #ddd);
  background: var(--color-surface, #fff);
  color: var(--color-text-primary, #222);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}
.adb-ctl:hover { background: var(--color-surface-muted, #f0f0f0); }
.adb-ctl:active { background: var(--color-accent, #4a90e2); color: #fff; border-color: var(--color-accent, #4a90e2); }
.adb-ctl--jog { padding: 14px 8px; font-size: 0.95rem; }
.adb-hint { font-size: 0.72rem; color: var(--color-text-secondary, #888); font-weight: 400; }
.adb-ctl--jog:active .adb-hint { color: rgba(255,255,255,0.8); }
</style>
