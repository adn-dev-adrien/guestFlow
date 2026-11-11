/**
 * The console's security settings read from the environment at boot
 * (specs/control-plane-plans-and-access.md rule 39).
 *
 * The console fails closed: unless NODE_ENV is explicitly `development` or `test`, it runs as
 * production — the session secret and Caddy's proxy secret are required and cookies are `Secure`.
 * A forgotten NODE_ENV therefore refuses to start instead of signing sessions with a public secret
 * and trusting any `X-Forwarded-For` from the host's loopback.
 *
 * readBootConfig(env) → { devMode, sessionSecret, secureCookies, proxySecret }, or throws an Error
 * whose message names the missing variables.
 */

const DEV_MODES = new Set(['development', 'test']);
const DEV_SESSION_SECRET = 'dev-only-console-secret';

function readBootConfig(env) {
  const devMode = DEV_MODES.has(env.NODE_ENV);
  if (devMode) {
    return {
      devMode,
      sessionSecret: env.CP_SESSION_SECRET || DEV_SESSION_SECRET,
      secureCookies: false,
      proxySecret: env.CP_PROXY_SECRET || null,
    };
  }
  const missing = ['CP_SESSION_SECRET', 'CP_PROXY_SECRET'].filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`${missing.join(', ')} required (NODE_ENV=${env.NODE_ENV || '<unset>'} runs as production; set NODE_ENV=development to run without)`);
  }
  if (env.CP_SESSION_SECRET === DEV_SESSION_SECRET) throw new Error('CP_SESSION_SECRET must not be the public development secret');
  return { devMode, sessionSecret: env.CP_SESSION_SECRET, secureCookies: true, proxySecret: env.CP_PROXY_SECRET };
}

module.exports = { readBootConfig, DEV_SESSION_SECRET };
