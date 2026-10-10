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
  Says whether a setting is on its recommended value, next to the control
  itself. A plain "Recommended: On" badge beside a title read the same whether
  the toggle already matched it or not, so people couldn't tell if they were
  fine or meant to change something. Matching: a quiet green check. Not
  matching: what is recommended, and a button that applies it.
-->
<template>
  <span v-if="matches" class="reco reco--ok">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    Recommended setting
  </span>
  <span v-else class="reco reco--suggest">
    <span class="reco__text">Recommended: {{ value }}</span>
    <button type="button" class="reco__apply" :disabled="disabled" @click="$emit('apply')">Use recommended</button>
  </span>
</template>

<script setup lang="ts">
defineProps<{ matches: boolean; value: string; disabled?: boolean }>();
defineEmits<{ (e: 'apply'): void }>();
</script>

<style scoped>
.reco {
  display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
  font-size: 0.8rem; font-weight: 600;
}
.reco svg { width: 13px; height: 13px; }
.reco--ok { color: #3ecf8e; }
.reco--suggest { color: var(--color-accent); }
.reco__apply {
  padding: 4px 10px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 0.78rem;
  border: none;
  background: var(--color-accent); color: #fff;
}
.reco__apply:not(:disabled):hover { filter: brightness(1.08); }
.reco__apply:disabled { opacity: 0.5; cursor: default; }
</style>
