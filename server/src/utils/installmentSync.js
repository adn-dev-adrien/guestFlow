/**
 * Keeps the stored installments in step with the stay (specs/direct-installments.md rules 7-9a, 13).
 *
 * `syncAfterTotalChange` is what every recalculation of the reservation total ends with: the dates that
 * fell after the arrival are brought back (rule 13), the amounts are rebalanced (rules 7, 8, 9a) and the
 * new target stored. Every function takes the database handle it must work on, so the HTTP save, the
 * payment recorders and the tests share the same code.
 */

const { buildModel } = require('../models/installmentsModel');
const { rebalance } = require('./installmentPlan');
const { addDaysToIsoDate } = require('./devisHelpers');

// Rule 13 — an unpaid installment dated after the (moved) arrival day is brought back to it; the ones
// before it give way one day each, so the strict order of rule 11 still holds.
function clampDates(model, rows, startDate) {
  const arrival = String(startDate).slice(0, 10);
  let ceiling = arrival;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (Number(rows[i].paid) === 1) continue;
    const due = rows[i].dueDate < ceiling ? rows[i].dueDate : ceiling;
    if (due !== rows[i].dueDate) model.updateRow(rows[i].id, { dueDate: due });
    ceiling = addDaysToIsoDate(due, -1);
  }
}

/**
 * @param {object} db
 * @param {number} reservationId
 * @param {{ targetCents: number, startDate: string }} change  the pre-arrival amount and the arrival day
 * @returns {{ gapCents: number, frozen: boolean, added: Map<number, number> } | null}  null without a plan
 */
function syncAfterTotalChange(db, reservationId, { targetCents, startDate }) {
  const model = buildModel(db);
  const rows = model.listFor(reservationId);
  if (rows.length === 0) return null;
  let result;
  db.transaction(() => {
    clampDates(model, rows, startDate);
    const current = model.listFor(reservationId);
    result = rebalance({ installments: current, targetCents });
    model.applyAmounts(reservationId, result.amounts, { clearPins: result.clearPins, added: result.added });
    model.setTarget(reservationId, targetCents);
  })();
  return { gapCents: result.gapCents, frozen: result.frozen, added: result.added };
}

/** Same rebalance on the target already stored — after an installment was paid for another amount. */
function rebalanceStored(db, reservationId) {
  const model = buildModel(db);
  const rows = model.listFor(reservationId);
  if (rows.length === 0) return null;
  const stay = db.prepare('SELECT installmentsTarget FROM reservations WHERE id = ?').get(Number(reservationId));
  const result = rebalance({ installments: rows, targetCents: Math.round(Number(stay.installmentsTarget || 0) * 100) });
  model.applyAmounts(reservationId, result.amounts, { clearPins: result.clearPins, added: result.added });
  return result;
}

module.exports = { syncAfterTotalChange, rebalanceStored };
