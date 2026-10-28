// specs/vat-optional-mode.md rule 23 — a VAT-registered install sees no difference. Every artefact a
// VAT reader feeds (quotes, fiche payloads, devis PDF, payment-link baskets, accounting journal, finance
// payloads, tourist-tax page, cancellation) on the Solio-shaped fixture, byte for byte as captured on
// the code before the regime existed. `GOLDEN_UPDATE=1` rewrites the capture, which is only ever
// legitimate on that code (Lot 0).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
const { capture } = require('./vatRegimeGoldenCapture');

const GOLDEN = path.join(__dirname, 'fixtures', 'vat-regime', 'golden.json');

const db = buildVatGoldenDb();

test('rule 23: a VAT-registered install answers byte for byte as before the regime', async () => {
  const actual = await capture(db);
  if (process.env.GOLDEN_UPDATE === '1') {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], key);
});

test('rule 23: the capture covers every artefact family and no family answers an error', async () => {
  const actual = await capture(db);
  const families = new Set(Object.keys(actual).map((k) => k.split('/')[0]));
  for (const f of ['quote', 'fiche', 'pdf', 'link', 'csv', 'finance', 'tourist-tax', 'cancel']) assert.ok(families.has(f), f);
  const errors = Object.entries(actual).filter(([, v]) => v.startsWith('ERROR'));
  assert.deepEqual(errors, []);
  assert.ok(Object.keys(actual).filter((k) => k.startsWith('quote/')).length >= 10);
  const csvWithRows = Object.entries(actual).filter(([k, v]) => k.startsWith('csv/') && v.includes('"rows":[[')).length;
  assert.ok(csvWithRows >= 5, `journal months with entries: ${csvWithRows}`);
});

test('rule 23: the capture is deterministic', async () => {
  const a = await capture(db);
  const b = await capture(db);
  for (const key of Object.keys(a)) assert.equal(a[key], b[key], key);
});
