/**
 * Accès au portail (Sowel) (specs/gate-access-sowel-connector.md; module per
 * specs/plugins-phase-1-sdk.md). Sowel pulls the list of keys and posts the outcomes back; guestFlow
 * shows the stored key in the emails, the SAS and the fiche, and alerts the admins on a failure.
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
    pushService: ctx.core.push,
    publicUrl: () => ctx.core.settings.publicUrl(),
  });

  ctx.mount('/public/v1/gate', buildPublicRouter({
    controller,
    limiter: sdk.middleware.publicApiLimiter,
    requireConnector: buildRequireGateConnector(),
    signResponse: buildSignGateResponse(),
  }), { public: true });

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
  ctx.route('get', '/api/settings/gate-connector', controller.settings);
  ctx.route('get', '/api/settings/gate-connector/secrets', controller.secrets);

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

  ctx.data({
    tables: ['gate_key_results', 'gate_connector_state'],
    describe: (db) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM gate_key_results').get().n;
      const lines = [];
      if (n > 0) lines.push({ label: n > 1 ? `${n} résultats de clés` : '1 résultat de clé', count: n });
      lines.push({ label: 'l’état du connecteur', count: 1 });
      return lines;
    },
    purge: () => { model = null; },
  });
}

module.exports = { id, register };
