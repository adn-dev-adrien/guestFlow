/**
 * `GET /api/version` — public: the release that runs and when this process started. The console's
 * health check reads it to prove the expected release came up (specs/hosting-h1-fleet-runtime.md
 * rule 10), and asks with `?plugin=<id>` whether a plugin it pushed loaded (rule 11).
 *
 * The plugin answer goes only to the console: a request that carries the instance's proxy secret in
 * `x-guestflow-health` (rule 34). An instance without a secret (self-hosted, development) never gives
 * it: behind a reverse proxy on the same machine every visitor looks like loopback, and neither the
 * client nor the boot asks for it. So the endpoint never says what is installed.
 */

const { HEALTH_HEADER, sameSecret } = require('../utils/proxySecret');

const PLUGIN_ID = /^[a-z][a-z0-9-]{1,40}$/;
function mayReadPluginHealth(req, secret) {
  return Boolean(secret) && sameSecret(req.headers[HEALTH_HEADER], secret);
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
