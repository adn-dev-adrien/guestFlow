/**
 * cashNoteExcess — the part of a stay's freed note money that cash notes took (specs/pricing-components.md rule 106 b, stabilisation loop t6 B6-2).
 * A cash note is money the caisse interne holds, never booked (`books 0`): its refund goes back the same way so it writes no avoir for money the
 * journal never held (refundMeansOf, Adrien 2026-10-29).
 *
 *   cashNoteExcessCents(db, reservationId, { quote }) → cents. Per line key a note paid, the cash a note paid on it beyond what the line is charged now:
 *     the stored line (its amount less its own discount) once the write is done, or, with `quote` (a save not written yet), what that quote charges on
 *     the key. Without `quote` it is capped by `paidLineJudgment.noteExcessCents` (what no bucket absorbs). Read-only.
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
    charged[key] = (charged[key] || 0) + (line.offered ? 0 : toCents(line.totalPrice));
  }
  return (key) => charged[key] || 0;
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
  let chargedOn;
  if (quote) {
    chargedOn = chargedByQuote(quote);
  } else {
    const facts = require('../models/ports/stayRepository').create(db).lineFacts(id);
    chargedOn = (key) => netOf(facts[key]);
  }
  const cash = Object.entries(paidByKey).reduce((sum, [key, paid]) => sum + Math.min(cashByKey[key] || 0, Math.max(0, paid - chargedOn(key))), 0);
  return quote ? cash : Math.min(cash, noteExcessCents(db, id));
}

module.exports = { cashNoteExcessCents };
