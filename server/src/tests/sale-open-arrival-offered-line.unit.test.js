// specs/pricing-components.md §3 rule 102 d as completed by rule 103 (stabilisation loop t3, T3-2, 2026-11-16) — at an open arrival (the check-in hour
// passed, the arrival not validated, its complement not collected) an unpaid arrival line offered at the door by mistake is billed again, discounted
// and removed there: every gesture answers 200 and the arrival complement follows (45 → 0 → 45 → 35 → 0 → 35 → 0). Stays booked 20 days ahead
// (`saleRound1Fixtures`, check-in 15:00).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const money = (id) => [Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)];

function soldBeforeArrival() {
  const id = stay(20);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  return { id, ref: sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref };
}

test('T3-2 — open arrival at 18:00: offer, re-bill, discount, offer, re-bill and remove each answer 200 and the arrival complement follows', () => {
  const { id, ref } = soldBeforeArrival();
  const door = at(id, '18:00');
  const steps = [
    [{ offered: true }, [0, 0]], [{ offered: false }, [4500, 0]], [{ discount: { amount: 10 } }, [3500, 0]],
    [{ offered: true }, [0, 0]], [{ offered: false }, [3500, 0]],
  ];
  for (const [patch, expected] of steps) {
    const changed = extraSale.changeLine(id, ref, patch, { now: door });
    assert.equal(changed.status, 200, `${JSON.stringify(patch)} → ${JSON.stringify(changed.body)}`);
    assert.deepEqual(money(id), expected, JSON.stringify(patch));
  }
  const removed = extraSale.removeLine(id, ref, { now: door });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(money(id), [0, 0]);
});

test('T3-2 — once the arrival is validated, the offered arrival line is frozen again (rule 6 of mid-stay-extras-on-locked-fiche)', () => {
  const { id, ref } = soldBeforeArrival();
  const door = at(id, '18:00');
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: door }).status, 200);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const rebill = extraSale.changeLine(id, ref, { offered: false }, { now: door });
  assert.deepEqual([rebill.status, rebill.body.code], [400, 'ARRIVAL_EXTRAS_FROZEN']);
});
