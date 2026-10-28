// specs/vat-optional-mode.md rule 23 — a VAT-registered install sees no difference. Every artefact a
// VAT reader feeds (quotes, fiche payloads, devis PDF, payment-link baskets, accounting journal, finance
// payloads, tourist-tax page, cancellation) on the Solio-shaped fixture, byte for byte as captured on
// the code before the regime existed. `GOLDEN_UPDATE=1` rewrites the capture, which is only ever
// legitimate on that code (Lot 0).

const { requirePlugins } = require('../plugins/sdk/testing');
if (!requirePlugins(['accounting-export'])) return;

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

// specs/vat-optional-mode.md rule 44 — the franchise follow-up is invisible to a VAT-registered install.
test('rule 44: the settings payload only adds an absent follow-up to the VAT block', async () => {
  const { getSettings } = require('../controllers/settingsController');
  const res = { body: null, json(b) { this.body = b; return this; } };
  await getSettings({ user: { id: 1 } }, res);
  const { franchise, ...rest } = res.body.vat;
  assert.deepEqual(rest, { regime: 'subject', rate: 10, legalMention: null });
  assert.deepEqual(franchise, { applies: false, threshold: null, setAt: null });
});

test('rule 44: the home attention payload does not even declare the franchise subject', async () => {
  const { coreAttentionSources } = require('../routes/dashboard');
  const { buildController } = require('../controllers/dashboardAttentionController');
  const source = coreAttentionSources().find((s) => s.key === 'vat-franchise');
  assert.equal(source.skip({}), true);
  const controller = buildController({ coreSources: () => [source], pluginSources: () => [] });
  const res = { body: null, json(b) { this.body = b; return this; } };
  await controller.attention({}, res);
  assert.deepEqual(res.body, { pinned: [], items: [], total: 0, unavailable: [], unavailableLabel: '', declared: [] });
  const finance = require('../models/vatFranchiseModel');
  assert.deepEqual(finance.getFollowUp(), { applies: false });
});
