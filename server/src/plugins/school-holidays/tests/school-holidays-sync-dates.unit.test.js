// specs/plugins-phase-1-sdk.md rules 26-27 (fixing specs/school-holidays.md rule 9, 2026-09-28) — a
// new customer's holidays come from the sync alone, so the sync must read the dataset the way it is
// published: every period (not only the summer), on its Paris days, and absorb hand-typed twins.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createModel } = require('../model');
const { runSync, groupRecords, toDay } = require('../sync');
const { buildUrl } = require('../educationGouvClient');

function freshModel() {
  const db = new Database(':memory:');
  require('../../sdk/testing').applyPluginSchema(db, 'school-holidays');
  return { db, model: createModel(db) };
}

const rec = (over) => ({ annee_scolaire: '2026-2027', population: '-', ...over });
const fetchOf = (records) => async () => ({ ok: true, json: async () => ({ results: records }) });

test('the query keeps the periods published for everyone (population "-"), not only the pupils-only ones', () => {
  const where = new URL(buildUrl({ horizonMonths: 24, now: new Date('2026-09-28T10:00:00Z') })).searchParams.get('where');
  assert.match(where, /\(population="Élèves" OR population="-"\)/);
});

test('a period is stored on its Paris days: first day off, and the day before classes resume', () => {
  assert.equal(toDay('2026-10-16T22:00:00+00:00'), '2026-10-17');
  assert.equal(toDay('2026-11-01T23:00:00+00:00', { resumption: true }), '2026-11-01');
  assert.equal(toDay('2027-09-01T22:00:00+00:00', { resumption: true }), '2027-09-01');
  assert.equal(toDay('2026-10-17'), '2026-10-17');
});

test('a single-day entry (a bridge) ends the day it starts', () => {
  const [group] = groupRecords([rec({
    description: "Pont de l'Ascension", zones: 'Zone A',
    start_date: '2027-05-06T22:00:00+00:00', end_date: '2027-05-06T22:00:00+00:00',
  })]);
  assert.equal(group.zoneA_start, '2027-05-07');
  assert.equal(group.zoneA_end, '2027-05-07');
});

test('a hand-typed « Hiver 2027 » is adopted by the official « Vacances d’Hiver », dates corrected', async () => {
  const { model } = freshModel();
  model.insert({
    label: 'Hiver 2027',
    zoneA_start: '2027-02-13', zoneA_end: '2027-02-28',
    zoneB_start: '2027-02-06', zoneB_end: '2027-02-21',
    zoneC_start: '2027-02-20', zoneC_end: '2027-03-07',
  });
  const records = [
    ['Zone A', '2027-02-12T23:00:00+00:00', '2027-02-28T23:00:00+00:00'],
    ['Zone B', '2027-02-19T23:00:00+00:00', '2027-03-07T23:00:00+00:00'],
    ['Zone C', '2027-02-05T23:00:00+00:00', '2027-02-21T23:00:00+00:00'],
  ].map(([zones, start_date, end_date]) => rec({ description: "Vacances d'Hiver", zones, start_date, end_date }));
  const result = await runSync({ model, fetchFn: fetchOf(records), horizonMonths: 24, now: new Date('2026-09-28T10:00:00Z') });
  assert.equal(result.createdCount, 0);
  const rows = model.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Vacances d'Hiver");
  assert.equal(rows[0].zoneB_start, '2027-02-20');
  assert.equal(rows[0].zoneC_start, '2027-02-06');
});

test('a period already imported is updated in place and adopts nothing', async () => {
  const { model } = freshModel();
  const records = [rec({ description: "Vacances d'Été", zones: 'Zone A', start_date: '2027-07-02T22:00:00+00:00', end_date: '2027-09-01T22:00:00+00:00' })];
  const now = new Date('2026-09-28T10:00:00Z');
  await runSync({ model, fetchFn: fetchOf(records), horizonMonths: 24, now });
  model.insert({ label: 'Été 2027', zoneA_start: '2027-07-03', zoneA_end: '2027-08-31' });
  const second = await runSync({ model, fetchFn: fetchOf(records), horizonMonths: 24, now });
  assert.equal(second.createdCount, 0);
  const summers = model.list();
  assert.equal(summers.filter((r) => r.externalRef).length, 1);
  assert.equal(summers.find((r) => r.label === 'Été 2027').externalRef, null);
});
