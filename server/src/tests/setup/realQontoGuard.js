/**
 * Preloaded by `npm test` on the server and on the console (specs/server-test-isolation.md rule 14): no test
 * reaches a real Qonto host. On 2026-11-05 an auditor's probe did, with a made-up token, because a stored
 * environment outranked its `QONTO_API_BASE`. The resolver and `fetch` refuse the name before any socket opens,
 * and the attempt fails the process at exit, since most callers of Qonto swallow a failure (rule 11 of the webhook).
 * A child process started by a test does not inherit the preload: `inputShapeApp` and the shadow pin dead bases.
 */
const dns = require('dns');

const REFUSED = 'E_REAL_QONTO_IN_TEST';
const attempts = [];

const isRealQontoHost = (host) => /(^|\.)qonto\.(com|co)\.?$/i.test(String(host || ''));

function refusal(host) {
  attempts.push(host);
  const error = new Error(`A test tried to reach the real Qonto host ${host}: point QONTO_API_BASE and QONTO_OAUTH_BASE at a loopback fake.`);
  error.code = REFUSED;
  return error;
}

function hostOf(input) {
  try {
    return new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
  } catch {
    return '';
  }
}

function install() {
  if (dns.lookup.realQontoGuard) return;
  const realLookup = dns.lookup;
  const guardedLookup = function guardedLookup(hostname, options, callback) {
    if (!isRealQontoHost(hostname)) return realLookup.call(this, hostname, options, callback);
    const error = refusal(hostname);
    process.nextTick(typeof options === 'function' ? options : callback, error);
    return undefined;
  };
  Object.defineProperties(guardedLookup, Object.getOwnPropertyDescriptors(realLookup));
  guardedLookup.realQontoGuard = true;
  dns.lookup = guardedLookup;

  const realFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    const host = hostOf(input);
    if (isRealQontoHost(host)) return Promise.reject(refusal(host));
    return realFetch.call(this, input, init);
  };

  process.on('exit', () => {
    if (attempts.length === 0) return;
    console.error(`[real-qonto-guard] ${attempts.length} attempt(s) on a real Qonto host: ${[...new Set(attempts)].join(', ')}`);
    process.exitCode = 1;
  });
}

install();

module.exports = { isRealQontoHost };
