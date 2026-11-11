const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCRIPT = pathToFileURL(path.join(__dirname, '..', '..', '..', 'scripts', 'start-shadow.mjs')).href;

// specs/inte-performance.md rule 1 — a shadow runs the production build, never the Vite dev server by
// default, and never with NODE_ENV=production (the mail outbox is off there).

const options = (extra = []) => import(SCRIPT).then(({ parseArgs }) => parseArgs(['--db', '/data/shadow.db', '--port', '4104', '--dir', '/tmp/shadow-x', ...extra]));

test('rule 1: the default shadow serves the built client and the plugin packages, with the mail outbox', async () => {
  const { shadowEnv } = await import(SCRIPT);
  const env = shadowEnv(await options());
  assert.equal(env.GUESTFLOW_PLUGINS, 'packages');
  assert.equal(env.GUESTFLOW_CLIENT_DIR, path.join('/tmp/shadow-x', 'client-dist'));
  assert.equal(env.GUESTFLOW_PLUGINS_DIST, path.join('/tmp/shadow-x', 'plugins-dist'));
  assert.equal(env.GUESTFLOW_MAIL_OUTBOX, path.join('/tmp/shadow-x', 'outbox'));
  assert.equal(env.GUESTFLOW_PUBLIC_URL, 'http://localhost:4104', 'one process, one port: the server serves the client');
  assert.equal(env.GUESTFLOW_DEV, undefined);
});

test('rule 1: never NODE_ENV=production, no DNS lookup, Qonto and Neat on a dead address', async () => {
  const { shadowEnv } = await import(SCRIPT);
  for (const extra of [[], ['--dev']]) {
    const env = shadowEnv(await options(extra));
    assert.notEqual(env.NODE_ENV, 'production');
    assert.equal(env.GUESTFLOW_SMTP_DETECT, 'off');
    for (const base of ['QONTO_API_BASE', 'QONTO_OAUTH_BASE', 'NEAT_API_BASE']) assert.equal(env[base], 'http://127.0.0.1:9');
  }
  assert.equal(shadowEnv(await options()).NODE_ENV, 'test');
});

test('rule 1: --dev keeps the Vite dev server, plugins from sources, and the client port', async () => {
  const { shadowEnv } = await import(SCRIPT);
  const dev = await options(['--dev']);
  assert.equal(dev.clientPort, 3104);
  const env = shadowEnv(dev);
  assert.equal(env.GUESTFLOW_PLUGINS, 'sources');
  assert.equal(env.GUESTFLOW_DEV, '1');
  assert.equal(env.GUESTFLOW_PUBLIC_URL, 'http://localhost:3104');
  assert.equal(env.GUESTFLOW_CLIENT_DIR, undefined);
});

test('rule 1: the database is required and an unknown option is refused', async () => {
  const { parseArgs } = await import(SCRIPT);
  assert.throws(() => parseArgs(['--port', '4104']), /--db/);
  assert.throws(() => parseArgs(['--db', 'x.db', '--turbo']), /Unknown option --turbo/);
});

test('rule 1: a port already in use stops the script before anything is copied', async () => {
  const { assertPortFree } = await import(SCRIPT);
  const busy = net.createServer();
  await new Promise((resolve) => { busy.listen(0, resolve); });
  const { port } = busy.address();
  try {
    await assert.rejects(assertPortFree(port), new RegExp(`Port ${port} is already in use`));
  } finally {
    await new Promise((resolve) => { busy.close(resolve); });
  }
  await assertPortFree(port);
});
