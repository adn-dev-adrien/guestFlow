// specs/outside-booking-sas.md rules 7, 39, 40 and reception-role-checkin-only rule 17 (end review R3-1, R3-2, R3-16) — withdrawing or e-mailing
// the visit's link is a write: the reception inside the day window only, nobody on a no-show visit. The counter collecting the whole reste withdraws
// the open link (nothing left to pay twice).
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const { createContext } = require('../../sdk/createContext');

const { DAY, NEXT_DAY } = f;
createContext('online-payment', {}).paymentProvider({
  id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
  createLink: async () => ({ id: `rem-${Date.now()}-${Math.random()}`, url: 'https://pay.example/1', status: 'open' }),
  getPayment: async () => ({ paid: false }), getLinkStatus: async () => 'open', cancelLink: async () => {},
});

async function visitWithLink() {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } });
  const minted = await f.call('mintLink', { id, body: { email: 'client@exemple.fr' } });
  assert.equal(minted.code, 200, JSON.stringify(minted.body));
  return { id, linkId: minted.body.link.id };
}

test('rule 7 — after the day window the reception can neither withdraw nor e-mail the link; the administrator still withdraws it', async () => {
  const { id, linkId } = await visitWithLink();
  f.setNow(`${NEXT_DAY}T10:00:00Z`);
  for (const handler of ['withdrawLink', 'emailLink']) {
    const refused = await f.call(handler, { id, linkId, user: f.RECEPTION });
    assert.deepEqual([refused.code, refused.body.code], [409, 'ARRIVAL_NOT_TODAY'], handler);
  }
  const admin = await f.call('withdrawLink', { id, linkId });
  assert.equal(admin.code, 200, 'an opened visit is the administrator\'s on any day');
  f.setNow(`${DAY}T15:00:00Z`);
});

test('rule 39 — nobody e-mails the link of a no-show visit', async () => {
  const { id, linkId } = await visitWithLink();
  f.db.prepare("UPDATE resource_bookings SET noShowAt = datetime('now') WHERE id = ?").run(id);
  const refused = await f.call('emailLink', { id, linkId });
  assert.deepEqual([refused.code, refused.body.code], [409, 'BOOKING_NO_SHOW']);
});

test('rule 40 — the counter collecting the whole reste withdraws the open link', async () => {
  const { id, linkId } = await visitWithLink();
  const paid = await f.call('pay', { id, body: { tenders: f.card(650), shortfall: null } });
  assert.equal(paid.code, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.visit.paymentLink.open, null);
  assert.equal(f.db.prepare('SELECT status FROM payment_links WHERE id = ?').get(linkId).status, 'cancelled');
});
