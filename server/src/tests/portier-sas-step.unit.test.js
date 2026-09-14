// specs/gate-access-portier.md §3.3 — the SAS step « Accès portail »: the code and its QR, read from Portier.
//
// The QR must carry the very address of the email (flashing it sets the guest's app up), and it is a
// key while the stay lasts: it is shown on screen and never written to a log.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const QRCode = require('qrcode');

const { invitationForSas, gateAccessForEmail } = require('../utils/portierInvitation');
const { PortierUnavailableError } = require('../utils/portierClient');

const INVITATION = {
  url: 'https://guest.domainesolio.com/#i=4K7M9QT2',
  code: '4K7M-9QT2',
  state: 'before',
  window: { from: '2026-09-21T14:00:00.000Z', until: '2026-09-28T09:00:00.000Z' },
};

const clientAnswering = (answer) => ({ calls: [], isConfigured: () => true, async call(req) { this.calls.push(req); return answer; } });

test('the step carries the code, the window in force, and a QR of exactly the email\'s address', async () => {
  const client = clientAnswering({ status: 200, data: INVITATION });
  const step = await invitationForSas(42, { client, fallbackCode: '1234' });

  assert.deepEqual(client.calls, [{ method: 'GET', path: '/svc/v1/stays/42/invitation' }]);
  assert.deepEqual(
    [step.status, step.code, step.windowLabel, step.fallbackCode],
    ['ok', '4K7M-9QT2', 'Actif du 21/09 à 16:00 au 28/09 à 11:00', '1234'],
  );
  const svg = Buffer.from(step.qrDataUri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
  const email = await gateAccessForEmail({ reservation: { id: 42, kind: 'reservation' }, texts: ['{{gateAccessUrl}}'], client });
  assert.equal(svg, await QRCode.toString(email.gateAccess.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }),
    'the QR encodes the same link the J-7 email carries');
});

test('Portier unreachable → « unavailable », the keypad code stays; not configured → said so', async () => {
  const down = { isConfigured: () => true, async call() { throw new PortierUnavailableError('timeout'); } };
  assert.deepEqual(await invitationForSas(42, { client: down, fallbackCode: '1234' }), { status: 'unavailable', fallbackCode: '1234' });
  const off = { isConfigured: () => false, async call() { throw new Error('never called'); } };
  assert.deepEqual(await invitationForSas(42, { client: off, fallbackCode: '' }), { status: 'not_configured', fallbackCode: '' });
});

test('a revoked, deleted or finished access shows no QR and no code, only what happened', async () => {
  for (const state of ['revoked', 'deleted', 'after']) {
    const step = await invitationForSas(42, { client: clientAnswering({ status: 200, data: { ...INVITATION, state } }) });
    assert.equal(step.code, '');
    assert.equal(step.qrDataUri, '');
    assert.ok(step.notice.length > 0, state);
  }
  const suspended = await invitationForSas(42, { client: clientAnswering({ status: 200, data: { ...INVITATION, state: 'suspended' } }) });
  assert.equal(suspended.code, '4K7M-9QT2', 'a suspended access keeps its QR: it works again once resumed');
});

test('the SAS read over the real client writes neither the code nor the link to any log', async () => {
  const saved = { env: { ...process.env }, fetch: global.fetch, console: { ...console } };
  const captured = [];
  process.env.PORTIER_SVC_URL = 'http://portier.test';
  process.env.PORTIER_KEY_GF = crypto.randomBytes(32).toString('base64url');
  global.fetch = async () => ({ status: 200, text: async () => JSON.stringify(INVITATION) });
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...args) => captured.push(args.join(' '));

  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/reservationsModel') return { getRow: (rid) => (Number(rid) === 42 ? { id: 42, kind: 'reservation' } : undefined) };
    if (id === '../models/settingsModel') return { read: () => ({ portalCode: '1234' }) };
    return original.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/sasController')];
    const sasController = require('../controllers/sasController');
    Module.prototype.require = original;
    const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await sasController.getGateAccessStep({ params: { id: '42' }, user: { roles: ['reception'] } }, res);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.qrDataUri.startsWith('data:image/svg+xml;base64,'));
    const logs = captured.join('\n');
    for (const secret of ['4K7M-9QT2', '4K7M9QT2', INVITATION.url, res.body.qrDataUri]) {
      assert.equal(logs.includes(secret), false, `nothing logged contains ${secret.slice(0, 20)}…`);
    }
  } finally {
    Module.prototype.require = original;
    Object.assign(console, saved.console);
    global.fetch = saved.fetch;
    for (const key of ['PORTIER_SVC_URL', 'PORTIER_KEY_GF']) {
      if (saved.env[key] === undefined) delete process.env[key];
      else process.env[key] = saved.env[key];
    }
  }
});
