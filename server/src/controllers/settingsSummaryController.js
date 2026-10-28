/**
 * GET /api/settings/summary — the one-line state of each Paramètres page, for the summary page
 * (specs/settings-rationalization.md rule 25; UI/UX review 2026-10-18, proposal 20).
 *
 *   → { lines: { '<page path>': { text, tone: 'neutral' | 'warning' } } }
 *
 * The page keys are the paths the summary links to (client/src/constants/settingsMenu.js). A line
 * that cannot be computed is left out: the row then shows its name alone. Every count comes from
 * the database as it is now; nothing is cached.
 */

const { resolveEmailIdentity } = require('../utils/emailIdentity');
const { PLUGIN_SETTINGS_PLACES } = require('../constants/plugins');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const neutral = (text) => ({ text, tone: 'neutral' });
const warning = (text) => ({ text, tone: 'warning' });
const INTEGRATIONS = '/settings/integrations';

/**
 * deps: { db, settings: () => row (masked), smtpConfigured: () => bool, platformAvailable: () => bool,
 *         plugins: () => [plugin view], appVersion: () => string, twoFactorEnabled: (userId) => bool,
 *         today: () => 'YYYY-MM-DD', pluginsManageable?: () => bool (false on an operator-managed space: no plugins line) }
 */
function buildSummary(deps, user) {
  const lines = {};
  const count = (sql, ...args) => deps.db.prepare(sql).get(...args).n;
  const put = (path, compute) => {
    try {
      const line = compute();
      if (line) lines[path] = line;
    } catch {
      // A table missing on an old database: the row keeps its name alone.
    }
  };
  const row = deps.settings();
  const views = (() => { try { return deps.plugins() || []; } catch { return []; } })();
  const active = views.filter((p) => p.state === 'active' && !p.outOfPlan);
  const toConfigure = active.filter((p) => p.setup && p.setup.needed);

  put('/settings/etablissement', () => {
    const name = String(row.companyName || '').trim();
    if (!name) return warning('Nom à saisir');
    return String(row.companyIban || '').trim() ? neutral(name) : warning(`${name} · IBAN à saisir`);
  });
  put('/properties', () => {
    const n = count('SELECT COUNT(*) AS n FROM properties');
    return n ? neutral(plural(n, 'logement', 'logements')) : warning('Aucun logement');
  });
  put('/settings/plateformes', () => neutral(plural(count('SELECT COUNT(*) AS n FROM platforms'), 'plateforme', 'plateformes')));
  put('/parametres/conditions-generales', () => {
    const v = deps.db.prepare('SELECT MAX(version) AS v FROM terms_versions').get().v;
    return v ? neutral(`Version ${v} en vigueur`) : neutral('Aucune version publiée');
  });
  put('/parametres/options-ressources', () => {
    const options = count('SELECT COUNT(*) AS n FROM options WHERE archivedAt IS NULL');
    const resources = count('SELECT COUNT(*) AS n FROM resources');
    return neutral(`${plural(options, 'option', 'options')} · ${plural(resources, 'ressource', 'ressources')}`);
  });
  put('/parametres/vacances-fermetures', () => {
    const n = count('SELECT COUNT(*) AS n FROM establishment_closures WHERE endDate >= ?', deps.today());
    return neutral(n ? plural(n, 'fermeture à venir', 'fermetures à venir') : 'Aucune fermeture à venir');
  });
  put('/settings/tva-exercice', () => {
    const month = MONTHS[(Number(row.fiscalYearEndMonth) || 12) - 1];
    return neutral(`TVA ${Number(row.vatRate)} % · exercice clos fin ${month}`);
  });
  put('/settings/emails', () => {
    const host = String(row.smtpHost || '').trim();
    if (!host) return deps.platformAvailable() ? neutral('Envoi par la plateforme') : warning('Envoi non configuré');
    if (!row.smtpPasswordSet || !resolveEmailIdentity(row).fromEmail) return warning('Envoi incomplet');
    return neutral(`Envoi par ${host}`);
  });
  put(INTEGRATIONS, () => {
    const n = toConfigure.filter((p) => String(p.setup.path || '').startsWith(INTEGRATIONS)).length;
    return n ? warning(`${n} à configurer`) : null;
  });
  put('/settings/utilisateurs', () => neutral(plural(count('SELECT COUNT(*) AS n FROM users WHERE isActive = 1'), 'compte actif', 'comptes actifs')));
  put('/settings/systeme', () => neutral(`Version ${deps.appVersion()}`));
  put('/parametres/plugins', () => {
    if (deps.pluginsManageable && !deps.pluginsManageable()) return null;
    const base = plural(active.length, 'actif', 'actifs');
    return toConfigure.length ? warning(`${base} · ${toConfigure.length} à configurer`) : neutral(base);
  });
  // A plugin's own settings page says when its plugin still lacks something (rule 25).
  toConfigure.forEach((p) => {
    const place = PLUGIN_SETTINGS_PLACES[p.id];
    if (place && !place.startsWith(INTEGRATIONS)) lines[place] = warning('À configurer');
  });
  put('/mon-compte', () => (user && user.id && deps.twoFactorEnabled(user.id)
    ? neutral('Validation en deux étapes activée') : neutral('Validation en deux étapes non activée')));
  return { lines };
}

function createSettingsSummaryController(deps) {
  return {
    get(req, res) {
      return res.json(buildSummary(deps, req.user));
    },
  };
}

module.exports = { buildSummary, createSettingsSummaryController };
