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

import type { Macro, MacroFormData } from './types';
import { getApiBaseUrl } from '@/lib/api-base';

const API_BASE = getApiBaseUrl();

export const api = {
  async getMacros(): Promise<Macro[]> {
    const response = await fetch(`${API_BASE}/api/macros`);
    if (!response.ok) {
      throw new Error('Failed to fetch macros');
    }
    return response.json();
  },

  async getMacro(id: string): Promise<Macro> {
    const response = await fetch(`${API_BASE}/api/macros/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch macro');
    }
    return response.json();
  },

  async createMacro(data: MacroFormData): Promise<Macro> {
    const response = await fetch(`${API_BASE}/api/macros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      throw new Error('Failed to create macro');
    }
    return response.json();
  },

  async updateMacro(id: string, data: Partial<MacroFormData>): Promise<Macro> {
    const response = await fetch(`${API_BASE}/api/macros/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      throw new Error('Failed to update macro');
    }
    return response.json();
  },

  async deleteMacro(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/macros/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error('Failed to delete macro');
    }
  },

  async executeMacro(id: string): Promise<{ success: boolean; message: string; commandsExecuted: number }> {
    const response = await fetch(`${API_BASE}/api/macros/${id}/execute`, {
      method: 'POST'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to execute macro');
    }
    return response.json();
  }
};
