// specs/deposit-blocks-the-dates.md rule 27 (audit R37-RES-L2) — a link minted on a devis keeps the devis id, and the
// stay converted from it reads that link as its own: deleting the devis would withdraw the link the guest is about to
// pay, with nothing said. While the stay lives, a converted devis holding an open link — or one still owing the
// provider a deactivation or a last read — is refused deletion, 409 DEVIS_HOLDS_LINK, the link untouched; a paid or
// withdrawn link holds nothing, and a cancelled stay's devis is judged as before.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');

const { db, inDays } = f;
f.seed();

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const linkOf = (id) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(Number(id));

/** A direct devis with an acompte outside the D23 window (no promise, rule 26), its acompte link, then converted. */
let nextStart = 100;
function convertedWithLink(link = {}) {
  const start = nextStart;
  nextStart += 3;
  const id = devisModel.create(f.stayBody({ propertyId: 1, startDate: inDays(start), endDate: inDays(start + 2) })).data.id;
  assert.ok(rowOf(id).depositAmount > 0);
  const linkId = paymentLinksModel.buildModel(db).create({
    reservationId: id, type: 'deposit', amountCents: Math.round(rowOf(id).depositAmount * 100), url: 'https://pay.example.test/l', status: 'open', ...link,
  }).id;
  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  return { id, rid: converted.data.reservationId, linkId };
}

test('rule 27: a converted devis holding the stay\'s open acompte link is refused deletion, the link untouched', () => {
  const { id, rid, linkId } = convertedWithLink();
  assert.equal(paymentLinksModel.buildModel(db).listForStay(rid).some((l) => l.id === linkId && l.status === 'open'), true);
  const res = devisModel.remove(id);
  assert.equal(res.status, 409, JSON.stringify(res));
  assert.equal(res.code, 'DEVIS_HOLDS_LINK');
  assert.equal(res.error, 'Ce devis porte le lien de paiement de la réservation qui en est issue : il ne peut pas être supprimé.');
  assert.ok(rowOf(id));
  assert.equal(linkOf(linkId).status, 'open');
});

test('rule 27: a link still owing the provider a deactivation or a last read holds the devis too', () => {
  const pending = convertedWithLink();
  db.prepare("UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = datetime('now') WHERE id = ?").run(pending.linkId);
  assert.equal(devisModel.remove(pending.id).code, 'DEVIS_HOLDS_LINK');
  const lapsed = convertedWithLink();
  db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', lastLookAt = datetime('now') WHERE id = ?").run(lapsed.linkId);
  assert.equal(devisModel.remove(lapsed.id).code, 'DEVIS_HOLDS_LINK');
});

test('rule 27: a withdrawn link with nothing owed holds nothing: the devis is deleted', () => {
  const { id, rid, linkId } = convertedWithLink();
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator' WHERE id = ?").run(linkId);
  assert.equal(devisModel.remove(id).ok, true);
  assert.ok(rowOf(rid));
});

test('rule 27: the devis of a cancelled stay is judged by the CGV and money refusals only', () => {
  const { id, rid } = convertedWithLink();
  db.prepare("UPDATE reservations SET kind = 'cancelled', cancelledAt = datetime('now') WHERE id = ?").run(rid);
  assert.equal(devisModel.remove(id).ok, true);
});
