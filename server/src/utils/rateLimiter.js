/**
 * A sliding-window counter per key, in memory (specs/hosting-h2-account-security.md rule 3).
 *
 * express-rate-limit (middleware/rateLimiters.js) answers 429 once a limit is reached; the forgotten
 * password must instead give the same answer whether it sent a link or not, so the controller asks
 * this counter and silently sends nothing. A restart clears the counters, which the single-use,
 * one-hour links make acceptable.
 */

function createWindowCounter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();

  function recent(key) {
    const since = now() - windowMs;
    const kept = (hits.get(key) || []).filter((t) => t > since);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  return {
    // Counts one hit; false when the key already reached `max` within the window.
    hit(key) {
      const k = String(key || '');
      const kept = recent(k);
      kept.push(now());
      hits.set(k, kept);
      return kept.length <= max;
    },
    clear: () => hits.clear(),
  };
}

module.exports = { createWindowCounter };
