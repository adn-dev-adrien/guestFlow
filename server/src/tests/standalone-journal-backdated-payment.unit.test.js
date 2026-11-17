// specs/pricing-components.md rule 62 (reading of loop t5 B5-1) and rule 99; specs/outside-booking-sas.md rules 30, 57 (a) — the journal of a counter document cuts
// each (class, rate) group's VAT on its cumulative TTC in the order the money was RECORDED: a payment recorded today and dated before an earlier payment
// day books its own day and never re-cuts an entry written before it, so a month already exported does not move. Second half: the reviewer's multi-day
// fuzz, bounded — after every step no past day but the one a back-dated payment lands on changes, and each group's VAT is still one cut on its TTC.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const standaloneSales = require('../utils/standaloneSales');
const { groupVatCents } = require('../utils/pricing/vat');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const DAY = 86400000;
const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const BEER = option('Bière datée', 6.5, 'drinks');
const ARTICLES = [BEER, option('Planche datée', 14, 'catering'), option('Souvenir daté', 4.5, 'options'), option('Séance datée', 7.3, 'resources')];
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);
sales.setExternalRate('options', 20);
sales.setExternalRate('resources', 5.5);

const entriesOf = (id) => standaloneSales.list({ from: '2000-01-01', to: '2100-12-31' }) // date-literal-ok: a window wide enough for every day the clock reaches
  .filter((s) => String(s.key).startsWith(`standalone:${id}:`));

// Ten in the morning, Paris time, of the day the clock starts on.
const morning = () => new Date(`${todayIso()}T10:00:00`).getTime();

test('B5-1 — a payment dated before an earlier payment day books its day; the later day already exported keeps its VAT', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: morning() });
  const start = todayIso();
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${BEER}`, quantity: 3 }], payment: { tenders: [{ method: 'card', amountCents: 650 }], shortfall: { kind: 'due' } } });
  assert.equal(sold.status, 200);
  const id = sold.document.document.id;
  t.mock.timers.setTime(Date.now() + 30 * DAY);
  const second = todayIso();
  assert.equal(standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 650 }], shortfall: { kind: 'due' } }).status, 200);
  const exported = entriesOf(id).map((e) => [e.date, e.groups.map((g) => g.vatCents)]);
  assert.deepEqual(exported, [[start, [108]], [second, [109]]]);

  t.mock.timers.setTime(Date.now() + 36 * DAY);
  const backDay = addDaysToIsoDate(start, 15);
  assert.equal(standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 650 }], paidAt: backDay }).status, 200);
  const after = entriesOf(id).map((e) => [e.date, e.groups.map((g) => g.vatCents)]);
  // Before: the later day was re-cut to 108 — a month nobody touched, already exported, moved by a cent.
  assert.deepEqual(after, [[start, [108]], [backDay, [108]], [second, [109]]]);
  assert.equal(after.reduce((sum, [, vat]) => sum + vat[0], 0), groupVatCents(1950, 20), 'the document still books one cut on its whole TTC');
  t.mock.timers.reset();
});

test('B5-1 — a refund recorded before a back-dated payment keeps its avoir: the order of writing, not the days, decides', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: morning() });
  const start = todayIso();
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${BEER}`, quantity: 3 }], payment: { tenders: [{ method: 'card', amountCents: 1950 }] } });
  const id = sold.document.document.id;
  t.mock.timers.setTime(Date.now() + 10 * DAY);
  const version = standaloneSale.documentOf(id).document.version;
  const line = standaloneSale.documentOf(id).lines[0];
  const asked = standaloneSale.offerLine(id, line.id, { offered: true, confirmRefund: true, version });
  assert.equal(asked.status, 200);
  const row = sales.obligationsOf(id)[0];
  assert.equal(links.closeObligation(id, row.id, 'settled').status, 200);
  const avoirDay = todayIso();
  const before = entriesOf(id).map((e) => [e.key, e.booksCents, e.groups]);
  // A late link dated before the avoir: it books on its day, the avoir of a day already written stays as it was.
  t.mock.timers.setTime(Date.now() + 20 * DAY);
  standaloneSale.sell({ saleId: id, version: standaloneSale.documentOf(id).document.version, lines: [{ articleRef: `option:${BEER}`, quantity: 1 }] });
  assert.equal(standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 650 }], paidAt: addDaysToIsoDate(start, 5) }).status, 200);
  const kept = entriesOf(id).filter((e) => e.date === start || e.date === avoirDay).map((e) => [e.key, e.booksCents, e.groups]);
  assert.deepEqual(kept, before);
  t.mock.timers.reset();
});

