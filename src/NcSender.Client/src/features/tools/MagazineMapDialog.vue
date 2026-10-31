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

<!-- Tool ID numbering: a program uses tools no magazine slot holds. Offers to
     put them in the magazine (assigns their slots in the Tool Library, the
     program is never rewritten), or to leave them as hand changes. -->
<template>
  <Dialog :show-header="false" :close-on-backdrop-click="false" :z-index="10000" @close="emit('close')">
    <div class="mm">
      <header class="mm__head">
        <div class="mm__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="6.5" r="1.6" /><circle cx="17" cy="10" r="1.6" /><circle cx="15" cy="16" r="1.6" /><circle cx="9" cy="16" r="1.6" /><circle cx="7" cy="10" r="1.6" /></svg>
        </div>
        <div class="mm__heading">
          <h2 class="mm__title">{{ t('magazine.title') }}</h2>
          <p class="mm__sub">
            <span v-if="filename" class="mm__file">{{ filename }}</span>
            {{ t(missingCount === 1 ? 'magazine.summaryOne' : 'magazine.summaryMany', { tools: rows.length, missing: missingCount }) }}
          </p>
        </div>
      </header>

      <div class="mm__body">
        <section>
          <div class="mm__lbl">
            <span>{{ t('magazine.magazine') }}</span>
            <span class="mm__legend">
              <span><i class="mm__key mm__key--used"></i>{{ t('magazine.legendUsed') }}</span>
              <span><i class="mm__key mm__key--load"></i>{{ t('magazine.legendLoad') }}</span>
              <span><i class="mm__key"></i>{{ t('magazine.legendUnused') }}</span>
            </span>
          </div>
          <div class="mm__strip">
            <button
              v-show="stripOverflows"
              class="mm__scroll-btn"
              :disabled="atStart"
              :aria-label="t('magazine.scrollLeft')"
              @mousedown="startScrollPress(-1)" @mouseup="stopScrollPress" @mouseleave="stopScrollPress"
              @touchstart.prevent="startScrollPress(-1)" @touchend="stopScrollPress" @touchcancel="stopScrollPress"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 12L14 6L14 18L8 12Z" fill="currentColor" /></svg>
            </button>
            <div
              ref="stripEl"
              class="mm__slots"
              :class="{ 'mm__slots--dragging': dragging }"
              @scroll="updateEdges"
              @wheel="onWheel"
              @mousedown="onDragStart"
              @touchstart.passive="onDragStart"
              @touchmove="onDragMove"
              @touchend="onDragEnd"
              @touchcancel="onDragEnd"
            >
              <div
                v-for="s in slotView"
                :key="s.slot"
                class="mm__slot"
                :class="{ 'mm__slot--used': s.state === 'used', 'mm__slot--load': s.state === 'load', 'mm__slot--empty': s.state === 'empty' }"
                :data-slot="s.slot"
              >
                <span class="mm__slot-top">
                  <span class="mm__slot-n">{{ t('magazine.slot', { n: s.slot }) }}</span>
                  <span v-if="s.state === 'load'" class="mm__tag">{{ t('magazine.load') }}</span>
                </span>
                <span class="mm__slot-t">{{ s.toolId !== null ? `T${s.toolId}` : '—' }}</span>
                <span class="mm__slot-name">{{ s.toolId !== null ? s.name : t('magazine.empty') }}</span>
                <span v-if="s.out !== null" class="mm__slot-out">{{ t('magazine.out') }} <del>T{{ s.out }}</del></span>
              </div>
            </div>
            <button
              v-show="stripOverflows"
              class="mm__scroll-btn"
              :disabled="atEnd"
              :aria-label="t('magazine.scrollRight')"
              @mousedown="startScrollPress(1)" @mouseup="stopScrollPress" @mouseleave="stopScrollPress"
              @touchstart.prevent="startScrollPress(1)" @touchend="stopScrollPress" @touchcancel="stopScrollPress"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M16 12L10 6L10 18L16 12Z" fill="currentColor" /></svg>
            </button>
          </div>
          <div v-if="loads.length" class="mm__jumps">
            <button v-for="l in loads" :key="l.toolId" class="mm__jump" @click="scrollToSlot(l.slot)">
              T{{ l.toolId }} → {{ t('magazine.slot', { n: l.slot }).toLowerCase() }}
            </button>
          </div>
        </section>

        <section class="mm__toolsec">
          <div class="mm__lbl">
            <span>{{ t('magazine.programTools') }}</span>
            <span class="mm__legend">{{ t('magazine.programOrder') }}</span>
          </div>
          <div class="mm__rows">
            <div v-for="r in rows" :key="r.toolId" class="mm__row" :class="{ 'mm__row--map': !!plan[r.toolId] }">
              <span class="mm__chip">T{{ r.toolId }}</span>
              <div class="mm__who">
                <b>{{ r.tool ? (r.tool.name || `T${r.toolId}`) : t('magazine.unknownTool') }}</b>
                <small>{{ t('magazine.firstUsed', { line: r.line.toLocaleString() }) }}</small>
              </div>
              <span v-if="!r.tool" class="mm__state mm__state--bad">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3.5v.5" /></svg>
                {{ t('magazine.notInLibrary') }}
              </span>
              <span v-else-if="r.slot !== null" class="mm__state mm__state--ok">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                {{ t('magazine.inSlot', { n: r.slot }) }}
              </span>
              <button
                v-else
                class="mm__pick"
                :class="{ 'mm__pick--hand': !plan[r.toolId] }"
                @click="openPicker(r.toolId, $event)"
              >
                <span>{{ plan[r.toolId] ? t('magazine.loadInto', { n: plan[r.toolId] }) : t('magazine.byHand') }}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer class="mm__foot">
        <div class="mm__todo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
          <span v-if="error" class="mm__error">{{ error }}</span>
          <span v-else-if="loads.length">{{ t('magazine.beforeStart', { list: loadList }) }}</span>
          <span v-else>{{ t('magazine.nothingToLoad') }}</span>
        </div>
        <div class="mm__btns">
          <button class="mm__btn mm__btn--hand" :disabled="saving" @click="emit('close')">{{ t('magazine.changeByHand') }}</button>
          <button v-if="loads.length" class="mm__btn mm__btn--map" :disabled="saving" @click="applyMapping">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
            {{ t('magazine.mapTools') }}
          </button>
        </div>
      </footer>
    </div>

    <!-- Slot picker: fixed to the screen so the scrolling list never clips it -->
    <Teleport to="body">
      <div v-if="picker" class="mm-picker-overlay" @click="picker = null">
        <div class="mm-picker" :style="picker.style" @click.stop>
          <button
            v-for="o in pickerOptions"
            :key="o.slot"
            class="mm-picker__item"
            :class="{ 'mm-picker__item--active': plan[picker.toolId] === o.slot }"
            :disabled="o.disabled"
            @click="choose(o.slot)"
          >
            <span>{{ t('magazine.slot', { n: o.slot }) }}</span><em>{{ o.note }}</em>
          </button>
          <hr />
          <button class="mm-picker__item" :class="{ 'mm-picker__item--active': !plan[picker.toolId] }" @click="choose(0)">
            <span>{{ t('magazine.byHand') }}</span><em>{{ t('magazine.noSlot') }}</em>
          </button>
        </div>
      </div>
    </Teleport>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Dialog from '../../components/Dialog.vue';
