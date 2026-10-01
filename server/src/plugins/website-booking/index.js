/**
 * Réservation depuis le site (WordPress) — module per specs/plugins-phase-2-hosts.md §3.F.
 *
 * Owns the public API the site calls (`/public/v1`, except `/public/v1/gate`), its key, the
 * « Demandes du site » alert and the CGV enforcement switch. The CGV themselves, the acceptances, the
 * request origin and the « Nouvelle demande de devis » notification stay core (rule 26).
 */

const sdk = require('../sdk');
const { PUBLIC_PREFIXES, buildPublicMounts } = require('./routes');
const settings = require('./settings');
const { buildEnforcementController } = require('./enforcementController');
const { buildPendingController } = require('./pendingController');

const id = 'website-booking';

const ERASED_LABELS = {
  requireTermsAcceptance: 'le réglage d’exigence des CGV',
  lastSeenPluginVersion: 'la dernière version du plugin WordPress vue',
};

function register(ctx) {
  ctx.settings.declare(settings.DECLARED);
  settings.bindStore(ctx.settings);
  ctx.migrations([{ name: 'settings_from_app_settings_v1', up: settings.copyFromAppSettings }]);

  // Rule 24 — the key exists only once the plugin is installed. Never logged: the operator reads it
  // from .env.local and copies it into the WordPress proxy settings. An uninstall never rotates it.
  const ensureApiKey = () => {
    sdk.secrets.getOrCreate('PUBLIC_API_KEY', 32);
    ctx.log.info('PUBLIC_API_KEY ready in server/.env.local — copy it into the WordPress proxy.');
  };
  ctx.onInstall(ensureApiKey);
  ctx.onBoot(ensureApiKey);

  // The controllers bind core models when they load; the routers are built on the first request,
  // not at register, which runs early in the boot (and in suites without a database).
  let mounts = null;
  const publicMount = (path) => (req, res, next) => {
    if (!mounts) mounts = new Map(buildPublicMounts().map((m) => [m.path, m.router]));
    return mounts.get(path)(req, res, next);
  };
  PUBLIC_PREFIXES.forEach((path) => ctx.mount(path, publicMount(path), { public: true }));

  const pending = buildPendingController({
    listPendingPublicDevis: () => sdk.coreModule('reservationsModel').listPendingPublicDevis(),
  });
  ctx.route('get', '/api/dashboard/public-devis-pending', pending.list);

  const enforcement = buildEnforcementController({
    settings,
    currentTerms: () => sdk.coreModule('termsModel').getCurrent(),
  });
  ctx.route('get', '/api/terms/online-booking', enforcement.get);
  ctx.route('put', '/api/terms/enforcement', enforcement.update);

  // Rule 27 — the two settings only. Every devis, acceptance and token stays: they are the stays'
  // records. The API key stays too (rule 24).
  ctx.data({
    tables: [],
    describe: () => {
      const { requireTermsAcceptance, lastSeenPluginVersion } = settings.termsSettings();
      const lines = [];
      if (!requireTermsAcceptance) lines.push({ label: ERASED_LABELS.requireTermsAcceptance, count: 1 });
      if (lastSeenPluginVersion) lines.push({ label: ERASED_LABELS.lastSeenPluginVersion, count: 1 });
      return lines;
    },
    purge: settings.resetLegacyColumns,
  });
}

module.exports = { id, register };
