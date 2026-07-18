const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const controller = require('../controllers/googleCalendarController');
const { buildController, STATUS_LABELS, computeStatusKey, formatLastSyncLabel } = controller;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeDeps({ oauthConfigured = true, googleStatus }) {
  return {
    settings: {
      googleStatus: () => googleStatus,
      googleConnected: () => googleStatus.connected,
      googleCalendarSelection: () => ({ calendarId: googleStatus.calendarId, summary: googleStatus.calendarSummary }),
      googleTokens: () => ({ refreshToken: googleStatus.connected ? 'SECRET-TOKEN' : '' }),
    },
    oauthFactory: () => ({
      isConfigured: () => oauthConfigured,
      getAuthedCalendar: () => null,
    }),
    sync: { isActive: () => googleStatus.connected && Boolean(googleStatus.calendarId) },
  };
}

const BASE_STATUS = {
  connected: false,
  connectedEmail: '',
  connectedAt: null,
  calendarId: '',
  calendarSummary: '',
  lastSyncAt: null,
  lastSyncOk: null,
  lastSyncDetail: '',
};

// --- statusKey matrix (spec rule 25) ---

test('computeStatusKey: full matrix', () => {
  assert.equal(computeStatusKey({ oauthConfigured: false, connected: false, calendarId: '', lastSyncOk: null }), 'notConfigured');
  assert.equal(computeStatusKey({ oauthConfigured: true, connected: false, calendarId: '', lastSyncOk: null }), 'notConfigured');
  assert.equal(computeStatusKey({ oauthConfigured: true, connected: true, calendarId: '', lastSyncOk: null }), 'inProgress');
  assert.equal(computeStatusKey({ oauthConfigured: true, connected: true, calendarId: 'cal', lastSyncOk: null }), 'active');
  assert.equal(computeStatusKey({ oauthConfigured: true, connected: true, calendarId: 'cal', lastSyncOk: true }), 'active');
  assert.equal(computeStatusKey({ oauthConfigured: true, connected: true, calendarId: 'cal', lastSyncOk: false }), 'failed');
});

test('formatLastSyncLabel: server-composed French label (fat backend)', () => {
  assert.equal(formatLastSyncLabel(null, ''), null);
  assert.match(formatLastSyncLabel('2026-07-18T10:05:00.000Z', ''), /^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);
  assert.match(formatLastSyncLabel('2026-07-18T10:05:00.000Z', '3 envoyée(s)'), / — 3 envoyée\(s\)$/);
});

test('status labels keep the historical French strings (client chip mapping)', () => {
  assert.equal(STATUS_LABELS.notConfigured, 'Synchronisation non configurée');
  assert.equal(STATUS_LABELS.inProgress, 'Configuration en cours');
  assert.equal(STATUS_LABELS.active, 'Synchronisation active');
  assert.equal(STATUS_LABELS.failed, 'Échec de la dernière synchro');
});

// --- GET /status shape ---

test('status: full response shape when connected + calendar selected', () => {
  const googleStatus = {
    ...BASE_STATUS,
    connected: true,
    connectedEmail: 'adrien@example.com',
    connectedAt: '2026-07-18T10:00:00.000Z',
    calendarId: 'cal-1',
    calendarSummary: 'Agenda pro',
    lastSyncAt: '2026-07-18T10:05:00.000Z',
    lastSyncOk: true,
    lastSyncDetail: '3 envoyée(s), 0 supprimée(s), 12 inchangée(s)',
  };
  const c = buildController(makeDeps({ googleStatus }));
  const res = fakeRes();
  c.status({}, res);
  assert.deepEqual(res.body, {
    oauthConfigured: true,
    connected: true,
    connectedEmail: 'adrien@example.com',
    connectedAt: '2026-07-18T10:00:00.000Z',
    calendarId: 'cal-1',
    calendarSummary: 'Agenda pro',
    syncActive: true,
    lastSyncAt: '2026-07-18T10:05:00.000Z',
    lastSyncOk: true,
    lastSyncDetail: '3 envoyée(s), 0 supprimée(s), 12 inchangée(s)',
    lastSyncLabel: formatLastSyncLabel('2026-07-18T10:05:00.000Z', '3 envoyée(s), 0 supprimée(s), 12 inchangée(s)'),
    statusKey: 'active',
    statusLabel: STATUS_LABELS.active,
  });
  // The refresh token must never appear anywhere in the payload.
  assert.equal(JSON.stringify(res.body).includes('SECRET-TOKEN'), false);
});

test('status: not connected → nulls + notConfigured label + syncActive false', () => {
  const c = buildController(makeDeps({ googleStatus: { ...BASE_STATUS } }));
  const res = fakeRes();
  c.status({}, res);
  assert.equal(res.body.connected, false);
  assert.equal(res.body.connectedEmail, null);
  assert.equal(res.body.calendarId, null);
  assert.equal(res.body.syncActive, false);
  assert.equal(res.body.lastSyncOk, null);
  assert.equal(res.body.statusLabel, STATUS_LABELS.notConfigured);
});

test('status: connected without calendar → Configuration en cours', () => {
  const googleStatus = { ...BASE_STATUS, connected: true, connectedEmail: 'a@b.com' };
  const c = buildController(makeDeps({ googleStatus }));
  const res = fakeRes();
  c.status({}, res);
  assert.equal(res.body.syncActive, false);
  assert.equal(res.body.statusLabel, STATUS_LABELS.inProgress);
});

