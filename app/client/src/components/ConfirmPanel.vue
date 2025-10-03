<template>
  <div class="confirm-dialog">
    <h3 class="confirm-dialog__title">{{ title }}</h3>
    <p v-if="message" class="confirm-dialog__message">{{ message }}</p>
    <slot />
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

const props = withDefaults(defineProps<{
  title: string;
  message?: string;
  showConfirm?: boolean;
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
}>(), {
  showConfirm: true,
  showCancel: true,
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'primary'
});

defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

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
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.confirm-dialog__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  margin-top: var(--gap-sm);
}

.confirm-dialog__actions:has(> :only-child) {
  justify-content: center;
}

.confirm-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
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

