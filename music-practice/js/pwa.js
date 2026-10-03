// Installable-app support: service worker registration and updates, the Install button, opening MusicXML files
// with the installed app, and keeping the screen awake while practising.

const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/**
 * Register the service worker (offline cache). When a new version has been downloaded, `onUpdate(apply)` is
 * called; `apply()` switches to it and reloads. On localhost new versions take over silently (files come from
 * the network there anyway).
 */
export async function registerServiceWorker({ onUpdate } = {}) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
  } catch (err) {
    console.warn('Service worker not registered:', err);
    return null;
  }
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const offer = (worker) => {
    if (!hadController) return; // first install: nothing to switch from
    const apply = () => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      worker.postMessage('skipWaiting');
    };
    if (DEV) worker.postMessage('skipWaiting');
    else onUpdate?.(apply);
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
  // Installed apps can stay open for days: look for updates now and then.
  setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  return reg;
}

// The browser can offer installation before the UI is ready: keep the offer from the moment this module loads.
let installPrompt = null;
let onInstallable = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  onInstallable?.(true);
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  onInstallable?.(false);
});

/**
 * Install button: `button` is shown while the browser offers installation (Chrome, Edge, Chrome on Android) and
 * hidden once installed or when running as the installed app.
 */
export function bindInstallButton(button) {
  onInstallable = (available) => { button.hidden = !available; };
  button.hidden = !installPrompt;
  button.addEventListener('click', async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    installPrompt = null;
    button.hidden = true;
  });
}

/** Files opened with the installed app ("Open with", double-click on desktop): `open(file)` for the first one. */
export function handleLaunchFiles(open) {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (handle) open(await handle.getFile());
  });
}

/**
 * Keeps the screen on while practising: call `poke()` on every played note or control. The lock is released
 * after `idleMs` without activity, and taken again when the app comes back to the foreground in that time
 * (browsers drop it when the page is hidden).
 */
export class ScreenWakeLock {
  constructor(idleMs = 5 * 60 * 1000) {
    this.idleMs = idleMs;
    this.lock = null;
    this.last = 0;
    this.timer = null;
    this.supported = 'wakeLock' in navigator;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && performance.now() - this.last < this.idleMs) this.#acquire();
    });
  }

  poke() {
    if (!this.supported) return;
    this.last = performance.now();
    if (!this.lock) this.#acquire();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), this.idleMs);
  }

  async #acquire() {
    if (this.lock || this.pending || document.visibilityState !== 'visible') return;
    this.pending = true;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => { this.lock = null; });
    } catch { /* not allowed (e.g. battery saver): the screen just times out as usual */ }
    this.pending = false;
  }

  release() {
    clearTimeout(this.timer);
    this.lock?.release().catch(() => {});
    this.lock = null;
  }
}