test('status: last sync failed → Échec de la dernière synchro', () => {
  const googleStatus = {
    ...BASE_STATUS,
    connected: true,
    calendarId: 'cal-1',
    calendarSummary: 'Agenda pro',
    lastSyncOk: false,
    lastSyncDetail: 'Connexion Google expirée ou révoquée. Reconnectez votre compte.',
  };
  const c = buildController(makeDeps({ googleStatus }));
  const res = fakeRes();
  c.status({}, res);
  assert.equal(res.body.statusLabel, STATUS_LABELS.failed);
  assert.match(res.body.lastSyncDetail, /Reconnectez/);
});

// --- sync-now gate ---

test('sync-now: 400 with a French message when sync is inactive', async () => {
  const deps = makeDeps({ googleStatus: { ...BASE_STATUS } });
  deps.sync = { isActive: () => false };
  const c = buildController(deps);
  const res = fakeRes();
  await c.syncNow({}, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'GOOGLE_SYNC_INACTIVE');
  assert.match(res.body.message, /Connectez votre compte Google/);
});

test('sync-now: returns the reconcile counters + server-built detail; 409 when already running', async () => {
  const deps = makeDeps({ googleStatus: { ...BASE_STATUS, connected: true, calendarId: 'cal-1' } });
  deps.sync = {
    isActive: () => true,
    runReconcileGuarded: async () => ({ ok: true, pushed: 2, deleted: 1, skipped: 3, errors: 0, detail: '2 envoyée(s), 1 supprimée(s), 3 inchangée(s)' }),
  };
  let res = fakeRes();
  await buildController(deps).syncNow({}, res);
  assert.deepEqual(res.body, { ok: true, pushed: 2, deleted: 1, skipped: 3, errors: 0, detail: '2 envoyée(s), 1 supprimée(s), 3 inchangée(s)' });

  deps.sync.runReconcileGuarded = async () => ({ ok: false, alreadyRunning: true });
  res = fakeRes();
  await buildController(deps).syncNow({}, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'SYNC_IN_PROGRESS');
});

// --- calendar selection ---

test('setCalendar: validates write access via calendarList.get and triggers a reconcile', async () => {
  const reconciles = [];
  const stored = [];
  const ENTRIES = {
    'cal-1': { id: 'cal-1', summary: 'Agenda pro', accessRole: 'owner', primary: true },
    'cal-2': { id: 'cal-2', summary: 'Lecture seule', accessRole: 'reader' },
  };
  const deps = makeDeps({ googleStatus: { ...BASE_STATUS, connected: true } });
  deps.settings.storeGoogleCalendarSelection = (sel) => stored.push(sel);
  deps.sync = { isActive: () => true, scheduleReconcile: () => reconciles.push(1) };
  deps.oauthFactory = () => ({
    isConfigured: () => true,
    getAuthedCalendar: () => ({
      calendarList: {
        get: async ({ calendarId }) => {
          const entry = ENTRIES[calendarId];
          if (!entry) throw { response: { status: 404 } };
          return { data: entry };
        },
      },
    }),
  });
  const c = buildController(deps);

  let res = fakeRes();
  await c.setCalendar({ body: { calendarId: 'cal-1' } }, res);
  assert.deepEqual(res.body, { ok: true, calendarId: 'cal-1', calendarSummary: 'Agenda pro' });
  assert.deepEqual(stored, [{ calendarId: 'cal-1', summary: 'Agenda pro' }]);
  assert.equal(reconciles.length, 1);

  // A read-only calendar is not selectable.
  res = fakeRes();
  await c.setCalendar({ body: { calendarId: 'cal-2' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_CALENDAR');

  // An unknown calendar id (Google 404) is not selectable either.
  res = fakeRes();
  await c.setCalendar({ body: { calendarId: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_CALENDAR');
});

test('listCalendars: filters to writer/owner and flags the primary', async () => {
  const deps = makeDeps({ googleStatus: { ...BASE_STATUS, connected: true } });
  deps.oauthFactory = () => ({
    isConfigured: () => true,
    getAuthedCalendar: () => ({
      calendarList: {
        list: async () => ({
          data: {
            items: [
              { id: 'p', summary: 'Perso', accessRole: 'owner', primary: true },
              { id: 'w', summary: 'Partagé écriture', accessRole: 'writer' },
              { id: 'r', summary: 'Abonnement lecture', accessRole: 'reader' },
            ],
          },
        }),
      },
    }),
  });
  const res = fakeRes();
  await buildController(deps).listCalendars({}, res);
  assert.deepEqual(res.body, {
    calendars: [
      { id: 'p', summary: 'Perso', primary: true },
      { id: 'w', summary: 'Partagé écriture', primary: false },
    ],
  });
});

test('listCalendars / setCalendar: 400 GOOGLE_NOT_CONNECTED when no connection', async () => {
  const deps = makeDeps({ googleStatus: { ...BASE_STATUS } });
  const c = buildController(deps);
  let res = fakeRes();
  await c.listCalendars({}, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'GOOGLE_NOT_CONNECTED');
  res = fakeRes();
  await c.setCalendar({ body: { calendarId: 'x' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'GOOGLE_NOT_CONNECTED');
});
