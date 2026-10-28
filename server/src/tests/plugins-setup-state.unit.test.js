// specs/plugins-phase-0-foundation.md rule 25 — a plugin card tells its real state: an active plugin
// that lacks something reads « Actif · <what> » and offers « Configurer » at its settings place; the
// others offer « Réglages » where they have one; the Plugins page counts those to configure.
// The plugin says what it lacks through `ctx.setupStatus` (SDK 1.5.0).

const test = require('node:test');
const { skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');
const { PLUGIN_CATALOG, PLUGIN_SETTINGS_PLACES } = require('../constants/plugins');
const { createController } = require('../controllers/pluginsController');

function fakeModel(rows) {
  return {
    list: () => Object.entries(rows).map(([id, r]) => ({ id, ...r })),
    get: (id) => (rows[id] ? { id, version: '1.0.0', source: 'archive', ...rows[id] } : null),
    countOpenPaymentLinks: () => 0,
    countPendingDeactivations: () => 0,
    countOnlyRoleUsers: () => 0,
  };
}

const fakeHost = {
  mode: () => 'sources', state: () => ({ incompatible: {}, restart: { supervised: false } }), runningCopy: () => null, hostExports: () => null,
};
const allowAll = { allowsPlugin: () => true, planFor: () => null };

function controllerWith(rows, records) {
  return createController(fakeModel(rows), {
    registry: { get: (id) => records[id] || null },
    host: () => fakeHost,
    licence: () => allowAll,
    coreVersion: () => '3.11.0',
  });
}

function capture(handler) {
  let body = null;
  handler({ params: {}, body: {} }, { json: (b) => { body = b; return this; }, status() { return this; } });
  return body;
}

test('rule 25: every catalogued plugin has a declared settings place (or none, said with null)', () => {
  PLUGIN_CATALOG.forEach((p) => {
    assert.ok(Object.prototype.hasOwnProperty.call(PLUGIN_SETTINGS_PLACES, p.id), `${p.id} has no settings place entry`);
  });
});

test('rule 25: « Actif · à connecter » + « Configurer » while the plugin lacks something, « Réglages » once set up', () => {
  let connected = false;
  const records = { 'google-calendar': { setupStatus: () => (connected ? null : 'à connecter') } };
  const ctrl = controllerWith({ 'google-calendar': { enabled: 1 } }, records);
  let card = ctrl.views().find((p) => p.id === 'google-calendar');
  assert.deepEqual(card.setup, {
    needed: true, label: 'Actif · à connecter', missing: 'à connecter', path: '/settings/integrations?tab=google-calendar', action: 'Configurer',
  });
  connected = true;
  card = ctrl.views().find((p) => p.id === 'google-calendar');
  assert.deepEqual(card.setup, { needed: false, label: 'Actif', path: '/settings/integrations?tab=google-calendar', action: 'Réglages' });
});

test('rule 25: an inactive plugin offers no settings action; the SAS opens its « Facturables » tab', () => {
  const ctrl = controllerWith({ neat: { enabled: 0 }, sas: { enabled: 1 } }, { neat: { setupStatus: () => 'identifiants manquants' } });
  const views = ctrl.views();
  assert.equal(views.find((p) => p.id === 'neat').setup.action, null);
  assert.equal(views.find((p) => p.id === 'neat').setup.needed, false);
  // 2026-10-27 audit — the SAS card used to have no button at all and read as empty.
  assert.deepEqual(views.find((p) => p.id === 'sas').setup, { needed: false, label: 'Actif', path: '/parametres/options-ressources?tab=sas', action: 'Réglages' });
});

test('rule 25: a check that throws reads as nothing missing, never as a broken page', () => {
  const ctrl = controllerWith({ neat: { enabled: 1 } }, { neat: { setupStatus: () => { throw new Error('boom'); } } });
  assert.equal(ctrl.views().find((p) => p.id === 'neat').setup.needed, false);
});

test('rule 25: the status counts the active plugins to configure', () => {
  const records = {
    neat: { setupStatus: () => 'identifiants manquants' },
    'weather-alerts': { setupStatus: () => 'clé manquante' },
    'online-payment': { setupStatus: () => null },
  };
  const ctrl = controllerWith({ neat: { enabled: 1 }, 'weather-alerts': { enabled: 0 }, 'online-payment': { enabled: 1 } }, records);
  assert.equal(capture(ctrl.status).toConfigure, 1);
});

test('rule 25: ctx.setupStatus is an SDK 1.5.0 entry point and takes a function only', () => {
  // Still there in SDK 2 (specs/sas-arrival-total-server-side.md rule 14 removed `recapLines` only).
  assert.equal(satisfies(SDK_VERSION, '>=1.5.0'), true);
  const ctx = createContext('setup-probe', { settingsModel: () => ({}) });
  assert.throws(() => ctx.setupStatus('nope'), /setupStatus needs a function/);
  ctx.setupStatus(() => 'à connecter');
  assert.equal(registry.get('setup-probe').setupStatus(), 'à connecter');
});

// Each plugin that can lack something says so from its own settings.
function registered(id, stored) {
  const mod = require('../plugins').find((m) => m.id === id);
  const settingsModel = () => ({
    get: (_, key) => (stored[key] == null ? '' : stored[key]),
    set: (_, key, value) => { stored[key] = value; },
    raw: (_, key) => stored[key] || '',
  });
  mod.register(createContext(id, { db: null, settingsModel }));
  return registry.get(id).setupStatus;
}

test('rule 25: Google Agenda — à connecter, then agenda à choisir, then nothing', { skip: skipWithout(['google-calendar']) }, () => {
  const stored = {};
  const check = registered('google-calendar', stored);
  assert.equal(check(), 'à connecter');
  stored.refreshToken = 'blob';
  assert.equal(check(), 'agenda à choisir');
  stored.calendarId = 'agenda@group.calendar.google.com';
  assert.equal(check(), null);
});

test('rule 25: Neat — identifiants manquants until the client id and secret are both there', { skip: skipWithout(['neat']) }, () => {
  const stored = {};
  const check = registered('neat', stored);
  assert.equal(check(), 'identifiants manquants');
  stored.neatClientId = 'abc';
  assert.equal(check(), 'identifiants manquants');
  stored.neatClientSecretEncrypted = 'secret';
  assert.equal(check(), null);
});

test('rule 25: Vigilance Météo-France — clé manquante until the key is stored', { skip: skipWithout(['weather-alerts']) }, () => {
  const stored = {};
  const check = registered('weather-alerts', stored);
  assert.equal(check(), 'clé manquante');
  stored.apiKey = 'blob';
  assert.equal(check(), null);
});

test('rule 25: Paiement en ligne — à connecter until Qonto handed a refresh token', { skip: skipWithout(['online-payment']) }, () => {
  const stored = {};
  const check = registered('online-payment', stored);
  assert.equal(check(), 'à connecter');
  stored.qontoRefreshTokenEncrypted = 'blob';
  assert.equal(check(), null);
});
