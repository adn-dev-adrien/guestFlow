// specs/plugins-phase-2-hosts.md rule 24 — the boot line that announces the API key names no path: the
// file is server/.env.local only while GUESTFLOW_LOCAL_ENV does not move it (review 2026-10-18, n1).
const test = require('node:test');
const assert = require('node:assert/strict');

const localEnv = require('../../../utils/localEnv');
const { register } = require('..');

test('rule 24: the key is created at boot and the log line does not claim server/.env.local', () => {
  const original = localEnv.getOrCreateSecret;
  const created = [];
  localEnv.getOrCreateSecret = (name) => { created.push(name); return 'stub'; };
  const infos = [];
  const boots = [];
  const ctx = {
    settings: { declare() {}, get() {}, set() {} },
    migrations() {},
    onInstall() {},
    onBoot(fn) { boots.push(fn); },
    mount() {},
    route() {},
    data() {},
    log: { info: (line) => infos.push(line), warn() {} },
  };
  try {
    register(ctx);
    boots.forEach((fn) => fn());
  } finally {
    localEnv.getOrCreateSecret = original;
  }
  assert.deepEqual(created, ['PUBLIC_API_KEY']);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /PUBLIC_API_KEY ready/);
  assert.doesNotMatch(infos[0], /server\/\.env\.local/);
});
