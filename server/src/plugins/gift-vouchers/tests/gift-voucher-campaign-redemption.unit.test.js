// specs/gift-voucher-campaigns.md rule 12 — a voucher pays only for its kind: a `lodging` voucher is refused on a resource, a `resource` voucher on a stay and on any other
// resource than its own, each with its sentence (the resource's name is read). The plugin's `apply` receives the consumer's kind — `lodging` from the booking engine (the
// default, so the engine needs no change), `resource:<id>` from a resource's page — through the core's generic `prepaidSources.apply`.
//
// And « Mon bain » (rules 23-32, 44-45, 51): the recipient opens the voucher, chooses a slot, and either books at once (nothing due) or has the slot and the voucher held for 15 minutes
// while the remainder is paid. Nothing is booked, held or created before the bank confirms the payment — but that hold: no booking row, no sale, no settle movement; the hold lapses
// after 15 minutes and frees slot and voucher; a payment confirmed after the lapse on a slot taken meanwhile opens a refund line (the payment link's, the core's) and leaves the
// voucher intact; on a slot still free, the booking is made.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const campaignRules = require('../campaignRules');
const prepaidSources = require('../../../utils/prepaidSources');

const use = require('./useFixture');
const sale = require('./giftVoucherFixtures');

const ids = fx.seedCatalogue();
const offerOfBath = use.bookingOffer();
const links = use.paymentLinks();
let hook = offerOfBath.offer;
const ADDRESS = '12 chemin du Lac\n46330 Saint-Cirq-Lapopie';
const shop = fx.openShop({ resources: () => hook, payments: links.payments, address: () => ADDRESS });
const {
  api, clock, sent, db,
} = shop;
const VISITOR = { ip: '10.0.0.9' };
const standaloneSale = require('../../../utils/standaloneSale');
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value);

const issue = (request) => {
  const out = api.offerService.issueDirect({
    request, parties: { recipientFirstName: '', recipientLastName: '', senderName: 'Paul', message: '', email: '', language: 'fr' }, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const read = sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted);
  return { id: out.voucherId, code: read.value };
};
const lodgingVoucher = issue({ amountCents: 15000 });
const bathVoucher = issue({ slug: 'bain-jour' });
const apply = (voucher, consumer) => api.redemption.apply({
  devisId: 1, input: { code: voucher.code }, capCents: 20000, visitor: { ip: '10.0.0.9' }, dryRun: true, ...(consumer === undefined ? {} : { consumer }),
});

test('a lodging voucher pays a stay — by default, as the booking engine asks — and is refused on a resource, naming it', () => {
  assert.equal(apply(lodgingVoucher).ok, true);
  assert.equal(apply(lodgingVoucher, 'lodging').ok, true);
  assert.deepEqual(apply(lodgingVoucher, `resource:${ids.bath}`), {
    ok: false, status: 409, code: 'VOUCHER_WRONG_KIND', message: 'Ce bon est valable pour un séjour dans nos logements, pas pour « Bain nordique ».',
  });
});

test('a composed voucher is refused on a stay, and on any other resource than its own; its own resource passes the kind check', () => {
  assert.deepEqual(apply(bathVoucher), {
    ok: false, status: 409, code: 'VOUCHER_WRONG_KIND', message: 'Ce bon est valable pour « Bain nordique », pas pour un séjour.',
  });
  assert.equal(apply(bathVoucher, 'lodging').code, 'VOUCHER_WRONG_KIND');
  assert.equal(apply(bathVoucher, `resource:${ids.sauna}`).message, 'Ce bon est valable pour « Bain nordique », pas pour « Sauna sans carte ».');
  assert.equal(apply(bathVoucher, `resource:${ids.bath}`).code, undefined, 'the kind is right: what the page does with it is the later step');
});

test('a refusal holds nothing: no movement is written on the voucher', () => {
  const before = api.movements.list(bathVoucher.id).length;
  api.redemption.apply({
    devisId: 5, input: { code: bathVoucher.code }, capCents: 20000, visitor: { ip: '10.0.0.9' }, consumer: 'lodging',
  });
  assert.equal(api.movements.list(bathVoucher.id).length, before);
  assert.equal(api.vouchers.find(bathVoucher.id).balanceCents, api.vouchers.find(bathVoucher.id).amountCents);
});

test('the core carries the consumer to the plugin that owns the instrument, and reads a stay when none is named', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('gift-vouchers', {}).prepaid({
    source: 'giftVoucher',
    label: 'Bon cadeau',
    apply: (args) => api.redemption.apply(args),
    held: () => null,
    settle: () => null,
    release: () => {},
  });
  const ask = (voucher, options = {}) => prepaidSources.apply(null, { kind: 'giftVoucher', code: voucher.code }, {
    capCents: 20000, visitor: { ip: '10.0.0.9' }, dryRun: true, ...options,
  });
  assert.equal(ask(lodgingVoucher).ok, true);
  assert.equal(ask(bathVoucher).code, 'VOUCHER_WRONG_KIND');
  assert.equal(ask(bathVoucher, { consumer: `resource:${ids.bath}` }).ok, true);
  assert.equal(ask(lodgingVoucher, { consumer: `resource:${ids.bath}` }).code, 'VOUCHER_WRONG_KIND');
  require('../../../tests/hourlyResourcesFixture').liveHourlyResources();
});

