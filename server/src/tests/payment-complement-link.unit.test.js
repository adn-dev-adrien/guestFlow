// specs/plugins-phase-1-sdk.md rule 47 (first used by specs/guest-app.md rules 35, 36) — the `complement` link type wired end to end for a plugin's basket: minted only
// with an explicit basket, at its exact total and VAT lines, for 30 minutes and never lapsed by the arrival; no reader of
// the stay's own buckets takes it for the stay's complement; its paid effect is the owning plugin's
// (specs/plugins-phase-1-sdk.md rule 47, `ctx.paymentBasket`), money it cannot honour flagged « à rembourser ».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { ensurePaymentLink } = require('../utils/paymentRequestService');
const { buildModel } = require('../models/paymentLinksModel');
const { applyPaidEffect } = require('../utils/paymentPollRunner');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const { staleLinks } = require('../utils/ledgerLinks');
const { buildLedger } = require('../utils/reservationLedger');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, complementAmount)
    VALUES ('reservation', 1, 1, '2099-07-06', '2099-07-09', 2, 300, 50)`).run().lastInsertRowid);
  return { db, id, links: buildModel(db) };
}

function deps(db, links, over = {}) {
  const created = [];
  return {
    created,
    deps: {
      database: db,
      paymentLinksModel: links,
      vatRateFor: () => 10,
      redirectUrl: 'https://sejour.example.test/commande/4',
      now: () => new Date('2099-07-07T10:00:00Z'),
      provider: {
        id: 'qonto',
        createLink: async (args) => {
          created.push(args);
          return { id: `pl_${created.length}`, url: `https://pay.example.test/${created.length}`, status: 'open' };
        },
      },
      ...over,
    },
  };
}

const BASKET = { source: 'shopOrder', ref: 4, title: 'Commande #4', lines: [{ title: 'Cidre', amountCents: 1200 }, { title: 'Bain nordique', amountCents: 3000 }] };

test('rule 35: `complement` is refused without an explicit basket — no provider call', async () => {
  const { db, id, links } = seed();
  const { deps: d, created } = deps(db, links);
  for (const basket of [undefined, {}, { source: 'shopOrder', ref: 4, lines: [] }, { source: 'shopOrder', ref: 4, lines: [{ title: 'x', amountCents: 0 }] }]) {
    await assert.rejects(ensurePaymentLink(d, id, 'complement', { basket }), (e) => e.httpStatus === 400 && e.error === 'BASKET_REQUIRED');
  }
  assert.equal(created.length, 0);
});

test('rule 35: a basket link bills exactly its lines, as a VAT basket, for 30 minutes, back to the order page', async () => {
  const { db, id, links } = seed();
  const { deps: d, created } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  assert.equal(link.type, 'complement');
  assert.equal(link.amountCents, 4200);
  assert.equal(created[0].amountCents, 4200);
  assert.equal(created[0].expectedTotalCents, 4200);
  assert.deepEqual(created[0].items.filter((i) => i.vatRate === 10).map((i) => i.title), ['Cidre', 'Bain nordique']);
  assert.equal(created[0].redirectUrl, 'https://sejour.example.test/commande/4');
  const row = links.findById(link.id);
  assert.deepEqual(JSON.parse(row.basketJson), { source: 'shopOrder', ref: '4' });
  assert.equal(row.expiresAt, '2099-07-07T10:30:00.000Z');
});

test('rules 35, 36: the arrival never lapses it; its 30 minutes do', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  assert.deepEqual(retireLapsedAndWithdrawn(db, { now: new Date('2099-07-07T10:29:00Z'), paymentLinksModel: links }), []);
  const lapsed = retireLapsedAndWithdrawn(db, { now: new Date('2099-07-07T10:31:00Z'), paymentLinksModel: links });
  assert.deepEqual(lapsed.map((l) => [l.id, l.status, l.cancelReason]), [[link.id, 'expired', 'validity']]);
});

test('rule 35: no reader of the stay’s buckets takes a basket link for the stay’s complement', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.deepEqual(staleLinks(links.listForReservation(id), row), [], 'a fiche save never retires it for an amount change');
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = ?').run(id);
  assert.deepEqual(links.retireSettled(), [], 'the arrival complement collected leaves it open');
  assert.equal(links.findById(link.id).status, 'open');
  const ledger = buildLedger({ row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), links: links.listForReservation(id) });
  const complement = ledger.rows.find((r) => r.key === 'complement');
  assert.equal(complement && complement.detail && complement.detail.link, undefined);
});

function liveOwner(paid, labels) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('shop', {}).paymentBasket({ source: 'shopOrder', paid, ...(labels ? { labels } : {}) });
}

