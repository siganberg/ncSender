/**
 * Kiosk link handling.
 *
 * The kiosk is a fullscreen Electron window on a machine that usually has no
 * browser, no keyboard and no way to close a window that opens on top of the
 * controls. So a link that would navigate away is intercepted and turned into
 * a QR code the operator scans with a phone instead.
 *
 * This is deliberately global rather than per-button. Links reach the user from
 * three directions — static anchors (View on GitHub), programmatic
 * `window.open` (update dialogs), and anchors generated at runtime from release
 * notes markdown — and every one of them has to behave the same way. A
 * capture-phase listener plus a patched `window.open` covers all three without
 * each call site having to remember.
 *
 * Outside kiosk mode nothing is installed and links behave normally.
 */
import { ref } from 'vue';

/** The URL currently being shown as a QR, or null when the overlay is closed. */
export const qrLink = ref<string | null>(null);

export function showLinkQr(url: string) { qrLink.value = url; }
export function dismissLinkQr() { qrLink.value = null; }

/** Only http(s) is worth a QR — a phone cannot do anything with file: or blob:. */
function isExternalHttp(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Same-origin links are the app navigating itself, not an outbound link.
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Install the interception. Safe to call more than once; only the first call
 * takes effect. Returns a teardown function for tests.
 */
export function installKioskLinkInterceptor(): () => void {
  if (installed) return () => {};
  installed = true;

  // Capture phase, so this runs before any component's own click handler and
  // before the browser's default navigation.
  const onClick = (ev: MouseEvent) => {
    if (ev.defaultPrevented || ev.button !== 0) return;
    const anchor = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!isExternalHttp(href)) return;
    ev.preventDefault();
    ev.stopPropagation();
    showLinkQr(anchor.href);
  };
  document.addEventListener('click', onClick, true);

  // Programmatic opens. Returning null matches what a blocked popup looks like,
  // so callers that check the result do not think the window is live.
  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = typeof url === 'string' ? url : url?.toString() ?? '';
    if (href && isExternalHttp(href)) { showLinkQr(new URL(href, window.location.href).href); return null; }
    return nativeOpen(url as any, target as any, features as any);
  }) as typeof window.open;

  return () => {
    document.removeEventListener('click', onClick, true);
    window.open = nativeOpen;
    installed = false;
  };
}
