import type { Macro, MacroFormData } from './types';

function getBaseUrl() {
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:8090';
    } else if (window.location.port === '5174') {
      const hostname = window.location.hostname;
      return `http://${hostname}:8090`;
    }
  }
  return '';
}

const API_BASE = getBaseUrl();

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
  }
};
