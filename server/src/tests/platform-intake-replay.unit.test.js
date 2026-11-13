// specs/pricing-components.md §3 rule 71 (with rule 68) — the automatic platform intakes keep writing the same stay.
// Each stored intake of the snapshot (Booking, Airbnb: `fixtures/price-gate/intakes.json`, guest identity replaced by
// placeholders) is replayed on its fixture platform stay through the plugin's own plan -> patch -> save (the SDK
// `reservations.update`, the fiche's save), the day before the stay starts; the stored row, the lines and the figures
// must equal the baseline capture. Gîtes de France has no stored intake: the plugin's own parser fixtures are replayed
// on the first Gîtes de France stay. A replay creates no client, so the placeholder identifiers are accepted as they are.
// The snapshot's applied intakes cover three stays only, and none carries a line routed to the arrival complement: crafted
// Booking- and Airbnb-shaped intakes (`intakes.json` `synthetic`) are replayed on four synthetic platform stays, each with a
// line routed to the arrival complement and one to the solde, on a channel that reverses the tourist tax and one that remits
// it — in a process of its own (`scripts/price-gate/replaySyntheticIntakes.js`), the synthetic stays being another database.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipWithout } = require('../plugins/sdk/testing');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const captured = ['inputs.json', 'intakes.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const needs = skipWithout(['booking-intake', 'airbnb-intake', 'gites-de-france-intake']);
const SKIP = needs || (captured ? false : 'price-gate fixture absent (captured on the price-gate-baseline tag)');

let replayed = [];
let baseline = null;
let syntheticReplayed = [];
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
  if (intakes.synthetic) {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'price-gate-intakes-')), 'replayed.json');
    const ran = spawnSync(process.execPath, [path.join(__dirname, '..', '..', '..', 'scripts', 'price-gate', 'replaySyntheticIntakes.js'),
      inputs.meta.capturedAt, path.join(DIR, 'inputs.json'), path.join(DIR, 'intakes.json'), out], { encoding: 'utf8', env: { ...process.env, DB_PATH: ':memory:' } });
    if (ran.status !== 0) throw new Error(`the synthetic intakes could not be replayed:\n${ran.stdout}\n${ran.stderr}`);
    syntheticReplayed = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
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

test('rule 71: the crafted intakes are replayed on four distinct synthetic stays, Booking and Airbnb, each routing a line to the complement and one to the solde', { skip: SKIP }, () => {
  assert.ok(baseline.synthetic, 'the fixture holds the crafted intakes');
  assert.deepEqual(syntheticReplayed.map((r) => r.intake), baseline.synthetic.expected.map((r) => r.intake));
  assert.equal(new Set(syntheticReplayed.map((r) => r.reservationId)).size, 4, 'four distinct stays');
  assert.ok(syntheticReplayed.filter((r) => r.intake.startsWith('booking_intakes')).length >= 2, 'Booking-shaped');
  assert.ok(syntheticReplayed.filter((r) => r.intake.startsWith('airbnb_intakes')).length >= 2, 'Airbnb-shaped');
  for (const result of baseline.synthetic.expected) {
    const flags = [...result.lines.options, ...result.lines.custom].map((line) => Number(line.inComplement));
    assert.ok(flags.includes(0) && flags.includes(1), `${result.intake}: a line routed to the solde and one to the arrival complement`);
  }
});

test('rule 71: each crafted intake writes the stored row, the lines and the figures of the baseline capture', { skip: SKIP }, () => {
  const actual = JSON.parse(JSON.stringify(syntheticReplayed));
  baseline.synthetic.expected.forEach((want, index) => {
    const got = actual[index];
    assert.equal(got.outcome, want.outcome, `${want.intake}: outcome ${got.error || ''}`);
    assert.deepEqual(got.row, want.row, `${want.intake}: stored row`);
    assert.deepEqual(got.lines, want.lines, `${want.intake}: lines (inComplement included)`);
    assert.deepEqual(got.figures, want.figures, `${want.intake}: figures`);
  });
  for (const result of syntheticReplayed) assert.equal(result.outcome, 'applied', `${result.intake}: ${result.error || ''}`);
});
