let installed = false;

export function installBeaconShim(): void {
  if (installed || typeof navigator.sendBeacon !== 'function') {
    return;
  }
  installed = true;
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value(url: string | URL, data?: BodyInit | null) {
      fetch(url, { method: 'POST', body: data ?? null, keepalive: true }).catch(
        () => undefined,
      );
      return true;
    },
  });
}

export function removeBeaconShim(): void {
  if (installed) {
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    installed = false;
  }
}
