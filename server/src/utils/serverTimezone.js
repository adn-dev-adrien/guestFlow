/**
 * Server time zone (specs/server-timezone.md).
 *
 * GuestFlow's schedulers compare operator-entered wall-clock times — a check-in at `16:00`, the
 * `08:00` e-mail pass — against the process's LOCAL time (`Date#getHours`). That only lines up when
 * the process runs in the accommodations' time zone. Production moved to a host whose clock is
 * `Etc/UTC`, so every one of those triggers fired 2 h late in summer (1 h in winter): an arrival
 * push due at 16:00 reached the operator's phone at 18:00.
 *
 * Rather than teach each runner about time zones — and miss one — the process declares its own, once,
 * before anything reads the clock. It does NOT honour an inherited `TZ`: a container image that
 * exports `TZ=UTC` by default is exactly how the bug got in, and nothing distinguishes that default
 * from a deliberate choice. The deliberate choice has its own name, `GUESTFLOW_TZ`, which no base
 * image sets by accident. An unusable value falls back to the default instead of taking the server
 * down.
 */

const DEFAULT_TIMEZONE = 'Europe/Paris';

function isSupported(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the zone the process must run in.
 * @param {string|undefined} configured — the value of `GUESTFLOW_TZ`, if the operator set one.
 * @returns {{ timezone: string, source: 'configured'|'default'|'fallback' }}
 */
function resolveServerTimezone(configured) {
  const wanted = String(configured || '').trim();
  if (!wanted) return { timezone: DEFAULT_TIMEZONE, source: 'default' };
  if (isSupported(wanted)) return { timezone: wanted, source: 'configured' };
  return { timezone: DEFAULT_TIMEZONE, source: 'fallback' };
}

/**
 * Applies the resolved zone to `process.env.TZ`, overwriting whatever the host inherited. Node ≥ 16
 * drops its cached zone on that assignment, so every `Date` built afterwards reads the new one.
 *
 * @param {{ env?: object, logger?: Console }} deps — injected by the tests.
 * @returns {{ timezone: string, source: string }}
 */
function applyServerTimezone({ env = process.env, logger = console } = {}) {
  const resolved = resolveServerTimezone(env.GUESTFLOW_TZ);
  env.TZ = resolved.timezone;
  if (resolved.source === 'fallback') {
    logger.warn(`[timezone] GUESTFLOW_TZ="${env.GUESTFLOW_TZ}" is not a usable zone, falling back to ${resolved.timezone}`);
  }
  return resolved;
}

module.exports = { applyServerTimezone, resolveServerTimezone, DEFAULT_TIMEZONE };
