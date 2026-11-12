/**
 * What each bucket paid with several methods actually RECEIVED (specs/mixed-method-payments.md rule 47), as the pricing
 * engine and the trop-perçu readers need it: a split that left a « Reste à percevoir » or a « Geste commercial » holds
 * less than its marked amount, and a paid bucket keeps what it received, not what it was marked at.
 *
 * A plain read on the handle it is given (no model, no database import), like `installmentSummary`, so the engine stays
 * usable on any database. `null` when the stay has none or the tables do not exist, else:
 * - `{ deposit, balance, complement, endOfStayComplement }` in euros, only for the buckets a settlement paid;
 * - `notes: { [noteId]: euros }` for the mid-stay notes;
 * - `pools: [{ buckets, received }]`, one per bucket target: what the settlement(s) of that target received, in euros.
 *
 * Rule 50 (D25 « Une seule somme ») — a settlement over several buckets (the single arrival payment, the SAS arrival and
 * departure, a complement carrying the end of stay) received ONE sum for all of them. The engine reads the pool itself;
 * the per-bucket figures attribute it at what the buckets are worth now, the end of stay, the complement and the acompte
 * full first and the solde taking the rest, because a cut lowers the solde first: the reste or the geste always sits on
 * the bucket the next cut can lower, and a reader adding the buckets counts the pool once.
 */

const BUCKETS = new Set(['deposit', 'balance', 'complement', 'endOfStayComplement']);
// The order the pool fills its buckets in; the last of a target's buckets takes the rest.
const FILL_ORDER = ['endOfStayComplement', 'complement', 'deposit', 'balance'];
const AMOUNT_COLUMN = {
  deposit: 'depositAmount', balance: 'balanceAmount', complement: 'complementAmount', endOfStayComplement: 'endOfStayComplementAmount',
};

const { toCentsOrZero: toCents } = require('./pricing/money');

function parseParts(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readAmounts(db, reservationId) {
  try {
    return db.prepare('SELECT depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount FROM reservations WHERE id = ?')
      .get(Number(reservationId)) || null;
  } catch {
    return null;
  }
}

// What each bucket of a pool holds of what it received: filled at what it is worth now (`row`), else at the amount it was
// paid at, in FILL_ORDER, the last taking the rest.
function attribute(parts, receivedCents, row) {
  const ordered = FILL_ORDER.map((kind) => parts.find((p) => p.kind === kind)).filter(Boolean);
  const out = {};
  let left = receivedCents;
  ordered.forEach((p, i) => {
    const worth = row ? toCents(row[AMOUNT_COLUMN[p.kind]]) : Math.max(0, Number(p.amountCents) || 0);
    const share = i === ordered.length - 1 ? left : Math.min(left, Math.max(0, worth));
    left -= share;
    out[p.kind] = share;
  });
  return out;
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
  let row;
  for (const [key, { parts, receivedCents }] of byTarget) {
    // A mid-stay note paid with several methods: what it received, by note id.
    if (key.startsWith('midStayNote:')) {
      out.notes = { ...(out.notes || {}), [key.slice('midStayNote:'.length)]: receivedCents / 100 };
      continue;
    }
    const buckets = parts.filter((p) => BUCKETS.has(p.kind));
    if (buckets.length === 0) continue;
    if (buckets.length > 1 && row === undefined) row = readAmounts(db, reservationId);
    const shares = buckets.length > 1 ? attribute(buckets, receivedCents, row) : { [buckets[0].kind]: receivedCents };
    for (const [kind, share] of Object.entries(shares)) out[kind] = (toCents(out[kind]) + share) / 100;
    const stored = row ? Object.fromEntries(buckets.map((p) => [p.kind, toCents(row[AMOUNT_COLUMN[p.kind]]) / 100])) : null;
    out.pools = [...(out.pools || []), { buckets: buckets.map((p) => p.kind), received: receivedCents / 100, ...(stored ? { stored } : {}) }];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Rule 50 — what the pool holding `bucket` did not receive, at the amounts its buckets are worth now (`amountOf(kind)`,
 * euros; null → the stored amount): how far a cut may lower that bucket before it eats into money received. 0 when no
 * split paid it.
 */
function unreceivedOf(received, bucket, amountOf) {
  const pool = received && (received.pools || []).find((p) => p.buckets.includes(bucket));
  if (!pool) return 0;
  const worth = pool.buckets.reduce((sum, kind) => {
    const now = amountOf(kind);
    return sum + toCents(now == null ? (pool.stored || {})[kind] : now);
  }, 0);
  return Math.max(0, worth - toCents(pool.received)) / 100;
}

module.exports = { readSplitReceived, unreceivedOf };
