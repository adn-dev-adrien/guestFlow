// specs/payment-link-lifecycle.md rule 55 — a stay whose nights an establishment closure covers gets no payment
// link: the mint (acompte, solde, séjour, échéance) and the request e-mail are refused 409 CLOSED_DATES
// « Logement fermé sur ces dates : aucun lien créé. », before any provider call or mail.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');
const { emailsFixture, teardown } = require('./paymentLinkEmailsFixture');
const { localIsoDate } = require('../utils/localDate');

test.afterEach(teardown);

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const MESSAGE = 'Logement fermé sur ces dates : aucun lien créé.';

// A closure on `nights` of the stay: `[fromOffset, toOffset]` in days from its start; null logement = everywhere.
function close(db, stayId, { propertyId = 1, from = 0, to = null } = {}) {
  const s = db.prepare('SELECT startDate, endDate FROM reservations WHERE id = ?').get(stayId);
  const shift = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localIsoDate(d); };
  db.prepare('INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, ?, ?, ?)')
    .run(propertyId, 'Travaux', shift(s.startDate, from), to == null ? s.endDate : shift(s.startDate, to));
}

function setup(kind = 'devis') {
  const { db, links } = seedDb();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Tente')").run();
  const id = addStay(db, { kind, startDate: inDays(40), endDate: inDays(44) });
  const provider = fakeProvider();
  const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000 };
  return { db, links, id, provider, deps };
}

const refused = (err) => err.httpStatus === 409 && err.error === 'CLOSED_DATES' && err.message === MESSAGE;

test('rule 55: a closure over the stay refuses the mint, before any provider call', async () => {
  const { db, links, id, provider, deps } = setup();
  close(db, id);
  await assert.rejects(ensurePaymentLink(deps, id, 'full'), refused);
  assert.deepEqual(provider.calls, []);
  assert.deepEqual(links.listForReservation(id), []);
});

test('rule 55: one closed night is enough; an establishment-wide closure counts', async () => {
  const one = setup();
  close(one.db, one.id, { from: 3, to: 4 });
  await assert.rejects(ensurePaymentLink(one.deps, one.id, 'deposit'), refused);
  const all = setup();
  close(all.db, all.id, { propertyId: null });
  await assert.rejects(ensurePaymentLink(all.deps, all.id, 'deposit'), refused);
});

test('rule 55: a closure on another logement, or from the departure day on, leaves the mint free', async () => {
  const other = setup();
  close(other.db, other.id, { propertyId: 2 });
  assert.equal((await ensurePaymentLink(other.deps, other.id, 'full')).reused, false);
  const after = setup();
  close(after.db, after.id, { from: 4, to: 6 });
  assert.equal((await ensurePaymentLink(after.deps, after.id, 'full')).reused, false);
});

test('rule 55: an open link is not handed out again on closed nights', async () => {
  const { db, links, id, deps } = setup();
  addLink(links, db, id, { type: 'full', expiresAt: new Date(Date.now() + 30 * 3600 * 1000) });
  close(db, id);
  await assert.rejects(ensurePaymentLink(deps, id, 'full'), refused);
});

test('rule 55: the échéance of a reservation is refused the same way', async () => {
  const { db, id, provider, deps } = setup('reservation');
  close(db, id);
  const installment = { id: 41, reservationId: id, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment] };
  await assert.rejects(ensureInstallmentLink({ ...deps, installmentsModel }, id, 41), refused);
  assert.deepEqual(provider.calls, []);
});

for (const key of ['deposit_request', 'full_request', 'deposit_reminder']) {
  test(`rule 55: ${key} is refused before any link is minted, nothing sent`, async () => {
    const f = emailsFixture();
    close(f.db, f.id);
    const r = await f.send(key);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, 'CLOSED_DATES');
    assert.equal(r.body.message, MESSAGE);
    assert.deepEqual(f.minted, []);
    assert.equal(f.sent.length, 0);
  });
}

test('rule 55: a mail that carries no link (the arrival reminder) still leaves on closed nights', async () => {
  const f = emailsFixture();
  close(f.db, f.id);
  const r = await f.send('arrival_reminder_7d');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(f.sent.length, 1);
});
