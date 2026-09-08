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
  <Dialog :show-header="false" size="small-plus" max-width="920px" :z-index="10040" @close="close">
    <div class="tips" @keydown.left.prevent="prev" @keydown.right.prevent="next" tabindex="-1" ref="rootEl">
      <!-- Hero: the tip's video / image, or a generated illustration -->
      <div class="tips__hero" :class="{ 'tips__hero--media': hasMedia }">
        <template v-if="hasMedia">
          <video
            v-if="tip!.media!.type === 'video'"
            :key="'v' + tip!.id"
            class="tips__video"
            :src="mediaUrl"
            :poster="posterUrl"
            autoplay
            muted
            loop
            playsinline
            preload="auto"
            @error="mediaFailed = true"
          ></video>
          <img v-else :key="'i' + tip!.id" class="tips__video" :src="mediaUrl" alt="" @error="mediaFailed = true" />
        </template>
        <div v-else class="tips__illustration" :key="'ill' + (tip?.id ?? 0)">
          <span class="tips__ring tips__ring--1"></span>
          <span class="tips__ring tips__ring--2"></span>
          <svg class="tips__bulb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18h6" /><path d="M10 22h4" />
            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" />
          </svg>
        </div>

        <div class="tips__hero-top">
          <span class="tips__chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" /></svg>
            Tips &amp; Tricks
          </span>
          <span v-if="tip && tip.edition === 'pro'" class="tips__pro">Pro</span>
          <button class="tips__close" @click="close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div class="tips__progress" aria-hidden="true">
          <span class="tips__progress-bar" :style="{ width: progressPct + '%' }"></span>
        </div>
      </div>

      <!-- Copy -->
      <Transition name="tips-fade" mode="out-in">
        <div v-if="loading" key="loading" class="tips__body tips__body--empty">Loading tips…</div>
        <div v-else-if="!tip" key="empty" class="tips__body tips__body--empty">No tips available right now.</div>
        <div v-else :key="tip.id" class="tips__body">
          <div class="tips__meta">Tip {{ index + 1 }} of {{ tips.length }}</div>
          <h2 class="tips__title">{{ tip.title }}</h2>
          <p v-for="(para, i) in paragraphs" :key="i" class="tips__text">{{ para }}</p>
          <p v-if="tip.edition === 'pro' && edition !== 'pro'" class="tips__pro-note">
            <span class="tips__pro">Pro</span> This one is part of ncSender Pro.
          </p>
        </div>
      </Transition>

      <!-- Footer -->
      <footer class="tips__footer">
        <label class="tips__startup">
          <input type="checkbox" :checked="showAtStartup" @change="onStartupToggle" />
          <span class="tips__checkbox" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          <span>Show at startup</span>
        </label>
        <div class="tips__nav">
          <button class="tips__btn tips__btn--ghost" @click="prev" :disabled="tips.length < 2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            Previous
          </button>
          <button class="tips__btn tips__btn--primary" @click="next" :disabled="tips.length < 2">
            Next
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </footer>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Dialog from './Dialog.vue';
import { api } from '@/lib/api.js';

interface TipMedia { type: 'video' | 'image'; src: string; poster?: string | null }
interface Tip { id: number; title: string; body: string; media?: TipMedia | null; edition: 'all' | 'pro'; minVersion?: string | null }
interface TipsResponse { edition: string; version: string; online: boolean; fetchedAt?: string | null; tips: Tip[] }

const props = defineProps<{
  // Tip of the day: start on the first tip after the one shown last time,
  // wrapping to the beginning once every tip has been seen.
  startAfterId?: number;
  showAtStartup: boolean;
}>();

