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

<!--
  Confirm prompt laid out like GatePanel so every blocking dialog reads
  the same: centred title, icon badge beside the text, centred buttons.
  The badge colour and default glyph follow the variant; pass `icon` to
  override the glyph (e.g. icon="success" for a completed import).
-->
<template>
  <div class="confirm-dialog" :class="`confirm-dialog--${variant}`">
    <h3 class="confirm-dialog__title">{{ title }}</h3>
    <div class="confirm-dialog__content">
      <div v-if="showIcon" class="confirm-dialog__icon" aria-hidden="true">
        <PanelIcon :name="iconName" />
      </div>
      <div class="confirm-dialog__body">
        <p v-if="message" class="confirm-dialog__message">{{ message }}</p>
        <slot />
      </div>
    </div>
    <div class="confirm-dialog__actions">
      <button
        v-if="showCancel"
        @click="$emit('cancel')"
        class="confirm-dialog__btn confirm-dialog__btn--cancel"
      >
        {{ cancelText }}
      </button>
      <button
        v-if="showConfirm"
        @click="$emit('confirm')"
        :class="['confirm-dialog__btn', confirmClass]"
      >
        {{ confirmText }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PanelIcon, { type PanelIconName } from './PanelIcon.vue';

const props = withDefaults(defineProps<{
  title: string;
  message?: string;
  showConfirm?: boolean;
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'warning';
  icon?: PanelIconName;
  showIcon?: boolean;
}>(), {
  showConfirm: true,
  showCancel: true,
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'primary',
  showIcon: true
});

defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

// Same defaults as GatePanel: danger is "stop and think" (raised hand),
// warning is the triangle, anything else is informational.
const iconName = computed<PanelIconName>(() => {
  if (props.icon) return props.icon;
  if (props.variant === 'danger') return 'hand';
  if (props.variant === 'warning') return 'warning';
  return 'info';
});

const confirmClass = computed(() => (
  props.variant === 'danger'
    ? 'confirm-dialog__btn--danger'
    : 'confirm-dialog__btn--primary'
));
</script>

<style scoped>
.confirm-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
  min-width: min(420px, 90vw);
  /* Fill the Dialog's content area so the internal scroll region can
     bound itself. When the surrounding Dialog is auto-height and content
     is short, flex-basis:auto keeps the panel tight — this only kicks in
     when the Dialog's content area is height-constrained. */
  flex: 1;
  min-height: 0;
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  color: var(--color-text-primary);
  flex-shrink: 0;
}

/* Two-column content: icon badge left, text right. Mirrors GatePanel. */
.confirm-dialog__content {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 18px;
  text-align: left;
  flex: 1 1 auto;
  min-height: 0;
}

.confirm-dialog__icon {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  color: var(--color-accent);
}
.confirm-dialog__icon svg { width: 34px; height: 34px; }

.confirm-dialog--danger .confirm-dialog__icon {
  background: rgba(255, 107, 107, 0.16);
  color: #ff6b6b;
}
.confirm-dialog--warning .confirm-dialog__icon {
  background: rgba(255, 193, 7, 0.16);
  color: #ffc107;
}

.confirm-dialog__body {
  /* Only this region scrolls when the message/slot content overflows.
     min-height:0 lets the flex child actually shrink below its content
     height so overflow-y can take effect. */
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.confirm-dialog__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-line;
}

.confirm-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sm);
  justify-content: center;
  margin-top: var(--gap-sm);
  flex-shrink: 0;
}

.confirm-dialog__btn {
  padding: 12px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  min-width: 112px;
}

.confirm-dialog__btn--cancel {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.confirm-dialog__btn--cancel:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.confirm-dialog__btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}

.confirm-dialog__btn--danger:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}

.confirm-dialog__btn--primary {
  background: var(--gradient-accent);
  color: #fff;
}

.confirm-dialog__btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(26, 188, 156, 0.25);
}
</style>