test('the public check says the kind of a usable code, so a page can send the visitor to the right place', async () => {
  const server = await fx.serve(api);
  try {
    const sale = require('./giftVoucherFixtures');
    const check = async (voucher, ip) => (await server.call('POST', '/public/v1/gift-vouchers/check', { code: voucher.code, ...sale.solvedProof({ ip }) }, { 'x-test-ip': ip })).body.data;
    assert.deepEqual([(await check(lodgingVoucher, '10.0.2.1')).kind, (await check(bathVoucher, '10.0.2.2')).kind], ['lodging', 'resource']);
  } finally {
    await server.close();
  }
});

// ── « Mon bain » ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, {
  name: 'Bain soirée', title: 'Un bain nordique le soir', slug: 'bain-soir', composition: { resourceId: ids.bath, band: 'evening', minutes: 120, options: [] }, addOns: [], extraTimeMaxMinutes: 0,
}), fx.rulesContext(api)).value);

const MONDAY = '2026-11-16'; // date-literal-ok: the suite runs on its own clock, never the real today
const day = (n) => new Date(Date.parse(`${MONDAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PARTIES = {
  recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul', message: 'Joyeux anniversaire', email: 'paul@example.test', language: 'fr',
};
const issueFor = (request) => {
  const out = api.offerService.issueDirect({
    request, parties: PARTIES, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { id: out.voucherId, code: sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted).value };
};
const dayVoucher = () => issueFor({ slug: 'bain-jour' });
const eveningVoucher = () => issueFor({ slug: 'bain-soir' });
const as = (visitor = VISITOR) => ({ visitor });
const ask = {
  open: (v, visitor) => api.useService.open({ code: v.code, ...as(visitor) }),
  slots: (v, over = {}) => api.useService.slots({
    code: v.code, from: day(0), to: day(0), ...as(), ...over,
  }),
  quote: (v, over = {}) => api.useService.quote({ code: v.code, start: `${day(0)}T10:00`, ...as(), ...over }),
  confirm: (v, over = {}) => api.useService.confirm({
    code: v.code, start: `${day(0)}T10:00`, email: 'lea@example.test', phone: '06 12 34 56 78', termsVersionId: 9, ...as(), ...over,
  }),
};
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const movementKinds = (voucher) => api.movements.list(voucher.id).map((m) => m.kind);
const slotStarts = (v, date, minutes) => offerOfBath.offer.freeSlots({
  resourceId: ids.bath, from: date, to: date, minutes, now: clock.at,
}).days.flatMap((d) => d.slots.map((s) => s.start));
const useRow = (id) => api.uses.find(id);

test('« Mon bain » opens a voucher: its contents, the names, the validity, the add-ons and the extra time on offer, the horizon of the resource', () => {
  const voucher = dayVoucher();
  const { ok, data } = ask.open(voucher);
  assert.equal(ok, true);
  assert.deepEqual(data.contents.map((c) => [c.kind, c.label, c.detail, c.qty]), [
    ['session', 'Bain nordique', '2 h en journée · de 10:00 à 19:00', 1],
    ['option', 'Planche apéro', null, 1],
  ]);
  assert.deepEqual([data.kind, data.recipientName, data.senderName, data.message, data.expiresOn], ['resource', 'Léa', 'Paul', 'Joyeux anniversaire', '2027-11-15']); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(data.addOns.map(({ prices, ...rest }) => rest), [{
    articleRef: `option:${ids.drink}`, label: 'Boisson', maxQty: 20, unitLabel: 'l’unité', linear: true,
  }]);
  assert.deepEqual(data.addOns[0].prices.slice(0, 2), [{ qty: 1, cents: 650 }, { qty: 2, cents: 1300 }], 'rule 64: the figures come from the server');
  assert.deepEqual([data.extraTime.stepMinutes, 'maxMinutes' in data.extraTime, data.horizonUntil, data.usedOn], [60, false, '2027-02-15', null]); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(data.termsVersionId, 9, 'the version of the activity’s terms the confirmation will ask to have accepted');
  assert.equal(JSON.stringify(data).includes(voucher.code), false, 'the code is never echoed');
});

test('a lodging voucher says it is for a stay on the opening call, and is refused on a slot with its sentence', () => {
  const lodging = issueFor({ amountCents: 20000 });
  assert.deepEqual(ask.open(lodging).data, { kind: 'lodging' });
  const refused = ask.slots(lodging);
  assert.deepEqual([refused.ok, refused.code, refused.message], [false, 'VOUCHER_WRONG_KIND', 'Ce bon est valable pour un séjour dans nos logements, pas pour une séance.']);
});

test('the refusals of rule 32, each with its sentence: unknown, mistyped, expired with its date, cancelled, used with its date', () => {
  const voucher = dayVoucher();
  const mistyped = { code: `${voucher.code.slice(0, -1)}${voucher.code.endsWith('A') ? 'B' : 'A'}` };
  assert.deepEqual([ask.open({ code: 'ABCD-EFGH-JKLM-NPQR' }).code, ask.open({ code: 'ABCD-EFGH-JKLM-NPQR' }).message], ['VOUCHER_CODE_MISTYPED', 'Code mal recopié : vérifier chaque caractère.']);
  assert.equal(ask.open(mistyped).ok, false);
  const cancelled = dayVoucher();
  api.vouchers.setCancelled(cancelled.id, clock.at.toISOString());
  assert.deepEqual([ask.open(cancelled).code, ask.open(cancelled).message], ['VOUCHER_CANCELLED', 'Ce bon a été annulé.']);
  const old = clock.at;
  clock.at = new Date('2027-12-01T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  try {
    assert.deepEqual([ask.open(voucher).code, ask.open(voucher).message], ['VOUCHER_EXPIRED', 'Ce bon a expiré le 15/11/2027.']);
  } finally { clock.at = old; }
});

test('five wrong attempts of a visitor close the door on that visitor, as the public check does — a typing error is never counted', () => {
  const stranger = { ip: '10.9.9.9' };
  const unknown = () => ask.open({ code: require('../code').format(require('../code').generate()) }, stranger);
  const answers = Array.from({ length: 5 }, unknown);
  assert.deepEqual(answers.map((a) => a.code), Array(5).fill('VOUCHER_UNKNOWN'));
  assert.deepEqual(answers.map((a) => a.triesLeft), [4, 3, 2, 1, 0]);
  const sixth = unknown();
  assert.deepEqual([sixth.ok, sixth.status, sixth.code], [false, 429, 'VOUCHER_CHECKS_EXCEEDED']);
  assert.ok(sixth.retryAfterSeconds > 0);
  assert.equal(ask.slots({ code: 'x' }, { ...as(stranger) }).code, 'VOUCHER_CHECKS_EXCEEDED', 'every call that reads a code is behind the same limit');
  const fresh = { ip: '10.9.9.10' };
  const typo = Array.from({ length: 8 }, () => ask.open({ code: 'ABCD-EFGH-JKLM-NPQR' }, fresh).code);
  assert.deepEqual(new Set(typo), new Set(['VOUCHER_CODE_MISTYPED']), 'a mistyped code is told, not counted');
});

test('the slots of a day voucher: all the day starts of the window, the evening ones tagged with the engine\'s supplement; an evening voucher is offered evening slots only', () => {
  const voucher = dayVoucher();
  const { data } = ask.slots(voucher, { from: day(1), to: day(1) });
  const byStart = Object.fromEntries(data.days[0].slots.map((s) => [s.start, s]));
  assert.deepEqual(Object.keys(byStart), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
  assert.deepEqual([byStart['17:00'].tag, byStart['17:00'].supplementCents, byStart['17:00'].end], ['in', 0, '19:00']);
  assert.deepEqual([byStart['18:00'].tag, byStart['18:00'].supplementCents, byStart['18:00'].end], ['supplement', 1800, '20:00']);
  assert.equal(data.horizonUntil, '2027-02-15'); // date-literal-ok: the suite runs on its own clock, never the real today
  const evening = eveningVoucher();
  const eve = ask.slots(evening, { from: day(1), to: day(1) }).data.days[0].slots;
  assert.deepEqual(eve.map((s) => [s.start, s.end, s.tag, s.supplementCents]), [['19:00', '21:00', 'in', 0], ['20:00', '22:00', 'in', 0]]);
});

test('the slots leave out the closed hours, the past and what is beyond the horizon, and name the horizon', () => {
  const voucher = dayVoucher();
  assert.deepEqual(ask.slots(voucher, { from: '2026-11-10', to: '2026-11-15' }).data.days.map((d) => d.date), ['2026-11-15'], 'today only, from now on'); // date-literal-ok: the suite runs on its own clock, never the real today
  const beyond = ask.slots(voucher, { from: '2027-02-16', to: '2027-02-20' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual([beyond.ok, beyond.code, beyond.message], [false, 'BEYOND_HORIZON', 'Réservable jusqu’au 15 février 2027.']);
  assert.equal(ask.slots(voucher, { from: day(0), to: '2027-05-01' }).code, 'PERIOD_TOO_LONG'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(ask.slots(voucher, { from: 'demain', to: day(1) }).code, 'PERIOD_INVALID');
});

test('the recap of a day voucher run into the evening: the supplement is the engine\'s, the added time takes the ranks that follow (3rd hour at the following-hours rate), the added option is due', () => {
  const voucher = dayVoucher();
  const { ok, data } = ask.quote(voucher, { start: `${day(2)}T18:00`, extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }] });
  assert.equal(ok, true, JSON.stringify(data));
  assert.deepEqual(data.included.map((l) => [l.label, l.valueCents]), [['Bain nordique · 2 h', 9500], ['Planche apéro', 1400]]);
  assert.deepEqual(data.supplement, { label: 'Supplément soirée', cents: 1800 });
  assert.deepEqual(data.extras.map((e) => [e.label, e.cents]), [['Temps supplémentaire · 1 h', 6300], ['Boisson', 650]]);
  assert.equal(data.dueCents, 1800 + 6300 + 650);
  assert.equal(data.extrasCents, 6300 + 650, 'rule 64: the sum the use screen shows next to « Ajouter au bon », read from the server');
  assert.equal(data.totalCents, 9500 + 1400 + data.dueCents);
  assert.deepEqual([data.date, data.start, data.end], [day(2), '18:00', '21:00']);
  assert.ok(data.vat.length > 0 && data.vat.every((row) => row.cents >= 0));
  assert.equal(ask.quote(voucher, { start: `${day(2)}T10:00` }).data.dueCents, 0, 'inside the day band: nothing due');
});

test('the refusals of a choice: a session past closing time, an add-on not offered, an extra time that does not fit the step, a slot no longer free, a bad start', () => {
  const voucher = dayVoucher();
  const late = ask.quote(voucher, { start: `${day(2)}T21:00` });
  assert.deepEqual([late.ok, late.code], [false, 'SESSION_AFTER_CLOSE']);
  assert.match(late.message, /la séance se termine après 22:00/);
  assert.equal(ask.quote(voucher, { start: `${day(2)}T10:00`, addOns: [{ articleRef: `option:${ids.board}`, qty: 1 }] }).code, 'ADDON_NOT_OFFERED');
  assert.equal(ask.quote(voucher, { start: `${day(2)}T10:00`, extraMinutes: 30 }).code, 'SESSION_STEP');
  assert.equal(ask.quote(voucher, { start: 'lundi 10h' }).code, 'SLOT_INVALID');
  assert.equal(ask.quote(voucher, { start: `${day(-3)}T10:00` }).code, 'SLOT_TAKEN', 'a past slot is not free');
  const beyond = ask.quote(voucher, { start: '2027-03-01T10:00' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual([beyond.code, beyond.message], ['BEYOND_HORIZON', 'Réservable jusqu’au 15 février 2027.']);
});

test('nothing due: the confirmation books at once — the booking, the sale at the engine\'s lines paid by the voucher\'s prepaid tender, the voucher settled whole, the terms recorded, the mail sent', async () => {
  const voucher = dayVoucher();
  const before = { bookings: count('resource_bookings'), sales: count('standalone_sales') };
  const { ok, data } = await ask.confirm(voucher, { start: `${day(3)}T10:00` });
  assert.equal(ok, true, JSON.stringify(data));
  assert.deepEqual([data.booked, data.date, data.start, data.end], [true, day(3), '10:00', '12:00']);
  assert.deepEqual([count('resource_bookings'), count('standalone_sales')], [before.bookings + 1, before.sales + 1]);
  const row = db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(data.bookingId);
  assert.deepEqual([row.reservationId, row.date, row.startTime, row.endTime, row.clientName, row.clientPhone], [null, day(3), '10:00', '12:00', 'Léa Martin', '06 12 34 56 78']);
  const document = standaloneSale.documentOf(Number(row.saleRef.split(':')[1]));
  assert.deepEqual(document.lines.map((l) => [l.label, l.totalCents, l.status]), [['Bain nordique', 9500, 'paid'], ['Planche apéro', 1400, 'paid']]);
  assert.deepEqual([document.totals.totalCents, document.totals.paidCents, document.totals.remainingCents], [10900, 10900, 0]);
  const [payment] = standaloneSale.paymentsOf(Number(row.saleRef.split(':')[1]));
  assert.deepEqual(payment.tenders.map((t) => [t.method, t.source, t.label, t.ref, t.amountCents]), [['prepaid', 'giftVoucher', 'Bon cadeau', api.vouchers.find(voucher.id).number, 10900]]);
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 0);
  assert.deepEqual(movementKinds(voucher).slice(-3), ['hold', 'release', 'redeem']);
  assert.deepEqual(api.uses.bookedOf(voucher.id).bookingId, data.bookingId);
  assert.deepEqual(offerOfBath.accepted.slice(-1).map((a) => [a.activity, a.subjectType, a.subjectRef, a.channel, a.versionId]), [['resource', 'outsideBooking', data.bookingId, 'mon-bain', 9]]);
  await new Promise((resolve) => { setImmediate(resolve); });
  const mail = sent.slice(-1)[0];
  assert.equal(mail.to, 'lea@example.test');
  assert.match(mail.subject, /Votre séance du 19\/11\/2026 est réservée/);
  [`jeudi 19 novembre 2026, de 10:00 à 12:00`, '12 chemin du Lac, 46330 Saint-Cirq-Lapopie', 'Planche apéro', 'Rien d’autre à payer'].forEach((needle) => assert.ok(mail.text.includes(needle), needle));
  assert.deepEqual([ask.open(voucher).code, ask.open(voucher).message], ['VOUCHER_EXHAUSTED', `Ce bon a déjà été utilisé le ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date(api.uses.bookedOf(voucher.id).settledAt))}.`]);
});

test('the confirmation is one transaction: a booking refused at the last step leaves no use, no hold, no booking, no sale and the voucher untouched', async () => {
  const voucher = dayVoucher();
  const before = { bookings: count('resource_bookings'), sales: count('standalone_sales'), uses: count('gift_voucher_uses'), movements: movementKinds(voucher) };
  hook = { ...offerOfBath.offer, bookOutside: () => ({ ok: false, code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre.' }) };
  try {
    const refused = await ask.confirm(voucher, { start: `${day(4)}T10:00` });
    assert.deepEqual([refused.ok, refused.code], [false, 'SLOT_TAKEN']);
  } finally { hook = offerOfBath.offer; }
  assert.deepEqual([count('resource_bookings'), count('standalone_sales'), count('gift_voucher_uses'), movementKinds(voucher)], [before.bookings, before.sales, before.uses, before.movements]);
  hook = { ...offerOfBath.offer, bookOutside: (args) => { offerOfBath.offer.bookOutside(args); throw new Error('boom after the booking'); } };
  try {
    await assert.rejects(ask.confirm(voucher, { start: `${day(4)}T10:00` }), /boom/);
  } finally { hook = offerOfBath.offer; }
  assert.deepEqual([count('resource_bookings'), count('standalone_sales'), count('gift_voucher_uses'), movementKinds(voucher)], [before.bookings, before.sales, before.uses, before.movements], 'the booking written before the failure is rolled back with the rest');
  assert.equal(api.vouchers.find(voucher.id).balanceCents, api.vouchers.find(voucher.id).amountCents);
});

test('the terms of the activity are required, and a refusal holds nothing', async () => {
  const voucher = dayVoucher();
  const before = [count('gift_voucher_uses'), movementKinds(voucher)];
  const missing = await ask.confirm(voucher, { start: `${day(4)}T12:00`, termsVersionId: undefined });
  assert.deepEqual([missing.ok, missing.code], [false, 'TERMS_NOT_ACCEPTED']);
  assert.equal((await ask.confirm(voucher, { start: `${day(4)}T12:00`, termsVersionId: 3 })).code, 'TERMS_OUTDATED');
  assert.equal((await ask.confirm(voucher, { start: `${day(4)}T12:00`, email: 'pas-un-mail' })).code, 'EMAIL_INVALID');
  assert.equal((await ask.confirm(voucher, { start: `${day(4)}T12:00`, phone: 'abc' })).code, 'PHONE_INVALID');
  assert.deepEqual([count('gift_voucher_uses'), movementKinds(voucher)], before);
});

test('a remainder due: before the bank confirms, nothing is booked — no booking row, no sale, no settle — but the slot and the voucher are held, and a payment link of 15 minutes is minted', async () => {
  const voucher = dayVoucher();
  const before = { bookings: count('resource_bookings'), sales: count('standalone_sales') };
  const answer = await ask.confirm(voucher, { start: `${day(5)}T18:00` });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual([answer.data.payUrl, answer.data.dueCents, answer.data.heldUntil], [`https://pay.example.test/use/${links.minted.length}`, 1800, new Date(clock.at.getTime() + 15 * 60 * 1000).toISOString()]);
  assert.deepEqual([count('resource_bookings'), count('standalone_sales')], [before.bookings, before.sales], 'nothing is booked before the bank confirms');
  assert.equal(movementKinds(voucher).includes('redeem'), false, 'no settle movement');
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 0, 'the voucher is held');
  const minted = links.minted.slice(-1)[0];
  assert.deepEqual([minted.sale.source, minted.sale.amountCents, minted.sale.validityMinutes], ['giftVoucherUse', 1800, 15]);
  const held = api.uses.heldOf(voucher.id)[0];
  assert.deepEqual([held.state, held.holdRef, held.dueCents, held.linkId], ['held', `voucher-use:${held.id}`, 1800, links.minted.length]);
});

