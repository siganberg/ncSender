// Tool library type ids and their display names, in menu order.
// The server's list is ToolTypes in NcSender.Core.
export const TOOL_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'flat', label: 'Flat End Mill' },
  { value: 'ball', label: 'Ball End Mill' },
  { value: 'v-bit', label: 'V-Bit' },
  { value: 'drill', label: 'Drill' },
  { value: 'chamfer', label: 'Chamfer' },
  { value: 'surfacing', label: 'Surfacing' },
  { value: 'thread-mill', label: 'Thread Mill' },
  { value: 'drag-knife', label: 'Drag Knife' },
  { value: 'pen', label: 'Pen / Marker' },
  { value: 'probe', label: 'Probe' },
];

const LABELS: Record<string, string> = Object.fromEntries(TOOL_TYPES.map(t => [t.value, t.label]));

export const toolTypeLabel = (type: string): string => LABELS[type?.toLowerCase()] ?? type;

// The server refuses M3/M4 while one of these is loaded.
const NON_SPINNING = new Set(['probe', 'drag-knife', 'pen']);

export const neverSpins = (type: string | undefined): boolean =>
  !!type && NON_SPINNING.has(type.toLowerCase());
