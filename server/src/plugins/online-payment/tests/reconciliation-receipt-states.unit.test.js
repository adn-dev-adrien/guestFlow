// specs/qonto-bank-reconciliation.md rules 19, 21, 22, 37 — one state per expected receipt.
const test = require('node:test');
const assert = require('node:assert/strict');
const { stateOfReceipt, fixText, isGap, GAP_STATES } = require('../reconciliation/receiptStates');

const receipt = (over = {}) => ({
  label: 'Solde', channel: 'direct', expectedCents: 70000, paid: true, paidDate: '2026-11-10', dueDate: '2026-11-01', expectedDate: '2026-11-10', ...over,
});
const line = (cents, settledAt = '2026-11-10T08:00:00Z') => ({ amountCents: cents, settledAt });
const st = (over, extra = {}) => stateOfReceipt({ receipt: receipt(over), lines: [], hasProposal: false, today: '2026-11-12', ...extra });

test('rule 19 — reconciled when the amounts agree and the fiche marks it paid', () => {
  assert.equal(st({}, { lines: [line(70000)] }).state, 'reconciled');
});

test('rule 19 — amount_gap wins over the rest, and words what to fix', () => {
  const s = st({ paid: false }, { lines: [line(75000)] });
  assert.equal(s.state, 'amount_gap');
  assert.equal(s.gapCents, 5000);
  assert.match(fixText({ ...s, receipt: receipt({ paid: true }) }), /Le virement fait 750,00 €, la fiche attend 700,00 €/);
});

test('rule 19 — received_not_recorded: reconciled but the fiche does not mark it paid', () => {
  assert.equal(st({ paid: false }, { lines: [line(70000)] }).state, 'received_not_recorded');
});

test('rule 19 — date_gap: paid date and credit in different months', () => {
  const s = st({ paidDate: '2026-10-30' }, { lines: [line(70000, '2026-11-02T08:00:00Z')] });
  assert.equal(s.state, 'date_gap');
  assert.match(fixText({ ...s, receipt: receipt() }), /Perçu le 02\/11 sur le compte/);
});

test('rule 19 — recorded_not_received only after 7 days, late likewise', () => {
  assert.equal(st({ paidDate: '2026-11-10' }).state, 'waiting');
  assert.equal(st({ paidDate: '2026-11-01' }).state, 'recorded_not_received');
  assert.equal(st({ paid: false, paidDate: null, dueDate: '2026-11-10' }).state, 'waiting');
  assert.equal(st({ paid: false, paidDate: null, dueDate: '2026-11-01' }).state, 'late');
});

test('rule 19 — a proposal makes a waiting or late receipt « À confirmer », never clears a gap', () => {
  assert.equal(st({ paid: false, paidDate: null, dueDate: '2026-11-01' }, { hasProposal: true }).state, 'proposed');
  assert.equal(st({ paid: false }, { lines: [line(75000)], hasProposal: true }).state, 'amount_gap');
});

test('rule 37 — a partial cover marks nothing: « reçu en partie », then reconciled once complete', () => {
  const partial = st({ paid: false }, { lines: [line(30000)] });
  assert.equal(partial.state, 'partial');
  assert.match(fixText({ ...partial, receipt: receipt({ paid: false }) }), /300,00 € sur 700,00 € reçus/);
  assert.equal(st({ paid: true }, { lines: [line(30000), line(40000)] }).state, 'reconciled');
});

test('rule 21 — a reconciliation survives an edit of the fiche: the amount change becomes an amount_gap', () => {
  const s = st({ expectedCents: 80000 }, { lines: [line(70000)] });
  assert.equal(s.state, 'amount_gap');
});

test('rule 15 — a payment link is compared net of the acquirer fee, one cent per link', () => {
  const netOf = (c) => c - Math.round(c * 0.014) - 25;
  const link = { channel: 'link', expectedCents: 10000 };
  assert.equal(st(link, { lines: [line(netOf(10000) + 1)], netOf }).state, 'reconciled');
  assert.equal(st(link, { lines: [line(netOf(10000) + 5)], netOf }).state, 'amount_gap');
});

test('rule 22 — the gap states', () => {
  assert.deepEqual(GAP_STATES, ['amount_gap', 'received_not_recorded', 'recorded_not_received', 'late', 'date_gap']);
  assert.equal(isGap('proposed'), false);
  assert.equal(isGap('late'), true);
});
