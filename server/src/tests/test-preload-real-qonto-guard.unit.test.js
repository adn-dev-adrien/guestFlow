// specs/server-test-isolation.md rule 14 (audit R23) — under the npm test preload no client reaches a real Qonto host:
// the dial is refused before any socket opens and the file fails, even when the code under test swallows the error.
// The child processes run a script that never gets past the guard; a broken guard is caught by the first test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const GUARD = path.join(__dirname, 'setup', 'realQontoGuard.js');
const { isRealQontoHost } = require('./setup/realQontoGuard');

function runGuarded(script) {
  const scrubbed = { ...process.env };
  delete scrubbed.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--require', GUARD, '-e', script], { encoding: 'utf8', timeout: 30_000, env: scrubbed });
}

test('rule 14: the real Qonto hosts are named, a look-alike or a fake is not', () => {
  for (const host of ['thirdparty.qonto.com', 'oauth.qonto.com', 'oauth-sandbox.staging.qonto.co', 'thirdparty-sandbox.staging.qonto.co', 'qonto.com', 'THIRDPARTY.QONTO.COM', 'thirdparty.qonto.com.']) {
    assert.equal(isRealQontoHost(host), true, host);
  }
  for (const host of ['127.0.0.1', 'localhost', 'notqonto.com', 'qonto.com.example', 'qonto.example.test', '']) {
    assert.equal(isRealQontoHost(host), false, host);
  }
});

test('rule 14: the resolver refuses a real host before any socket', () => {
  const out = runGuarded(`require('dns').lookup('thirdparty.qonto.com', (e) => { console.log('code', e && e.code); })`);
  assert.match(out.stdout, /code E_REAL_QONTO_IN_TEST/);
  assert.equal(out.status, 1, 'the attempt fails the process even though the error was handled');
});

test('rule 14: fetch and https.request are refused, the error swallowed or not', () => {
  const viaFetch = runGuarded(`fetch('https://thirdparty.qonto.com/v2/x').then(() => console.log('reached'), (e) => console.log('code', e.code))`);
  assert.match(viaFetch.stdout, /code E_REAL_QONTO_IN_TEST/);
  assert.equal(viaFetch.status, 1);
  const viaHttps = runGuarded(`const r = require('https').request('https://oauth.qonto.com/oauth2/token'); r.on('error', (e) => console.log('code', e.code)); r.on('response', () => console.log('reached')); r.end();`);
  assert.match(viaHttps.stdout, /code E_REAL_QONTO_IN_TEST/);
  assert.equal(viaHttps.status, 1);
});

test('rule 14: a process that never tried keeps its exit code, and a loopback dial is left alone', () => {
  const out = runGuarded(`
    const http = require('http');
    const s = http.createServer((q, r) => r.end('ok')).listen(0, 'localhost', async () => {
      const r = await fetch('http://localhost:' + s.address().port);
      console.log(await r.text());
      s.close();
    });`);
  assert.match(out.stdout, /ok/);
  assert.equal(out.status, 0);
});

test('rule 14: the npm test preload installs the guard, here and on the console suite', () => {
  const scrubbed = { ...process.env, DB_PATH: ':memory:' };
  delete scrubbed.NODE_TEST_CONTEXT;
  delete scrubbed.NODE_OPTIONS;
  const out = spawnSync(process.execPath, ['--require', path.join(__dirname, 'setup', 'isolateDefaultDb.js'), '-p', "require('dns').lookup.realQontoGuard"], { encoding: 'utf8', timeout: 30_000, env: scrubbed });
  assert.equal(out.stdout.trim(), 'true', out.stderr);
  const pkg = require('../../../control-plane/server/package.json');
  assert.match(pkg.scripts.test, /realQontoGuard\.js/);
});
