// specs/vat-optional-mode.md rule 17 — what the dialog announces before a switch, from the server: the
// reservations whose regime or rate changes, with money collected, the tourist taxes that move and the
// frozen or declared ones kept, the open payment links, the months of the books, the devis drafts; a
// fingerprint the switch must still find true (409 otherwise); and nothing written by looking.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
// The fixture's devis expired in June / July 2027; a live offer is what the preview counts (rule 25).
db.prepare("UPDATE reservations SET validUntil = '2027-12-31' WHERE kind = 'devis'").run();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');

// The declared tax of the installment stay is kept by the page, not by the stay: free it, so one stay of
// the fixture has a proportional tax a regime can move.
db.prepare('UPDATE reservations SET touristTaxDeclaredAt = NULL WHERE id = 106').run();
db.prepare("INSERT INTO payment_links (reservationId, type, amountCents, status) VALUES (101, 'balance', 100000, 'open'), (104, 'balance', 100000, 'open'), (101, 'deposit', 5000, 'paid')").run();

const call = (fn, body, user = { id: 1 }) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  fn({ body, user }, res);
  return res;
};
const preview = (input) => call(controller.preview, input).body;
const ALL = { regime: 'not_subject', basis: 'all' };

test('rule 17: a pure read — looking changes no period, no reservation, no history', () => {
  const snapshot = () => JSON.stringify([
    db.prepare('SELECT * FROM vat_periods').all(), db.prepare('SELECT id, vatPeriodId FROM reservations ORDER BY id').all(),
    db.prepare('SELECT COUNT(*) AS n FROM reservation_history').get(), db.prepare('SELECT vatRate FROM app_settings').get(),
  ]);
  const before = snapshot();
  preview(ALL);
  preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' });
  assert.equal(snapshot(), before);
  assert.equal(db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('vat_periods').seq <= 1, true, 'the rolled-back period leaves no trace');
});