import { api } from '../../lib/api.js';

const props = defineProps<{
  filename?: string;
  // The program's tools in order of first use, with that line (1-based)
  programTools: { toolId: number; line: number }[];
  slotCount: number;
  // The Tool Library as tool changes see it (Tool ID numbering)
  tools: any[];
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'mapped'): void }>();
// English only: Community has no UI languages.
const MESSAGES: Record<string, string> = {
  title: "Load tools into the magazine?",
  summaryOne: "uses {tools} tools. 1 isn't in the magazine.",
  summaryMany: "uses {tools} tools. {missing} aren't in the magazine.",
  magazine: "Magazine",
  legendUsed: "Used by this program",
  legendLoad: "Load here",
  legendUnused: "Not used",
  slot: "Slot {n}",
  load: "Load",
  empty: "Empty",
  out: "out:",
  scrollLeft: "Scroll slots left",
  scrollRight: "Scroll slots right",
  programTools: "Program tools",
  programOrder: "In program order",
  unknownTool: "Unknown tool",
  firstUsed: "First used at line {line}",
  notInLibrary: "Not in Tool Library · by hand",
  inSlot: "In slot {n}",
  loadInto: "Load into slot {n}",
  byHand: "Change by hand",
  noSlot: "no slot",
  noteUsed: "{tool} · used",
  notePicked: "picked",
  noteReplaces: "replaces {tool}",
  putInSlot: "{tool} in slot {n}",
  beforeStart: "Before Start, put {list}.",
  nothingToLoad: "Nothing to load. Tools outside the magazine are changed by hand.",
  changeByHand: "Change by hand",
  mapTools: "Map tools",
  saveFailed: "Couldn't save the slots: {reason}",
};
const t = (key: string, params: Record<string, unknown> = {}): string =>
  (MESSAGES[key.replace(/^magazine\./, '')] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));

