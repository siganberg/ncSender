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
  Confirm prompt. The title is the question, left aligned; the buttons sit
  at the bottom right and say what they do. Three optional parts:
    why      one small line above the title, with the variant's glyph
    subject  the thing the prompt is about, as a card (subject-id is its
             short tag: "T12")
    icon     the badge beside the message, when there is neither
-->
<template>
  <div class="confirm-dialog" :class="`confirm-dialog--${variant}`">
    <div class="confirm-dialog__head">
      <span v-if="why" class="confirm-dialog__why">
        <PanelIcon :name="iconName" />
        {{ why }}
      </span>
      <h3 class="confirm-dialog__title">{{ title }}</h3>
    </div>
    <div v-if="subjectName" class="confirm-dialog__subject">
      <span v-if="subjectId" class="confirm-dialog__subject-id">{{ subjectId }}</span>
      <div class="confirm-dialog__subject-text">
        <b>{{ subjectName }}</b>
        <span v-if="subjectDetail">{{ subjectDetail }}</span>
      </div>
    </div>
    <div class="confirm-dialog__content">
      <div v-if="showIcon && !why && !subjectName" class="confirm-dialog__icon" aria-hidden="true">
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
  why?: string;
  subjectId?: string;
  subjectName?: string;
  subjectDetail?: string;
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
  gap: 20px;
  padding: 30px;
  min-width: min(560px, 92vw);
  /* Fill the Dialog's content area so the internal scroll region can
     bound itself. When the surrounding Dialog is auto-height and content
     is short, flex-basis:auto keeps the panel tight — this only kicks in
     when the Dialog's content area is height-constrained. */
  flex: 1;
  min-height: 0;
}

.confirm-dialog__head { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }

.confirm-dialog__why {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--color-accent);
}
.confirm-dialog__why svg { width: 18px; height: 18px; flex: none; }
.confirm-dialog--danger .confirm-dialog__why { color: #ff6b6b; }
.confirm-dialog--warning .confirm-dialog__why { color: #e9b949; }

.confirm-dialog__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-primary);
  text-wrap: balance;
}

/* The thing the prompt is about. */
.confirm-dialog__subject {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  flex-shrink: 0;
}
.confirm-dialog--danger .confirm-dialog__subject { border-color: color-mix(in srgb, #ff6b6b 50%, var(--color-border)); }
.confirm-dialog__subject-id {
  flex: none;
  padding: 6px 10px;
  border-radius: 8px;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 1.26rem;
  font-weight: 700;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
}
.confirm-dialog--danger .confirm-dialog__subject-id { color: #ff6b6b; background: rgba(255, 107, 107, 0.13); }
.confirm-dialog__subject-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.confirm-dialog__subject-text b { font-size: 1.15rem; font-weight: 600; color: var(--color-text-primary); overflow-wrap: anywhere; }
.confirm-dialog__subject-text span {
  font-size: 0.96rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

/* Badge left, text right. */
.confirm-dialog__content {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14px;
  text-align: left;
  flex: 1 1 auto;
  min-height: 0;
}

.confirm-dialog__icon {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  color: var(--color-accent);
}
.confirm-dialog__icon svg { width: 25px; height: 25px; }

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
  font-size: 1.05rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-line;
}

.confirm-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sm);
  justify-content: flex-end;
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.confirm-dialog__btn {
  padding: 14px 28px;
  border-radius: var(--radius-small);
  font-size: 1.14rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  min-width: 140px;
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
