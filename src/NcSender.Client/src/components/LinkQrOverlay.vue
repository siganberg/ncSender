<!--
  Shown in place of following a link while running on the kiosk. Mounted once,
  at the app root, and driven by the shared state in lib/kiosk-links.ts — the
  interceptor there decides when it appears, so no call site has to.
-->
<template>
  <Teleport to="body">
    <Transition name="link-qr">
      <div v-if="qrLink" class="link-qr" @click.self="dismissLinkQr">
        <div class="link-qr__card" role="dialog" aria-modal="true" aria-label="Open this link on your phone">
          <h2 class="link-qr__title">Scan to open</h2>
          <p class="link-qr__sub">This screen has no browser. Point your phone camera at the code.</p>

          <div class="link-qr__plate">
            <img v-if="dataUrl" :src="dataUrl" alt="QR code for the link" />
            <div v-else-if="error" class="link-qr__fallback">{{ error }}</div>
            <div v-else class="link-qr__fallback">Generating…</div>
          </div>

          <p class="link-qr__url">{{ qrLink }}</p>
          <button class="link-qr__close" @click="dismissLinkQr">Close</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import QRCode from 'qrcode';
import { qrLink, dismissLinkQr } from '../lib/kiosk-links';

const dataUrl = ref('');
const error = ref('');

watch(qrLink, async (url) => {
  dataUrl.value = '';
  error.value = '';
  if (!url) return;
  try {
    // Rendered dark-on-white regardless of theme: a QR inverted on a dark card
    // will not scan on most phones.
    dataUrl.value = await QRCode.toDataURL(url, {
      width: 420, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    error.value = 'Could not render the code — the address is below.';
  }
});
</script>

<style scoped>
.link-qr {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / 0.72);
  padding: 24px;
}
.link-qr__card {
  background: var(--color-surface, #1b1b22);
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 14px;
  padding: 24px;
  max-width: min(420px, 92vw);
  max-height: 92vh; overflow-y: auto;
  text-align: center;
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.5);
}
.link-qr__title {
  margin: 0 0 4px; font-size: 1.1rem; color: var(--color-text-primary);
}
.link-qr__sub {
  margin: 0 0 16px; font-size: 0.82rem; color: var(--color-text-secondary);
}
.link-qr__plate {
  background: #fff; border-radius: 10px; padding: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 200px; min-height: 200px;
}
.link-qr__plate img { display: block; width: 100%; max-width: 260px; height: auto; }
.link-qr__fallback { color: #444; font-size: 0.82rem; padding: 24px; }
.link-qr__url {
  margin: 14px 0 18px; font-size: 0.74rem; line-height: 1.45;
  color: var(--color-text-secondary); overflow-wrap: anywhere;
}
/* Generous target: this is pressed with a finger, often with gloves on. */
.link-qr__close {
  width: 100%; padding: 12px 16px; font-size: 0.9rem; font-weight: 600;
  border: none; border-radius: 8px; cursor: pointer;
  background: var(--color-accent); color: #fff;
}
.link-qr-enter-active, .link-qr-leave-active { transition: opacity 0.15s ease; }
.link-qr-enter-from, .link-qr-leave-to { opacity: 0; }
</style>