const toolIdOf = (tool: any): number => tool?.toolId ?? tool?.id;
const byToolId = computed(() => {
  const m = new Map<number, any>();
  for (const tool of props.tools) m.set(toolIdOf(tool), tool);
  return m;
});
// slot -> Tool ID now
const slots = computed(() => {
  const m = new Map<number, number | null>();
  for (let s = 1; s <= props.slotCount; s++) m.set(s, null);
  for (const tool of props.tools) {
    const s = tool.toolNumber;
    if (Number.isInteger(s) && s >= 1 && s <= props.slotCount) m.set(s, toolIdOf(tool));
  }
  return m;
});
const used = computed(() => new Set(props.programTools.map(p => p.toolId)));
const slotOf = (toolId: number): number | null => {
  for (const [s, id] of slots.value) if (id === toolId) return s;
  return null;
};

const rows = computed(() => props.programTools.map(p => ({
  toolId: p.toolId,
  line: p.line,
  tool: byToolId.value.get(p.toolId) ?? null,
  slot: slotOf(p.toolId),
})));
const missingCount = computed(() => rows.value.filter(r => r.slot === null).length);

// Tool ID -> slot it goes in (0: hand change). Suggested on open: empty slots
// first, then slots whose tool this program doesn't use.
const plan = reactive<Record<number, number>>({});
const suggest = () => {
  const empty = [...slots.value].filter(([, id]) => id === null).map(([s]) => s);
  const spare = [...slots.value].filter(([, id]) => id !== null && !used.value.has(id)).map(([s]) => s);
  const free = empty.concat(spare);
  for (const r of rows.value) {
    if (r.tool && r.slot === null) plan[r.toolId] = free.shift() ?? 0;
  }
};
suggest();

const loads = computed(() => Object.entries(plan)
  .filter(([, s]) => s > 0)
  .map(([id, s]) => ({ toolId: Number(id), slot: s }))
  .sort((a, b) => a.slot - b.slot));
const loadList = computed(() => loads.value
  .map(l => t('magazine.putInSlot', { tool: `T${l.toolId}`, n: l.slot }))
  .join(', '));

const slotView = computed(() => {
  const incoming = new Map(loads.value.map(l => [l.slot, l.toolId]));
  return [...slots.value].map(([slot, now]) => {
    const next = incoming.get(slot) ?? now;
    const load = incoming.has(slot);
    return {
      slot,
      toolId: next,
      name: next !== null ? (byToolId.value.get(next)?.name ?? '') : '',
      out: load && now !== null ? now : null,
      state: load ? 'load' : next === null ? 'empty' : used.value.has(next) ? 'used' : 'unused',
    };
  });
});

