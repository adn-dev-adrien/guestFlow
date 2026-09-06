/**
 * specs/neat-cancellation-insurance-subscription.md §4.3 — controllers/neatController.js.
 *
 * Settings masking + the secret 3-way, the mapping 422 shape, the retry/void endpoints and the
 * fiche `neat` block derivation (incl. the rule-16 « line_removed_active » warning state).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNeatController } = require('../controllers/neatController');
const { buildModel } = require('../models/neatSubscriptionsModel');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
  CONTRACT_FIELDS, MAPPING,
} = require('./neatFixtures');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// A settingsModel double that records upserts and reflects them back through neatConfig.
function recordingSettings(initialOverrides = {}) {
  const state = { ...fakeNeatSettings().neatConfig(), ...initialOverrides };
  const colToKey = {
    neatEnvironment: 'environment', neatClientId: 'clientId', neatClientSecretEncrypted: 'clientSecret',
    neatStoreId: 'storeId', neatSalesChannelId: 'salesChannelId', neatSalesChannelLabel: 'salesChannelLabel',
    neatContractId: 'contractId', neatContractLabel: 'contractLabel', neatPaymentMethodId: 'paymentMethodId',
    neatPaymentMethodKind: 'paymentMethodKind', neatPaymentMethodLabel: 'paymentMethodLabel',
    neatFieldMappingJson: 'fieldMappingJson', neatContractFieldsJson: 'contractFieldsJson',
    neatMarginPercent: 'marginPercent',
  };
  return {
    upserts: [],
    neatConfig: () => ({ ...state }),
    upsert(payload) {
      this.upserts.push(payload);
      for (const [col, value] of Object.entries(payload)) {
        if (colToKey[col]) state[colToKey[col]] = value;
      }
    },
  };
}

function controllerFor(db, { settings = recordingSettings(), clientFactory = fakeNeatClientFactory(), push = fakePushService() } = {}) {
  const model = buildModel(db);
  const ctrl = createNeatController({
    db, settingsModel: settings, model, buildClient: clientFactory, pushService: push,
    now: () => new Date('2027-06-01T10:00:00Z'), logger: silentLogger,
  });
  return { ctrl, model, settings, clientFactory };
}

// specs/neat-cancellation-insurance-subscription.md règle 1 (the Réglages section holds the
// environment + credentials, secret masked) + règle 6 (status summary derived server-side).
test('getSettings masks the secret to a boolean and derives the status server-side', () => {
  const db = freshNeatDb();
  const { ctrl } = controllerFor(db);
  const res = fakeRes();
  ctrl.getSettings({}, res);
  assert.equal(res.body.clientSecretSet, true);
  assert.equal('clientSecret' in res.body, false, 'the secret never crosses HTTP');
  assert.equal(res.body.status.subscriptionActive, true);
  assert.equal(res.body.status.pricingActive, true);
  assert.equal(res.body.status.requiredFieldsMapped, 1);
  assert.ok(Array.isArray(res.body.sources) && res.body.sources.length > 0, 'the source catalogue feeds the mapping selects');
  db.close();
});

test('updateSettings — the secret 3-way: absent preserves, empty clears, value stores', () => {
  const db = freshNeatDb();
  const { ctrl, settings } = controllerFor(db);
  ctrl.updateSettings({ body: { clientId: 'new-id' } }, fakeRes());
  assert.equal('neatClientSecretEncrypted' in settings.upserts[0], false, 'absent → preserved');
  ctrl.updateSettings({ body: { clientSecret: '' } }, fakeRes());
  assert.equal(settings.upserts[1].neatClientSecretEncrypted, '', 'empty → cleared');
  ctrl.updateSettings({ body: { clientSecret: 'new-secret' } }, fakeRes());
  assert.equal(settings.upserts[2].neatClientSecretEncrypted, 'new-secret');
  db.close();
});

// specs/neat-cancellation-insurance-subscription.md règle 2 — « Tester la connexion »
// authenticates against the selected environment and reports success or the exact Neat error;
// without credentials the whole feature is off (400, no call attempted).
test('testConnection — 400 without credentials, 502 with Neat’s exact error, ok on success', async () => {
  const db = freshNeatDb();
  const unconfigured = controllerFor(db, { settings: recordingSettings({ clientId: '', clientSecret: '' }) });
  const noCreds = fakeRes();
  await unconfigured.ctrl.testConnection({}, noCreds);
  assert.equal(noCreds.statusCode, 400);

  const okFactory = () => ({ testConnection: async () => ({ ok: true, serviceAccountId: 'svc-1' }) });
  const okCtrl = controllerFor(db, { clientFactory: okFactory });
  const okRes = fakeRes();
  await okCtrl.ctrl.testConnection({}, okRes);
  assert.deepEqual(okRes.body, { ok: true, environment: 'staging' });

  const boom = Object.assign(new Error('Neat auth failed (HTTP 401)'), { status: 401 });
  const koFactory = () => ({ testConnection: async () => { throw boom; } });
  const koCtrl = controllerFor(db, { clientFactory: koFactory });
  const koRes = fakeRes();
  await koCtrl.ctrl.testConnection({}, koRes);
  assert.equal(koRes.statusCode, 502);
  assert.match(koRes.body.error, /Connexion Neat impossible : Neat auth failed/);
  db.close();
});

test('updateSettings validates the environment and the margin', () => {
  const db = freshNeatDb();
  const { ctrl, settings } = controllerFor(db);
  const badEnv = fakeRes();
  ctrl.updateSettings({ body: { environment: 'prod' } }, badEnv);
  assert.equal(badEnv.statusCode, 400);
  assert.ok(badEnv.body.errors.environment);
  const badMargin = fakeRes();
  ctrl.updateSettings({ body: { marginPercent: -5 } }, badMargin);
  assert.equal(badMargin.statusCode, 400);
  ctrl.updateSettings({ body: { marginPercent: '' } }, fakeRes());
  assert.equal(settings.upserts[0].neatMarginPercent, null, 'empty margin → Neat pricing off, static tariff back');
  db.close();
});

test('updateMapping — an invalid mapping returns 422 with per-field errors and stores nothing', () => {
  const db = freshNeatDb();
  const { ctrl, settings } = controllerFor(db);
  const res = fakeRes();
  ctrl.updateMapping({ body: { mapping: {} } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'MAPPING_INVALID');
  assert.deepEqual(res.body.errors, [{ fieldId: 'f-nights', error: 'REQUIRED_UNMAPPED' }]);
  assert.equal(settings.upserts.length, 0);

  const ok = fakeRes();
  ctrl.updateMapping({ body: { mapping: MAPPING } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(settings.upserts[0].neatFieldMappingJson, JSON.stringify(MAPPING));
  db.close();
});

test('the fiche block derives the display status: pending / failed / active / voided', async () => {
  const db = freshNeatDb();
  const { ctrl, model } = controllerFor(db);
  const id = insertReservation(db);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

  assert.equal(ctrl.buildFicheBlock(reservation), null, 'no job yet → nothing to show');

  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  assert.equal(ctrl.buildFicheBlock(reservation).status, 'pending');

  const job = model.getByReservationId(id, 'staging');
  model.markFailedAttempt(job.id, { error: 'down', errorKind: 'unavailable', nowMs: Date.now() });
  const failed = ctrl.buildFicheBlock(reservation);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.lastError, 'down');

  model.markActive(job.id, { neatSubscriptionId: 'sub-1', premiumAmount: 17.5, billedAmount: 9 });
  const active = ctrl.buildFicheBlock(reservation);
  assert.equal(active.status, 'active');
  assert.equal(active.neatId, 'sub-1');
  assert.equal(active.premiumAmount, 17.5);
  assert.equal(active.marginPercent, 30, 'the margin rides along for the derivation caption');

  model.markVoided(job.id);
  assert.equal(ctrl.buildFicheBlock(reservation).status, 'voided');
  db.close();
});

test('rule 16 — an active subscription whose insurance line was removed shows line_removed_active', () => {
  const db = freshNeatDb();
  const { ctrl, model } = controllerFor(db);
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  model.markActive(model.getByReservationId(id, 'staging').id, { neatSubscriptionId: 'sub-1', premiumAmount: 17.5, billedAmount: 9 });
  db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(id);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(ctrl.buildFicheBlock(reservation).status, 'line_removed_active');
  db.close();
});

test('the fiche block is null for a platform reservation, even with a job row', () => {
  const db = freshNeatDb();
  const { ctrl, model } = controllerFor(db);
  const id = insertReservation(db, { platform: 'Airbnb' });
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(ctrl.buildFicheBlock(reservation), null);
  db.close();
});

test('retry makes the job due, runs a pass, and returns the refreshed block', async () => {
  const db = freshNeatDb();
  const { ctrl, model } = controllerFor(db);
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  const job = model.getByReservationId(id, 'staging');
  model.markFailedAttempt(job.id, { error: 'down', errorKind: 'unavailable', nowMs: new Date('2027-06-01T10:00:00Z').getTime() + 10 ** 9 });
  const res = fakeRes();
  await ctrl.retry({ params: { id: String(id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.neat.status, 'active', 'the failed job was re-run immediately');
  db.close();
});

test('retry on an active subscription is a 409; on an unknown reservation a 404', async () => {
  const db = freshNeatDb();
  const { ctrl, model } = controllerFor(db);
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  model.markActive(model.getByReservationId(id, 'staging').id, { neatSubscriptionId: 'sub-1', premiumAmount: 17.5, billedAmount: 9 });
  const conflict = fakeRes();
  await ctrl.retry({ params: { id: String(id) } }, conflict);
  assert.equal(conflict.statusCode, 409);
  const missing = fakeRes();
  await ctrl.retry({ params: { id: '9999' } }, missing);
  assert.equal(missing.statusCode, 404);
  db.close();
});

test('void resiliates at Neat then marks the job voided; only an active job can be voided', async () => {
  const db = freshNeatDb();
  const clientFactory = fakeNeatClientFactory();
  const { ctrl, model } = controllerFor(db, { clientFactory });
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);

  const notActive = fakeRes();
  await ctrl.void({ params: { id: String(id) } }, notActive);
  assert.equal(notActive.statusCode, 409, 'a pending job has nothing to void at Neat');

  model.markActive(model.getByReservationId(id, 'staging').id, { neatSubscriptionId: 'sub-1', premiumAmount: 17.5, billedAmount: 9 });
  const res = fakeRes();
  await ctrl.void({ params: { id: String(id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(clientFactory.calls.voidSubscription, [{ id: 'sub-1' }]);
  assert.equal(res.body.neat.status, 'voided');
  db.close();
});

test('a Neat failure during void keeps the job active and surfaces a 502', async () => {
  const db = freshNeatDb();
  const boom = Object.assign(new Error('down'), { status: 503 });
  const clientFactory = fakeNeatClientFactory({ failWith: boom });
  const { ctrl, model } = controllerFor(db, { clientFactory });
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  model.markActive(model.getByReservationId(id, 'staging').id, { neatSubscriptionId: 'sub-1', premiumAmount: 17.5, billedAmount: 9 });
  const res = fakeRes();
  await ctrl.void({ params: { id: String(id) } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(model.getByReservationId(id, 'staging').status, 'active', 'never voided locally when Neat did not confirm');
  db.close();
});

// specs/neat-cancellation-insurance-subscription.md règle 3 — discovery is server-driven: the
// operator picks the sales channel / contract / payment method, and everything stored about them
// (labels, the contract's serviceFields schema) is resolved from Neat, never trusted from the client.
test('updateSelection resolves labels + the contract schema from Neat, never from the client payload', async () => {
  const db = freshNeatDb();
  const clientFactory = () => ({
    getSalesChannel: async () => ({ id: 'ch-1', name: 'Site direct', paymentMethods: [{ id: 'pm-1', type: 'Cash', name: 'Facturation établissement' }] }),
    getSalesChannelContracts: async () => ([{ id: 'c-1', status: 'Active', product: { name: 'Assurance annulation', Garanties: [{ serviceFields: CONTRACT_FIELDS }] } }]),
  });
  const settings = recordingSettings();
  const { ctrl } = controllerFor(db, { settings, clientFactory });
  const res = fakeRes();
  await ctrl.updateSelection({ body: { salesChannelId: 'ch-1', contractId: 'c-1', paymentMethodId: 'pm-1' } }, res);
  assert.equal(res.statusCode, 200);
  const stored = settings.upserts[0];
  assert.equal(stored.neatSalesChannelLabel, 'Site direct');
  assert.equal(stored.neatContractLabel, 'Assurance annulation');
  assert.equal(stored.neatPaymentMethodKind, 'Cash');
  assert.equal(stored.neatPaymentMethodLabel, 'Facturation établissement');
  assert.deepEqual(JSON.parse(stored.neatContractFieldsJson), CONTRACT_FIELDS);

  const wrong = fakeRes();
  await ctrl.updateSelection({ body: { salesChannelId: 'ch-1', contractId: 'nope', paymentMethodId: 'pm-1' } }, wrong);
  assert.equal(wrong.statusCode, 422);
  db.close();
});
