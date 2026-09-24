// Crimson Cut: installable-web-app helpers.

/**
 * Registers ./sw.js (relative to the page) when supported. Skips file:// and claude.ai hosts.
 * Calls onUpdateReady(applyUpdate) when a new worker is installed and waiting.
 * applyUpdate() tells the waiting worker to activate, then reloads once it takes control.
 */
export function registerSW(onUpdateReady) {
  try {
    if (!('serviceWorker' in navigator)) return;
    const { protocol, hostname } = location;
    if (protocol === 'file:' || /(^|\.)claude\.ai$/.test(hostname) || /claudeusercontent/.test(hostname)) return;
  } catch (_) { return; }

  let reloading = false;
  const notify = (worker) => {
    if (!worker || typeof onUpdateReady !== 'function') return;
    onUpdateReady(() => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  const start = () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
      .then((reg) => {
        // A worker already waiting (e.g. update found on a previous visit).
        if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // Only an *update* if a controller already exists; first install is silent.
            if (nw.state === 'installed' && navigator.serviceWorker.controller) notify(nw);
          });
        });
        // Check for updates when the app returns to the foreground (standalone iOS rarely reloads).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('[pwa] SW registration failed', err));
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

export function isStandalone() {
  try {
    return navigator.standalone === true
      || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  } catch (_) { return false; }
}

export function isIOS() {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS desktop UA
  } catch (_) { return false; }
}

export function requestPersistentStorage() {
  try {
    const p = navigator.storage && navigator.storage.persist && navigator.storage.persist();
    return Promise.resolve(p).then((v) => v === true, () => false);
  } catch (_) {
    return Promise.resolve(false);
  }
}
