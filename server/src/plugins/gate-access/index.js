/**
 * Sowel — portail et domotique (specs/gate-access-sowel-connector.md, specs/guest-app-home-automation.md; module per
 * specs/plugins-phase-1-sdk.md). Sowel pulls the list of keys and posts the outcomes back; guestFlow
 * shows the stored key in the emails, the SAS and the fiche, and alerts the admins on a failure. On the same
 * key and signature, the house pushes what the guests' « Domotique » page shows and collects their light commands.
 *
 * The keypad code of the property (`portalCode`) is not this plugin's: it belongs to the SAS (rule 17).
 */

const sdk = require('../sdk');
const createGateKeysModel = require('./keysModel');
const { migratePropertyId } = createGateKeysModel;
const { buildController } = require('./controller');
const { buildPublicRouter } = require('./publicRoutes');
const { buildRequireGateConnector } = require('./requireConnector');
const { buildSignGateResponse } = require('./signResponse');
const { runStaleReadCheck } = require('./results');
const invitationView = require('./invitationView');
const { TOKENS, FLAGS, gateEmailContext } = require('./emailContext');
const { createHomeModel, HOME_TABLES_SQL, HOME_TABLES } = require('./homeModel');
const { buildHomeController } = require('./homeController');
const { buildHomeRouter } = require('./homeRoutes');

const DAY_MS = 24 * 60 * 60 * 1000;

const id = 'gate-access';

