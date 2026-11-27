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
  The Plugins tab: one tile per plugin tool, icon over name, in the order
  the user arranged. In edit mode tiles are dragged to reorder and hidden
  with the eye; hidden ones wait in a strip below. The arrangement lives in
  settings (pluginLauncher), so every screen shows the same one.

  No text of its own: the host passes `labels`, so the same file serves the
  edition with translations and the one without.
-->
<template>
  <div class="launcher" :class="{ 'launcher--editing': editing }">
    <div v-if="editing" class="launcher__bar">
      <span class="launcher__hint">{{ labels.hint }}</span>
      <button type="button" class="launcher__btn" @click="sortAZ">{{ labels.sortAZ }}</button>
    </div>

    <TransitionGroup tag="div" name="tile" class="launcher__grid" ref="grid">
      <component
        :is="editing ? 'div' : 'button'"
        v-for="item in visible"
        :key="keyOf(item)"
        :data-key="keyOf(item)"
        class="tile"
        :class="{ 'tile--dragging': dragKey === keyOf(item), 'tile--busy': busyKey === keyOf(item) }"
        :type="editing ? undefined : 'button'"
        :disabled="!editing && busyKey === keyOf(item) ? true : undefined"
        @click="!editing && emit('run', item)"
        @pointerdown="onPointerDown($event, item)"
      >
        <span class="tile__icon">
          <span v-if="item.icon && item.icon.startsWith('<')" class="tile__svg" v-html="item.icon"></span>
          <img v-else-if="item.icon" :src="iconUrl(item)" alt="" draggable="false" />
          <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3H7a1 1 0 0 0-1 1v3h3a2 2 0 1 1 0 4H6v3a1 1 0 0 0 1 1h3v-3a2 2 0 1 1 4 0v3h3a1 1 0 0 0 1-1v-3h-3a2 2 0 1 1 0-4h3V8a1 1 0 0 0-1-1z" />
          </svg>
          <span v-if="busyKey === keyOf(item)" class="tile__spinner"></span>
        </span>
        <span class="tile__name">{{ item.label }}</span>
        <button
          v-if="editing"
          type="button"
          class="tile__hide"
          :aria-label="`${labels.hide}: ${item.label}`"
          :title="labels.hide"
          @pointerdown.stop
          @click.stop="hide(item)"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" />
          </svg>
        </button>
      </component>
    </TransitionGroup>

    <!-- The tile in the hand: follows the pointer anywhere while its slot in
         the grid stays behind as a faint placeholder. -->
    <Teleport to="body">
      <div v-if="ghost" class="tile tile--ghost" :style="ghostStyle" aria-hidden="true">
        <span class="tile__icon">
          <span v-if="ghost.item.icon && ghost.item.icon.startsWith('<')" class="tile__svg" v-html="ghost.item.icon"></span>
          <img v-else-if="ghost.item.icon" :src="iconUrl(ghost.item)" alt="" />
          <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3H7a1 1 0 0 0-1 1v3h3a2 2 0 1 1 0 4H6v3a1 1 0 0 0 1 1h3v-3a2 2 0 1 1 4 0v3h3a1 1 0 0 0 1-1v-3h-3a2 2 0 1 1 0-4h3V8a1 1 0 0 0-1-1z" />
          </svg>
        </span>
        <span class="tile__name">{{ ghost.item.label }}</span>
      </div>
    </Teleport>

    <p v-if="!editing && visible.length === 0" class="launcher__empty">{{ labels.allHidden }}</p>

    <div v-if="editing && hiddenItems.length > 0" class="launcher__hidden">
      <span class="launcher__hidden-title">{{ labels.hidden }}</span>
      <div class="launcher__hidden-list">
        <button v-for="item in hiddenItems" :key="keyOf(item)" type="button" class="chip" @click="show(item)">
          <span class="chip__icon">
            <span v-if="item.icon && item.icon.startsWith('<')" class="tile__svg" v-html="item.icon"></span>
            <img v-else-if="item.icon" :src="iconUrl(item)" alt="" />
          </span>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '@/lib/api.js';
import { settingsStore, updateSettings } from '@/lib/settings-store.js';

export interface LauncherItem { pluginId: string; label: string; icon?: string; clientOnly?: boolean }
export interface LauncherLabels { hint: string; sortAZ: string; hide: string; hidden: string; allHidden: string }

const props = defineProps<{
  items: LauncherItem[];
  editing: boolean;
  busyKey: string | null;
  labels: LauncherLabels;
}>();
const emit = defineEmits<{ (e: 'run', item: LauncherItem): void }>();

const keyOf = (item: LauncherItem) => `${item.pluginId}-${item.label}`;
const iconUrl = (item: LauncherItem) =>
  `${api.baseUrl}/api/plugins/${item.pluginId}/icon?file=${encodeURIComponent(item.icon || '')}`;

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const saved = () => (settingsStore.data as any)?.pluginLauncher;

const order = ref<string[]>(list(saved()?.order));
const hidden = ref<string[]>(list(saved()?.hidden));

// Another screen rearranged them. Not while a tile is in the hand here.
watch(() => saved(), (value) => {
  if (dragKey.value) return;
  order.value = list(value?.order);
  hidden.value = list(value?.hidden);
});

