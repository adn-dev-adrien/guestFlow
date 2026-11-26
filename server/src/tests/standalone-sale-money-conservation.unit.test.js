// specs/sas/outside-booking-sas.md rules 55, 56 (stabilisation loop t4; the reviewer's invariants of round 4) — over many random sequences of what a counter
// document lives through (sales, payments by card or caisse interne, partial payments, lines offered / made payable again / removed, late links, the document
// cancelled, rows refunded or closed « rien à rembourser »), after EVERY step:
//   1. no cent is created or lost: booked money received − booked money given back = journal revenue + tips + booked money still on no line;
//   2. when the invoice may go, the journal nets per (class, rate) exactly the paid lines it states, TTC and VAT cut once per (class, rate) group;
//   3. an open row means money owed, every owed cent sits in a row, and a document « paid » has no line due.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { unallocatedOf } = require('../utils/pricing/settlement');
const { groupVatCents } = require('../utils/pricing/vat');
const { todayIso } = require('../utils/localDate');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const ARTICLES = [option('Bière fuzz', 6.5, 'drinks'), option('Planche fuzz', 14, 'catering'), option('Limonade fuzz', 3.5, 'drinks')];
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
const TODAY = todayIso();

function journalOf(id) {
  const net = new Map();
  let books = 0;
  let tips = 0;
  for (const sale of standaloneSales.list({ from: TODAY, to: TODAY }).filter((s) => String(s.key).startsWith(`standalone:${id}:`))) {
    if (sale.role === 'tip') { tips += sale.booksCents; continue; }
    const sign = sale.role === 'refund' ? -1 : 1;
    books += sign * sale.booksCents;
    for (const g of sale.groups) {
      const key = `${g.vatClass}|${g.rate}`;
      const row = net.get(key) || { ttc: 0, vat: 0 };
      row.ttc += sign * g.ttcCents;
      row.vat += sign * g.vatCents;
      net.set(key, row);
    }
  }
  return { net, books, tips };
}
const shape = (map) => [...map].filter(([, v]) => v.ttc || v.vat).map(([k, v]) => `${k}=${v.ttc}/${v.vat}`).sort().join(' ');

function check(id, trail) {
  const document = standaloneSale.documentOf(id);
  const allocations = db.prepare('SELECT * FROM payment_allocations WHERE documentRef = ?').all(sales.documentRef(id));
  const cashIn = standaloneSale.paymentsOf(id).reduce((sum, p) => sum + p.tenders.filter((t) => !t.internal).reduce((a, t) => a + t.amountCents, 0), 0);
  const givenBack = allocations.filter((a) => a.kind === 'refund' && Number(a.books) === 1).reduce((sum, a) => sum - a.amountCents, 0);
  const journal = journalOf(id);
  const where = `after ${trail.join(' → ')}`;
  assert.equal(cashIn - givenBack, journal.books + journal.tips + unallocatedOf(allocations).bookedCents, `money identity ${where}`);
  const { totals } = document;
  const invoiceable = totals.totalCents > 0 && totals.remainingCents === 0 && totals.refundOwedCents === 0 && totals.internalHeldCents === 0;
  if (invoiceable) {
    const basis = new Map();
    for (const line of document.lines.filter((l) => l.status === 'paid' && l.totalCents > 0)) {
      const key = `${line.vatClass}|${Number(line.vatRate)}`;
      const row = basis.get(key) || { ttc: 0, vat: 0 };
      row.ttc += line.totalCents;
      basis.set(key, row);
    }
    for (const [key, row] of basis) row.vat = groupVatCents(row.ttc, Number(key.split('|')[1]));
    assert.equal(shape(journal.net), shape(basis), `journal = invoice ${where}`);
  }
  const open = sales.obligationsOf(id);
  if (open.length) assert.ok(totals.refundOwedCents > 0, `an open row owes money ${where}`);
  assert.equal(totals.refundUnheldCents, 0, `every owed cent in a row ${where}`);
  if (document.document.status === 'paid') assert.ok(!document.lines.some((l) => l.status === 'due'), `paid with no line due ${where}`);
}