// The reviewer's round-5 fuzz, bounded: random lives of a document over several days and four groups — sales, partial and back-dated payments, late
// links, lines offered with their refund row, rows refunded or kept, day changes.
test('B5-1 fuzz — no past day but the back-dated one is ever rewritten; every group books one cut on its TTC', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: morning() });
  let seed = 515;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const row = (e) => JSON.stringify([e.key, e.booksCents, e.totalCents, e.groups]);
  let backDated = 0;
  for (let run = 0; run < 25; run += 1) {
    const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${pick(ARTICLES)}`, quantity: 2 }, { articleRef: `option:${pick(ARTICLES)}`, quantity: 1 }] });
    assert.equal(sold.status, 200);
    const id = sold.document.document.id;
    const trail = [];
    let snapshot = { today: todayIso(), all: entriesOf(id) };
    for (let step = 0; step < 20; step += 1) {
      const doc = standaloneSale.documentOf(id);
      const { version } = doc.document;
      const r = rnd();
      let landed = null;
      if (r < 0.15) {
        t.mock.timers.setTime(Date.now() + (1 + Math.floor(rnd() * 20)) * DAY);
        trail.push(`+day ${todayIso()}`);
      } else if (r < 0.3) {
        const lines = [{ articleRef: `option:${pick(ARTICLES)}`, quantity: 1 + Math.floor(rnd() * 3) }];
        trail.push('sell');
        assert.equal(standaloneSale.sell({ saleId: id, version, lines }).status, 200, trail.join(' → '));
      } else if (r < 0.6 && doc.totals.remainingCents > 0) {
        const due = doc.totals.remainingCents;
        const part = rnd() < 0.4 ? Math.max(1, Math.floor(due * rnd())) : due;
        landed = rnd() < 0.35 ? addDaysToIsoDate(todayIso(), -(1 + Math.floor(rnd() * 40))) : null;
        trail.push(`pay ${part}${landed ? ` dated ${landed}` : ''}`);
        const res = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: part }], ...(part < due ? { shortfall: { kind: 'due' } } : {}), ...(landed ? { paidAt: landed } : {}), version });
        assert.equal(res.status, 200, trail.join(' → '));
      } else if (r < 0.7) {
        const amountCents = 100 + Math.floor(rnd() * 1500);
        landed = rnd() < 0.3 ? addDaysToIsoDate(todayIso(), -(1 + Math.floor(rnd() * 40))) : todayIso();
        const link = Number(db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status) VALUES (NULL, ?, 'complement', ?, 'paid')")
          .run(sales.documentRef(id), amountCents).lastInsertRowid);
        trail.push(`link ${amountCents} dated ${landed}`);
        links.settlePaidLink({ link: { id: link, saleRef: sales.documentRef(id), amountCents }, paidDate: landed });
      } else if (r < 0.85) {
        const open = sales.obligationsOf(id);
        if (open.length) {
          const obligation = pick(open);
          const status = rnd() < 0.5 ? 'settled' : 'cancelled';
          trail.push(`close ${obligation.origin} ${status}`);
          assert.equal(links.closeObligation(id, obligation.id, status).status, 200, trail.join(' → '));
        }
      } else {
        const paid = doc.lines.filter((l) => l.id && l.status === 'paid');
        if (paid.length) {
          trail.push('offer a paid line');
          standaloneSale.offerLine(id, pick(paid).id, { offered: true, confirmRefund: true, version });
        }
      }
      if (landed && landed < snapshot.today) backDated += 1;
      const all = entriesOf(id);
      const keep = (e) => e.date < snapshot.today && e.date !== landed;
      assert.deepEqual(all.filter(keep).map(row), snapshot.all.filter(keep).map(row), `a past day moved after ${trail.join(' → ')}`);
      const net = new Map();
      for (const e of all.filter((x) => x.role !== 'tip')) {
        const sign = e.role === 'refund' ? -1 : 1;
        for (const g of e.groups) {
          const key = `${g.vatClass}|${g.rate}`;
          const sum = net.get(key) || { rate: g.rate, ttc: 0, vat: 0 };
          sum.ttc += sign * g.ttcCents;
          sum.vat += sign * g.vatCents;
          net.set(key, sum);
        }
      }
      for (const [key, sum] of net) assert.equal(sum.vat, groupVatCents(sum.ttc, sum.rate), `${key} after ${trail.join(' → ')}`);
      snapshot = { today: todayIso(), all };
    }
  }
  assert.ok(backDated >= 20, `the fuzz back-dated ${backDated} payments`);
  t.mock.timers.reset();
});
