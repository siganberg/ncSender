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
  "Close now?" for the setup guides. Close is always available; this only
  appears when closing would interrupt something that matters (a move, a
  controller restart, measurements not yet saved). Sits over the guide's own
  window, so it reads as part of it rather than a second dialog.
-->
<template>
  <div class="wcc" role="alertdialog" aria-modal="true" @click.self="emit('keep')">
    <div class="wcc__card">
      <span class="wcc__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      </span>
      <h3 class="wcc__title">{{ title }}</h3>
      <p class="wcc__text">{{ message }}</p>
      <div class="wcc__btns">
        <button type="button" class="wcc__btn wcc__btn--ghost" @click="emit('close')">{{ closeLabel }}</button>
        <button type="button" class="wcc__btn wcc__btn--primary" @click="emit('keep')">{{ keepLabel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; message: string; keepLabel: string; closeLabel: string }>();
const emit = defineEmits<{ (e: 'keep'): void; (e: 'close'): void }>();
</script>

<style scoped>
.wcc {
  position: absolute; inset: 0; z-index: 5;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  background: rgba(0, 0, 0, 0.55); border-radius: inherit;
}
.wcc__card {
  width: min(440px, 100%); padding: 24px 24px 20px; border-radius: 14px;
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.wcc__icon {
  width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(217, 83, 79, 0.16); color: #ff8888;
}
.wcc__icon svg { width: 24px; height: 24px; }
.wcc__title { margin: 4px 0 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-primary); }
.wcc__text { margin: 0; color: var(--color-text-secondary); line-height: 1.5; font-size: 0.92rem; }
.wcc__btns { display: flex; gap: 10px; margin-top: 12px; width: 100%; }
.wcc__btn {
  flex: 1 1 0; padding: 11px 16px; border-radius: 10px; cursor: pointer;
  font: inherit; font-size: 0.95rem; font-weight: 600; border: 1.5px solid transparent;
}
.wcc__btn--ghost { background: #d9534f; color: #fff; }
.wcc__btn--primary { background: var(--color-accent); color: #fff; }
.wcc__btn:hover { filter: brightness(1.08); }
</style>
