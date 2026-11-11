/**
 * liveRecord(compute) — a read-only object whose keys and values are `compute()`'s, read at each
 * access (specs/plugins-phase-4-registry.md rule 18). For the maps derived from the plugin module
 * list: in a production build that list is filled from the plugins' own bundles after the SDK
 * modules have evaluated, so a map frozen at import time would miss every plugin. `compute` is
 * cached on `version()` — the list's length — so a lookup costs nothing once the list is complete.
 */
export default function liveRecord(compute, version = () => 0) {
  let cachedAt = null;
  let cached = null;
  const current = () => {
    const v = version();
    if (cached === null || cachedAt !== v) {
      cached = compute();
      cachedAt = v;
    }
    return cached;
  };
  const own = (key) => Object.prototype.hasOwnProperty.call(current(), key);
  return new Proxy({}, {
    get: (_, key) => current()[key],
    has: (_, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => (own(key)
      ? { value: current()[key], enumerable: true, configurable: true, writable: false }
      : undefined),
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}
