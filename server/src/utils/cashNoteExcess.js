/**
 * cashNoteExcess — the part of a stay's freed note money that cash notes took (specs/pricing-components.md rule 106 b, stabilisation loop t6 B6-2).
 * A cash note is money the caisse interne holds, never booked (`books 0`): its refund goes back the same way so it writes no avoir for money the
 * journal never held (refundMeansOf, Adrien 2026-10-29).
 *
 *   cashNoteExcessCents(db, reservationId, { quote }) → cents. Per line key a note paid, the cash a note paid on it beyond what the line is charged now:
 *     the stored line (its amount less its own discount) once the write is done, or, with `quote` (a save not written yet), what that quote charges on
 *     the key. Without `quote` it is capped by `paidLineJudgment.noteExcessCents` (what no bucket absorbs). With `quote` it is capped by what the
 *     save does not charge anew (loop t7, data observation): the growth of every line the quote charges above the stored line (a new line, a line
 *     un-offered or raised) absorbs the freed note money first (rule 104), so a mixed save — cash freed on one line, an unpaid line added, a booked
 *     trop-perçu elsewhere — never defaults that booked money to « Caisse interne ». Read-only.
 */
const { toCents } = require('./pricing/money');
const { settledByKey, extraLineKey } = require('./pricing/storedLines');
const { parseNotes } = require('./midStayExtras');
const { noteExcessCents } = require('./paidLineJudgment');

const netOf = (fact) => (fact ? Math.max(0, Number(fact.storedCents || 0) - Number(fact.discountCents || 0)) : 0);

function chargedByQuote(quote) {
  const charged = {};
  for (const line of [...(quote.optionLines || []), ...(quote.resourceLines || [])]) {
    const key = extraLineKey(line);
    if (!key) continue;
    charged[key] = (charged[key] || 0) + (line.offered ? 0 : toCents(line.totalPrice));
  }
  return charged;
}

// What the quote charges beyond the stored lines, Σ per key of the increase only.
function growthCents(charged, facts) {
  return Object.entries(charged).reduce((sum, [key, cents]) => sum + Math.max(0, cents - netOf(facts[key])), 0);
}

// Loop t7 B7-3 (rule 112) — the cash a « caisse interne » refund on the trop-perçu already gave back: the `lineLowered` rows it settled. That cash
// left the till; what stays freed is the money the other means brought, so the second refund of a mixed excess defaults to them, never to the till.
function cashReturnedCents(db, id) {
  const ready = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('refund_obligations', 'reservation_refunds')").get().n === 2;
  if (!ready) return 0;
  return Number(db.prepare(`SELECT COALESCE(SUM(o.amountCents), 0) AS cents FROM refund_obligations o
    JOIN reservation_refunds r ON o.settledBy = 'refund:' || r.id
    WHERE o.reservationId = ? AND o.origin = 'lineLowered' AND o.status = 'settled' AND r.method = 'internal'`).get(id).cents);
}

function cashNoteExcessCents(db, reservationId, { quote = null } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id);
  if (!row) return 0;
  const paidByKey = {};
  const cashByKey = {};
  for (const note of parseNotes(row.midStaySettledNotes)) {
    const cash = Boolean(note) && Number(note.paidCash || 0) === 1;
    for (const [key, amount] of Object.entries(settledByKey(JSON.stringify([note])))) {
      paidByKey[key] = (paidByKey[key] || 0) + toCents(amount);
      if (cash) cashByKey[key] = (cashByKey[key] || 0) + toCents(amount);
    }
  }
  if (!Object.keys(cashByKey).length) return 0;
  const facts = require('../models/ports/stayRepository').create(db).lineFacts(id);
  const charged = quote ? chargedByQuote(quote) : null;
  const chargedOn = charged ? (key) => charged[key] || 0 : (key) => netOf(facts[key]);
  const cash = Math.max(0, Object.entries(paidByKey).reduce((sum, [key, paid]) => sum + Math.min(cashByKey[key] || 0, Math.max(0, paid - chargedOn(key))), 0)
    - cashReturnedCents(db, id));
  return charged ? Math.max(0, cash - growthCents(charged, facts)) : Math.min(cash, noteExcessCents(db, id));
}

module.exports = { cashNoteExcessCents };
