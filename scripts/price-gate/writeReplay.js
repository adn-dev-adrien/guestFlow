/**
 * The refund WRITE paths of the price gate (specs/pricing-components.md §3 rules 68 and 81, decision D9).
 *
 * The gate's stays prove what the code READS. PR B changes what refunds, take-backs and nettings WRITE, so this
 * module plays the write paths through the real controllers on an empty in-memory database and returns, per case,
 * every step's HTTP status and canonical body plus the rows left behind (the baseline columns only, so a column PR B
 * adds never counts as a difference):
 *
 *   refund-create            create (line, free line, cash, internal, above the refundable, above the collected), delete, 404
 *   refund-before-payment    a refund dated before the last book payment (400 REFUND_BEFORE_PAYMENT) and the same day
 *   cancel-requalification   the cancellation's retained avoir and indemnity, refunds after it, the deletion refusals
 *   untick-with-refund       a paid solde un-ticked while a refund stands (refused), then after the refund is deleted
 *   pool-d25                 one arrival payment over solde + complement cut by 5 % then by the line removed: the pool, no false trop-perçu
 *   end-of-stay-refund       a refund on a stay that holds a collected end-of-stay complement
 *   overpayment-refund       a refund opened from the stored trop-perçu, over it, twice
 *
 * `playWrites()` is shared: `buildWriteReplay.mjs` runs it on a worktree of the `price-gate-baseline` tag and writes
 * `fixtures/price-gate/writes.json`; `price-gate-writes.unit.test.js` runs it on the current code and compares,
 * exactly. The caller sets `process.env.DB_PATH = ':memory:'` and freezes the clock before requiring this module.
 */
const path = require('node:path');

const serverSrc = path.join(__dirname, '..', '..', 'server', 'src');
const DROPPED = new Set(['createdAt', 'updatedAt']);

/** JSON-safe copy with the volatile keys dropped and every number written as the code returned it. */
function canonical(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => {
    if (DROPPED.has(key)) return undefined;
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (Object.is(v, -0)) return 0;
    return v;
  }));
}

