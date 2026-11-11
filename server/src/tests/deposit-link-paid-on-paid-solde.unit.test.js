// specs/plugins-phase-3a-online-payment.md rule 49 (review of PR #893, RC2, 2026-10-30) — an acompte link paid
// on a stay whose solde is already collected never rewrites that solde downwards: the acompte is booked on top
// at what was received, the solde keeps its paid amount, and the excess is the trop-perçu (round 6, E1). The
// alert says the solde is already collected and asks for the refund; no confirmation goes to the guest.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const ns = require('../utils/notificationService');
const { stayWithDisabledAcompte, pay } = require('./disabledAcompteLinkFixture');

const cents = (n) => Math.round(Number(n) * 100);

for (const path of ['live', 'retry']) {
  test(`${path}: the paid solde keeps its amount and the acompte is booked on top`, async () => {
    const s = stayWithDisabledAcompte(path, { soldePaid: true });
    const { out } = await pay(path, s);
    assert.equal(out.effect, 'deposit-booked');
    const row = f.rowOf(s.id);
    assert.equal(row.balancePaid, 1);
    assert.equal(cents(row.balanceAmount), cents(s.preArrival), 'the paid solde is not lowered');
    assert.equal(row.depositPaid, 1);
    assert.equal(row.depositDisabled, 0);
    assert.equal(row.depositAmount, s.deposit);
    assert.equal(cents(row.depositAmount + row.balanceAmount), cents(s.preArrival + s.deposit), 'both payments are recorded');
    const over = f.controller.storedOverpayment(s.id);
    assert.equal(cents(over.overpaymentTtc), cents(s.deposit), 'the link money is the trop-perçu');
  });

  test(`${path}: the alert states the trop-perçu and no confirmation goes out`, async () => {
    const s = stayWithDisabledAcompte(path, { soldePaid: true });
    const { calls } = await pay(path, s);
    assert.ok(!calls.some((c) => c[0] === 'confirm'), 'no confirmation');
    const alert = calls.find((c) => c[0] === 'alert');
    assert.ok(alert, 'the admin is alerted');
    const mm = alert[1].amountMismatch;
    assert.equal(mm.balanceCents, cents(s.preArrival), 'the solde announced is the paid one');
    assert.equal(mm.balanceSettled, true);
    assert.equal(mm.excessCents, cents(s.deposit));
    assert.equal(alert[1].confirmationSent, false);
    const text = ns.__test.buildPaidAfterCancelEmail({ ...f.rowOf(s.id), firstName: 'A', lastName: 'B' }, s.links.findById(s.link.id), '', alert[1]).text;
    const euros = (c) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    assert.ok(text.includes(`Trop-perçu de ${euros(cents(s.deposit))} à rembourser.`), text);
    assert.match(text, /solde déjà perçu/);
    assert.doesNotMatch(text, /solde porté à/);
    assert.match(text, /Aucun e-mail de confirmation/);
  });

  test(`${path}: a save of the fiche afterwards keeps both payments`, async () => {
    const s = stayWithDisabledAcompte(path, { soldePaid: true });
    await pay(path, s);
    const res = await f.save(s.id);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const row = f.rowOf(s.id);
    assert.equal(row.depositPaid, 1);
    assert.equal(row.balancePaid, 1);
    assert.equal(cents(row.depositAmount + row.balanceAmount), cents(s.preArrival + s.deposit));
  });
}
