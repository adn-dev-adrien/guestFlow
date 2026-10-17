/**
 * A sliding-window counter per key, in memory (specs/hosting-h2-account-security.md rule 3).
 *
 * express-rate-limit (middleware/rateLimiters.js) answers 429 once a limit is reached; the forgotten
 * password must instead give the same answer whether it sent a link or not, so the controller asks
 * this counter and silently sends nothing. A restart clears the counters, which the single-use,
 * one-hour links make acceptable.
 *
 * Memory is bounded: a sweep drops the keys whose window has passed (every `sweepMs`, on a timer
 * that never keeps the process alive), and past `maxKeys` the key hit least recently is dropped to
 * make room.
 */

function createWindowCounter({
  windowMs,
  max,
  now = () => Date.now(),
  maxKeys = 10000,
  sweepMs = windowMs,
}) {
  const hits = new Map();

  function recent(key) {
    const since = now() - windowMs;
    const kept = (hits.get(key) || []).filter((t) => t > since);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  function sweep() {
    const since = now() - windowMs;
    for (const [key, times] of hits) {
      if (!times.some((t) => t > since)) hits.delete(key);
    }
  }

  const timer = sweepMs > 0 ? setInterval(sweep, sweepMs) : null;
  if (timer && typeof timer.unref === 'function') timer.unref();

  return {
    // Counts one hit; false when the key already reached `max` within the window.
    hit(key) {
      const k = String(key || '');
      const kept = recent(k);
      if (!hits.has(k) && hits.size >= maxKeys) {
        sweep();
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      kept.push(now());
      // Past the limit only the fact that it is past matters: a key never holds more than max + 1 hits.
      if (kept.length > max + 1) kept.splice(0, kept.length - (max + 1));
      // Re-inserted on every hit, so the Map's first key is the one hit least recently: the one the
      // cap evicts. A key in active use is never the one to go.
      hits.delete(k);
      hits.set(k, kept);
      return kept.length <= max;
    },
    sweep,
    size: () => hits.size,
    clear: () => hits.clear(),
    stop: () => { if (timer) clearInterval(timer); },
  };
}

module.exports = { createWindowCounter };
