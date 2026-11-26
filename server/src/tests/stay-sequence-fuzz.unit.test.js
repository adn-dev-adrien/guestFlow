// specs/pricing/pricing-components.md §3 rules 104, 108, 116, 119, 121 (stabilisation loop t9, B9-2..B9-5, 2026-11-16) — the reviewer's stay sequence
// fuzzer, bounded: random gestures on one stay (before the arrival: discounts, offers, un-offers, unpaid sales, fiche offers, refunds as the
// ledger row proposes, refund deletions; then the complement collected and the check-in; in the stay: card and cash notes too) and, after
// EVERY step, the money identity received − refunded − owed + asked = price + tax, and never « asked AND owed » at once. Direct and Booking,
// fixed seeds (a linear congruential generator): the same sequences on every run.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./stayIdentityFixtures');

const plank = F.option('Planche fuzz', 20);
const jam = F.option('Confiture fuzz', 15);
const ARTICLES = [F.beer, plank, jam];
const RUNS = 12;
const STEPS = 12;

function run(platform, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const failures = [];
  for (let r = 0; r < RUNS; r += 1) {
    const id = F.paidStay(platform);
    const log = [];
    let day = -3; let hour = 9; let inStay = false;
    for (let step = 0; step < STEPS; step += 1) {
      hour += 1; if (hour > 21) { hour = 9; day += 1; }
      if (!inStay && (day >= 0 || rnd() < 0.15)) {
        const row = F.row(id);
        if (F.cents(row.complementAmount) > 0 && !row.complementPaid && !row.complementPaidCash) {
          const cash = rnd() < 0.3;
          F.pay(id, cash ? { complementPaidCash: true, complementPaidDate: F.todayIso() } : { complementPaid: true, complementPaidDate: F.todayIso() });
          log.push(`collect ${cash ? 'cash' : 'card'}`);
        }
        F.pay(id, { checkInDone: true });
        inStay = true; day = Math.max(day, 1); hour = 9; log.push('check-in');
        continue;
      }
      const ops = inStay ? ['noteCard', 'noteCash', 'unpaid', 'offer', 'unoffer', 'discount', 'refund', 'refund', 'delref', 'ficheOffer', 'ficheUnoffer']
        : ['discount', 'offer', 'unpaid', 'refund', 'delref', 'unoffer', 'ficheOffer'];
      const op = pick(ops); const article = pick(ARTICLES);
      const now = F.at(id, day, `${String(hour).padStart(2, '0')}:${String(Math.floor(rnd() * 50) + 5).padStart(2, '0')}`);
      let outcome = '';
      if (op === 'noteCard' || op === 'noteCash') outcome = F.sell(id, article, 1 + Math.floor(rnd() * 2), now, op === 'noteCard' ? 'card' : 'cash').status;
      else if (op === 'unpaid') outcome = F.sell(id, article, 1, now).status;
      else if (op === 'offer' || op === 'unoffer' || op === 'discount') {
        if (!F.lineRef(id, article, now)) outcome = 'noline';
        else outcome = F.change(id, article, op === 'offer' ? { offered: true } : op === 'unoffer' ? { offered: false } : { discount: { amount: pick([4, 6, 10]) } }, now).final.status;
      } else if (op === 'ficheOffer' || op === 'ficheUnoffer') {
        outcome = F.fiche(id, (options) => options.map((o) => (Number(o.optionId) === article ? { ...o, offered: op === 'ficheOffer' } : o)), now).final.status;
      } else if (op === 'refund') outcome = F.refundAsProposed(id).map((x) => x.statusCode).join(',') || 'none';
      else if (op === 'delref') { const ids = F.refundIds(id); outcome = ids.length ? F.deleteRefund(id, ids[ids.length - 1]).statusCode : 'none'; }
      const money = F.identity(id);
      log.push(`d${day} ${op} ${article} → ${outcome} | ${JSON.stringify(money)}`);
      if (money.gap !== 0 || (money.owed > 0 && money.asked > 0)) {
        failures.push(`run ${r}:\n  ${log.join('\n  ')}`);
        break;
      }
    }
  }
  return failures;
}

for (const [platform, seed] of [['direct', 1], ['direct', 2], ['direct', 3], ['Booking', 1], ['Booking', 2]]) {
  test(`stay sequence fuzz — ${platform}, seed ${seed}, ${RUNS} runs × ${STEPS} steps: the identity holds and nothing is asked and owed at once`, () => {
    const failures = run(platform, seed);
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}
