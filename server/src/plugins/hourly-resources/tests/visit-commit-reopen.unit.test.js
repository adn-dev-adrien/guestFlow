// specs/outside-booking-sas.md rules 21-24 — « Valider l'arrivée » commits once in one transaction (a refused step undoes every step), the quote is re-run
// inside it (`PRICE_CHANGED` on a moved total or a document changed underneath), reopening appends and journals, the planning card reads the server's state, an
// invoiced visit is read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

test('rule 21 — one transaction: a refused payment leaves no document, no arrival, no offered time', async () => {
  const id = f.bookEvening();
  const refused = await f.call('commit', { id, body: { offeredMinutes: 30, extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(99999) } } });
  assert.equal(refused.code, 400);
  const row = f.row(id);
  assert.deepEqual([row.arrivedAt, row.saleRef, row.offeredMinutes, row.totalPrice], [null, null, 0, 120]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM standalone_sale_lines').get().n, 0);
});

test('rule 21 — the total the screen showed is compared inside the commit: a moved price answers « Prix modifié — relire le panier »', async () => {
  const id = f.book();
  const quoted = (await f.call('quote', { id, body: { extras: [f.extra(f.beer, 1)] } })).body;
  f.db.prepare('UPDATE options SET price = 7 WHERE id = ?').run(f.beer);
  const refused = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], acceptedTotalCents: quoted.totals.totalCents } });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [409, 'PRICE_CHANGED', 'Prix modifié — relire le panier']);
  f.db.prepare('UPDATE options SET price = 6.5 WHERE id = ?').run(f.beer);
  const ok = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], acceptedTotalCents: quoted.totals.totalCents } });
  assert.equal(ok.code, 200);
});

test('rule 21 — two devices: the second commit on an older version is refused', async () => {
  const id = f.book();
  const first = (await f.call('commit', { id, body: {} })).body.visit;
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], version: first.document.version } });
  const stale = await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)], version: first.document.version } });
  assert.deepEqual([stale.code, stale.body.code], [409, 'PRICE_CHANGED']);
});

test('rules 22-23 — reopening appends and journals; the card reads « À encaisser », then « Reste », then « Payé »', async () => {
  const id = f.book();
  assert.equal(f.bookings.findById(id).cardState.label, 'À encaisser');
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } });
  assert.equal(f.bookings.findById(id).cardState.label, 'Reste 13,00 €');
  const reopened = (await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)] } })).body.visit;
  assert.equal(reopened.lines.length, 3);
  assert.deepEqual(reopened.history.map((entry) => entry.text), [
    'Vente enregistrée', 'Bain fictif ×1 ajoutée', 'Bière locale ×2 ajoutée', '50,00 € encaissés : CB', 'Limonade ×1 ajoutée',
  ]);
  await f.call('pay', { id, body: { tenders: f.card(1700) } });
  assert.equal(f.bookings.findById(id).cardState.label, 'Payé');
  const planning = f.bookings.listPlanningEvents(f.DAY, f.DAY).find((event) => event.id === id);
  assert.deepEqual(planning.cardState, { state: 'paid', label: 'Payé', remainingCents: 0 });
});

test('rule 24 — an invoiced visit is read-only: « Facturée : nouvelle vente séparée. »', async () => {
  const id = f.book();
  await f.call('commit', { id, body: {} });
  f.db.prepare("UPDATE resource_bookings SET qontoInvoiceId = 'inv', invoiceNumber = 'F-1' WHERE id = ?").run(id);
  const refused = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [409, 'BOOKING_INVOICED', 'Facturée : nouvelle vente séparée.']);
  assert.deepEqual((await f.call('getVisit', { id })).body.invoice, { number: 'F-1', cancelled: false });
});

test('rule 21 — « Pas maintenant »: the arrival and the lines, nothing paid', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: null } })).body.visit;
  assert.equal(visit.booking.arrived, true);
  assert.deepEqual([visit.totals.paidCents, visit.totals.remainingCents], [0, 5650]);
});