test('rule 17: the reservations that change, and those with money collected', () => {
  const all = preview(ALL);
  const stays = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind IN ('reservation', 'cancelled')").get().n;
  assert.equal(all.reassigned, stays);
  assert.ok(all.collected > 0 && all.collected <= all.reassigned);
  const arrival = preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' });
  assert.equal(arrival.reassigned, db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind IN ('reservation', 'cancelled') AND startDate >= '2027-09-01'").get().n);
  assert.equal(preview({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2027-10-20' }).reassigned, 0);
});

test('rule 17: a rate change counts as a change, an unchanged rate does not', () => {
  assert.equal(preview({ regime: 'subject', rate: 20, basis: 'all' }).reassigned, preview(ALL).reassigned);
});

test('rule 17: the tourist taxes that move, with the total delta, and the frozen ones kept', () => {
  const all = preview(ALL);
  assert.equal(all.touristTaxChanged, 1, 'the proportional tax of the installment stay rises');
  assert.ok(all.touristTaxDelta > 1.5 && all.touristTaxDelta < 2.2, `${all.touristTaxDelta}`);
  assert.ok(all.touristTaxKept >= 1, 'the frozen tax of the lodgify stay and the collected ones');
  const none = preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' });
  assert.deepEqual([none.touristTaxChanged, none.touristTaxDelta], [0, 0]);
});

test('rule 17: the open payment links of the reservations that change — their amount stands', () => {
  assert.equal(preview(ALL).openLinks, 2);
  assert.equal(preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-08-01' }).openLinks, 1);
});

test('rule 17: the months of the books that would change', () => {
  assert.deepEqual(preview(ALL).exportMonths, ['2027-04', '2027-05', '2027-06', '2027-08', '2027-09']);
  assert.deepEqual(preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' }).exportMonths, []);
});

test('rule 17: the devis drafts that would now print differently', () => {
  assert.equal(preview(ALL).devisDrafts, 2);
  assert.equal(preview({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2027-12-01' }).devisDrafts, 0, 'a devis is quoted as booked today');
  assert.equal(preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-10-01' }).devisDrafts, 1, 'only the one arriving after the date');
});

test('rule 17: the preview says whether the accounting export follows', () => {
  assert.equal(typeof preview(ALL).accountingExportActive, 'boolean');
});

test('rule 17: the fingerprint is stable for the same inputs and moves with them', () => {
  assert.equal(preview(ALL).fingerprint, preview(ALL).fingerprint);
  assert.notEqual(preview(ALL).fingerprint, preview({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' }).fingerprint);
  assert.notEqual(preview(ALL).fingerprint, preview({ ...ALL, legalMention: 'art_261_d_4' }).fingerprint);
});

test('rule 17: a switch whose reassigned set changed since the preview is refused with 409, and goes through after a new preview', () => {
  const input = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' };
  const { fingerprint } = preview(input);
  db.prepare("INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate, finalPrice) VALUES ('reservation', 1, 1, '2027-11-10', '2027-11-12', 100)").run();
  const stale = call(controller.makeSwitch, { ...input, fingerprint });
  assert.deepEqual([stale.statusCode, stale.body], [409, { error: 'preview_stale' }]);
  assert.equal(vatRegimeModel.listPeriods(db).length, 1);
  const again = call(controller.makeSwitch, { ...input, fingerprint: preview(input).fingerprint, acknowledged: true });
  assert.equal(again.statusCode, 201);
});

test('rule 17: a switch without a fingerprint is refused', () => {
  const res = call(controller.makeSwitch, { regime: 'subject', rate: 20, basis: 'arrival', effectiveFrom: '2027-12-01' });
  assert.equal(res.statusCode, 409);
});

test('rule 17: invalid inputs answer 422 with the field, never a preview', () => {
  const res = call(controller.preview, { regime: 'not_subject', basis: 'booking', effectiveFrom: '2020-01-01' });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(Object.keys(res.body), ['errors']);
  assert.ok(res.body.errors.effectiveFrom);
});

test('rule 17: the lines of « Ce qui change » are phrased by the server, only the non-zero effects', () => {
  const back = preview({ regime: 'subject', rate: 20, basis: 'all' });
  assert.match(back.lines[0], /^\d+ réservations passent à la TVA, dont \d+ déjà encaissées?\.$/);
  assert.equal(back.lines[1], 'Prix inchangés. Le chiffre d’affaires HT baisse d’autant.');
  assert.ok(back.lines.some((l) => /^Taxe de séjour recalculée sur 1 séjour \([+−]\d,\d\d €\)\.$/.test(l)));
  assert.ok(back.lines.some((l) => /^\d+ liens? de paiement ouverts? gardent? (leur|son) montant\.$/.test(l)));
  assert.equal(back.lines[back.lines.length - 1], 'Devis et résumés : TVA 20 %.');
  const none = preview({ regime: 'subject', rate: 20, basis: 'booking', effectiveFrom: '2028-01-01' });
  assert.deepEqual(none.lines, [
    'Aucune réservation existante. Les réservations prises à partir du 01/01/2028 passent à la TVA.',
    'Prix inchangés. Le chiffre d’affaires HT baisse d’autant.',
    'Devis et résumés : TVA 20 %.',
  ]);
});

test('rule 17: the months of the books are told only when the accounting export is on, listed one by one', () => {
  const { previewLines } = require('../utils/vatRegime');
  const base = { reassigned: 3, collected: 0, touristTaxChanged: 0, touristTaxDelta: 0, touristTaxKept: 0, openLinks: 1, exportMonths: ['2026-05', '2026-06', '2026-10'] };
  const ALL_NO = { regime: 'not_subject', basis: 'all' };
  assert.ok(!previewLines(ALL_NO, base, { accountingExportActive: false }).some((l) => l.startsWith('Écritures')));
  assert.ok(previewLines(ALL, base, { accountingExportActive: true }).includes('Écritures comptables modifiées : mai, juin et octobre 2026.'));
  assert.ok(previewLines(ALL, { ...base, exportMonths: ['2026-12', '2027-02'] }, { accountingExportActive: true }).includes('Écritures comptables modifiées : décembre 2026 et février 2027.'));
  assert.ok(previewLines(ALL, { ...base, exportMonths: ['2026-06', '2026-08', '2026-10'] }, { accountingExportActive: true }).includes('Écritures comptables modifiées : juin, août et octobre 2026.'), 'a gap is never hidden by a range');
  assert.ok(previewLines(ALL, { ...base, exportMonths: ['2026-05'] }, { accountingExportActive: true }).includes('Écritures comptables modifiées : mai 2026.'));
  assert.ok(previewLines(ALL, base).includes('1 lien de paiement ouvert garde son montant.'));
  assert.equal(previewLines(ALL, base)[0], '3 réservations passent sans TVA.');
  assert.equal(previewLines(ALL, { ...base, reassigned: 1, collected: 1 })[0], '1 réservation passe sans TVA, dont 1 déjà encaissée.');
});