function register(ctx) {
  ctx.migrations([{
    name: 'tables_v1',
    // No foreign key on purpose: a result must outlive a deleted reservation, that is when it matters.
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS gate_key_results (
        reservationId INTEGER PRIMARY KEY,
        action        TEXT NOT NULL,
        ok            INTEGER NOT NULL,
        state         TEXT,
        code          TEXT,
        url           TEXT,
        error         TEXT,
        message       TEXT,
        label         TEXT,
        startsAt      TEXT,
        endsAt        TEXT,
        receivedAt    TEXT NOT NULL,
        alertedError  TEXT
      );
      CREATE TABLE IF NOT EXISTS gate_connector_state (
        id             INTEGER PRIMARY KEY CHECK (id = 1),
        lastReadAt     TEXT,
        staleAlertedAt TEXT
      );
    `),
  }, {
    // The stay every key carries (specs/sowel-stays-in-keys.md): the property survives a deleted
    // reservation, so its revoke still names it.
    name: 'stay_property_v1',
    up: (db) => { migratePropertyId(db); },
  }, {
    // specs/guest-app-home-automation.md §5 — what the house sends for the guests' « Domotique » page.
    name: 'home_tables_v1',
    up: (db) => db.exec(HOME_TABLES_SQL),
  }]);

  // Rule 18 — the connector keys exist only once the plugin is installed. Two secrets, distinct from
  // the website's key; never logged, the operator copies them into the Sowel plugin.
  const ensureSecrets = () => {
    sdk.secrets.getOrCreate('GATE_API_KEY', 32);
    sdk.secrets.getOrCreate('GATE_SIGNING_SECRET', 32);
  };
  ctx.onBoot(ensureSecrets);
  ctx.onInstall(ensureSecrets);

  let model = null;
  const getModel = () => {
    if (!model) model = createGateKeysModel(ctx.db);
    return model;
  };
  const controller = buildController({
    model: getModel,
    homeChannel: () => (homeModel || createHomeModel(ctx.db)).channel(),
    pushService: ctx.core.push,
    publicUrl: () => ctx.core.settings.publicUrl(),
  });

  ctx.mount('/public/v1/gate', buildPublicRouter({
    controller,
    limiter: sdk.middleware.publicApiLimiter,
    requireConnector: buildRequireGateConnector(),
    signResponse: buildSignGateResponse(),
  }), { public: true });

  // specs/guest-app-home-automation.md rules 1-2 — the same connector, a second tree.
  let homeModel = null;
  const getHomeModel = () => {
    if (!homeModel) homeModel = createHomeModel(ctx.db);
    return homeModel;
  };
  const home = buildHomeController({ model: getHomeModel, selection: () => ctx.core.homeSelection() });
  ctx.mount('/public/v1/home', buildHomeRouter({
    controller: home,
    limiter: sdk.middleware.publicApiLimiter,
    requireConnector: buildRequireGateConnector(),
    signResponse: buildSignGateResponse(),
  }), { public: true });
  ctx.homeData(home.provider());

  // One route for the fiche's card and the SAS step (rules 24-27): a read, the actions live in Sowel.
  ctx.route('get', '/api/reservations/:id/gate-access', async (req, res) => {
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Identifiant invalide' });
    }
    const card = invitationView.ficheCard(ctx.db, reservationId);
    const sas = await invitationView.sasStep(ctx.db, reservationId);
    return res.json({ card, sas });
  });
  ctx.reception([{ method: 'GET', re: /^\/reservations\/\d+\/gate-access$/ }]);
  ctx.route('get', '/api/dashboard/gate-keys', controller.dashboard);
  // Pinned above the day on the home (specs/shell-and-home-day-first.md rule 3).
  ctx.attention({ key: 'gate-keys', rank: 10, handler: controller.dashboard, summarize: require('./attention').summarize });
  ctx.route('get', '/api/settings/gate-connector', controller.settings);
  ctx.route('get', '/api/settings/gate-connector/secrets', controller.secrets);
  // The keys come back in clear: a support session is refused them (specs/hosting-h2-account-security.md rule 23).
  ctx.secretRoutes([{ method: 'GET', re: /^\/settings\/gate-connector\/secrets$/ }]);

  ctx.emailContext({
    tokens: TOKENS,
    flags: FLAGS,
    build: (reservationId) => gateEmailContext(invitationView.usableInvitation(ctx.db, reservationId)),
  });

  // Rule 24 — the SAS payload says only whether there is a key; the step reads it through its route.
  ctx.sasData((reservationId) => ({ available: Boolean(invitationView.usableInvitation(ctx.db, reservationId)) }));

  // Rules 17-18 — Sowel reads the list hourly; three hours without a read pushes the admins once.
  ctx.jobs.every({
    name: 'stale-read',
    intervalMs: 60 * 60 * 1000,
    bootDelayMs: 160 * 1000,
    run: async () => {
      const { alerted } = await runStaleReadCheck({ model: getModel(), pushService: ctx.core.push });
      if (alerted) ctx.log.warn('Sowel has not read the keys for more than 3 h — admins pushed');
    },
  });

  // specs/guest-app-home-automation.md §5 — light commands are kept 7 days.
  ctx.jobs.every({
    name: 'home-commands-purge',
    intervalMs: DAY_MS,
    bootDelayMs: 170 * 1000,
    run: async () => { getHomeModel().purge(new Date()); },
  });

  ctx.data({
    tables: ['gate_key_results', 'gate_connector_state', ...HOME_TABLES],
    describe: (db) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM gate_key_results').get().n;
      const lines = [];
      if (n > 0) lines.push({ label: n > 1 ? `${n} résultats de clés` : '1 résultat de clé', count: n });
      lines.push({ label: 'l’état du connecteur', count: 1 });
      const equipments = db.prepare('SELECT COUNT(*) AS n FROM home_catalog').get().n;
      if (equipments > 0) lines.push({ label: equipments > 1 ? `${equipments} équipements de la maison` : '1 équipement de la maison', count: equipments });
      const commands = db.prepare('SELECT COUNT(*) AS n FROM home_commands').get().n;
      if (commands > 0) lines.push({ label: commands > 1 ? `${commands} commandes de lumière` : '1 commande de lumière', count: commands });
      return lines;
    },
    purge: () => { model = null; homeModel = null; },
  });
}

module.exports = { id, register };
