const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGoogleOAuthClient,
  emailFromIdToken,
  isInvalidGrant,
  CALLBACK_PATH,
  SCOPES,
} = require('../utils/googleOAuthClient');

// Fake OAuth2 constructor — the factory lazy-requires googleapis ONLY when no ctor is
// injected, so these tests never touch the real library.
class FakeOAuth2 {
  constructor(clientId, clientSecret, redirectUri) {
    this.ctorArgs = { clientId, clientSecret, redirectUri };
    FakeOAuth2.last = this;
  }

  generateAuthUrl(opts) {
    this.authOpts = opts;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`;
  }

  async getToken(code) {
    this.exchangedCode = code;
    return { tokens: FakeOAuth2.tokens || {} };
  }
}

function fakeSettings({ publicUrl = '' } = {}) {
  return {
    publicUrl: () => publicUrl,
    googleTokens: () => ({ refreshToken: '' }),
  };
}

const ENV = {
  GOOGLE_OAUTH_CLIENT_ID: 'client-id-123',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-456',
};

function makeIdToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${body}.signature`;
}

// --- isConfigured / resolveRedirectUri ---

test('isConfigured: true only when both env vars are set', () => {
  assert.equal(buildGoogleOAuthClient({ env: ENV, settings: fakeSettings() }).isConfigured(), true);
  assert.equal(buildGoogleOAuthClient({ env: {}, settings: fakeSettings() }).isConfigured(), false);
  assert.equal(buildGoogleOAuthClient({ env: { GOOGLE_OAUTH_CLIENT_ID: 'x' }, settings: fakeSettings() }).isConfigured(), false);
});

test('resolveRedirectUri: env override wins over publicUrl', () => {
  const client = buildGoogleOAuthClient({
    env: { ...ENV, GOOGLE_OAUTH_REDIRECT_URI: 'https://override.example.com/cb' },
    settings: fakeSettings({ publicUrl: 'https://guestflow.example.com' }),
  });
  assert.equal(client.resolveRedirectUri(), 'https://override.example.com/cb');
});

test('resolveRedirectUri: derives from publicUrl + callback path (trailing slash trimmed)', () => {
  const client = buildGoogleOAuthClient({
    env: ENV,
    settings: fakeSettings({ publicUrl: 'https://guestflow.example.com/' }),
  });
  assert.equal(client.resolveRedirectUri(), `https://guestflow.example.com${CALLBACK_PATH}`);
});

test('resolveRedirectUri: empty when neither env override nor publicUrl', () => {
  const client = buildGoogleOAuthClient({ env: ENV, settings: fakeSettings() });
  assert.equal(client.resolveRedirectUri(), '');
});

// --- getAuthorizeUrl ---

test('getAuthorizeUrl: offline access, forced consent, expected scopes, state passthrough', () => {
  const client = buildGoogleOAuthClient({
    env: ENV,
    settings: fakeSettings({ publicUrl: 'https://guestflow.example.com' }),
    OAuth2: FakeOAuth2,
  });
  const url = client.getAuthorizeUrl({ state: 'state-abc' });
  assert.match(url, /state=state-abc/);
  const oauth2 = FakeOAuth2.last;
  assert.equal(oauth2.ctorArgs.clientId, 'client-id-123');
  assert.equal(oauth2.ctorArgs.clientSecret, 'client-secret-456');
  assert.equal(oauth2.ctorArgs.redirectUri, `https://guestflow.example.com${CALLBACK_PATH}`);
  assert.equal(oauth2.authOpts.access_type, 'offline');
  assert.equal(oauth2.authOpts.prompt, 'consent');
  assert.deepEqual(oauth2.authOpts.scope, SCOPES);
  assert.ok(SCOPES.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(SCOPES.includes('https://www.googleapis.com/auth/calendar.readonly'));
});

// --- exchangeCode ---

test('exchangeCode: returns the refresh token + email from the id_token', async () => {
  FakeOAuth2.tokens = {
    refresh_token: '1//refresh-xyz',
    id_token: makeIdToken({ email: 'adrien@example.com', sub: '42' }),
  };
  const client = buildGoogleOAuthClient({ env: ENV, settings: fakeSettings(), OAuth2: FakeOAuth2 });
  const out = await client.exchangeCode({ code: 'auth-code-1' });
  assert.deepEqual(out, { refreshToken: '1//refresh-xyz', email: 'adrien@example.com' });
  assert.equal(FakeOAuth2.last.exchangedCode, 'auth-code-1');
});

test('exchangeCode: missing refresh token → empty string (controller treats as failure)', async () => {
  FakeOAuth2.tokens = { id_token: makeIdToken({ email: 'a@b.com' }) };
  const client = buildGoogleOAuthClient({ env: ENV, settings: fakeSettings(), OAuth2: FakeOAuth2 });
  const out = await client.exchangeCode({ code: 'c' });
  assert.equal(out.refreshToken, '');
});

// --- emailFromIdToken (pure) ---

test('emailFromIdToken: extracts the email claim', () => {
  assert.equal(emailFromIdToken(makeIdToken({ email: 'x@y.fr' })), 'x@y.fr');
});

test('emailFromIdToken: garbage / missing claim → empty string', () => {
  assert.equal(emailFromIdToken('not-a-jwt'), '');
  assert.equal(emailFromIdToken(''), '');
  assert.equal(emailFromIdToken(null), '');
  assert.equal(emailFromIdToken(makeIdToken({ sub: 'no-email' })), '');
});

// --- isInvalidGrant ---

test('isInvalidGrant: detects the Google response body and message forms', () => {
  assert.equal(isInvalidGrant({ response: { data: { error: 'invalid_grant' } } }), true);
  assert.equal(isInvalidGrant(new Error('invalid_grant: Token has been revoked')), true);
  assert.equal(isInvalidGrant({ response: { status: 500 } }), false);
  assert.equal(isInvalidGrant(new Error('quota exceeded')), false);
});

// --- revokeToken (best-effort) ---

test('revokeToken: posts the token to the revocation endpoint', async () => {
  const calls = [];
  const client = buildGoogleOAuthClient({
    env: ENV,
    settings: fakeSettings(),
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  await client.revokeToken('tok-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/revoke/);
  assert.match(calls[0].opts.body, /token=tok-1/);
});

test('revokeToken: never throws (empty token → no call; network failure swallowed)', async () => {
  const client = buildGoogleOAuthClient({
    env: ENV,
    settings: fakeSettings(),
    fetchImpl: async () => { throw new Error('network down'); },
  });
  await client.revokeToken('');
  await client.revokeToken('tok-2');
});