async function playWrites() {
  const print = console.log;
  console.log = () => {};
  try {
    const money = require(path.join(serverSrc, 'tests', 'moneyLedgerFixture.js'));
    const refundsController = require(path.join(serverSrc, 'controllers', 'refundsController.js'));
    const cancellationController = require(path.join(serverSrc, 'controllers', 'reservationCancellationController.js'));
    const {
      db, controller, respond, inDays, rowOf, mark, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, S, D, forced, free, fiche, put, pay, register, storedEndOfStayPaid, ficheView,
    } = money;

    const cents = (euros) => Math.round(Number(euros) * 100);
    const round2 = (n) => Math.round(n * 100) / 100;
    const out = {};

    const call = (handler, req) => {
      const res = respond();
      handler(req, res);
      return res;
    };
    const create = (id, body) => call((req, res) => refundsController.create(req, res), { params: { id }, body: { refundDate: TODAY, method: 'transfer', reason: 'p', ...body } });
    const remove = (id, refundId) => call((req, res) => refundsController.remove(req, res), { params: { id, refundId }, body: {} });
    const cancel = async (id) => {
      const res = respond();
      await cancellationController.cancel({ params: { id }, body: { reason: 't' }, user: ADMIN }, res);
      return res;
    };
    const save = async (stay, over, { force = true } = {}) => {
      stay.body = { ...stay.body, ...over };
      const res = respond();
      await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...(force ? { forceOverpayment: true } : {}) }, user: ADMIN }, res);
      return res;
    };

    const refundRows = (id) => db.prepare('SELECT id, refundDate, method, totalTtc, reason, afterCancellation FROM reservation_refunds WHERE reservationId = ? ORDER BY id').all(id)
      .map((refund) => ({
        ...refund,
        lines: db.prepare('SELECT lineKey, label, bucket, quantity, unitPrice, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id').all(refund.id),
      }));
    const MONEY_COLUMNS = ['kind', 'finalPrice', 'touristTaxTotal', 'depositAmount', 'balanceAmount', 'complementAmount', 'depositPaid', 'balancePaid', 'complementPaid',
      'endOfStayComplementPaid', 'retainedDeposit', 'splitShortfallDue', 'splitWaivedAmount', 'discountPercent'];
    const snapshot = (id) => {
      const row = rowOf(id);
      const reg = register(id);
      return {
        row: Object.fromEntries(MONEY_COLUMNS.filter((c) => c in row).map((c) => [c, row[c]])),
        refunds: refundRows(id),
        history: db.prepare('SELECT eventType FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id).map((h) => h.eventType),
        register: {
          refundableLines: reg.refundableLines, refundTotals: reg.refundTotals, collectedTtc: reg.collectedTtc, refunds: reg.refunds,
        },
        ledger: (ficheView(id).ledger || {}).rows,
      };
    };
    const record = (steps, step, res) => steps.push({ step, status: res.statusCode, body: canonical(res.body) });
    const firstLine = (id) => register(id).refundableLines.find((line) => line.refundableTtc > 0);

    // 1. Create, refusals, deletion.
    {
      const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(80)] });
      pay(stay.id, D, S);
      const steps = [];
      const line = firstLine(stay.id);
      record(steps, 'above the refundable', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc + 1) }] }));
      record(steps, 'half of the first line', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc / 2) }] }));
      record(steps, 'the rest of the line plus a cent', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc / 2 + 0.01) }] }));
      record(steps, 'a free line', create(stay.id, { lines: [{ label: 'Geste', amountTtc: 10, bucket: 'accommodation' }] }));
      record(steps, 'cash', create(stay.id, { method: 'cash', lines: [{ key: line.key, amountTtc: 1 }] }));
      record(steps, 'internal with no caisse money', create(stay.id, { method: 'internal', lines: [{ key: line.key, amountTtc: 1 }] }));
      record(steps, 'no line', create(stay.id, { lines: [] }));
      record(steps, 'unknown method', create(stay.id, { method: 'bitcoin', lines: [{ key: line.key, amountTtc: 1 }] }));
      const first = refundRows(stay.id)[0];
      record(steps, 'delete the first refund', remove(stay.id, first ? first.id : 0));
      record(steps, 'delete an unknown refund', remove(stay.id, 99999));
      out['refund-create'] = { stayId: stay.id, steps, after: snapshot(stay.id) };
    }

    // 2. A refund dated before the last book payment.
    {
      const stay = fiche(WITH_ACOMPTE, 'direct');
      pay(stay.id, D, S);
      const steps = [];
      const line = firstLine(stay.id);
      record(steps, 'the day before the payment', create(stay.id, { refundDate: inDays(-1), lines: [{ key: line.key, amountTtc: 1 }] }));
      record(steps, 'the day of the payment', create(stay.id, { refundDate: TODAY, lines: [{ key: line.key, amountTtc: 1 }] }));
      out['refund-before-payment'] = { stayId: stay.id, steps, after: snapshot(stay.id) };
    }

    // 3. Cancellation: the retained avoir, refunds after it, the deletion refusals.
    {
      const stay = fiche(WITH_ACOMPTE, 'direct');
      pay(stay.id, D, S);
      const steps = [];
      record(steps, 'cancel', await cancel(stay.id));
      const before = snapshot(stay.id);
      const line = firstLine(stay.id);
      record(steps, 'a refund after the cancellation', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc / 2) }] }));
      record(steps, 'above what the cancelled stay offers', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc + 5) }] }));
      const refunds = refundRows(stay.id);
      for (const refund of refunds) record(steps, `delete refund #${refund.id} (${refund.method}, ${refund.totalTtc})`, remove(stay.id, refund.id));
      out['cancel-requalification'] = { stayId: stay.id, steps, afterCancel: before, after: snapshot(stay.id) };
    }

    // 4. Un-tick with a refund standing.
    {
      const stay = fiche(NO_ACOMPTE, 'direct');
      pay(stay.id, S);
      const steps = [];
      const line = firstLine(stay.id);
      record(steps, 'refund half of the first line', create(stay.id, { lines: [{ key: line.key, amountTtc: round2(line.refundableTtc / 2) }] }));
      record(steps, 'un-tick the solde', mark(stay.id, { balancePaid: false }));
      const refund = refundRows(stay.id)[0];
      record(steps, 'delete the refund', remove(stay.id, refund ? refund.id : 0));
      record(steps, 'un-tick the solde again', mark(stay.id, { balancePaid: false }));
      out['untick-with-refund'] = { stayId: stay.id, steps, after: snapshot(stay.id) };
    }

    // 5. The D25 pool: one arrival payment over solde + complement.
    {
      const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
      // SQLite stamps createdAt with the real clock, which the frozen one cannot move: pin it before the payment date is judged.
      db.prepare("UPDATE reservations SET createdAt = '2026-11-01 08:00:00' WHERE id = ?").run(stay.id);
      const r0 = rowOf(stay.id);
      const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
      const steps = [];
      record(steps, 'one payment 50 EUR short, the rest due', call((req, res) => controller.settleArrivalPayment(req, res), {
        params: { id: String(stay.id) }, user: ADMIN,
        body: { mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [{ method: 'card', amountCents: due - 5000, internal: false }], shortfall: { kind: 'due' } },
      }));
      const afterPayment = snapshot(stay.id);
      record(steps, '5 % off', await save(stay, { discountPercent: 5 }, { force: false }));
      const afterDiscount = snapshot(stay.id);
      record(steps, 'the 80 EUR line removed', await save(stay, { customOptions: [] }, { force: false }));
      record(steps, 'un-tick one bucket of the pool', mark(stay.id, { complementPaid: false }));
      out['pool-d25'] = { stayId: stay.id, steps, afterPayment, afterDiscount, after: snapshot(stay.id) };
    }

    // 6. End-of-stay complement collected, then a refund.
    {
      const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
      pay(stay.id, S, { complementPaid: true, complementPaidDate: TODAY });
      await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
      const steps = [];
      record(steps, 'refund the end-of-stay line before it is collected', create(stay.id, { lines: [{ key: 'custom:ajout', amountTtc: 30 }] }));
      storedEndOfStayPaid(stay.id, { date: TODAY, cash: false });
      record(steps, 'refund half of it once collected', create(stay.id, { lines: [{ key: 'custom:ajout', amountTtc: 15 }] }));
      record(steps, 'refund more than the rest', create(stay.id, { lines: [{ key: 'custom:ajout', amountTtc: 20 }] }));
      record(steps, 'refund the rest', create(stay.id, { lines: [{ key: 'custom:ajout', amountTtc: 15 }] }));
      out['end-of-stay-refund'] = { stayId: stay.id, steps, after: snapshot(stay.id) };
    }

    // 7. A refund opened from the stored trop-perçu.
    {
      const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
      pay(stay.id, S, { complementPaid: true, complementPaidDate: TODAY });
      const steps = [];
      record(steps, 'the 80 EUR line removed (trop-perçu)', await save(stay, { customOptions: [] }));
      const over = (ficheView(stay.id).ledger.rows || []).find((r) => /Trop-perçu/.test(String(r.label || '')));
      const stored = over ? Number(over.amount || over.amountTtc || 0) : 0;
      record(steps, 'refund over the trop-perçu', create(stay.id, { fromOverpayment: true, overpaymentTtc: round2(stored + 10), lines: [{ label: 'Trop-perçu', amountTtc: round2(stored + 10), bucket: 'accommodation' }] }));
      record(steps, 'refund the trop-perçu', create(stay.id, { fromOverpayment: true, overpaymentTtc: stored, lines: [{ label: 'Trop-perçu', amountTtc: stored, bucket: 'accommodation' }] }));
      record(steps, 'refund it a second time', create(stay.id, { fromOverpayment: true, overpaymentTtc: stored, lines: [{ label: 'Trop-perçu', amountTtc: stored, bucket: 'accommodation' }] }));
      out['overpayment-refund'] = { stayId: stay.id, storedOverpayment: stored, steps, after: snapshot(stay.id) };
    }

    return canonical(out);
  } finally {
    console.log = print;
  }
}

module.exports = { playWrites, canonical };
