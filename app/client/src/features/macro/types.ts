export interface Macro {
  id: string;
  name: string;
  description?: string;
  commands: string;
  createdAt: string;
  updatedAt: string;
}

export interface MacroFormData {
  name: string;
  description?: string;
  commands: string;
}
