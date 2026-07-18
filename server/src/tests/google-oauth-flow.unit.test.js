const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { buildController } = require('../controllers/googleCalendarController');

// Controller-level OAuth flow tests (specs/google-calendar-oauth-rework.md §3 rules 4-8) —
// everything injected: fake settings store, fake oauth factory, fake sync engine.

function fakeSettingsStore() {
  const state = {
    tokens: { refreshToken: '' },
    stored: [],
    cleared: 0,
    selection: { calendarId: '', summary: '' },
  };
  return {
    state,
    googleTokens: () => state.tokens,
    googleConnected: () => Boolean(state.tokens.refreshToken),
    storeGoogleTokens(payload) {
      state.stored.push(payload);
      state.tokens = { refreshToken: payload.refreshToken };
    },
    clearGoogleConnection() {
      state.cleared += 1;
      state.tokens = { refreshToken: '' };
      state.selection = { calendarId: '', summary: '' };
    },
    googleCalendarSelection: () => state.selection,
    storeGoogleCalendarSelection({ calendarId, summary }) {
      state.selection = { calendarId, summary };
    },
    googleStatus: () => ({
      connected: Boolean(state.tokens.refreshToken),
      connectedEmail: '',
      connectedAt: null,
      calendarId: state.selection.calendarId,
      calendarSummary: state.selection.summary,
      lastSyncAt: null,
      lastSyncOk: null,
      lastSyncDetail: '',
    }),
  };
}

function fakeOauth({ configured = true, redirectUri = 'https://x.example.com/cb', exchange, revoked } = {}) {
  return () => ({
    isConfigured: () => configured,
    resolveRedirectUri: () => redirectUri,
    getAuthorizeUrl: ({ state }) => `https://accounts.google.com/auth?state=${state}`,
    exchangeCode: exchange || (async () => ({ refreshToken: '1//tok', email: 'a@b.com' })),
    revokeToken: async (token) => { if (revoked) revoked.push(token); },
    getAuthedCalendar: () => null,
  });
}

function fakeSync() {
  return {
    isActive: () => false,
    scheduleReconcile: () => {},
    runReconcileGuarded: async () => ({ ok: true, pushed: 0, deleted: 0, skipped: 0, errors: 0 }),
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

// --- authorize ---

test('authorize: stores a single-use state in the session and redirects to Google', () => {
  const c = buildController({ settings: fakeSettingsStore(), oauthFactory: fakeOauth(), sync: fakeSync() });
  const req = { session: {} };
  const res = fakeRes();
  c.oauthAuthorize(req, res);
  assert.ok(req.session.googleOAuthState, 'state stored in session');
  assert.match(req.session.googleOAuthState, /^[0-9a-f]{32}$/);
  assert.equal(res.redirectedTo, `https://accounts.google.com/auth?state=${req.session.googleOAuthState}`);
});

test('authorize: 400 when env vars are missing', () => {
  const c = buildController({ settings: fakeSettingsStore(), oauthFactory: fakeOauth({ configured: false }), sync: fakeSync() });
  const res = fakeRes();
  c.oauthAuthorize({ session: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'GOOGLE_OAUTH_NOT_CONFIGURED');
});

test('authorize: 400 when no redirect URI can be resolved', () => {
  const c = buildController({ settings: fakeSettingsStore(), oauthFactory: fakeOauth({ redirectUri: '' }), sync: fakeSync() });
  const res = fakeRes();
  c.oauthAuthorize({ session: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PUBLIC_URL_MISSING');
});

// --- callback ---

test('callback: success → tokens stored + redirect ?google=connected', async () => {
  const settings = fakeSettingsStore();
  const c = buildController({ settings, oauthFactory: fakeOauth(), sync: fakeSync() });
  const req = { session: { googleOAuthState: 'st-1' }, query: { code: 'code-1', state: 'st-1' } };
  const res = fakeRes();
  await c.oauthCallback(req, res);
  assert.equal(res.redirectedTo, '/settings?google=connected');
  assert.deepEqual(settings.state.stored, [{ refreshToken: '1//tok', email: 'a@b.com' }]);
  assert.equal(req.session.googleOAuthState, undefined, 'state is single-use');
});

test('callback: state mismatch / missing code / missing session state → invalid_state', async () => {
  const cases = [
    { session: { googleOAuthState: 'st-1' }, query: { code: 'c', state: 'WRONG' } },
    { session: { googleOAuthState: 'st-1' }, query: { state: 'st-1' } },
    { session: {}, query: { code: 'c', state: 'st-1' } },
  ];
  for (const req of cases) {
    const settings = fakeSettingsStore();
    const c = buildController({ settings, oauthFactory: fakeOauth(), sync: fakeSync() });
    const res = fakeRes();
    await c.oauthCallback(req, res);
    assert.equal(res.redirectedTo, '/settings?google=invalid_state');
    assert.equal(settings.state.stored.length, 0);
  }
});

test('callback: replay with an already-consumed state → invalid_state', async () => {
  const settings = fakeSettingsStore();
  const c = buildController({ settings, oauthFactory: fakeOauth(), sync: fakeSync() });
  const req = { session: { googleOAuthState: 'st-1' }, query: { code: 'c', state: 'st-1' } };
  await c.oauthCallback(req, fakeRes());
  const res = fakeRes();
  await c.oauthCallback({ session: req.session, query: { code: 'c', state: 'st-1' } }, res);
  assert.equal(res.redirectedTo, '/settings?google=invalid_state');
});

test('callback: Google returned ?error → redirect error, nothing stored', async () => {
  const settings = fakeSettingsStore();
  const c = buildController({ settings, oauthFactory: fakeOauth(), sync: fakeSync() });
  const res = fakeRes();
  await c.oauthCallback({ session: { googleOAuthState: 's' }, query: { error: 'access_denied' } }, res);
  assert.equal(res.redirectedTo, '/settings?google=error');
  assert.equal(settings.state.stored.length, 0);
});

test('callback: exchange without refresh token or throwing → error redirect, no leak in URL', async () => {
  for (const exchange of [
    async () => ({ refreshToken: '', email: '' }),
    async () => { throw new Error('boom with secret detail'); },
  ]) {
    const settings = fakeSettingsStore();
    const c = buildController({ settings, oauthFactory: fakeOauth({ exchange }), sync: fakeSync() });
    const res = fakeRes();
    await c.oauthCallback({ session: { googleOAuthState: 's' }, query: { code: 'c', state: 's' } }, res);
    assert.equal(res.redirectedTo, '/settings?google=error');
    assert.equal(settings.state.stored.length, 0);
  }
});

// --- disconnect ---

test('disconnect: best-effort revoke + clears the stored connection', async () => {
  const settings = fakeSettingsStore();
  settings.storeGoogleTokens({ refreshToken: '1//tok', email: 'a@b.com' });
  const revoked = [];
  const c = buildController({ settings, oauthFactory: fakeOauth({ revoked }), sync: fakeSync() });
  const res = fakeRes();
  await c.oauthDisconnect({}, res);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(revoked, ['1//tok']);
  assert.equal(settings.state.cleared, 1);
  assert.equal(settings.googleConnected(), false);
});
