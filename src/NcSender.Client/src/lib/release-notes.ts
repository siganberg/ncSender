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
  const html = notes
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
  return autolink(html);
}

/**
 * Turn bare URLs into anchors.
 *
 * Release notes are written by whoever cut the release, so a plain
 * `https://…` is at least as likely as markdown link syntax. Left as text it is
 * unreachable on the kiosk, where there is no way to select and copy it — and
 * the kiosk QR interceptor only ever sees real anchors.
 *
 * Only text between tags is rewritten, and never inside an existing <a>, so a
 * link that markdown already produced is not wrapped twice.
 */
function autolink(html: string): string {
  const BARE_URL = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;
  let depth = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<a[\s>]/i.test(part)) depth++;
        else if (/^<\/a>/i.test(part)) depth = Math.max(0, depth - 1);
        return part;
      }
      if (depth > 0) return part;
      return part.replace(BARE_URL, (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    })
    .join('');
}
