// specs/deposit-blocks-the-dates.md rule 23 (audit R34 L-N2). Rule 21 refuses to delete a converted devis while
// its stay exists, because the stay reads its deadline on the devis row. A cancelled stay is history: it can no
// longer be re-priced (409 RESERVATION_CANCELLED) nor brought back, so no deadline is left to protect and its
// devis is deletable again under the older conditions (no CGV acceptance, no money). A stay set aside as a
// duplicate can be restored to a reservation: its devis stays refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');

const { db, inDays } = f;
f.seed();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
function convert(startIn) {
  const id = devisModel.create(f.stayBody({ propertyId: 1, startDate: inDays(startIn), endDate: inDays(startIn + 2) })).data.id;
  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  return { id, rid: converted.data.reservationId };
}
const setKind = (rid, kind) => db.prepare("UPDATE reservations SET kind = ?, cancelledAt = CASE WHEN ? = 'cancelled' THEN datetime('now') ELSE cancelledAt END WHERE id = ?").run(kind, kind, rid);

test('rule 23 — the converted devis of a cancelled stay can be deleted; the cancelled stay is untouched', () => {
  const { id, rid } = convert(45);
  setKind(rid, 'cancelled');
  const before = rowOf(rid);
  const removed = devisModel.remove(id);
  assert.ok(removed.ok, JSON.stringify(removed));
  assert.equal(rowOf(id), undefined);
  assert.deepEqual(rowOf(rid), before);
});

test('rule 23 — the older refusals still hold on a cancelled stay\'s devis: CGV acceptance, money', () => {
  const withTerms = convert(47);
  setKind(withTerms.rid, 'cancelled');
  const version = db.prepare(`INSERT INTO terms_versions (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt)
    VALUES (1, 'x', 'x', 'x', 'x', '{}', 'h', datetime('now'))`).run().lastInsertRowid;
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (?, ?, datetime('now'))").run(withTerms.id, version);
  assert.equal(devisModel.remove(withTerms.id).status, 409);
  assert.ok(rowOf(withTerms.id));

  const withMoney = convert(49);
  setKind(withMoney.rid, 'cancelled');
  db.prepare('UPDATE reservations SET depositPaid = 1, depositAmount = 50 WHERE id = ?').run(withMoney.id);
  const refused = devisModel.remove(withMoney.id);
  assert.equal(refused.code, 'DEVIS_CARRIES_MONEY');
  assert.ok(rowOf(withMoney.id));
});

test('rule 23 — a stay set aside as a duplicate (it can be restored) and a live stay keep their devis', () => {
  for (const kind of ['superseded', 'reservation']) {
    const { id, rid } = convert(kind === 'superseded' ? 51 : 53);
    setKind(rid, kind);
    const refused = devisModel.remove(id);
    assert.equal(refused.code, 'DEVIS_HOLDS_PROMISE', kind);
    assert.ok(rowOf(id), kind);
  }
});
