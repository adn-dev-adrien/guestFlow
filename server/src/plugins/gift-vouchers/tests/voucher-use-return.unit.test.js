// specs/site-outside-resource-booking.md rules 4, 14, 16, 23 — the redemption on the session page: the opening answer carries what the page needs of the voucher's activity (its step, its longest
// session, its party), the party is bounded by the resource's own limit, the remainder's return page reads the use by an unguessable reference (the recap chosen, no name), and the booking is
// announced to the operator only once its transaction has committed.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sdk = require('../../sdk');
const campaignRules = require('../campaignRules');
const use = require('./useFixture');

const ids = fx.seedCatalogue();
const told = [];
const offerOfBath = use.bookingOffer({ notify: (notice) => told.push(notice) });
const links = use.paymentLinks();
const shop = fx.openShop({ resources: () => offerOfBath.offer, payments: links.payments });
const { api, db } = shop;
const VISITOR = { ip: '10.0.0.9' };
db.prepare('UPDATE resources SET sessionMaxPeople = 4 WHERE id = ?').run(ids.bath);
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value);

const DAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const voucher = () => {
  const out = api.offerService.issueDirect({
    request: { slug: 'bain-jour' }, parties: { recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul', message: '', email: '', language: 'fr' }, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
};
const confirm = (v, over = {}) => api.useService.confirm({
  code: v.code, start: `${DAY}T10:00`, email: 'lea@example.test', phone: '06 12 34 56 78', firstName: 'Léa', lastName: 'Martin', people: 2, termsVersionId: 9, visitor: VISITOR, ...over,
});

test('rule 14 — the opening answer carries the activity’s step, its longest session and its party, from the booking offer', () => {
  const { data } = api.useService.open({ code: voucher().code, visitor: VISITOR });
  assert.deepEqual(
    [data.resource.id, data.resource.minutes, data.resource.stepMinutes, data.resource.maxMinutes, data.resource.maxPeople],
    [ids.bath, 120, 60, 720, 4],
  );
});

test('rule 4 — the party is bounded by the resource’s own limit, 20 when none is set, and refused above it with its field', async () => {
  const refused = await confirm(voucher(), { people: 5 });
  assert.deepEqual([refused.ok, refused.code, refused.field, refused.message], [false, 'PEOPLE_INVALID', 'people', 'Nombre de personnes : de 1 à 4.']);
  assert.equal((await confirm(voucher(), { people: 0 })).code, 'PEOPLE_INVALID');
  assert.equal((await confirm(voucher(), { people: 4, start: `${DAY}T12:00` })).data.booked, true);
  db.prepare('UPDATE resources SET sessionMaxPeople = NULL WHERE id = ?').run(ids.bath);
  assert.equal((await confirm(voucher(), { people: 20, start: `${DAY}T14:00` })).data.booked, true);
  assert.equal((await confirm(voucher(), { people: 21 })).code, 'PEOPLE_INVALID');
  db.prepare('UPDATE resources SET sessionMaxPeople = 4 WHERE id = ?').run(ids.bath);
});

test('rule 23 — a session booked with a voucher is announced once, after its transaction has committed; a refused one is announced to nobody', async () => {
  told.length = 0;
  const booked = await confirm(voucher(), { start: `${DAY}T16:00` });
  assert.equal(booked.data.booked, true);
  assert.equal(told.length, 1);
  assert.match(told[0].body, /Léa M\., 2 pers\./);
  const before = told.length;
  assert.equal((await confirm(voucher(), { start: `${DAY}T16:00` })).ok, false, 'the slot is taken');
  assert.equal(told.length, before);
});

test('rule 16 — the return page of a remainder: the use is read by its reference, the recap chosen is kept, nothing personal comes back; paid, it is booked', async () => {
  const v = voucher();
  const held = await confirm(v, { start: `${DAY}T18:00`, returnUrl: 'https://site.example.test/reserver/?gf_use=paid' });
  assert.equal(held.ok, true, JSON.stringify(held));
  const options = links.minted.at(-1).options;
  const ref = /gf_ref=([0-9a-f]{32})$/.exec(options.redirectUrl)[1];
  assert.match(options.redirectUrl, /^https:\/\/site\.example\.test\/reserver\/\?gf_use=paid&gf_ref=/);
  const waiting = await api.useService.status(ref);
  assert.deepEqual([waiting.data.state, waiting.data.date, waiting.data.start, waiting.data.end, waiting.data.people, waiting.data.resourceName], ['held', DAY, '18:00', '20:00', 2, 'Bain nordique']);
  assert.equal(waiting.data.recap.dueCents, 1800);
  assert.equal(waiting.data.recap.supplement.label, 'Supplément soirée');
  assert.equal(JSON.stringify(waiting.data).includes('lea@example.test'), false);
  assert.equal(JSON.stringify(waiting.data).includes('Léa'), false);
  const use_ = api.uses.findByRef(ref);
  assert.equal(api.useService.paid({ ref: String(use_.id), linkId: 1, amountCents: 1800 }).effect, 'bath-booked');
  const done = await api.useService.status(ref);
  assert.equal(done.data.state, 'booked');
  assert.equal(done.data.recap.dueCents, 1800);
});

test('rule 16 — an unknown or malformed reference is a 404 and nothing else', async () => {
  const none = await api.useService.status('0'.repeat(32));
  assert.deepEqual([none.ok, none.status, none.code], [false, 404, 'ORDER_NOT_FOUND']);
  assert.equal((await api.useService.status('1 OR 1=1')).code, 'ORDER_NOT_FOUND');
});