let linkSeq = 0;
function step(id, rnd, trail) {
  const document = standaloneSale.documentOf(id);
  const { version } = document.document;
  const cancelled = document.document.status === 'cancelled';
  const live = document.lines.filter((l) => l.status !== 'cancelled' && l.id);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const roll = rnd();
  const open = sales.obligationsOf(id);
  if (open.length && roll < 0.2) {
    const row = pick(open);
    const status = rnd() < 0.5 ? 'settled' : 'cancelled';
    trail.push(`close ${row.origin} ${row.amountCents} ${status}`);
    assert.equal(links.closeObligation(id, row.id, status).status, 200);
    return;
  }
  if (cancelled) { trail.push('noop'); return; }
  if (roll < 0.35) {
    const article = pick(ARTICLES);
    trail.push(`sell ${article}`);
    standaloneSale.sell({ saleId: id, version, lines: [{ articleRef: `option:${article}`, quantity: 1 + Math.floor(rnd() * 2) }] });
  } else if (roll < 0.5 && document.totals.remainingCents > 0) {
    const due = document.totals.remainingCents;
    const part = rnd() < 0.3 ? Math.max(1, Math.floor(due / 2)) : due;
    const internal = rnd() < 0.25;
    trail.push(`pay ${part}${internal ? ' internal' : ''}`);
    standaloneSale.pay(id, { tenders: [{ method: internal ? 'cash' : 'card', amountCents: part, ...(internal ? { internal: true } : {}) }], ...(part < due ? { shortfall: { kind: 'due' } } : {}), version });
  } else if (roll < 0.65 && live.length) {
    const line = pick(live);
    const offered = line.status !== 'offered';
    trail.push(`${offered ? 'offer' : 'unoffer'} ${line.id}`);
    standaloneSale.offerLine(id, line.id, { offered, confirmRefund: true, version });
  } else if (roll < 0.75 && live.length > 1) {
    const line = pick(live);
    trail.push(`remove ${line.id}`);
    standaloneSale.removeLine(id, line.id, { confirmRefund: true, version });
  } else if (roll < 0.9) {
    const amount = 100 + Math.floor(rnd() * 2000);
    linkSeq += 1;
    const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', ?, 'paid')").run(sales.documentRef(id), amount).lastInsertRowid);
    trail.push(`link ${amount}`);
    links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents: amount }, paidDate: TODAY });
  } else if (roll < 0.95) {
    trail.push('cancel');
    standaloneSale.cancel(id);
  } else {
    trail.push('noop');
  }
}

test('rules 55, 56 — the money of a document is conserved, the books match the invoice and the rows the money owed, after every step of 300 random sequences', () => {
  let seed = 20261116;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let run = 0; run < 300; run += 1) {
    const first = standaloneSale.sell({
      lines: [{ articleRef: `option:${ARTICLES[0]}`, quantity: 2 }, { articleRef: `option:${ARTICLES[1]}`, quantity: 1 }],
      payment: rnd() < 0.5 ? { tenders: [{ method: 'card', amountCents: 2700 }] } : { tenders: [{ method: 'card', amountCents: 1300 }], shortfall: { kind: 'due' } },
    });
    const { id } = first.document.document;
    const trail = [`sale ${id}`];
    check(id, trail);
    for (let k = 0; k < 12; k += 1) {
      step(id, rnd, trail);
      check(id, trail);
    }
    // A finished run leaves the journal window, so each check reads one document (the journal list reads every document that moved money).
    db.prepare('DELETE FROM payment_allocations WHERE documentRef = ?').run(sales.documentRef(id));
    db.prepare('DELETE FROM standalone_sale_payments WHERE saleId = ?').run(id);
  }
});
