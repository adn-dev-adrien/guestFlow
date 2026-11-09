/**
 * What each bucket paid with several methods actually RECEIVED (specs/mixed-method-payments.md rule 47), as the pricing
 * engine and the trop-perçu readers need it: a split that left a « Reste à percevoir » or a « Geste commercial » holds
 * less than its marked amount, and a paid bucket keeps what it received, not what it was marked at.
 *
 * A plain read on the handle it is given (no model, no database import), like `installmentSummary`, so the engine stays
 * usable on any database. `{ deposit, balance, complement, endOfStayComplement }` in euros, only for the buckets a
 * settlement paid, and `notes: { [noteId]: euros }` for the mid-stay notes; `null` when the stay has none or the tables
 * do not exist. A settlement over several buckets (the
 * single arrival payment, a complement carrying the end of stay) fills them in the order it paid them, each up to the
 * amount it was paid at, the last taking the rest.
 */

const BUCKETS = new Set(['deposit', 'balance', 'complement', 'endOfStayComplement']);

function parseParts(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readSplitReceived(db, reservationId) {
  if (!db || !reservationId || Number(reservationId) <= 0) return null;
  let rows;
  try {
    rows = db.prepare(`
      SELECT s.targetKind, s.targetKey, s.parts, COALESCE(SUM(t.amountCents), 0) AS receivedCents
        FROM payment_settlements s LEFT JOIN payment_tenders t ON t.settlementId = s.id
       WHERE s.reservationId = ?
       GROUP BY s.id ORDER BY s.id`).all(Number(reservationId));
  } catch {
    return null;
  }
  if (!rows || rows.length === 0) return null;
  const byTarget = new Map();
  for (const r of rows) {
    const key = `${r.targetKind}:${r.targetKey}`;
    if (!byTarget.has(key)) byTarget.set(key, { parts: parseParts(r.parts), receivedCents: 0 });
    byTarget.get(key).receivedCents += Number(r.receivedCents) || 0;
  }
  const out = {};
  for (const [key, { parts, receivedCents }] of byTarget) {
    // A mid-stay note paid with several methods: what it received, by note id.
    if (key.startsWith('midStayNote:')) {
      out.notes = { ...(out.notes || {}), [key.slice('midStayNote:'.length)]: receivedCents / 100 };
      continue;
    }
    const buckets = parts.filter((p) => BUCKETS.has(p.kind));
    let left = receivedCents;
    buckets.forEach((p, i) => {
      const share = i === buckets.length - 1 ? left : Math.min(left, Math.max(0, Number(p.amountCents) || 0));
      left -= share;
      out[p.kind] = ((out[p.kind] || 0) * 100 + share) / 100;
    });
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { readSplitReceived };