test('rules 35, 36: a paid basket link is settled by the live plugin that owns its source', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  links.markPaid(link.id, { providerPaymentId: 'pay_9', paidAt: '2099-07-07T10:05:00Z' });
  const calls = [];
  liveOwner((event) => { calls.push(event); return { effect: 'shop-order-paid' }; });
  try {
    const effect = applyPaidEffect({ database: db, link: links.findById(link.id), paidDate: '2099-07-07', paidAt: '2099-07-07T10:05:00Z' });
    assert.equal(effect.effect, 'shop-order-paid');
    assert.deepEqual(calls, [{
      reservationId: id, ref: '4', linkId: link.id, amountCents: 4200, paidDate: '2099-07-07', paidAt: '2099-07-07T10:05:00Z', providerPaymentId: 'pay_9',
    }]);
    registry.reset();
    registry.configure({ isActive: () => true, allows: () => true });
    assert.equal(applyPaidEffect({ database: db, link: links.findById(link.id), paidDate: '2099-07-07' }).effect, 'basket-unallocated', 'no live owner: the admin sorts it out');
  } finally {
    registry.reset();
  }
});

test('rule 36: money the plugin cannot honour is flagged « à rembourser » on the link and the ledger, with a history entry', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  links.markPaid(link.id, { providerPaymentId: 'pay_9', paidAt: '2099-07-07T10:05:00Z' });
  const refundRow = () => buildLedger({ row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), links: links.listForReservation(id) })
    .rows.find((r) => r.key === 'basketRefunds');
  liveOwner(() => ({ refundOwed: true, reason: 'créneau plus libre' }), { refundOne: 'Commande boutique à rembourser' });
  try {
    assert.equal(applyPaidEffect({ database: db, link: links.findById(link.id), paidDate: '2099-07-07' }).effect, 'basket-refund-owed');
    assert.equal(refundRow().label, 'Commande boutique à rembourser', 'the owner’s own words');
  } finally {
    registry.reset();
  }
  assert.equal(JSON.parse(links.findById(link.id).basketJson).refundOwed, true);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'refundOwed' && c.to.includes('créneau plus libre')));
  assert.deepEqual([refundRow().label, refundRow().amount, refundRow().stateLabel], ['Paiement en ligne à rembourser', 42, 'À rembourser'], 'no owner declared: the core’s neutral words');
});

test('specs/guest-app.md rule 35: an owner that kept part of the money flags only the gap — the ledger row and the history say that part', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  links.markPaid(link.id, { providerPaymentId: 'pay_9', paidAt: '2099-07-07T10:05:00Z' });
  liveOwner(() => ({ effect: 'shop-order-paid', refundOwed: true, refundCents: 600, reason: 'prix baissé' }));
  try {
    assert.equal(applyPaidEffect({ database: db, link: links.findById(link.id), paidDate: '2099-07-07' }).effect, 'basket-refund-owed');
  } finally {
    registry.reset();
  }
  assert.equal(JSON.parse(links.findById(link.id).basketJson).refundCents, 600);
  const row = buildLedger({ row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), links: links.listForReservation(id) })
    .rows.find((r) => r.key === 'basketRefunds');
  assert.equal(row.amount, 6);
  assert.match(row.detail.lines[0], /^6,00.€ à rendre sur 42,00.€ payés/);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'refundOwed' && /^6,00.€ sur 42,00.€ payés .*prix baissé/.test(c.to)), JSON.stringify(history));
});

test('specs/guest-app.md rule 36: a basket paid after its stay was cancelled still reaches its owner — the money flagged « à rembourser », never lost', async () => {
  const { db, id, links } = seed();
  const { deps: d } = deps(db, links);
  const link = await ensurePaymentLink(d, id, 'complement', { basket: BASKET });
  links.markPaid(link.id, { providerPaymentId: 'pay_9', paidAt: '2099-07-07T10:05:00Z' });
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  const calls = [];
  liveOwner((event) => { calls.push(event.ref); return { refundOwed: true, reason: 'séjour annulé' }; });
  try {
    assert.equal(applyPaidEffect({ database: db, link: links.findById(link.id), paidDate: '2099-07-07' }).effect, 'basket-refund-owed');
  } finally {
    registry.reset();
  }
  assert.deepEqual(calls, ['4'], 'the owner settles its order');
  assert.equal(JSON.parse(links.findById(link.id).basketJson).refundOwed, true);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'refundOwed' && c.to.includes('séjour annulé')));
});

test('specs/plugins-phase-1-sdk.md rule 47: `ctx.paymentBasket` needs a source and a paid function, one plugin per source', () => {
  registry.reset();
  try {
    assert.throws(() => createContext('a', {}).paymentBasket({ source: 'shopOrder' }), /needs a paid function/);
    assert.throws(() => createContext('a', {}).paymentBasket({ source: 'Bad source', paid: () => ({}) }), /needs a source/);
    createContext('a', {}).paymentBasket({ source: 'shopOrder', paid: () => ({}) });
    assert.throws(() => createContext('b', {}).paymentBasket({ source: 'shopOrder', paid: () => ({}) }), /already declared by a/);
    assert.throws(() => createContext('c', {}).paymentBasket({ source: 'other', paid: () => ({}), labels: { refundOne: '' } }), /labels/);
  } finally {
    registry.reset();
  }
});
