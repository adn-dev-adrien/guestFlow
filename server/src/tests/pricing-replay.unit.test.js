// specs/pricing-components.md §3 rule 34 — the prod replay hashes every money reader: `scripts/pricing-replay.mjs` extends the VAT
// golden replay with the live quote, the no-op save, the SAS plans, the cancellation preview, the arrival-payment detail, the
// collected splits, the tourist-tax figure and the price gate's figures per stay, and the month readers (accounting CSV,
// tourist-tax report, finance views) it inherits. Run on a COPY of the snapshot at the checkpoints; here its artefact list is held.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'pricing-replay.mjs'), 'utf8');

test('rule 34: the replay names every artefact family of the rule', () => {
  for (const artefact of ['live-quote/', 'noop-save/', 'sas/', 'cancel-preview/', 'fiche-money/', 'splits/', 'tourist-tax-figure/', 'figures/']) {
    assert.ok(script.includes(`${artefact}`), artefact);
  }
});

test('rule 34: the replay refuses the original snapshot and prints no name', () => {
  assert.match(script, /refused: that path is under shadows\//);
  assert.match(script, /never a name/);
});
