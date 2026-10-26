import { t } from '../meta/i18n';
import type { UI } from '../ui/ui';

/**
 * Registers the service worker (offline play) and shows
 * "New version available — tap to refresh" when an update is waiting.
 */
export function registerSW(ui: UI): void {
  // the Capacitor APK serves files locally, it needs no service worker
  if (!('serviceWorker' in navigator) || import.meta.env.DEV || import.meta.env.VITE_NATIVE === '1') return;
  // Reload only when the player asked for the update. The very first install also fires
  // controllerchange (clients.claim) and must NOT interrupt a running game.
  let updateRequested = false;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || refreshing) return;
    refreshing = true;
    location.reload();
  });
  const offer = (reg: ServiceWorkerRegistration): void => {
    const w = reg.waiting;
    if (!w || !navigator.serviceWorker.controller) return;
    ui.toast(t('updateReady'), {
      sticky: true,
      onClick: () => {
        updateRequested = true;
        w.postMessage({ type: 'SKIP_WAITING' });
      },
    });
  };
  const go = (): void => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        offer(reg);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed') {
              if (navigator.serviceWorker.controller) offer(reg);
              else ui.toast(t('offlineReady'));
            }
          });
        });
        // check for updates when the app comes back to the foreground
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) reg.update().catch(() => undefined);
        });
        setInterval(() => reg.update().catch(() => undefined), 30 * 60 * 1000);
      })
      .catch((e) => console.warn('SW registration failed', e));
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
}
