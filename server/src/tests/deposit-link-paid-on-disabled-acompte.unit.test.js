// specs/disable-deposit-per-reservation.md rule 12 and specs/plugins-phase-3a-online-payment.md rule 48
// (audit R7 M1, 2026-10-30) — an acompte link paid after the stay was switched to « Sans acompte » (the
// Qonto deactivation failed, or the guest paid in between) re-enables the acompte: the money is recorded
// as the acompte, the ledger shows it, the journal books it, and the next save of the fiche keeps it.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { skipWithout } = require('../plugins/sdk/testing');
const ns = require('../utils/notificationService');
const { stayWithDisabledAcompte, pay, journalEntries } = require('./disabledAcompteLinkFixture');

const depositEntries = (id) => journalEntries(id, 'deposit');

for (const path of ['live', 'retry']) {
  test(`${path}: the acompte link paid on a « Sans acompte » stay re-enables the acompte`, async () => {
    const s = stayWithDisabledAcompte(path);
    const { out } = await pay(path, s);
    assert.equal(out.effect, 'deposit-booked');
    const row = f.rowOf(s.id);
    assert.equal(row.depositDisabled, 0, 'the acompte is re-enabled');
    assert.equal(row.depositPaid, 1);
    assert.equal(row.depositPaidDate, '2027-03-01');
    assert.equal(row.depositAmount, s.deposit);
    assert.equal(Math.round(row.balanceAmount * 100), Math.round((s.preArrival - s.deposit) * 100), 'the solde drops by the acompte');
    const lines = f.history(s.id).flatMap((h) => h.changes);
    assert.ok(lines.some((c) => c.field === 'depositDisabled' && c.label === 'Acompte réactivé' && c.toText === 'payé par un lien retiré'),
      JSON.stringify(lines));
  });

  test(`${path}: the alert says the acompte was re-enabled`, async () => {
    const s = stayWithDisabledAcompte(path);
    const { calls } = await pay(path, s);
    const alert = calls.find((c) => c[0] === 'alert');
    assert.ok(alert, 'the admin is alerted');
    assert.equal(alert[1].amountMismatch.depositReenabled, true);
    assert.equal(alert[1].amountMismatch.receivedCents, Math.round(s.deposit * 100));
    assert.equal(alert[1].amountMismatch.balanceCents, Math.round((s.preArrival - s.deposit) * 100));
    const text = ns.__test.buildPaidAfterCancelEmail({ ...f.rowOf(s.id), firstName: 'A', lastName: 'B' }, s.links.findById(s.link.id), '', alert[1]).text;
    assert.match(text, /Acompte réactivé : payé par un lien retiré\./);
    assert.match(text, /séjour était passé sans acompte/);
    assert.doesNotMatch(text, /0,00\s€ demandés/);
  });

  test(`${path}: the ledger shows the acompte collected, and a save of the fiche keeps it`, async () => {
    const s = stayWithDisabledAcompte(path);
    await pay(path, s);
    const ledgerDeposit = (fiche) => fiche.ledger.rows.find((r) => r.key === 'deposit');
    const before = ledgerDeposit(f.getFiche(s.id));
    assert.notEqual(before.state, 'na', JSON.stringify(before));
    assert.equal(before.amount, s.deposit);
    const res = await f.save(s.id);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const row = f.rowOf(s.id);
    assert.equal(row.depositDisabled, 0);
    assert.equal(row.depositPaid, 1, 'the save keeps the acompte paid');
    assert.equal(row.depositPaidDate, '2027-03-01');
    assert.equal(row.depositAmount, s.deposit);
    const after = ledgerDeposit(f.getFiche(s.id));
    assert.notEqual(after.state, 'na');
    assert.equal(after.amount, s.deposit);
  });

  test(`${path}: the journal books the acompte and keeps it after a save`, { skip: skipWithout(['accounting-export']) }, async () => {
    const s = stayWithDisabledAcompte(path);
    await pay(path, s);
    assert.equal(depositEntries(s.id).length, 1, 'the acompte entry is in the March journal');
    await f.save(s.id);
    const entries = depositEntries(s.id);
    assert.equal(entries.length, 1, 'still there after the save');
    assert.equal(entries[0].encaissementTtc, s.deposit);
  });
}
