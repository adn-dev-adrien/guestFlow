/**
 * Forwarded headers are believed only when they come through the hosting's proxy
 * (specs/hosting-h1-fleet-runtime.md rule 21, review 2026-10-17).
 *
 * On the host every process reaches every other on 127.0.0.1: another instance could call this one
 * directly and claim any client address in X-Forwarded-For, defeating the IP rate limiters that
 * `trust proxy` would otherwise apply to it. Caddy adds a secret header to what it forwards; a
 * request without it loses its X-Forwarded-* headers before Express reads them. The secret header
 * itself never reaches the application.
 *
 * Unset secret (a self-hosted install, development): the middleware does nothing.
 */

const crypto = require('crypto');

const HEADER = 'x-guestflow-proxy';
// The console's own requests to the instance (its health check, H1 rule 11) carry the same secret
// under this header, which Caddy never adds: it tells the console from a visitor behind the proxy.
const HEALTH_HEADER = 'x-guestflow-health';
const FORWARDED = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'forwarded'];

function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function proxySecretGuard(secret) {
  return function guard(req, res, next) {
    if (!secret) return next();
    const presented = req.headers[HEADER];
    delete req.headers[HEADER];
    if (!same(presented, secret)) for (const h of FORWARDED) delete req.headers[h];
    return next();
  };
}

/**
 * What `trust proxy` is set to, from the environment (specs/hosting-h1-fleet-runtime.md rule 35).
 * X-Forwarded-For is believed only when TRUST_PROXY_HOPS is set (a number of trusted hops), and then
 * only for a request that carries the proxy secret when GUESTFLOW_PROXY_SECRET is set. Hops without a
 * secret are legitimate behind a proxy that is the only way in, but spoofable by anyone who can reach
 * the Node port directly: the caller logs `warning` at boot so the operator sees it. Nothing is
 * defaulted silently: unset hops stay `false`.
 */
function proxyTrust(env = process.env) {
  const raw = env.TRUST_PROXY_HOPS;
  const hops = raw != null && raw !== '' ? Number(raw) : false;
  const trusted = typeof hops === 'number' && Number.isFinite(hops) && hops > 0;
  const warning = trusted && !env.GUESTFLOW_PROXY_SECRET
    ? 'TRUST_PROXY_HOPS is set without GUESTFLOW_PROXY_SECRET: X-Forwarded-For can be spoofed by anyone who reaches this port without the proxy.'
    : null;
  return { hops: trusted ? hops : false, warning };
}

module.exports = { proxyTrust, proxySecretGuard, HEADER, HEALTH_HEADER, sameSecret: same };
