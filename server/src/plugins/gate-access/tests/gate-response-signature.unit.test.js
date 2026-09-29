// guestFlow signs its answers to Sowel — specs/gate-access-sowel-connector.md §3.4 rules 22b-22d.
//
// The vector below is PINNED on both sides: the Sowel `guestflow` plugin verifies the very same
// inputs to the very same hex. Changing the canonical string here while the plugin keeps its own
// would make Sowel refuse every list with both suites green.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

const { buildSignGateResponse, responseSignature } = require('../signResponse');

// specs/gate-access-sowel-connector.md §3.4 rule 22c — the pinned vector.
test('pinned vector: secret "s3cret", request signature "abc", body {"ok":true}', () => {
  assert.equal(
    responseSignature('s3cret', 'abc', Buffer.from('{"ok":true}', 'utf8')),
    '12ac7139e4bc81ce30b413a9c7f1880b33b1f055a045affde5d2765dcfb65190',
  );
  // Spelled out: HMAC over "response\n" + request signature + "\n" + sha256hex(body).
  const digest = crypto.createHash('sha256').update('{"ok":true}').digest('hex');
  assert.equal(digest, '4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93');
  assert.equal(
    crypto.createHmac('sha256', 's3cret').update(`response\nabc\n${digest}`).digest('hex'),
    '12ac7139e4bc81ce30b413a9c7f1880b33b1f055a045affde5d2765dcfb65190',
  );
});

function serve(routes) {
  const app = express();
  const router = express.Router();
  router.use(buildSignGateResponse({ env: { GATE_SIGNING_SECRET: 's3cret' } }));
  routes(router);
  app.use('/public/v1/gate', router);
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${server.address().port}/public/v1/gate` };
}

// specs/gate-access-sowel-connector.md §3.4 rules 22b + 22c — the exact bytes sent are the bytes signed.
test('a 2xx answer is signed over the exact bytes it carries, bound to the request signature', async () => {
  const { server, base } = serve((r) => {
    r.get('/json', (_req, res) => res.json({ keys: [{ label: 'Gîte · R1 · Zoé' }], now: 'x' }));
    r.get('/text', (_req, res) => res.send('{"ok":true}'));
  });
  try {
    for (const path of ['/json', '/text']) {
      const response = await fetch(base + path, { headers: { 'x-gate-signature': 'abc' } });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(
        response.headers.get('x-gate-response-signature'),
        responseSignature('s3cret', 'abc', bytes),
        path,
      );
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const text = await fetch(`${base}/text`, { headers: { 'x-gate-signature': 'abc' } });
    assert.equal(text.headers.get('x-gate-response-signature'), '12ac7139e4bc81ce30b413a9c7f1880b33b1f055a045affde5d2765dcfb65190');

    // Another request signature → another answer signature: an old answer cannot be replayed.
    const other = await fetch(`${base}/text`, { headers: { 'x-gate-signature': 'abd' } });
    assert.notEqual(other.headers.get('x-gate-response-signature'), text.headers.get('x-gate-response-signature'));
  } finally {
    server.close();
  }
});

// specs/gate-access-sowel-connector.md §3.4 rule 22d — errors need no signature, and get none.
test('an error answer is not signed', async () => {
  const { server, base } = serve((r) => {
    r.post('/results', (_req, res) => res.status(413).json({ error: { code: 'TOO_MANY' } }));
  });
  try {
    const response = await fetch(`${base}/results`, { method: 'POST', headers: { 'x-gate-signature': 'abc' } });
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('x-gate-response-signature'), null);
  } finally {
    server.close();
  }
});

// specs/gate-access-sowel-connector.md §3.4 rule 22d — mounted on the router, every route is covered.
test('the real gate router signs every route: the middleware sits in front of all of them', () => {
  const { buildPublicRouter } = require('../publicRoutes');
  const { buildController } = require('../controller');
  const router = buildPublicRouter({
    controller: buildController({ model: () => null }),
    limiter: function publicApiLimiter(req, res, next) { next(); },
    requireConnector: require('../requireConnector').buildRequireGateConnector(),
    signResponse: buildSignGateResponse(),
  });
  const names = router.stack.map((layer) => (layer.route ? `route:${layer.route.path}` : layer.name));
  const signAt = names.indexOf('signGateResponse');
  assert.ok(signAt > names.indexOf('requireGateConnector'), 'after authentication');
  for (const path of ['/ping', '/keys', '/results']) {
    assert.ok(names.indexOf(`route:${path}`) > signAt, path);
  }
});
