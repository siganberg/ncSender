const EMOJI_MAP: Record<string, string> = {
  rocket: '🚀', bug: '🐛', wrench: '🔧', sparkles: '✨', fire: '🔥',
  tada: '🎉', zap: '⚡', boom: '💥', hammer: '🔨', gear: '⚙️',
  package: '📦', lock: '🔒', warning: '⚠️', bulb: '💡', memo: '📝',
  construction: '🚧', white_check_mark: '✅', x: '❌', star: '⭐',
  heavy_check_mark: '✔️', arrow_up: '⬆️', arrow_down: '⬇️',
  art: '🎨', ambulance: '🚑', pencil2: '✏️', lipstick: '💄',
  rotating_light: '🚨', triangular_flag_on_post: '🚩',
};

export function renderReleaseNotesMarkdown(notes: string): string {
  if (!notes) return '';
  return notes
    .replace(/:([a-z0-9_]+):/g, (_, name) => EMOJI_MAP[name] || `:${name}:`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '<br>')
    .replace(/\n/g, ' ');
}
