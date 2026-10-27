/**
 * What the WordPress plugin's settings need, for an admin to copy (specs/plugins-phase-2-hosts.md
 * rules 30-31): the address the site calls and the public API key, and a new key on demand.
 *
 * Admin-only by the role guard (/settings/* is on no other role's allowlist), refused to a support
 * session (it reads a credential in clear), never cached, never logged.
 */

const KEY_NAME = 'PUBLIC_API_KEY';

/**
 * The address WordPress must call: the configured public URL, else — when it was never typed — the
 * origin the admin is browsing from, flagged so the card can say it is a guess.
 */
function siteApiAddress({ publicUrl, req }) {
  const url = String(publicUrl || '').trim().replace(/\/+$/, '');
  if (url) return { value: url, source: 'setting' };
  const host = req && req.get ? req.get('host') : '';
  if (!host) return { value: '', source: 'none' };
  return { value: `${req.protocol}://${host}`, source: 'request' };
}

/**
 * @param {object} deps
 * @param {() => string} deps.publicUrl  the core's « Adresse de l'application »
 * @param {() => string} deps.ensureKey  the key, created when missing
 * @param {() => string} deps.rotateKey  a new key; throws `SECRET_FROM_ENVIRONMENT` when the real
 *                                       environment sets it
 * @param {() => object} [deps.antiBot]  { active, pluginVersion, requiredVersion } — whether the site's
 *                                       plugin solves the proof of work
 *                                       (specs/public-request-abuse-and-grouping.md, edge case)
 */
function buildSiteConnectionController({ publicUrl, ensureKey, rotateKey, antiBot = () => null }) {
  return {
    get(req, res) {
      res.set('Cache-Control', 'no-store');
      return res.json({ address: siteApiAddress({ publicUrl: publicUrl(), req }), apiKey: ensureKey(), antiBot: antiBot() });
    },

    regenerate(req, res) {
      res.set('Cache-Control', 'no-store');
      try {
        return res.json({ apiKey: rotateKey() });
      } catch (err) {
        if (err && err.code === 'SECRET_FROM_ENVIRONMENT') {
          return res.status(409).json({
            error: 'KEY_FROM_ENVIRONMENT',
            message: `Clé fixée par la variable d’environnement ${KEY_NAME} du serveur : à changer là.`,
          });
        }
        throw err;
      }
    },
  };
}

module.exports = { buildSiteConnectionController, siteApiAddress, KEY_NAME };
