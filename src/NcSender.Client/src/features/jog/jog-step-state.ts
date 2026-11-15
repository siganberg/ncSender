/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import { reactive, watch } from 'vue';
import { updateSettings } from '@/lib/settings-store.js';

type StepGroups = Record<number, { step: number; feedRate: number }>;

// Each step group's step and feed, shared by every step control so they
// agree, and saved in settings (jogChoices) with the step and feed picked.
// They're read when a screen loads, never live: one screen's pick doesn't
// change the step under another screen's jog.

// Metric: step in mm, feed rate in mm/min
export const categoryStateMetric = reactive<StepGroups>({
  0: { step: 0.1, feedRate: 500 },
  1: { step: 1, feedRate: 3000 },
  2: { step: 10, feedRate: 6000 }
});

// Imperial: step in inches, feed rate in in/min
export const categoryStateImperial = reactive<StepGroups>({
  0: { step: 0.01, feedRate: 20 },
  1: { step: 0.1, feedRate: 100 },
  2: { step: 1, feedRate: 200 }
});

const SAVE_DELAY_MS = 500;

type JogChoice = { stepSize: number; feedRate: number };

const positive = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const snapshot = (jogConfig: JogChoice) => JSON.stringify({
  stepSize: jogConfig.stepSize,
  feedRate: jogConfig.feedRate,
  groups: { metric: categoryStateMetric, imperial: categoryStateImperial }
});

let lastSaved = '';
let saveTimer: number | null = null;

function applyGroups(target: StepGroups, saved: any) {
  for (const index of [0, 1, 2]) {
    const group = saved?.[index];
    if (positive(group?.step) && positive(group?.feedRate)) {
      Object.assign(target[index], { step: group.step, feedRate: group.feedRate });
    }
  }
}

export function applySavedJog(jog: any, jogConfig: JogChoice): void {
  if (!jog || typeof jog !== 'object') return;
  applyGroups(categoryStateMetric, jog.groups?.metric);
  applyGroups(categoryStateImperial, jog.groups?.imperial);
  if (positive(jog.stepSize)) jogConfig.stepSize = jog.stepSize;
  if (positive(jog.feedRate)) jogConfig.feedRate = jog.feedRate;
  lastSaved = snapshot(jogConfig);
}

export function rememberJogChoices(jogConfig: JogChoice): void {
  lastSaved = snapshot(jogConfig);
  watch(() => snapshot(jogConfig), (json) => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (json === lastSaved) return;
      lastSaved = json;
      updateSettings({ jogChoices: JSON.parse(json) }).catch((error: any) => {
        console.error('Failed to save jog choices:', JSON.stringify(error?.message ?? String(error)));
      });
    }, SAVE_DELAY_MS);
  });
}

// The step and feed a step group was left at, for switching units.
export function savedStepGroup(imperial: boolean, index: number): { step: number; feedRate: number } {
  return (imperial ? categoryStateImperial : categoryStateMetric)[index];
}
