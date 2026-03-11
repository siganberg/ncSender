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

import type { M98Macro, M98MacroFormData, M98IdInfo } from './types';
import { getApiBaseUrl } from '@/lib/api-base';

const API_BASE = getApiBaseUrl();

export const m98Api = {
  async getMacros(): Promise<M98Macro[]> {
    const response = await fetch(`${API_BASE}/api/m98-macros`);
    if (!response.ok) {
      throw new Error('Failed to fetch macros');
    }
    return response.json();
  },

  async getMacro(id: number): Promise<M98Macro> {
    const response = await fetch(`${API_BASE}/api/m98-macros/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch macro');
    }
    return response.json();
  },

  async getNextId(): Promise<M98IdInfo> {
    const response = await fetch(`${API_BASE}/api/m98-macros/next-id`);
    if (!response.ok) {
      throw new Error('Failed to get next ID');
    }
    return response.json();
  },

  async createMacro(data: M98MacroFormData): Promise<M98Macro> {
    const response = await fetch(`${API_BASE}/api/m98-macros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create macro');
    }
    return response.json();
  },

  async updateMacro(id: number, data: Partial<M98MacroFormData>): Promise<M98Macro> {
    const response = await fetch(`${API_BASE}/api/m98-macros/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update macro');
    }
    return response.json();
  },

  async deleteMacro(id: number): Promise<void> {
    const response = await fetch(`${API_BASE}/api/m98-macros/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete macro');
    }
  },

  async executeMacro(id: number): Promise<{ success: boolean; message: string; commandsExecuted: number }> {
    const response = await fetch(`${API_BASE}/api/m98-macros/${id}/execute`, {
      method: 'POST'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Failed to execute macro');
    }
    return response.json();
  }
};

// Legacy API for backward compatibility
export const api = {
  async getMacros() {
    const macros = await m98Api.getMacros();
    return macros.map(m => ({
      id: String(m.id),
      name: m.name,
      description: m.description || undefined,
      commands: m.body,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt
    }));
  },

  async getMacro(id: string) {
    const macro = await m98Api.getMacro(parseInt(id, 10));
    return {
      id: String(macro.id),
      name: macro.name,
      description: macro.description || undefined,
      commands: macro.body,
      createdAt: macro.createdAt,
      updatedAt: macro.updatedAt
    };
  },

  async createMacro(data: { name: string; description?: string; commands: string }) {
    const macro = await m98Api.createMacro({
      name: data.name,
      description: data.description,
      body: data.commands
    });
    return {
      id: String(macro.id),
      name: macro.name,
      description: macro.description || undefined,
      commands: macro.body,
      createdAt: macro.createdAt,
      updatedAt: macro.updatedAt
    };
  },

  async updateMacro(id: string, data: Partial<{ name: string; description?: string; commands: string }>) {
    const macro = await m98Api.updateMacro(parseInt(id, 10), {
      name: data.name,
      description: data.description,
      body: data.commands
    });
    return {
      id: String(macro.id),
      name: macro.name,
      description: macro.description || undefined,
      commands: macro.body,
      createdAt: macro.createdAt,
      updatedAt: macro.updatedAt
    };
  },

  async deleteMacro(id: string) {
    await m98Api.deleteMacro(parseInt(id, 10));
  },

  async executeMacro(id: string) {
    return m98Api.executeMacro(parseInt(id, 10));
  }
};
