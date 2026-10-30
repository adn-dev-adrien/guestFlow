// specs/school-holidays.md rule 27 — with GUESTFLOW_DISABLE_OUTBOUND=1 (the E2E servers) neither the
// scheduled sync nor the sync of a fresh install calls data.education.gouv.fr.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const plugin = require('..');

function registered() {
  const db = new Database(':memory:');
  const record = { jobs: [], onInstall: [], logs: [] };
  plugin.register({
    db,
    migrations: (list) => list.forEach((m) => m.up(db)),
    mount: () => {},
    jobs: { every: (job) => record.jobs.push(job) },
    onInstall: (fn) => record.onInstall.push(fn),
    data: () => {},
    log: { info: (m) => record.logs.push(m), error: (m) => record.logs.push(m) },
    core: { text: { sentenceCase: (s) => s } },
  });
  return record;
}

const origFetch = global.fetch;
const origFlag = process.env.GUESTFLOW_DISABLE_OUTBOUND;
let calls;
test.beforeEach(() => {
  calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ results: [] }) }; };
});
test.afterEach(() => {
  global.fetch = origFetch;
  if (origFlag === undefined) delete process.env.GUESTFLOW_DISABLE_OUTBOUND;
  else process.env.GUESTFLOW_DISABLE_OUTBOUND = origFlag;
});

test('rule 27: outbound disabled — the scheduled sync and the install sync call no one', async () => {
  process.env.GUESTFLOW_DISABLE_OUTBOUND = '1';
  const { jobs, onInstall } = registered();
  const sync = jobs.find((j) => j.name === 'sync');
  await sync.run();
  await onInstall[0]();
  assert.deepEqual(calls, []);
});

test('rule 27: without the flag the same scheduled sync does call the dataset', async () => {
  delete process.env.GUESTFLOW_DISABLE_OUTBOUND;
  const { jobs } = registered();
  await jobs.find((j) => j.name === 'sync').run();
  assert.ok(calls.length > 0 && calls.every((u) => u.includes('data.education.gouv.fr')), calls.join('\n'));
});
