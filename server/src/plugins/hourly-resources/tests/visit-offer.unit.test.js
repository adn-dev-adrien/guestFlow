// specs/outside-booking-sas.md rule 13 — « Offrir » on the whole line (session or extra: amount 0, catalogue value kept for the struck display), the partial offered
// time of the session as one of its parts (15-minute steps), and no third mechanism: the tender's « geste commercial » is refused in the mini SAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

test('rule 13 — the whole session offered: 0 €, its catalogue value kept, status « Offerte »', async () => {
  const id = f.bookEvening();
  const quoted = (await f.call('quote', { id, body: { sessionOffered: true, extras: [f.extra(f.beer, 1)] } })).body;
  const [session] = quoted.lines;
  assert.deepEqual([session.offered, session.totalCents, session.catalogueCents, session.status], [true, 0, 12000, 'offered']);
  assert.equal(quoted.totals.totalCents, 650);
  const done = (await f.call('commit', { id, body: { sessionOffered: true, extras: [f.extra(f.beer, 1)] } })).body.visit;
  assert.equal(done.totals.remainingCents, 650);
});

test('rule 13 — the offered time is a part of the session line, by 15 minutes, priced by the family', async () => {
  const id = f.bookEvening();
  const quoted = (await f.call('quote', { id, body: { offeredMinutes: 15 } })).body;
  const [session] = quoted.lines;
  assert.deepEqual(session.components.at(-1), { key: 'offered', label: 'Temps offert', detail: '15 min', amountCents: -1250 });
  assert.equal(session.totalCents, 10750);
  const bad = (await f.call('quote', { id, body: { offeredMinutes: 10 } })).body;
  assert.equal(bad.refusals[0].error, 'Temps offert invalide : par tranche de 15 min.');
  await f.call('commit', { id, body: { offeredMinutes: 15 } });
  assert.deepEqual([f.row(id).offeredMinutes, f.row(id).totalPrice], [15, 107.5], 'the booking keeps the offered time its session was sold with');
});

test('rule 13 — once the session is sold its offered time is fixed: the whole line is offered instead', async () => {
  const id = f.book();
  await f.call('commit', { id, body: {} });
  const refused = await f.call('commit', { id, body: { offeredMinutes: 15 } });
  assert.deepEqual([refused.code, refused.body.code], [409, 'SESSION_SOLD']);
  const session = (await f.call('getVisit', { id })).body.lines[0];
  const offered = (await f.call('patchLine', { id, lineId: session.id, body: { offered: true } })).body.visit;
  assert.deepEqual([offered.lines[0].status, offered.totals.totalCents], ['offered', 0]);
  const back = (await f.call('patchLine', { id, lineId: session.id, body: { offered: false } })).body.visit;
  assert.equal(back.totals.totalCents, 5000);
});

test('rule 13 — an unpaid extra is offered and offered back; the history says so', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 2)] } })).body.visit;
  const lemonade = visit.lines.find((line) => line.label === 'Limonade');
  const offered = (await f.call('patchLine', { id, lineId: lemonade.id, body: { offered: true } })).body.visit;
  const line = offered.lines.find((l) => l.id === lemonade.id);
  assert.deepEqual([line.offered, line.totalCents, line.catalogueCents], [true, 0, 800]);
  assert.equal(offered.totals.remainingCents, 5000);
  assert.ok(offered.history.some((entry) => entry.text === 'Limonade offerte'));
});

test('rule 17 — no geste commercial in the tender: « waived » is refused, offering is a line property', async () => {
  const id = f.book();
  const refused = await f.call('commit', { id, body: { payment: { tenders: f.card(1000), shortfall: { kind: 'waived' } } } });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [400, 'WAIVED_REFUSED', 'Geste commercial : offrir une ligne.']);
  assert.equal(f.row(id).arrivedAt, null, 'nothing written');
});
