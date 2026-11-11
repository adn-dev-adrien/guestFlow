// specs/pricing-components.md §3 rule 71 (with rule 68) — the automatic platform intakes keep writing the same stay.
// Each stored intake of the snapshot (Booking, Airbnb: `fixtures/price-gate/intakes.json`, guest identity replaced by
// placeholders) is replayed on its fixture platform stay through the plugin's own plan -> patch -> save (the SDK
// `reservations.update`, the fiche's save), the day before the stay starts; the stored row, the lines and the figures
// must equal the baseline capture. Gîtes de France has no stored intake: the plugin's own parser fixtures are replayed
// on the first Gîtes de France stay. A replay creates no client, so the placeholder identifiers are accepted as they are.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { skipWithout } = require('../plugins/sdk/testing');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const captured = ['inputs.json', 'intakes.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const needs = skipWithout(['booking-intake', 'airbnb-intake', 'gites-de-france-intake']);
const SKIP = needs || (captured ? false : 'price-gate fixture absent (captured on the price-gate-baseline tag)');

let replayed = [];
let baseline = null;
if (!SKIP) {
  const inputs = JSON.parse(fs.readFileSync(path.join(DIR, 'inputs.json'), 'utf8'));
  const intakes = JSON.parse(fs.readFileSync(path.join(DIR, 'intakes.json'), 'utf8'));
  baseline = intakes;
  const startedAt = new Date(inputs.meta.capturedAt).getTime();
  mock.timers.enable({ apis: ['Date'], now: startedAt });
  const pinClock = (instant) => { mock.timers.setTime(new Date(instant).getTime()); return () => mock.timers.setTime(startedAt); };
  const db = require('../database');
  const recompute = require('../../../scripts/price-gate/recompute');
  recompute.loadInputs(db, inputs);
  replayed = [...recompute.replayIntakes(db, intakes, pinClock), ...recompute.replayGdfFixtures(db, pinClock)];
  mock.timers.reset();
}

test('rule 71: every stored intake of the snapshot and the Gîtes de France fixtures were replayed', { skip: SKIP }, () => {
  assert.deepEqual(replayed.map((r) => r.intake), baseline.expected.map((r) => r.intake));
  assert.ok(replayed.some((r) => r.intake.startsWith('booking_intakes')), 'a Booking intake');
  assert.ok(replayed.some((r) => r.intake.startsWith('airbnb_intakes')), 'an Airbnb intake');
  assert.ok(replayed.some((r) => r.intake.startsWith('gdf-fixture')), 'a Gîtes de France fixture');
});

test('rule 71: each replay writes the stored row, the lines and the figures of the baseline capture', { skip: SKIP }, () => {
  const actual = JSON.parse(JSON.stringify(replayed));
  baseline.expected.forEach((want, index) => {
    const got = actual[index];
    assert.equal(got.outcome, want.outcome, `${want.intake}: outcome`);
    assert.deepEqual(got.row, want.row, `${want.intake}: stored row`);
    assert.deepEqual(got.lines, want.lines, `${want.intake}: lines`);
    assert.deepEqual(got.figures, want.figures, `${want.intake}: figures`);
  });
});

test('rule 71: an intake that applied on the baseline still applies (none is refused for a price)', { skip: SKIP }, () => {
  for (const result of replayed) assert.ok(['applied', 'needs_rent'].includes(result.outcome), `${result.intake}: ${result.outcome} ${result.error || ''}`);
});
