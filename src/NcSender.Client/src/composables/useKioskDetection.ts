import { ref, onMounted } from 'vue';

/**
 * Single-shot check of whether the client is running inside the Electron
 * kiosk shell (ncsender-desktop launched with NCSENDER_KIOSK=1).
 *
 * The preload exposes `window.ncSender.app.isKiosk()` as an async IPC call
 * (see LicenseGate.vue for the same detection). Remote browser tabs and
 * non-kiosk desktop windows don't have `window.ncSender` at all, so the
 * default is false — which is what the "Download Backup" flow expects.
 *
 * Cached at module scope so we don't call the IPC on every mount.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function detect(): Promise<boolean> {
  if (cached !== null) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const api = (window as any).ncSender;
      const isKiosk = api?.app?.isKiosk ? await api.app.isKiosk() : false;
      cached = !!isKiosk;
      return cached;
    } catch {
      cached = false;
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function useKioskDetection() {
  const isKiosk = ref(false);
  const ready = ref(false);
  onMounted(async () => {
    isKiosk.value = await detect();
    ready.value = true;
  });
  return { isKiosk, ready };
}
