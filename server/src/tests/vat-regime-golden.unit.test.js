// specs/accounting/vat-optional-mode.md rule 23 — a VAT-registered install sees no difference. Every artefact a
// VAT reader feeds (quotes, fiche payloads, devis PDF, payment-link baskets, accounting journal, finance
// payloads, tourist-tax page, cancellation) on the Solio-shaped fixture, byte for byte as captured on
// the code before the regime existed — except the `quote/*` family, regenerated on 2026-10-28 when the replay of
// a stored stay became the fiche's own (specs/reservations/reservation-save-keeps-pricing.md rule 3), and on 2026-11-01 for `fiche/*` (each
// refundable line gained `requalifiedTtc`, specs/payments/reservation-refunds.md rule 46, nothing else moved) and `cancel/106` (its unfrozen
// installments are reversed per installment and bucket, specs/payments/direct-installments.md rule 46 reading of 2026-11-01), and on
// 2026-11-02 for `fiche/109` (a cancelled stay that collected nothing offers no refundable line, specs/payments/reservation-refunds.md rule 48)
// and for `fiche/101`, `cancel/101`, `cancel/106` (each refund carries `afterCancellation`, specs/payments/reservation-refunds.md rule 6
// reading of 2026-11-02, nothing else moved), and on 2026-11-03 for six `quote/*` (a non-card line carries
// `cardPersons`, `cardNights` and `servedPersons`, specs/options/non-card-option-served-persons.md rules 2 and 18, nothing else moved), and later that day for the
// same six `quote/*` (each line carries `displayCount`, the same spec's rule 29, nothing else moved), and on 2026-11-05 for
// `tourist-tax/2027-07` (stay 106's plan enters at its stay month, D14, specs/tourist-tax/tourist-tax-declaration-month-stay-end.md rule 7, nothing else moved), and later that day for the four
// `finance/dashboard/*` (the payload gains `hero.revPar`, `hero.openNights`, `hero.occupiedNights`, `occupancyAll` and `comparison`,
// specs/accounting/finance-revpar-year-over-year.md rule 14, every existing field checked unchanged before the capture was rewritten).
// On 2026-11-06 for `finance/dashboard/2025..2028` and `finance/detail/2027|2028/properties`: revenue per night and RevPAR on the
// revenue of the nights and « Déjà payé »'s source (specs/accounting/finance-dashboard-redesign.md rules 53-54), and the 2028 notice naming its
// date (specs/accounting/finance-revpar-year-over-year.md rule 23), nothing else moved.
// On 2026-11-06 (round 2) for `finance/dashboard/2025` and `2026`: the exercise served is added to `fiscalYears` when the data does
// not reach it (specs/accounting/finance-dashboard-redesign.md rule 57), nothing else moved.
// On 2026-11-06 for `finance/operational` and `finance/detail/*` (each operational row carries `settleAllFields`, D20,
// specs/payments/reservation-payment-ledger.md rule 68, nothing else moved).
// On 2026-11-09 for `finance/summary/*`, `finance/detail/*/toCollect|late` and `finance/operational`: each stay row carries the
// four split aggregates of specs/payments/mixed-method-payments.md §5 (all 0 here), nothing else moved (checked field by field).
// On 2026-11-12 for the 13 captures that carry a stay row: the row gains `cautionWaived: 0` (arrival-departure-sas.md rule 31, additive,
// nothing else moved: checked key by key).
// On 2026-11-13 for `pdf/201` and `pdf/202`: the devis gains its « Récapitulatif TVA » table (pricing-components.md rule 15,
// D12, approved by Adrien), no amount moved.
// On 2026-11-15 for the 13 captures that carry a stay row: the row gains `readsSaleLines: 0` (pricing-components.md rules 31, 61, 63, 91,
// owner reading of 2026-11-15, approved by Adrien), additive, no amount moved: checked key by key.
// On 2026-11-26 for `finance/summary/*`: the summary loses `totalPending` and `totalPendingHt` (computed, read by no client;
// the figure lives on in the operational tab only), nothing else moved: checked key by key.
// On 2026-11-16 for `finance/dashboard/2025..2028`: `tiles.incoming`, the « Versements à venir » tile (specs/payments/mollie-rolling-reserve-and-incoming-payments.md
// rule 21), nothing else moved (checked: the payload minus that key is the previous capture).
// On 2026-11-17, merging #1067 into pricing-components C: re-captured on the branch, checked key by key — only those four
// `finance/dashboard/*` moved against the branch's capture, by `data.tiles.incoming` alone, equal to master's value.
// On 2026-11-23 for `finance/dashboard/*` and `finance/detail/*/collected|toCollect` (12 captures): « Reste à encaisser » counts the window's stays and
// lists dated payments by month, `cashProjection` is added, `collected` gains its month `groups` (specs/planning/mobile-dashboard-exercise-cash.md
// rules 10-18; checked: every other key of those payloads, and every other capture, is unchanged).
// `GOLDEN_UPDATE=1` rewrites the capture, which is only ever legitimate on that code (Lot 0).

const test = require('node:test');
const { skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
const { capture } = require('./vatRegimeGoldenCapture');

const GOLDEN = path.join(__dirname, 'fixtures', 'vat-regime', 'golden.json');

const db = buildVatGoldenDb();

test('rule 23: a VAT-registered install answers byte for byte as before the regime', { skip: skipWithout(['accounting-export']) }, async () => {
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

test('rule 23: the capture covers every artefact family and no family answers an error', { skip: skipWithout(['accounting-export']) }, async () => {
  const actual = await capture(db);
  const families = new Set(Object.keys(actual).map((k) => k.split('/')[0]));
  for (const f of ['quote', 'fiche', 'pdf', 'link', 'csv', 'finance', 'tourist-tax', 'cancel']) assert.ok(families.has(f), f);
  const errors = Object.entries(actual).filter(([, v]) => v.startsWith('ERROR'));
  assert.deepEqual(errors, []);
  assert.ok(Object.keys(actual).filter((k) => k.startsWith('quote/')).length >= 10);
  const csvWithRows = Object.entries(actual).filter(([k, v]) => k.startsWith('csv/') && v.includes('"rows":[[')).length;
  assert.ok(csvWithRows >= 5, `journal months with entries: ${csvWithRows}`);
});

test('rule 23: the capture is deterministic', { skip: skipWithout(['accounting-export']) }, async () => {
  const a = await capture(db);
  const b = await capture(db);
  for (const key of Object.keys(a)) assert.equal(a[key], b[key], key);
});

// specs/accounting/vat-optional-mode.md rule 44 — the franchise follow-up is invisible to a VAT-registered install.
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