test('the hold blocks the slot in every availability read: « Mon bain », the planning, the outside slots, the guest app\'s occupancy and any other booking', async () => {
  const voucher = dayVoucher();
  const date = day(6);
  const answer = await ask.confirm(voucher, { start: `${date}T17:00`, extraMinutes: 60 });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const taken = (minutes) => slotStarts(voucher, date, minutes);
  assert.deepEqual(taken(120).filter((s) => ['16:00', '17:00', '18:00', '19:00', '20:00'].includes(s)), ['20:00'], 'a 2 h session may not overlap 17:00–20:00');
  assert.deepEqual(offerOfBath.bookings.listForResource({ resourceId: ids.bath, date }).filter((e) => e.held).map((e) => [e.startTime, e.endTime]), [['17:00', '20:00']]);
  assert.deepEqual(offerOfBath.bookings.getOccupiedSlots(ids.bath, date).map((s) => [s.startTime, s.endTime]), [['17:00', '20:00']]);
  assert.equal(offerOfBath.occupancy.listForStay({ resourceId: ids.bath, startDate: date, endDate: date }).filter((o) => o.kind === 'hold' && o.date === date).length, 1);
  assert.equal(offerOfBath.bookings.createBooking({
    resourceId: ids.bath, date, startTime: '18:00', endTime: '19:00', clientName: 'Un autre',
  }).status, 409);
  const other = dayVoucher();
  assert.equal(ask.quote(other, { start: `${date}T18:00` }).code, 'SLOT_TAKEN');
});

