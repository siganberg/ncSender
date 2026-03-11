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
  settings: Record<string, any> | null;
  macros: any[];
  firmware: any | null;
  plugins: any[];
  commandHistory: string[];
  tools: any[];
  serverState: Record<string, any>;
  isKiosk?: boolean;
  screenRotation?: string;
  isLocal?: boolean;
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

    // Populate settings store
    settingsStore.data = data.settings;
    settingsStore.loaded = true;

    return data;
  }).catch((error) => {
    console.error('Failed to load init data:', error);
    settingsStore.error = error;
    settingsStore.loaded = true;
    throw error;
  });

  return initPromise;
}

export function getInitData(): InitData | null {
  return initData;
}

export function getMacrosFromInit(): any[] {
  return initData?.macros || [];
}

export function getFirmwareFromInit(): any | null {
  return initData?.firmware || null;
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

export function getServerStateFromInit(): Record<string, any> {
  return initData?.serverState || {};
}
