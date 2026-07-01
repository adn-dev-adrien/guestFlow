const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../utils/meteoVigilance');

// Representative DPVigilance "carte" payload (structure confirmed against the public API):
// product.periods[].timelaps.domain_ids[]{domain_id, phenomenon_items[]{phenomenon_id,
// timelaps_items[]{begin_time,end_time,color_id}}}.
const RAW = {
  product: {
    periods: [
      {
        echeance: 'J',
        timelaps: {
          domain_ids: [
            {
              domain_id: '83',
              phenomenon_items: [
                { phenomenon_id: '6', timelaps_items: [{ begin_time: '2026-07-02T10:00:00Z', end_time: '2026-07-04T20:00:00Z', color_id: 3 }] },
                { phenomenon_id: '3', timelaps_items: [{ begin_time: '2026-07-03T12:00:00Z', end_time: '2026-07-03T18:00:00Z', color_id: 2 }] },
              ],
            },
            {
              domain_id: '13',
              phenomenon_items: [
                { phenomenon_id: '1', timelaps_items: [{ begin_time: '2026-07-02T00:00:00Z', end_time: '2026-07-02T06:00:00Z', color_id: 4 }] },
              ],
            },
          ],
        },
      },
    ],
  },
};

// --- extractDepartmentFromCitycode ---
test('extractDepartmentFromCitycode: metropolitan / Corsica / overseas / empty', () => {
  assert.equal(v.extractDepartmentFromCitycode('83004'), '83');
  assert.equal(v.extractDepartmentFromCitycode('2A004'), '2A');
  assert.equal(v.extractDepartmentFromCitycode('2b033'), '2B');
  assert.equal(v.extractDepartmentFromCitycode('97411'), '974');
  assert.equal(v.extractDepartmentFromCitycode(''), null);
  assert.equal(v.extractDepartmentFromCitycode(null), null);
});

// --- normalizeVigilance ---
test('normalizeVigilance: keeps only the requested département, flattens slices', () => {
  const out = v.normalizeVigilance(RAW, '83');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.phenomenonId).sort(), [3, 6]);
  const canicule = out.find((x) => x.phenomenonId === 6);
  assert.equal(canicule.colorLevel, 3);
  assert.equal(canicule.startsAt, '2026-07-02T10:00:00Z');
});

test('normalizeVigilance: unknown département / malformed payload → []', () => {
  assert.deepEqual(v.normalizeVigilance(RAW, '99'), []);
  assert.deepEqual(v.normalizeVigilance({}, '83'), []);
  assert.deepEqual(v.normalizeVigilance(null, '83'), []);
});

// --- filterAlertsForStay ---
test('filterAlertsForStay: keeps orange+ overlapping the stay, drops yellow (rule 5)', () => {
  const normalized = v.normalizeVigilance(RAW, '83');
  const alerts = v.filterAlertsForStay(normalized, { start: '2026-07-02', end: '2026-07-04' });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].phenomenonId, 6);
  assert.equal(alerts[0].colorLevel, 3);
});

test('filterAlertsForStay: drops alerts whose window does not overlap the stay', () => {
  const phenomena = [{ phenomenonId: 6, colorLevel: 3, startsAt: '2026-07-10T10:00:00Z', endsAt: '2026-07-11T10:00:00Z' }];
  const alerts = v.filterAlertsForStay(phenomena, { start: '2026-07-02', end: '2026-07-04' });
  assert.equal(alerts.length, 0);
});

test('filterAlertsForStay: red sorts before orange; per-phenomenon collapse takes the max colour', () => {
  const phenomena = [
    { phenomenonId: 3, colorLevel: 3, startsAt: '2026-07-02T06:00:00Z', endsAt: '2026-07-02T12:00:00Z' },
    { phenomenonId: 1, colorLevel: 4, startsAt: '2026-07-03T06:00:00Z', endsAt: '2026-07-03T12:00:00Z' },
    { phenomenonId: 3, colorLevel: 4, startsAt: '2026-07-02T12:00:00Z', endsAt: '2026-07-02T18:00:00Z' },
  ];
  const alerts = v.filterAlertsForStay(phenomena, { start: '2026-07-02', end: '2026-07-04' });
  // Two phenomena; the two id=3 slices collapse to one entry with max colour 4.
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].colorLevel, 4);
  const orages = alerts.find((a) => a.phenomenonId === 3);
  assert.equal(orages.colorLevel, 4);
});

// --- frTimingLabel (Europe/Paris) ---
test('frTimingLabel: multi-day and same-day formats (Paris tz)', () => {
  const multi = v.frTimingLabel('2026-07-02T10:00:00Z', '2026-07-04T20:00:00Z');
  assert.match(multi, /^du 2 juillet à 12:00 au 4 juillet à 22:00$/);
  const same = v.frTimingLabel('2026-07-03T12:00:00Z', '2026-07-03T18:00:00Z');
  assert.match(same, /^le 3 juillet de 14:00 à 20:00$/);
});

// --- buildAlertDisplay ---
test('buildAlertDisplay: canicule appends fire ban + smoking-area instructions (rule 7)', () => {
  const d = v.buildAlertDisplay({ phenomenonId: 6, colorLevel: 3, startsAt: '2026-07-02T10:00:00Z', endsAt: '2026-07-04T20:00:00Z' });
  assert.equal(d.phenomenon, 'Canicule');
  assert.equal(d.color, 'Orange');
  assert.match(d.message, /canicule/i);
  assert.ok(d.instructions.some((l) => /feux sont strictement interdits/i.test(l)));
  assert.ok(d.instructions.some((l) => /zones fumeurs/i.test(l)));
});

test('buildAlertDisplay: orages leads with the explicit episode timing (rule 7)', () => {
  const d = v.buildAlertDisplay({ phenomenonId: 3, colorLevel: 3, startsAt: '2026-07-03T12:00:00Z', endsAt: '2026-07-03T18:00:00Z' });
  assert.equal(d.phenomenon, 'Orages');
  assert.match(d.instructions[0], /^Épisode orageux prévu le 3 juillet de 14:00 à 20:00\.$/);
});

// --- getVigilanceForDepartment (no network paths) ---
test('getVigilanceForDepartment: no key / no dept → []', async () => {
  const cache = { readFresh: () => null, read: () => null, upsert: () => {} };
  assert.deepEqual(await v.getVigilanceForDepartment('83', '', cache), []);
  assert.deepEqual(await v.getVigilanceForDepartment('', 'key', cache), []);
});

test('getVigilanceForDepartment: fresh cache short-circuits the fetch', async () => {
  const cached = [{ phenomenonId: 6, colorLevel: 3, startsAt: '2026-07-02T10:00:00Z', endsAt: '2026-07-04T20:00:00Z' }];
  const cache = {
    readFresh: () => ({ payload: cached, fetchedAt: '2026-07-02T09:00:00Z' }),
    read: () => null,
    upsert: () => { throw new Error('should not fetch/upsert on fresh cache'); },
  };
  const out = await v.getVigilanceForDepartment('83', 'key', cache);
  assert.deepEqual(out, cached);
});