// Slot picker
const picker = ref<{ toolId: number; style: Record<string, string> } | null>(null);
const openPicker = (toolId: number, ev: MouseEvent) => {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const width = Math.max(r.width, 260);
  const below = window.innerHeight - r.bottom;
  const style: Record<string, string> = {
    left: `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
  };
  if (below >= 240) { style.top = `${r.bottom + 6}px`; style.maxHeight = `${Math.min(320, below - 16)}px`; }
  else { style.bottom = `${window.innerHeight - r.top + 6}px`; style.maxHeight = `${Math.min(320, r.top - 16)}px`; }
  picker.value = { toolId, style };
};
const pickerOptions = computed(() => {
  if (!picker.value) return [];
  const me = picker.value.toolId;
  return [...slots.value].map(([slot, now]) => {
    const taken = Object.entries(plan).some(([id, s]) => s === slot && Number(id) !== me);
    const busy = now !== null && used.value.has(now);
    const note = busy ? t('magazine.noteUsed', { tool: `T${now}` })
      : taken ? t('magazine.notePicked')
      : now === null ? t('magazine.empty').toLowerCase()
      : t('magazine.noteReplaces', { tool: `T${now}` });
    return { slot, note, disabled: busy || taken };
  });
});
const choose = (slot: number) => {
  if (!picker.value) return;
  plan[picker.value.toolId] = slot;
  picker.value = null;
  if (slot) nextTick(() => scrollToSlot(slot));
};

// Map tools: one write of the whole library, so the slots never pass through
// a state where two tools share one.
const saving = ref(false);
const error = ref('');
const applyMapping = async () => {
  saving.value = true;
  error.value = '';
  try {
    const res = await fetch(`${api.baseUrl}/api/tools`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stored: any[] = await res.json();
    for (const { toolId, slot } of loads.value) {
      const tool = stored.find(x => toolIdOf(x) === toolId);
      if (!tool) continue;
      for (const other of stored) if (other !== tool && other.toolNumber === slot) other.toolNumber = null;
      tool.toolNumber = slot;
    }
    const put = await fetch(`${api.baseUrl}/api/tools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stored),
    });
    if (!put.ok) {
      const body = await put.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${put.status}`);
    }
    emit('mapped');
  } catch (e: any) {
    error.value = t('magazine.saveFailed', { reason: e?.message ?? String(e) });
  } finally {
    saving.value = false;
  }
};

// Slot strip: arrows (hold to scroll), drag with a finger or the mouse, and
// the wheel, like the tool buttons on the visualizer.
const stripEl = ref<HTMLElement | null>(null);
const stripOverflows = ref(false);
const atStart = ref(true);
const atEnd = ref(true);
const updateEdges = () => {
  const el = stripEl.value;
  if (!el) return;
  stripOverflows.value = el.scrollWidth > el.clientWidth + 4;
  atStart.value = el.scrollLeft <= 4;
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
};
const scrollToSlot = (slot: number) => {
  const el = stripEl.value;
  const tile = el?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!el || !tile) return;
  const off = tile.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
  el.scrollTo({ left: off - (el.clientWidth - tile.offsetWidth) / 2, behavior: 'smooth' });
};

let scrollDir = 0;
let scrollFrame: number | null = null;
const scrollStep = () => {
  if (!scrollDir || !stripEl.value) { scrollFrame = null; return; }
  stripEl.value.scrollLeft += scrollDir * 6;
  scrollFrame = requestAnimationFrame(scrollStep);
};
const startScrollPress = (dir: number) => {
  scrollDir = dir;
  if (scrollFrame === null) scrollFrame = requestAnimationFrame(scrollStep);
};
const stopScrollPress = () => { scrollDir = 0; };

const dragging = ref(false);
let dragX = 0;
let dragLeft = 0;
const pointX = (e: MouseEvent | TouchEvent) => ('touches' in e ? e.touches[0].clientX : e.clientX);
const onDragStart = (e: MouseEvent | TouchEvent) => {
  if (!stripEl.value) return;
  dragging.value = true;
  dragX = pointX(e);
  dragLeft = stripEl.value.scrollLeft;
  if (!('touches' in e)) {
    e.preventDefault();
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }
};
const onDragMove = (e: MouseEvent | TouchEvent) => {
  if (!dragging.value || !stripEl.value) return;
  const dx = dragX - pointX(e);
  if ('touches' in e && Math.abs(dx) > 8) e.preventDefault();
  stripEl.value.scrollLeft = dragLeft + dx;
};
const onDragEnd = () => {
  dragging.value = false;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
};
const onWheel = (e: WheelEvent) => {
  if (!stripEl.value || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  stripEl.value.scrollLeft += e.deltaY;
  e.preventDefault();
};

let resizeObserver: ResizeObserver | null = null;
onMounted(async () => {
  await nextTick();
  updateEdges();
  if (stripEl.value) {
    resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(stripEl.value);
  }
  if (loads.value.length) scrollToSlot(loads.value[0].slot);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  onDragEnd();
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
});
</script>

<style scoped>
.mm {
  /* The user's accent: "used" slots are solid, "load here" ones tinted */
  --mm-blue: var(--color-accent);
  --mm-blue-soft: color-mix(in srgb, var(--color-accent) 16%, transparent);
  --mm-ok: #22c55e;
  --mm-red: #e5484d;
  --mm-red-soft: rgba(229, 72, 77, 0.14);
  --mm-ok-soft: rgba(34, 197, 94, 0.14);
  width: min(860px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--color-text-primary);
}
@media (orientation: portrait) {
  .mm { width: min(960px, 92vw); max-height: 80vh; }
}

.mm__head { display: flex; gap: 14px; align-items: flex-start; padding: 20px 22px 16px; border-bottom: 1px solid var(--color-border); }
.mm__icon {
  flex: none; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: #fff;
  background: var(--color-accent); box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--color-accent) 70%, transparent);
}
.mm__heading { min-width: 0; }
.mm__title { font-size: 1.3rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.mm__sub { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 0.9rem; }
.mm__file {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; font-size: 0.82rem; color: var(--color-text-primary);
  background: var(--color-surface-muted); padding: 2px 7px; border-radius: 6px; margin-right: 4px; word-break: break-all;
}

.mm__body { padding: 16px 22px 0; display: flex; flex-direction: column; gap: 18px; min-height: 0; flex: 1; overflow: hidden; }
.mm__lbl {
  display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 9px;
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-text-secondary);
}
.mm__legend { display: flex; gap: 12px; flex-wrap: wrap; text-transform: none; letter-spacing: 0; font-weight: 500; }
.mm__legend > span { display: inline-flex; align-items: center; gap: 5px; }
.mm__key { width: 10px; height: 10px; border-radius: 3px; display: inline-block; background: var(--color-surface-muted); border: 1px solid var(--color-border); }
.mm__key--used { background: var(--color-accent); border-color: var(--color-accent); }
.mm__key--load { background: var(--mm-blue-soft); border: 1.5px dashed var(--mm-blue); }

/* Magazine strip */
.mm__strip { display: flex; align-items: stretch; gap: 8px; }
.mm__slots {
  flex: 1; min-width: 0; display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px;
  scrollbar-width: none; cursor: grab; user-select: none; touch-action: pan-y;
}
.mm__slots::-webkit-scrollbar { display: none; }
.mm__slots--dragging { cursor: grabbing; }
.mm__slot {
  flex: 1 0 108px; max-width: 150px; min-height: 84px; display: flex; flex-direction: column; gap: 3px;
  padding: 10px 10px 9px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-surface-muted);
}
.mm__slot-top { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
.mm__slot-n { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-text-secondary); white-space: nowrap; }
.mm__slot-t { font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; font-weight: 600; font-size: 1.1rem; }
.mm__slot-name { font-size: 0.72rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm__slot-out { margin-top: auto; font-size: 0.68rem; color: var(--color-text-secondary); }
.mm__slot--used { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
.mm__slot--used .mm__slot-n, .mm__slot--used .mm__slot-name { color: rgba(255, 255, 255, 0.85); }
.mm__slot--load { background: var(--mm-blue-soft); border: 1.5px dashed var(--mm-blue); }
.mm__slot--load .mm__slot-t { color: var(--mm-blue); }
.mm__slot--empty .mm__slot-t { color: var(--color-text-secondary); opacity: 0.6; }
.mm__tag { font-size: 0.56rem; font-weight: 700; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 6px; background: var(--mm-blue); color: #fff; text-transform: uppercase; }

/* Same as the tool buttons' scroll arrows, laid sideways */
.mm__scroll-btn {
  flex: none; display: flex; align-items: center; justify-content: center; width: 32px; padding: 0;
  background: var(--color-surface-muted-overlay, var(--color-surface-muted)); border: 1px solid var(--color-border);
  border-radius: var(--radius-small); color: var(--color-text-primary); cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}
.mm__scroll-btn:hover { background: var(--color-surface); }
.mm__scroll-btn:active { transform: scale(0.95); }
.mm__scroll-btn svg { opacity: 0.7; }
.mm__scroll-btn:disabled { opacity: 0.35; cursor: default; transform: none; }

.mm__jumps { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.mm__jump { font: inherit; font-size: 0.75rem; font-weight: 600; border: 0; border-radius: 999px; padding: 5px 10px; background: var(--mm-blue); color: #fff; cursor: pointer; }

/* Program tools: the only part that scrolls */
.mm__toolsec { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.mm__rows { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; padding-bottom: 16px; overscroll-behavior: contain; }
.mm__row {
  display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center;
  padding: 10px 12px; border-radius: 12px; background: var(--color-surface-muted); border: 1px solid transparent;
}
.mm__row--map { border-color: var(--mm-blue); background: linear-gradient(90deg, var(--mm-blue-soft), transparent 70%), var(--color-surface-muted); }
.mm__chip {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; font-weight: 600; font-size: 0.95rem; min-width: 52px; text-align: center;
  padding: 8px 4px; border-radius: 10px; background: var(--color-surface); border: 1px solid var(--color-border);
}
.mm__row--map .mm__chip { color: var(--mm-blue); }
.mm__who { min-width: 0; }
.mm__who b { display: block; font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm__who small { color: var(--color-text-secondary); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.mm__state { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; padding: 7px 11px; border-radius: 999px; white-space: nowrap; }
.mm__state--ok { background: var(--mm-ok-soft); color: var(--mm-ok); }
.mm__state--bad { background: var(--mm-red-soft); color: var(--mm-red); }
.mm__pick {
  display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 170px;
  font: inherit; font-size: 0.85rem; font-weight: 600; border: 0; border-radius: 10px; padding: 9px 12px;
  background: var(--mm-blue); color: #fff; cursor: pointer;
}
.mm__pick--hand { background: #64748b; }

/* Footer */
.mm__foot { display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 14px 22px 18px; border-top: 1px solid var(--color-border); }
.mm__todo { display: flex; align-items: center; gap: 10px; font-size: 0.84rem; color: var(--color-text-secondary); flex: 1 1 260px; min-width: 0; }
.mm__todo svg { flex: none; color: var(--mm-blue); }
.mm__error { color: var(--mm-red); }
.mm__btns { display: flex; gap: 10px; flex-wrap: wrap; }
.mm__btn { font: inherit; font-weight: 600; font-size: 0.95rem; border: 0; border-radius: 12px; padding: 13px 20px; cursor: pointer; color: #fff; display: inline-flex; align-items: center; gap: 8px; }
.mm__btn:disabled { opacity: 0.6; cursor: default; }
.mm__btn--hand { background: #64748b; }
.mm__btn--map { background: var(--color-accent); box-shadow: 0 10px 20px -10px color-mix(in srgb, var(--color-accent) 80%, transparent); }

@media (max-width: 640px) {
  .mm__row { grid-template-columns: auto 1fr; }
  .mm__row > .mm__pick, .mm__row > .mm__state { grid-column: 1 / -1; justify-self: stretch; }
  .mm__btns { width: 100%; }
  .mm__btn { flex: 1; justify-content: center; }
}
</style>

<style>
/* Teleported slot picker (outside the scoped tree) */
.mm-picker-overlay { position: fixed; inset: 0; z-index: 10001; }
.mm-picker {
  position: fixed; overflow-y: auto; padding: 6px; border-radius: 12px;
  background: var(--color-surface); color: var(--color-text-primary);
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--color-border);
}
.mm-picker hr { border: 0; border-top: 1px solid var(--color-border); margin: 4px 2px; }
.mm-picker__item {
  display: flex; width: 100%; justify-content: space-between; gap: 10px; padding: 11px 10px; border: 0; border-radius: 8px;
  background: none; color: inherit; font: inherit; font-size: 0.88rem; cursor: pointer; text-align: left;
}
.mm-picker__item:hover:not(:disabled) { background: var(--color-surface-muted); }
.mm-picker__item--active { background: color-mix(in srgb, var(--color-accent) 16%, transparent); }
.mm-picker__item:disabled { opacity: 0.4; cursor: default; }
.mm-picker__item em { font-style: normal; color: var(--color-text-secondary); font-size: 0.8rem; }
</style>