// Arranged tiles first, in that order; anything installed since goes last.
const sorted = computed(() => {
  const rank = new Map(order.value.map((key, index) => [key, index]));
  return props.items
    .map((item, index) => ({ item, at: rank.get(keyOf(item)) ?? order.value.length + index }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.item);
});
const visible = computed(() => sorted.value.filter((item) => !hidden.value.includes(keyOf(item))));
const hiddenItems = computed(() => sorted.value.filter((item) => hidden.value.includes(keyOf(item))));

const save = async () => {
  try {
    await updateSettings({ pluginLauncher: { order: order.value, hidden: hidden.value } });
  } catch (error) {
    console.error('Failed to save plugin arrangement:', JSON.stringify(String(error)));
  }
};

const hide = (item: LauncherItem) => {
  order.value = sorted.value.map(keyOf);
  hidden.value = [...hidden.value, keyOf(item)];
  void save();
};
const show = (item: LauncherItem) => {
  hidden.value = hidden.value.filter((key) => key !== keyOf(item));
  void save();
};
const sortAZ = () => {
  order.value = [...props.items]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map(keyOf);
  void save();
};

// Drag to reorder: the tile under the pointer gives way as it is passed, so
// what is on screen is always what letting go will keep.
const grid = ref<{ $el: HTMLElement } | null>(null);
const dragKey = ref<string | null>(null);
let moved = false;
let settleUntil = 0;
const SLIDE_MS = 200;

const ghost = ref<{ item: LauncherItem; x: number; y: number; w: number; h: number; dx: number; dy: number } | null>(null);
const ghostStyle = computed(() => ghost.value && {
  left: `${ghost.value.x - ghost.value.dx}px`,
  top: `${ghost.value.y - ghost.value.dy}px`,
  width: `${ghost.value.w}px`,
  height: `${ghost.value.h}px`
});

const onPointerMove = (event: PointerEvent) => {
  if (!dragKey.value) return;
  if (ghost.value) { ghost.value.x = event.clientX; ghost.value.y = event.clientY; }
  const under = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
    ?.closest<HTMLElement>('.tile[data-key]');
  const overKey = under?.dataset.key;
  if (!overKey || overKey === dragKey.value || !grid.value?.$el.contains(under!)) return;
  // A tile sliding out of the way passes back under the pointer: wait for it to land.
  if (performance.now() < settleUntil) return;
  const keys = sorted.value.map(keyOf);
  const from = keys.indexOf(dragKey.value);
  const to = keys.indexOf(overKey);
  if (from < 0 || to < 0) return;
  keys.splice(to, 0, keys.splice(from, 1)[0]);
  order.value = keys;
  moved = true;
  settleUntil = performance.now() + SLIDE_MS;
};
const endDrag = () => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  if (dragKey.value && moved) void save();
  dragKey.value = null;
  ghost.value = null;
  moved = false;
};
const onPointerDown = (event: PointerEvent, item: LauncherItem) => {
  if (!props.editing || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  dragKey.value = keyOf(item);
  moved = false;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  ghost.value = {
    item, x: event.clientX, y: event.clientY, w: box.width, h: box.height,
    dx: event.clientX - box.left, dy: event.clientY - box.top
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
};

watch(() => props.editing, (on) => { if (!on) endDrag(); });
onUnmounted(endDrag);
</script>

<style scoped>
.launcher {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--gap-sm);
  min-height: 100%;
  box-sizing: border-box;
}

.launcher__bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.launcher__hint {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}
.launcher__btn {
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-small, 8px);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.launcher__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px 6px;
  align-content: start;
}

.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  min-height: 100px;
  padding: 10px 4px 6px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  cursor: pointer;
  box-sizing: border-box;
}
button.tile:hover:not(:disabled) { background: var(--color-surface-muted); }
button.tile:active:not(:disabled) .tile__icon { transform: scale(0.94); }
.tile--busy { opacity: 0.7; cursor: progress; }

.tile__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  color: var(--color-accent);
  transition: transform 0.1s ease;
}
.tile__icon img,
.tile__icon > svg,
.tile__svg :deep(svg) {
  width: 52px;
  height: 52px;
  object-fit: contain;
  display: block;
}
.tile__svg { display: grid; place-items: center; }
.tile__name {
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
}
.tile__spinner {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 26px;
  height: 26px;
  border: 3px solid color-mix(in srgb, var(--color-surface) 70%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: launcher-spin 1s linear infinite;
}
@keyframes launcher-spin { to { transform: rotate(360deg); } }

/* Edit mode: tiles become things to pick up, not buttons to press. */
.launcher--editing .tile {
  border: 1px dashed var(--color-border);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
/* The slot the held tile left behind. */
.launcher--editing .tile--dragging {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.launcher--editing .tile--dragging > * { visibility: hidden; }
.tile--ghost {
  position: fixed;
  z-index: 20000;
  margin: 0;
  pointer-events: none;
  border: 1px solid var(--color-accent);
  background: var(--color-surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  scale: 1.08;
  cursor: grabbing;
}
/* Tiles slide to their new place as one is dragged past, hidden or shown. */
.tile-move { transition: transform 0.2s ease; }
.tile-enter-active { transition: opacity 0.2s ease, scale 0.2s ease; }
.tile-enter-from { opacity: 0; scale: 0.8; }
.tile-leave-active { display: none; }
.launcher--editing .tile { transition: scale 0.12s ease, box-shadow 0.12s ease; }
.launcher--editing .tile.tile-move { transition: transform 0.2s ease, scale 0.12s ease, box-shadow 0.12s ease; }
@media (prefers-reduced-motion: reduce) {
  .tile-move, .tile-enter-active, .launcher--editing .tile, .launcher--editing .tile.tile-move { transition: none; }
}
.tile__hide {
  position: absolute;
  top: -6px;
  right: -2px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  cursor: pointer;
}

.launcher__empty {
  margin: 24px 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.launcher__hidden {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}
.launcher__hidden-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.launcher__hidden-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px 0 6px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}
.chip__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--color-accent);
}
.chip__icon img,
.chip__icon :deep(svg) {
  width: 30px;
  height: 30px;
  object-fit: contain;
}
</style>