const emit = defineEmits<{
  (e: 'close', lastShownId: number | null): void;
  (e: 'update:showAtStartup', value: boolean): void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const tips = ref<Tip[]>([]);
const edition = ref('');
const index = ref(0);
const loading = ref(true);
const mediaFailed = ref(false);

const tip = computed(() => tips.value[index.value] ?? null);
const hasMedia = computed(() => !!tip.value?.media && !mediaFailed.value);
const paragraphs = computed(() => (tip.value?.body ?? '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean));
const mediaUrl = computed(() => tip.value?.media ? `${api.baseUrl}${tip.value.media.src}` : '');
const posterUrl = computed(() => tip.value?.media?.poster ? `${api.baseUrl}${tip.value.media.poster}` : undefined);
const progressPct = computed(() => tips.value.length ? ((index.value + 1) / tips.value.length) * 100 : 0);

watch(index, () => { mediaFailed.value = false; });

const load = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${api.baseUrl}/api/tips?refresh=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as TipsResponse;
    tips.value = data.tips ?? [];
    edition.value = data.edition ?? '';
    const after = props.startAfterId ?? 0;
    const nextIdx = tips.value.findIndex(t => t.id > after);
    index.value = nextIdx >= 0 ? nextIdx : 0;
  } catch (err) {
    console.error('Failed to load tips:', err);
    tips.value = [];
  } finally {
    loading.value = false;
    await nextTick();
    rootEl.value?.focus();
  }
};

const next = () => { if (tips.value.length) index.value = (index.value + 1) % tips.value.length; };
const prev = () => { if (tips.value.length) index.value = (index.value - 1 + tips.value.length) % tips.value.length; };
const close = () => emit('close', tip.value?.id ?? null);
const onStartupToggle = (e: Event) => emit('update:showAtStartup', (e.target as HTMLInputElement).checked);

onMounted(load);
</script>

<style scoped>
.tips {
  display: flex;
  flex-direction: column;
  /* Fixed footprint so the card doesn't resize as tips change. The hero
     is exactly 16:9 of the card width (screen recordings fill it with no
     side bars) and the copy + footer add a fixed 250px below it, so the
     width is also capped by what fits in 90vh. */
  --tips-copy-height: 174px;
  --tips-footer-height: 76px;
  width: min(920px, 94vw, calc((90vh - var(--tips-copy-height) - var(--tips-footer-height)) * 16 / 9));
  outline: none;
  border-radius: 16px;
  overflow: hidden;
}

/* ---- Hero ---- */
.tips__hero {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #0b0d12;
  overflow: hidden;
}

.tips__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tips__illustration {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 90% at 20% 0%, rgba(245, 158, 11, 0.28), transparent 60%),
    radial-gradient(90% 90% at 100% 100%, rgba(99, 102, 241, 0.30), transparent 60%),
    linear-gradient(160deg, #161a24, #0b0d12);
  color: #f5b544;
}
.tips__bulb {
  width: 96px;
  height: 96px;
  filter: drop-shadow(0 8px 24px rgba(245, 158, 11, 0.35));
  animation: tips-float 4s ease-in-out infinite;
}
.tips__ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(245, 158, 11, 0.22);
}
.tips__ring--1 { width: 200px; height: 200px; }
.tips__ring--2 { width: 300px; height: 300px; border-color: rgba(245, 158, 11, 0.12); }

@keyframes tips-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.tips__hero-top {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tips__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 8px;
  border-radius: 999px;
  background: rgba(10, 12, 18, 0.72);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  backdrop-filter: none;
}
.tips__chip svg { width: 14px; height: 14px; color: #f5b544; }

.tips__pro {
  display: inline-block;
  font-size: 0.62rem;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  padding: 3px 7px;
  border-radius: 5px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  line-height: 1.1;
}

.tips__close {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(10, 12, 18, 0.72);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.tips__close svg { width: 16px; height: 16px; }
.tips__close:hover { background: rgba(255, 255, 255, 0.18); transform: scale(1.05); }

.tips__progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
}
.tips__progress-bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  transition: width 0.3s ease;
}

/* ---- Copy ---- */
.tips__body {
  padding: 22px 32px 8px;
  flex: 0 0 auto;
  height: var(--tips-copy-height);
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tips__body--empty {
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}
.tips__meta {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f5b544;
}
.tips__title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--color-text-primary);
}
.tips__text {
  margin: 0;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.tips__pro-note {
  margin: 4px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.tips-fade-enter-active, .tips-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.tips-fade-enter-from { opacity: 0; transform: translateX(12px); }
.tips-fade-leave-to { opacity: 0; transform: translateX(-12px); }

/* ---- Footer ---- */
.tips__footer {
  flex: 0 0 auto;
  height: var(--tips-footer-height);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 24px 0 32px;
}

.tips__startup {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.92rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
}
.tips__startup input { position: absolute; opacity: 0; width: 0; height: 0; }
.tips__checkbox {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
  background: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.tips__checkbox svg { width: 13px; height: 13px; opacity: 0; transition: opacity 0.15s ease; }
.tips__startup input:checked + .tips__checkbox { background: var(--color-accent); border-color: var(--color-accent); }
.tips__startup input:checked + .tips__checkbox svg { opacity: 1; }
.tips__startup input:focus-visible + .tips__checkbox { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 35%, transparent); }

.tips__nav { display: flex; gap: 10px; }

.tips__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 118px;
  justify-content: center;
  padding: 11px 18px;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.tips__btn svg { width: 16px; height: 16px; }
.tips__btn:disabled { opacity: 0.5; cursor: default; }
.tips__btn:not(:disabled):hover { transform: translateY(-1px); }

.tips__btn--ghost {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-primary);
}
.tips__btn--ghost:not(:disabled):hover { border-color: var(--color-text-secondary); }

.tips__btn--primary {
  background: var(--color-accent);
  color: #fff;
}
.tips__btn--primary:not(:disabled):hover { filter: brightness(1.08); }

@media (max-width: 560px) {
  .tips { --tips-copy-height: 150px; --tips-footer-height: 64px; }
  .tips__body { padding: 16px 20px 4px; }
  .tips__title { font-size: 1.2rem; }
  .tips__footer { padding: 0 16px 0 20px; }
  .tips__btn { min-width: 0; padding: 10px 14px; }
}
</style>