test('paid on time: the bank\'s word books the session and settles the voucher in one transaction — the voucher part by its prepaid tender, the remainder by card', async () => {
  const voucher = dayVoucher();
  const answer = await ask.confirm(voucher, { start: `${day(7)}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  const before = { bookings: count('resource_bookings'), sales: count('standalone_sales') };
  const effect = api.useService.paid({ ref: String(use.id), linkId: 41, amountCents: answer.data.dueCents });
  assert.deepEqual(effect, { effect: 'bath-booked' });
  assert.deepEqual([count('resource_bookings'), count('standalone_sales')], [before.bookings + 1, before.sales + 1]);
  const booked = useRow(use.id);
  assert.equal(booked.state, 'booked');
  const payment = standaloneSale.paymentsOf(booked.saleId);
  assert.deepEqual(payment.map((p) => p.tenders.map((t) => [t.method, t.amountCents])), [[['prepaid', 10900]], [['card', 1800]]]);
  const document = standaloneSale.documentOf(booked.saleId);
  assert.deepEqual([document.totals.totalCents, document.totals.paidCents, document.totals.remainingCents], [12700, 12700, 0]);
  assert.deepEqual(document.lines.map((l) => [l.label, l.totalCents]), [['Bain nordique', 11300], ['Planche apéro', 1400]]);
  assert.deepEqual(movementKinds(voucher).slice(-3), ['hold', 'release', 'redeem']);
  assert.equal(use.holdRef && use.holdRef.length > 0, true);
  assert.ok(use.holdRef && use.holdRef.startsWith('voucher-use:'));
  assert.ok(db.prepare('SELECT releasedAt FROM resource_booking_holds WHERE ref = ?').get(use.holdRef).releasedAt, 'the hold is consumed by the booking');
  assert.deepEqual(api.useService.paid({ ref: String(use.id), linkId: 41, amountCents: 1800 }), { effect: 'bath-already-booked' }, 'a second word of the bank books nothing more');
  assert.equal(count('resource_bookings'), before.bookings + 1);
});

test('the 15 minutes end unpaid: the job frees the slot and the voucher, withdraws the link, books nothing', async () => {
  const voucher = dayVoucher();
  const date = day(8);
  await ask.confirm(voucher, { start: `${date}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  assert.equal(api.useService.lapseDue(), 0, 'still inside the 15 minutes');
  const before = count('resource_bookings');
  clock.at = new Date(clock.at.getTime() + 16 * 60 * 1000);
  use_.lapse(use.holdRef);
  try {
    assert.ok(api.lapseUses() >= 1, 'every use past its 15 minutes is lapsed, this one included');
  } finally { clock.at = new Date(clock.at.getTime() - 16 * 60 * 1000); }
  assert.equal(useRow(use.id).state, 'lapsed');
  assert.deepEqual(movementKinds(voucher).slice(-2), ['hold', 'release']);
  assert.equal(api.vouchers.find(voucher.id).balanceCents, api.vouchers.find(voucher.id).amountCents, 'the voucher is whole again');
  assert.equal(slotStarts(voucher, date, 120).includes('18:00'), true, 'the slot is free again');
  assert.equal(count('resource_bookings'), before);
  assert.ok(links.withdrawn.includes(use.linkId));
  assert.equal(ask.quote(voucher, { start: `${date}T18:00` }).ok, true);
});
const use_ = { lapse: (ref) => use.lapseHold(ref) };

test('paid after the lapse on a slot taken meanwhile: a refund line on the payment, no booking, the voucher intact', async () => {
  const voucher = dayVoucher();
  const date = day(9);
  await ask.confirm(voucher, { start: `${date}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  clock.at = new Date(clock.at.getTime() + 16 * 60 * 1000);
  use_.lapse(use.holdRef);
  api.lapseUses();
  clock.at = new Date(clock.at.getTime() - 16 * 60 * 1000);
  const taker = offerOfBath.bookings.createBooking({
    resourceId: ids.bath, date, startTime: '18:00', endTime: '19:00', clientName: 'Arrivé avant',
  });
  assert.equal(taker.ok, true);
  const before = count('resource_bookings');
  const effect = api.useService.paid({ ref: String(use.id), linkId: 42, amountCents: 1800 });
  assert.deepEqual([effect.refundOwed, effect.reason], [true, 'créneau pris entre-temps']);
  assert.equal(count('resource_bookings'), before, 'no booking');
  assert.equal(api.vouchers.find(voucher.id).balanceCents, api.vouchers.find(voucher.id).amountCents, 'the voucher is intact');
  assert.equal(movementKinds(voucher).includes('redeem'), false);
  assert.equal(useRow(use.id).state, 'refund_owed');
  assert.deepEqual(api.useService.paid({ ref: String(use.id), linkId: 42, amountCents: 1800 }).refundOwed, true, 'told twice, owed once: the same answer');
});

test('paid after the lapse on a slot still free: the booking is made and the voucher settled', async () => {
  const voucher = dayVoucher();
  const date = day(10);
  await ask.confirm(voucher, { start: `${date}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  clock.at = new Date(clock.at.getTime() + 16 * 60 * 1000);
  use_.lapse(use.holdRef);
  api.lapseUses();
  clock.at = new Date(clock.at.getTime() - 16 * 60 * 1000);
  assert.equal(api.vouchers.find(voucher.id).balanceCents, api.vouchers.find(voucher.id).amountCents);
  const effect = api.useService.paid({ ref: String(use.id), linkId: 43, amountCents: 1800 });
  assert.deepEqual(effect, { effect: 'bath-booked' });
  assert.equal(useRow(use.id).state, 'booked');
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 0);
  assert.deepEqual(movementKinds(voucher).filter((k) => k === 'redeem'), ['redeem']);
});

test('paid after the lapse, the voucher used elsewhere meanwhile: the money is owed back, the other use is untouched', async () => {
  const voucher = dayVoucher();
  await ask.confirm(voucher, { start: `${day(11)}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  clock.at = new Date(clock.at.getTime() + 16 * 60 * 1000);
  use_.lapse(use.holdRef);
  api.lapseUses();
  clock.at = new Date(clock.at.getTime() - 16 * 60 * 1000);
  const second = await ask.confirm(voucher, { start: `${day(12)}T10:00` });
  assert.equal(second.ok, true, JSON.stringify(second));
  const effect = api.useService.paid({ ref: String(use.id), linkId: 44, amountCents: 1800 });
  assert.deepEqual([effect.refundOwed, effect.reason], [true, 'bon cadeau déjà utilisé']);
  assert.equal(api.uses.bookedOf(voucher.id).bookingId, second.data.bookingId);
});

test('a payment of another amount than the remainder is owed back, never booked', async () => {
  const voucher = dayVoucher();
  await ask.confirm(voucher, { start: `${day(13)}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  const before = count('resource_bookings');
  assert.equal(api.useService.paid({ ref: String(use.id), linkId: 45, amountCents: 1000 }).refundOwed, true);
  assert.equal(count('resource_bookings'), before);
  assert.equal(api.useService.paid({ ref: '99999', linkId: 46, amountCents: 1800 }).refundOwed, true);
});

test('a second confirmation of the same voucher replaces the pending one: one hold on the voucher, the first slot freed', async () => {
  const voucher = dayVoucher();
  const date = day(14);
  const first = await ask.confirm(voucher, { start: `${date}T18:00` });
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await ask.confirm(voucher, { start: `${day(17)}T18:00` });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(api.uses.listByVoucher(voucher.id).map((u) => u.state), ['lapsed', 'held']);
  assert.equal(slotStarts(voucher, date, 120).includes('18:00'), true, 'the first slot is free again');
  assert.equal(slotStarts(voucher, day(17), 120).includes('18:00'), false, 'the second is held');
  assert.equal(movementKinds(voucher).filter((k) => k === 'hold').length - movementKinds(voucher).filter((k) => k === 'release').length, 1, 'one hold stays open');
});

test('cancelling a voucher ends its pending use: the slot is free, the link withdrawn', async () => {
  const voucher = dayVoucher();
  const date = day(15);
  await ask.confirm(voucher, { start: `${date}T18:00` });
  const use = api.uses.heldOf(voucher.id)[0];
  api.useService.lapseVoucher(voucher.id);
  assert.equal(useRow(use.id).state, 'lapsed');
  assert.equal(slotStarts(voucher, date, 120).includes('18:00'), true);
  assert.ok(links.withdrawn.includes(use.linkId));
});

test('specs/gift-voucher-campaigns.md rules 14, 45 — an evening voucher booked in the evening has nothing due; a day voucher run into the evening pays the supplement of rule 45, the added time continuing its ranks', async () => {
  const voucher = eveningVoucher();
  const quote = ask.quote(voucher, { start: `${day(16)}T19:00` });
  assert.deepEqual([quote.data.supplement, quote.data.dueCents], [null, 0]);
  assert.equal(ask.quote(voucher, { start: `${day(16)}T17:00` }).code, 'SLOT_TAKEN', 'a day start is not offered to an evening voucher');
  const booked = await ask.confirm(voucher, { start: `${day(16)}T19:00` });
  assert.equal(booked.ok, true, JSON.stringify(booked));
  const document = standaloneSale.documentOf(Number(db.prepare('SELECT saleRef FROM resource_bookings WHERE id = ?').get(booked.data.bookingId).saleRef.split(':')[1]));
  assert.deepEqual([document.totals.totalCents, document.totals.paidCents], [13300, 13300], '70 + 63 = 133 € at the evening rate, with the rank of each hour');
});

test('the public routes: the code travels in the body of a POST, never in a URL; the first read and the confirmation ask for the proof of work', async () => {
  const server = await fx.serve(api);
  try {
    const voucher = dayVoucher();
    const call = (path, body, ip = '10.0.4.1') => server.call('POST', `/public/v1/gift-vouchers${path}`, body, { 'x-test-ip': ip });
    const proof = (ip) => sale.solvedProof({ ip });
    assert.equal((await server.call('GET', `/public/v1/gift-vouchers/use?code=${voucher.code}`)).status, 404);
    assert.equal((await call('/use', { code: voucher.code })).status, 403, 'no proof, no reading');
    const opened = await call('/use', { code: voucher.code, ...proof('10.0.4.1') });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.data.kind, 'resource');
    const slots = await call('/use/slots', { code: voucher.code, from: day(20), to: day(20) });
    assert.equal(slots.status, 200);
    assert.ok(slots.body.data.days[0].slots.length > 0);
    const quoted = await call('/use/quote', { code: voucher.code, start: `${day(20)}T10:00` });
    assert.equal(quoted.body.data.dueCents, 0);
    assert.equal((await call('/use/confirm', {
      code: voucher.code, start: `${day(20)}T10:00`, email: 'lea@example.test', phone: '0612345678', termsVersionId: 9,
    })).status, 403, 'the confirmation asks for the proof too');
    const confirmed = await call('/use/confirm', {
      code: voucher.code, start: `${day(20)}T10:00`, email: 'lea@example.test', phone: '0612345678', termsVersionId: 9, ...proof('10.0.4.1'),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.booked, true);
    assert.equal((await call('/use/slots', { code: 12, from: day(20), to: day(20) })).status, 400);
    const used = await call('/use/quote', { code: voucher.code, start: `${day(21)}T10:00` });
    assert.equal(used.status, 409);
    assert.match(used.body.error ? JSON.stringify(used.body) : '', /déjà été utilisé/);
  } finally {
    await server.close();
  }
});

test('rule 15: an option marked « non pris » at the arrival is traced on the voucher through the generic callback, and its detail says « Écart non utilisé »; nothing is kept as a balance', async () => {
  createContext('gift-vouchers', {}).prepaid({
    source: 'giftVoucher',
    label: 'Bon cadeau',
    apply: (args) => api.redemption.apply(args),
    held: () => null,
    settle: () => null,
    release: () => {},
    unused: (args) => api.useService.traceUnused(args),
    includedTitle: 'Compris dans le bon cadeau',
    paidMark: 'Réglé par bon',
  });
  const voucher = dayVoucher();
  const booked = await ask.confirm(voucher, { start: `${day(18)}T10:00` });
  assert.equal(booked.ok, true, JSON.stringify(booked));
  const number = api.vouchers.find(voucher.id).number;
  assert.equal(prepaidSources.unusedFor('giftVoucher', { ref: number, label: 'Planche apéro', valueCents: 1400 }), true);
  assert.deepEqual(api.unused.listByVoucher(voucher.id).map((r) => [r.label, r.valueCents]), [['Planche apéro', 1400]]);
  assert.equal(api.vouchers.find(voucher.id).balanceCents, 0, 'no balance kept');
  const server = await fx.serve(api);
  try {
    const detail = (await server.call('GET', `/api/gift-vouchers/${voucher.id}`)).body;
    assert.deepEqual([detail.unusedCents, detail.unused.map((u) => [u.label, u.valueCents])], [1400, [['Planche apéro', 1400]]]);
    assert.deepEqual([detail.bath.bookingId, detail.bath.date, detail.bath.startTime], [booked.data.bookingId, day(18), '10:00']);
  } finally {
    await server.close();
  }
  assert.equal(prepaidSources.unusedFor('giftVoucher', { ref: 'BC-0000-0000', label: 'x', valueCents: 1 }), true, 'a number that names no voucher is told and ignored');
  assert.equal(api.unused.listByVoucher(voucher.id).length, 1);
});
