/**
 * `GET /api/version` — public: the release that runs and when this process started. The console's
 * health check reads it to prove the expected release came up (specs/hosting-h1-fleet-runtime.md
 * rule 10), and asks with `?plugin=<id>` whether a plugin it pushed loaded (rule 11).
 *
 * The plugin answer goes only to the console: a request that carries the instance's proxy secret in
 * `x-guestflow-health`, or — without a secret (self-hosted, development) — one that comes from the
 * machine itself. Anyone else gets no plugin field, so the endpoint never says what is installed.
 */

const { HEALTH_HEADER, sameSecret } = require('../utils/proxySecret');

const PLUGIN_ID = /^[a-z][a-z0-9-]{1,40}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function mayReadPluginHealth(req, secret) {
  if (secret) return sameSecret(req.headers[HEALTH_HEADER], secret);
  return LOOPBACK.has(String((req.socket && req.socket.remoteAddress) || ''));
}

function buildVersionHandler({ getVersion, pluginHealth, secret = null, env, commitSha, commitShaShort, startedAt }) {
  return function version(req, res) {
    const asked = String(req.query.plugin || '');
    res.json({
      version: getVersion(),
      env: env || 'development',
      commitSha: commitSha || null,
      commitShaShort,
      startedAt,
      ...(PLUGIN_ID.test(asked) && mayReadPluginHealth(req, secret) ? { plugin: pluginHealth(asked) } : {}),
    });
  };
}

module.exports = { buildVersionHandler, mayReadPluginHealth };
