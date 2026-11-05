// specs/google-calendar-oauth-rework.md rule 5, reading of 2026-11-04 (audit R22, E22-1) — a Google failure with no
// response (DNS, network) is a GaxiosError whose `config.data` is the token request; gaxios masks the client secret,
// not `refresh_token`. Every log site prints googleErrorForLog: the answer, or message / code / status.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const net = require('net');
const util = require('util');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { google } = require('googleapis');
const { buildGoogleOAuthClient } = require('../oauthClient');
const { googleErrorForLog } = require('../client');
const { create } = require('../sync');
const { buildController } = require('../controller');

const SECRET = 'REFRESH_XYZ';
const { localIsoDate } = require('../../../utils/localDate');

const dayFromToday = (n) => localIsoDate(new Date(Date.now() + n * 86400000));

// The shape gaxios rejects with when the socket fails: no response, the request in `config`.
const networkError = () => Object.assign(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'), {
  code: 'ENOTFOUND',
  config: { url: 'https://oauth2.googleapis.com/token', data: new URLSearchParams({ refresh_token: SECRET, client_id: 'CID' }) },
});

const stay = (id) => ({
  id, propertyId: 1, propertyName: 'Villa', clientLastName: 'Doe', clientFirstName: 'Jane',
  startDate: dayFromToday(10), endDate: dayFromToday(12), checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0, options: [],
});

const syncSettings = {
  googleConnected: () => true,
  googleCalendarSelection: () => ({ calendarId: 'cal-1', summary: 'Agenda' }),
  recordGoogleSyncResult: () => {},
};

const engine = (calendar, reservations = [stay(1)]) => {
  const lines = [];
  const sync = create({
    settings: syncSettings,
    model: { listReservationsForSync: () => reservations, getReservationForSync: (id) => reservations.find((r) => r.id === id) || null },
    getCalendar: () => calendar,
    log: (...args) => lines.push(util.format(...args)),
  });
  return { sync, lines };
};

const assertClean = (lines, expected = 1) => {
  assert.ok(lines.length >= expected, 'the failure is logged');
  const text = lines.join('\n');
  assert.equal(text.includes(SECRET), false, text);
  assert.match(text, /ENOTFOUND/);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('googleErrorForLog: the answer when there is one, else message / code / status, never the request', () => {
  assert.deepEqual(googleErrorForLog(Object.assign(networkError(), { response: { data: { error: 'invalid_grant' } } })), { error: 'invalid_grant' });
  assert.deepEqual(googleErrorForLog(Object.assign(new Error('boom'), { code: 'X', status: 500, config: { data: SECRET }, response: { data: '' } })), { message: 'boom', code: 'X', status: 500 });
  assert.deepEqual(googleErrorForLog(networkError()), { message: 'getaddrinfo ENOTFOUND oauth2.googleapis.com', code: 'ENOTFOUND', status: undefined });
  assert.deepEqual(googleErrorForLog(null), { message: undefined, code: undefined, status: undefined });
});

test('real OAuth client, token endpoint down: the reconcile log holds no refresh token', async (t) => {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function refused() { throw new Error('no socket in this test'); };
  t.after(() => { net.Socket.prototype.connect = connect; });

  const fetchImplementation = async () => {
    throw Object.assign(new TypeError('getaddrinfo ENOTFOUND oauth2.googleapis.com'), { code: 'ENOTFOUND' });
  };
  class Stubbed extends google.auth.OAuth2 {
    constructor(...args) {
      super(...args);
      this.transporter.defaults = { ...(this.transporter.defaults || {}), fetchImplementation, retry: false };
    }
  }
  const settings = { ...syncSettings, googleTokens: () => ({ refreshToken: SECRET }), publicUrl: () => '', googleTokenBlob: () => 'blob' };
  const oauth = buildGoogleOAuthClient({
    OAuth2: Stubbed,
    env: { GOOGLE_OAUTH_CLIENT_ID: 'CID', GOOGLE_OAUTH_CLIENT_SECRET: 'CLIENT_SECRET_XYZ', GOOGLE_OAUTH_REDIRECT_URI: 'https://x.example/cb' },
    settings,
  });
  const lines = [];
  const sync = create({ settings, model: { listReservationsForSync: () => [] }, getCalendar: () => oauth.getAuthedCalendar(), log: (...args) => lines.push(util.format(...args)) });
  const result = await sync.reconcile();
  assert.equal(result.ok, false);
  assertClean(lines);
  assert.equal(lines.join('\n').includes('CLIENT_SECRET_XYZ'), false);
});

test('reconcile: a stay that fails and an orphan that fails log no request', async () => {
  const orphan = { id: 'orphan-1', extendedProperties: { private: { guestflowReservationId: '999', guestflowSource: 'guestflow' } } };
  const calendar = {
    events: {
      list: async () => ({ data: { items: [orphan] } }),
      update: async () => { throw networkError(); },
      insert: async () => { throw networkError(); },
      delete: async () => { throw networkError(); },
    },
  };
  const { sync, lines } = engine(calendar);
  const result = await sync.reconcile();
  assert.equal(result.errors, 2);
  assertClean(lines, 2);
});

test('a scheduled push and a scheduled delete that fail log no request', async () => {
  const fail = async () => { throw networkError(); };
  const { sync, lines } = engine({ events: { update: fail, insert: fail, delete: fail } });
  sync.schedulePush(1);
  await settle();
  sync.scheduleDelete(1);
  await settle();
  assertClean(lines, 2);
});

test('controller: every catch logs no request', async (t) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(util.format(...args));
  t.after(() => { console.error = original; });

  const fail = () => { throw networkError(); };
  const failAsync = async () => fail();
  const settings = {
    googleConnected: () => true,
    googleTokens: () => ({ refreshToken: SECRET }),
    googleCalendarSelection: () => ({ calendarId: 'cal-1', summary: 'Agenda' }),
    storeGoogleTokens: () => {},
    clearGoogleConnection: fail,
  };
  const calendar = { calendarList: { list: failAsync, get: failAsync } };
  const oauthFactory = () => ({
    exchangeCode: failAsync,
    revokeToken: async () => {},
    getAuthedCalendar: () => calendar,
  });
  const sync = { isActive: () => true, scheduleReconcile: () => {}, runReconcileGuarded: failAsync };
  const c = buildController({ settings, oauthFactory, sync, connectionTest: failAsync });
  const res = () => ({ status() { return this; }, json() { return this; }, redirect() { return this; } });

  const sites = [
    () => c.oauthCallback({ session: { googleOAuthState: 's' }, query: { code: 'c', state: 's' } }, res()),
    () => c.oauthDisconnect({}, res()),
    () => c.listCalendars({}, res()),
    () => c.setCalendar({ body: { calendarId: 'cal-1' } }, res()),
    () => c.testConnection({}, res()),
    () => c.syncNow({}, res()),
  ];
  for (const site of sites) {
    lines.length = 0;
    await site();
    assertClean(lines);
  }
});
