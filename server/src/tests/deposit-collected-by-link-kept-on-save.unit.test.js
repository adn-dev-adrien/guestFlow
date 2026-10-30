// specs/disable-deposit-per-reservation.md rule 13 (review of PR #893, RC1, 2026-10-30) — an acompte a payment
// link collected cannot be switched off: a save (or the live quote) carrying « Sans acompte » keeps it. A fiche
// still holding the flag from before the link was booked — sent without its version (« Enregistrer quand
// même », a script) or in the same second as the booking — no longer erases the money. An acompte ticked by
// hand, with no paid link behind it, can still be switched off (rule 3: the platform took it).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { skipWithout } = require('../plugins/sdk/testing');
const paymentLinksModel = require('../models/paymentLinksModel');
const { stayWithDisabledAcompte, pay, journalEntries, ledgerRow } = require('./disabledAcompteLinkFixture');

const call = (fn, req) => new Promise((resolve) => fn(req, { status() { return this; }, json: resolve }));

// The PUT a tab sends with the body it loaded before the booking (« Sans acompte » on, acompte 0).
async function saveHeld(id, held, extra = {}) {
  const res = f.respond();
  await f.controller.update({ params: { id: String(id) }, body: { ...held, ...extra }, user: f.ADMIN }, res);
  return res;
}

function assertAcompteKept(s, res) {
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = f.rowOf(s.id);
  assert.equal(row.depositDisabled, 0, 'the acompte stays enabled');
  assert.equal(row.depositPaid, 1, 'the acompte stays paid');
  assert.equal(row.depositPaidDate, '2027-03-01');
  assert.equal(row.depositAmount, s.deposit);
  const deposit = ledgerRow(s.id, 'deposit');
  assert.notEqual(deposit.state, 'na', JSON.stringify(deposit));
  assert.equal(deposit.amount, s.deposit);
}

for (const path of ['live', 'retry']) {
  test(`${path}: a save without its version, still on « Sans acompte », keeps the acompte the link collected`, async () => {
    const s = stayWithDisabledAcompte(path);
    const held = f.ficheBody(s.id);
    assert.equal(held.depositDisabled, 1);
    assert.equal(held.loadedUpdatedAt, undefined, 'no version: the stale-fiche guard does not apply');
    await pay(path, s);
    assertAcompteKept(s, await saveHeld(s.id, held));
  });

  test(`${path}: a save holding the version of the same second keeps the acompte the link collected`, async () => {
    const s = stayWithDisabledAcompte(path);
    const version = f.rowOf(s.id).updatedAt;
    const held = f.ficheBody(s.id);
    await pay(path, s);
    // The booking landed in the second the tab loaded: the stored version still reads the same.
    f.db.prepare('UPDATE reservations SET updatedAt = ? WHERE id = ?').run(version, s.id);
    assertAcompteKept(s, await saveHeld(s.id, held, { loadedUpdatedAt: version }));
  });

  test(`${path}: the refused « Sans acompte » keeps the acompte's stored amount and due date, with no history line`, async () => {
    const s = stayWithDisabledAcompte(path);
    const held = f.ficheBody(s.id);
    await pay(path, s);
    const booked = f.rowOf(s.id);
    assert.equal(booked.depositAmountOverride, s.deposit, 'the booking records the amount received');
    assert.equal(booked.depositDueDate, null);
    const historyBefore = f.history(s.id).length;
    // The tab still holds the cleared override and the deadline it showed before the switch.
    assertAcompteKept(s, await saveHeld(s.id, held, { depositAmountOverride: null, depositDueDate: '2027-02-15' }));
    const row = f.rowOf(s.id);
    assert.equal(row.depositAmountOverride, s.deposit);
    assert.equal(row.depositDueDate, null);
    const labels = f.history(s.id).slice(historyBefore).flatMap((h) => h.changes.map((c) => c.label));
    assert.ok(!labels.includes('Acompte saisi'), JSON.stringify(labels));
    assert.ok(!labels.includes('Date acompte'), JSON.stringify(labels));
  });

  test(`${path}: the journal keeps the acompte entry after the « Sans acompte » save`, { skip: skipWithout(['accounting-export']) }, async () => {
    const s = stayWithDisabledAcompte(path);
    const held = f.ficheBody(s.id);
    await pay(path, s);
    await saveHeld(s.id, held);
    const entries = journalEntries(s.id, 'deposit');
    assert.equal(entries.length, 1, 'the acompte entry is still in the March journal');
    assert.equal(entries[0].encaissementTtc, s.deposit);
  });
}

test('the live quote on « Sans acompte » keeps an acompte a link collected', async () => {
  const s = stayWithDisabledAcompte('retry');
  await pay('retry', s);
  const live = await call(f.controller.calculatePrice, {
    body: { ...f.ficheBody(s.id, { depositDisabled: true }), reservationId: s.id, selectedOptions: [], selectedResources: [] },
    user: f.ADMIN,
  });
  assert.equal(live.error, undefined, JSON.stringify(live));
  assert.equal(live.depositAmount, s.deposit);
  const deposit = live.ledger.rows.find((r) => r.key === 'deposit');
  assert.notEqual(deposit.state, 'na', JSON.stringify(deposit));
});

test('an acompte ticked by hand, with no paid link, can still be switched off', async () => {
  const id = f.createStay({ startDate: '2027-11-02', endDate: '2027-11-05' });
  const before = f.rowOf(id);
  assert.ok(before.depositAmount > 0);
  f.db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-10-01' WHERE id = ?").run(id);
  // A link that was never paid does not hold the acompte.
  paymentLinksModel.buildModel(f.db).create({
    reservationId: id, type: 'deposit', amountCents: Math.round(before.depositAmount * 100),
    provider: 'qonto', providerLinkId: 'L-hand-ticked', url: 'https://pay.example/y', status: 'cancelled',
  });
  const res = await f.save(id, { depositDisabled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = f.rowOf(id);
  assert.equal(row.depositDisabled, 1);
  assert.equal(row.depositPaid, 0);
  assert.equal(row.depositPaidDate, null);
  assert.equal(row.depositAmount, 0);
  assert.equal(ledgerRow(id, 'deposit').state, 'na');
});

test('the fiche and the live quote say why « Sans acompte » is locked once a link collected the acompte', async () => {
  const s = stayWithDisabledAcompte('retry');
  assert.equal(f.getFiche(s.id).depositDisabledLockedReason, null, 'nothing collected yet: the switch is free');
  await pay('retry', s);
  assert.equal(f.getFiche(s.id).depositDisabledLockedReason, 'collected-by-link');
  const live = await call(f.controller.calculatePrice, {
    body: { ...f.ficheBody(s.id), reservationId: s.id, selectedOptions: [], selectedResources: [] },
    user: f.ADMIN,
  });
  assert.equal(live.depositDisabledLockedReason, 'collected-by-link');
});

test('an acompte ticked by hand, with no paid link, leaves « Sans acompte » unlocked', () => {
  const id = f.createStay({ startDate: '2027-11-09', endDate: '2027-11-12' });
  f.db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-10-01' WHERE id = ?").run(id);
  assert.equal(f.getFiche(id).depositDisabledLockedReason, null);
});
