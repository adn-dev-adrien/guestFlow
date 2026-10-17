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

module.exports = { proxySecretGuard, HEADER };
