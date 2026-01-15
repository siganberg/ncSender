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

import { api } from './api.js';
import { settingsStore } from './settings-store.js';

export interface InitData {
  settings: any;
  macros: any[];
  firmware: any;
  plugins: any[];
  commandHistory: string[];
  tools: any[];
  serverState: any;
}

let initData: InitData | null = null;
let initPromise: Promise<InitData> | null = null;

export async function loadInitData(): Promise<InitData> {
  if (initData) {
    return initData;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = api.getInit().then((data: InitData) => {
    initData = data;

    // Pre-populate settings store
    settingsStore.data = data.settings;
    settingsStore.loaded = true;

    return data;
  });

  return initPromise;
}

export function getInitData(): InitData | null {
  return initData;
}

export function getMacrosFromInit(): any[] {
  return initData?.macros || [];
}

export function getPluginsFromInit(): any[] {
  return initData?.plugins || [];
}

export function getCommandHistoryFromInit(): string[] {
  return initData?.commandHistory || [];
}

export function getToolsFromInit(): any[] {
  return initData?.tools || [];
}

export function getFirmwareFromInit(): any {
  return initData?.firmware || null;
}
