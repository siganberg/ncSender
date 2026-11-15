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

type StepGroups = Record<number, { step: number; feedRate: number }>;
type Units = 'metric' | 'imperial';
type JogChoice = { stepSize: number; feedRate: number };

// The jog panel's step groups (each group's step and feed), shared by the
// step controls that drive the jog panel (jog panel, mobile view). With the
// step and feed picked, they're kept in this screen's browser storage, so
// each screen comes back as it was left, without changing the step under
// another screen's jog or touching server settings. Other step controls
// (probe dialog, plugins) keep their own groups.
const STORAGE_KEY = 'ncsender-jog-choices';

export function createStepGroups(): { metric: StepGroups; imperial: StepGroups } {
  return {
    // Metric: step in mm, feed rate in mm/min
    metric: reactive<StepGroups>({
      0: { step: 0.1, feedRate: 500 },
      1: { step: 1, feedRate: 3000 },
      2: { step: 10, feedRate: 6000 }
    }),
    // Imperial: step in inches, feed rate in in/min
    imperial: reactive<StepGroups>({
      0: { step: 0.01, feedRate: 20 },
      1: { step: 0.1, feedRate: 100 },
      2: { step: 1, feedRate: 200 }
    })
  };
}

export const jogPanelStepGroups = createStepGroups();
export const categoryStateMetric = jogPanelStepGroups.metric;
export const categoryStateImperial = jogPanelStepGroups.imperial;

const SAVE_DELAY_MS = 500;

const positive = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function applyGroups(target: StepGroups, saved: any) {
  for (const index of [0, 1, 2]) {
    const group = saved?.[index];
    if (positive(group?.step) && positive(group?.feedRate)) {
      Object.assign(target[index], { step: group.step, feedRate: group.feedRate });
    }
  }
}

// The step and feed a step group was left at.
export function savedStepGroup(imperial: boolean, index: number): { step: number; feedRate: number } {
  return (imperial ? categoryStateImperial : categoryStateMetric)[index];
}

// Restores this screen's step groups, and the step and feed it picked when
// they were picked in the same units; otherwise the middle group as left.
export function restoreJogChoices(jogConfig: JogChoice, units: Units): void {
  let saved: any = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  applyGroups(categoryStateMetric, saved?.groups?.metric);
  applyGroups(categoryStateImperial, saved?.groups?.imperial);
  const middle = savedStepGroup(units === 'imperial', 1);
  const same = saved?.units === units && positive(saved?.stepSize) && positive(saved?.feedRate);
  jogConfig.stepSize = same ? saved.stepSize : middle.step;
  jogConfig.feedRate = same ? saved.feedRate : middle.feedRate;
}

export function rememberJogChoices(jogConfig: JogChoice, units: () => Units): void {
  let timer: number | null = null;
  watch(
    () => JSON.stringify({
      units: units(),
      stepSize: jogConfig.stepSize,
      feedRate: jogConfig.feedRate,
      groups: { metric: categoryStateMetric, imperial: categoryStateImperial }
    }),
    (json) => {
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        try {
          localStorage.setItem(STORAGE_KEY, json);
        } catch (error: any) {
          console.error('Failed to save jog choices:', JSON.stringify(error?.message ?? String(error)));
        }
      }, SAVE_DELAY_MS);
    }
  );
}
