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
const { buildSiteConnectionController, KEY_NAME } = require('./siteConnectionController');
const requestStore = require('./requestStore');
const challenge = require('./challenge');
const { runRequestPurge } = require('./requestPurge');
const { proofEnforced, CHALLENGE_PLUGIN_VERSION } = require('./controllers/publicChallengeController');

const id = 'website-booking';

const ERASED_LABELS = {
  requireTermsAcceptance: 'le réglage d’exigence des CGV',
  lastSeenPluginVersion: 'la dernière version du plugin WordPress vue',
  proofEnforcedSince: 'la vérification anti-robot devenue obligatoire',
};

function register(ctx) {
  ctx.settings.declare(settings.DECLARED);
  settings.bindStore(ctx.settings);
  ctx.migrations([
    { name: 'settings_from_app_settings_v1', up: settings.copyFromAppSettings },
    // specs/public-request-abuse-and-grouping.md §5 — spent challenges, the request log, the stays.
    { name: 'public_request_tables_v1', up: (db) => db.exec(requestStore.TABLES_SQL) },
    // Review of PR #805 — issued challenges and the appended-message count.
    { name: 'public_request_tables_v2', up: requestStore.migrateV2 },
    // Rule 29 (2026-10-27 spec review) — issued challenges no longer count: their table goes.
    { name: 'public_request_tables_v3', up: requestStore.migrateV3 },
  ]);

  // Rule 24 — the key exists only once the plugin is installed. Never logged: the operator copies it
  // from Paramètres › Intégrations into the WordPress proxy settings (rule 30). An uninstall never
  // rotates it.
  const ensureApiKey = () => {
    sdk.secrets.getOrCreate(KEY_NAME, 32, { rotatable: true });
    ctx.log.info(`${KEY_NAME} ready — shown in Paramètres › Intégrations › Site internet.`);
    // Roostview's own key (specs/roostview-api-key.md): read-only on the catalogue, availability and
    // quotes, distinct from the site's so either can be revoked alone. Never logged.
    sdk.secrets.getOrCreate('ROOSTVIEW_API_KEY', 32);
    ctx.log.info('ROOSTVIEW_API_KEY ready in server/.env.local — paste it into Roostview › Réglages › GuestFlow.');
    // The key the proof-of-work challenges are signed with (specs/public-request-abuse-and-grouping.md
    // rule 1). Never leaves the server.
    sdk.secrets.getOrCreate(challenge.SECRET_NAME, 32);
  };
  ctx.onInstall(ensureApiKey);
  ctx.onBoot(ensureApiKey);

  const connection = buildSiteConnectionController({
    publicUrl: () => ctx.core.settings.publicUrl(),
    ensureKey: () => sdk.secrets.getOrCreate(KEY_NAME, 32, { rotatable: true }),
    rotateKey: () => sdk.secrets.rotate(KEY_NAME, 32),
    // The transition edge case: the tab says when the site's plugin does not solve challenges yet.
    antiBot: () => ({
      active: proofEnforced(),
      pluginVersion: settings.termsSettings().lastSeenPluginVersion || null,
      requiredVersion: CHALLENGE_PLUGIN_VERSION,
    }),
  });
  ctx.route('get', '/api/settings/website-connection', connection.get);
  ctx.route('post', '/api/settings/website-connection/regenerate', connection.regenerate);
  // Both hand out or rotate the key WordPress holds: a support session is refused them
  // (specs/hosting-h2-account-security.md rule 23).
  ctx.secretRoutes([{ method: '*', re: /^\/settings\/website-connection(\/regenerate)?$/ }]);

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
    // Rule 11 — the requests of the last hour, for the « trafic inhabituel » line.
    requestsLastHour: () => requestStore.countRecent({ windowMs: 60 * 60 * 1000 }),
  });
  ctx.route('get', '/api/dashboard/public-devis-pending', pending.list);
  ctx.attention({ key: 'site-requests', rank: 20, handler: pending.list, summarize: require('./attention').summarize });

  const enforcement = buildEnforcementController({
    settings,
    currentTerms: () => sdk.coreModule('termsModel').getCurrent(),
  });
  // Rule 10 — every day, the website requests nobody touched in 30 days go, with their lone client.
  ctx.jobs.every({
    name: 'request-purge',
    intervalMs: 24 * 60 * 60 * 1000,
    bootDelayMs: 10 * 60 * 1000,
    run: () => {
      const { deleted, clientsDeleted } = runRequestPurge();
      if (deleted) ctx.log.info(`${deleted} demande(s) du site non traitée(s) depuis 30 jours supprimée(s), ${clientsDeleted} client(s) avec`);
    },
  });

  ctx.route('get', '/api/terms/online-booking', enforcement.get);
  ctx.route('put', '/api/terms/enforcement', enforcement.update);

  // Rule 27 — the two settings only. Every devis, acceptance and token stays: they are the stays'
  // records. The API key stays too (rule 24).
  ctx.data({
    tables: requestStore.TABLES,
    describe: () => {
      const { requireTermsAcceptance, lastSeenPluginVersion } = settings.termsSettings();
      const lines = [];
      if (!requireTermsAcceptance) lines.push({ label: ERASED_LABELS.requireTermsAcceptance, count: 1 });
      if (lastSeenPluginVersion) lines.push({ label: ERASED_LABELS.lastSeenPluginVersion, count: 1 });
      if (settings.proofEnforcedSince()) lines.push({ label: ERASED_LABELS.proofEnforcedSince, count: 1 });
      return lines;
    },
    purge: settings.resetLegacyColumns,
  });
}

module.exports = { id, register };
