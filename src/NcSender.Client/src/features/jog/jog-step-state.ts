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
const categoryStateMetric = jogPanelStepGroups.metric;
const categoryStateImperial = jogPanelStepGroups.imperial;

// Expanded options for each step category (in mm)
export const expandedOptionsMap: Record<number, number[]> = {
  0: [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],  // Small steps
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9],                                   // Medium steps
  2: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300]  // Large steps
};

// Expanded options for imperial mode (in inches)
export const expandedOptionsMapImperial: Record<number, number[]> = {
  0: [0.001, 0.005, 0.01, 0.015625, 0.02, 0.03125, 0.03, 0.04, 0.05, 0.06, 0.0625, 0.07, 0.08, 0.09],
  1: [0.1, 0.125, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.625, 0.7, 0.75, 0.8, 0.9],
  2: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
};

// Feed rate options per category for metric (mm/min)
export const feedRateOptionsByCategory = [
  [300, 400, 500, 700, 1000],
  [1000, 2000, 3000, 4000, 5000],
  [6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000]
];

// Feed rate options per category for imperial (in/min)
export const feedRateOptionsByCategoryImperial = [
  [10, 15, 20, 30, 40],
  [40, 60, 80, 100, 150, 200],
  [200, 250, 300, 400, 500, 600]
];

const SAVE_DELAY_MS = 500;

const positive = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const offered = (list: number[] | undefined, value: any) =>
  positive(value) && !!list?.some((option) => Math.abs(option - value) < 1e-9);

// Only steps and feeds the step panel offers for that group are restored.
function applyGroups(target: StepGroups, saved: any, imperial: boolean) {
  const steps = imperial ? expandedOptionsMapImperial : expandedOptionsMap;
  const feeds = imperial ? feedRateOptionsByCategoryImperial : feedRateOptionsByCategory;
  for (const index of [0, 1, 2]) {
    const group = saved?.[index];
    if (offered(steps[index], group?.step) && offered(feeds[index], group?.feedRate)) {
      Object.assign(target[index], { step: group.step, feedRate: group.feedRate });
    }
  }
}

// The fastest step group's feed, in the units shown.
export function fastestStepFeed(imperial: boolean): number {
  const state = imperial ? categoryStateImperial : categoryStateMetric;
  return Math.max(...Object.values(state).map((group) => group.feedRate));
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
  applyGroups(categoryStateMetric, saved?.groups?.metric, false);
  applyGroups(categoryStateImperial, saved?.groups?.imperial, true);
  const imperial = units === 'imperial';
  const middle = savedStepGroup(imperial, 1);
  const groups = imperial ? categoryStateImperial : categoryStateMetric;
  const same = saved?.units === units
    && Object.values(groups).some((g) => g.step === saved?.stepSize && g.feedRate === saved?.feedRate);
  jogConfig.stepSize = same ? saved.stepSize : middle.step;
  jogConfig.feedRate = same ? saved.feedRate : middle.feedRate;
}

export function rememberJogChoices(jogConfig: JogChoice, units: () => Units): void {
  let timer: number | null = null;
  let pending: string | null = null;
  const save = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending === null) return;
    try {
      localStorage.setItem(STORAGE_KEY, pending);
    } catch (error: any) {
      console.error('Failed to save jog choices:', JSON.stringify(error?.message ?? String(error)));
    }
    pending = null;
  };
  watch(
    () => JSON.stringify({
      units: units(),
      stepSize: jogConfig.stepSize,
      feedRate: jogConfig.feedRate,
      groups: { metric: categoryStateMetric, imperial: categoryStateImperial }
    }),
    (json) => {
      pending = json;
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_DELAY_MS);
    }
  );
  window.addEventListener('pagehide', save);
  // A phone may close a backgrounded tab without a pagehide.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}
