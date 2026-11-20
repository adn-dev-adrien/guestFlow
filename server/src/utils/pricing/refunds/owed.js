/**
 * REFUNDS / owed — the money that must LEAVE and has not yet (specs/pricing-components.md §3 rules 72 and 75, owner O-2, O-10).
 *
 * Three questions, one answer each, in cents. The callers write what they get into `refund_obligations`; nothing here reads a
 * database, a clock or a plugin.
 *
 *   owedOnBasket       a basket link paid by card whose plugin could not honour it: the whole payment, or the part its owner flagged
 *   owedOnLinkPayment  a link paid above what the stay asked: the excess and the duplicate part
 *   owedOnDuplicate    a link paid a second time: what the second payment gives back
 *   owedOnLineLowered  a paid line lowered, offered or removed: its trop-perçu share (rule 76), net of what is already owed for it
 *   owedOnDocument     a sale document paid above what its lines now ask (a line offered, removed, a link paid late): the excess, net of what was given back
 *   documentRowsInStep a sale document's open `lineLowered` rows kept in step with what it owes now, and what a lowering opens (loop t2 B2-2)
 *   refundRowsOfDocument  which line the money of a `lineLowered` row marked refunded leaves (loop t2 B2-1, B2-4)
 */

const whole = (value) => (Number.isInteger(value) ? value : 0);

/**
 * @param {{ paidCents: number, refundCents?: number, honoured?: boolean, reason?: string }} args
 *   `refundCents`: the part the owner flagged (strictly between 0 and the payment), else the whole payment is owed
 * @returns {{ owedCents: number, reason: string }}
 */
function owedOnBasket({ paidCents, refundCents = null, honoured = false, reason = '' }) {
  const paid = whole(paidCents);
  if (honoured || paid <= 0) return { owedCents: 0, reason: '' };
  const part = Number.isInteger(refundCents) && refundCents > 0 && refundCents < paid ? refundCents : null;
  return { owedCents: part || paid, reason: String(reason || 'achat non honoré') };
}

/**
 * @param {{ paidCents: number, expectedCents: (number|null), duplicateCents?: number }} args
 * @returns {{ excessCents: number, duplicateCents: number }}
 */
function owedOnLinkPayment({ paidCents, expectedCents, duplicateCents = 0 }) {
  const excess = expectedCents == null ? 0 : Math.max(0, whole(paidCents) - whole(expectedCents));
  return { excessCents: excess, duplicateCents: Math.max(0, whole(duplicateCents)) };
}

/**
 * A payment received a second time: what the second payment gives back — the whole link, unless the caller measured the part
 * that is a duplicate.
 * @param {{ paidCents: number, duplicateCents?: (number|null) }} args
 * @returns {{ owedCents: number }}
 */
function owedOnDuplicate({ paidCents, duplicateCents = null }) {
  return { owedCents: whole(duplicateCents == null ? paidCents : duplicateCents) };
}

/**
 * @param {{ overpaymentCents: number, alreadyOwedCents?: number }} args  the stay's trop-perçu after the change, and what the
 *   register already holds open for lowered lines
 * @returns {{ owedCents: number }} the obligation to open (0 when the register already covers it)
 */
function owedOnLineLowered({ overpaymentCents, alreadyOwedCents = 0 }) {
  return { owedCents: Math.max(0, whole(overpaymentCents) - whole(alreadyOwedCents)) };
}

/**
 * @param {{ dueCents: number, paidCents: number, refundedCents?: number, heldCents?: number }} args  what the document's lines ask now, what it received,
 *   what was already given back, what the open obligation rows already hold (all in cents)
 * @returns {{ owedCents: number, unheldCents: number }}
 */
function owedOnDocument({ dueCents, paidCents, refundedCents = 0, heldCents = 0 }) {
  const owedCents = Math.max(0, whole(paidCents) - whole(refundedCents) - whole(dueCents));
  // `unheldCents` — the part of it no open obligation row holds yet (loop t1 B-7: the one place this difference is taken).
  return { owedCents, unheldCents: Math.max(0, owedCents - whole(heldCents)) };
}

// What each line of a settled document holds beyond what it asks (an offered, removed or cancelled line still carrying its money).
const excessByLine = (lines) => new Map((lines || []).map((line) => [line.ref, Math.max(0, whole(line.settledCents) - whole(line.dueCents))]));

/**
 * Loop t2 B2-2 (outside-visit rule 53) — the open `lineLowered` rows of a document, in step with what it owes now: a row names the line it was opened for
 * and holds at most what that line still holds beyond what it asks; the rows together hold at most `owedCents` (the newest cut first). A lowering
 * (`open`) opens what no row holds yet, at most the excess of its line (`open.lineRef`, null for the whole document cancelled).
 * Loop t3 B3-1 (outside-visit rule 55) — every open row of the document is kept in step, a link surplus too: a row marked `unallocated` (a `linkSurplus`)
 * holds at most the money still filed on no line (`unallocatedCents`, once rule 52 has filed it on the lines still due).
 * @param {{ rows: Array<{ id: number, lineRef: (string|null), unallocated?: boolean, amountCents: number }>, lines: Array<{ ref: string, dueCents: number,
 *   settledCents: number }>, owedCents: number, unallocatedCents?: number, open?: ({ lineRef: (string|null) }|null) }} args  `rows` oldest first; `owedCents` =
 *   what the document owes back
 * @returns {{ amounts: Array<{ id: number, amountCents: number }>, openCents: number }} each row's amount now (0 = no longer owed), and what to open
 */
function documentRowsInStep({
  rows, lines, owedCents, unallocatedCents = 0, open = null,
}) {
  const left = excessByLine(lines);
  let unallocatedLeft = Math.max(0, whole(unallocatedCents));
  const amounts = (rows || []).map((row) => {
    const amount = whole(row.amountCents);
    if (row.unallocated) {
      const kept = Math.min(amount, unallocatedLeft);
      unallocatedLeft -= kept;
      return { id: row.id, amountCents: kept };
    }
    if (row.lineRef == null) return { id: row.id, amountCents: amount };
    const kept = Math.min(amount, left.get(row.lineRef) || 0);
    left.set(row.lineRef, (left.get(row.lineRef) || 0) - kept);
    return { id: row.id, amountCents: kept };
  });
  let over = amounts.reduce((sum, row) => sum + row.amountCents, 0) - Math.max(0, whole(owedCents));
  for (const row of [...amounts].reverse()) {
    if (over <= 0) break;
    const cut = Math.min(over, row.amountCents);
    row.amountCents -= cut;
    over -= cut;
  }
  const room = Math.max(0, whole(owedCents) - amounts.reduce((sum, row) => sum + row.amountCents, 0));
  let openCents = 0;
  if (open) openCents = open.lineRef == null ? room : Math.min(room, left.get(open.lineRef) || 0);
  return { amounts, openCents };
}

/**
 * Loop t2 B2-1, B2-4 (outside-visit rule 49) — the refund rows of a `lineLowered` row marked refunded: taken first on the line the row was opened for, then
 * on the other lines holding more than they ask, in sale order; on each line its booked part before its caisse-interne part; what no line holds goes on
 * no line. `allocations` are the document's rows (`{ lineRef, amountCents, books }`), `lines` its settled lines.
 * Loop t3 B3-2 (outside-visit rule 55) — a `linkSurplus` row (`unallocated: true`) gives back the money filed on no line first: one refund row on no line
 * (off the books, the surplus never was revenue), then, if the document holds less there, the lines as above.
 * Loop t4 B4-3 (outside-visit rule 56) — `reserved` are the other open rows of the document (`{ lineRef, amountCents }`): after its own line, a row takes
 * the excess no other row names, in sale order, and only then what another row holds. A whole document cancelled (`lineRef` NULL) no longer takes the
 * offered beers' money its own row was opened for. The same rows say which money a row closed « rien à rembourser » keeps (rule 56 a).
 * Loop t5 D5-4 — at most one row per (lineRef, internal).
 * @returns {Array<{ lineRef: (string|null), amountCents: number, internal: boolean }>}
 */
function refundRowsOfDocument({
  lines, allocations = [], amountCents, lineRef = null, unallocated = false, reserved = [],
}) {
  const excess = excessByLine(lines);
  const bookedLeft = new Map((lines || []).map((line) => [line.ref, Math.max(0, (allocations || [])
    .filter((row) => row.lineRef === line.ref && Number(row.books) === 1).reduce((sum, row) => sum + whole(Number(row.amountCents)), 0))]));
  const named = new Map();
  for (const row of reserved || []) {
    if (row && row.lineRef != null && row.lineRef !== lineRef) named.set(row.lineRef, (named.get(row.lineRef) || 0) + Math.max(0, whole(row.amountCents)));
  }
  let left = whole(amountCents);
  const rows = [];
  if (unallocated) {
    const held = Math.max(0, (allocations || []).filter((row) => row.lineRef == null).reduce((sum, row) => sum + whole(Number(row.amountCents)), 0));
    const take = Math.min(left, held);
    if (take > 0) { rows.push({ lineRef: null, amountCents: take, internal: false }); left -= take; }
  }
  const takeFrom = (line, most) => {
    const take = Math.min(left, most, excess.get(line.ref) || 0);
    if (!(take > 0)) return;
    const booked = Math.min(take, bookedLeft.get(line.ref) || 0);
    rows.push({ lineRef: line.ref, amountCents: booked, internal: false }, { lineRef: line.ref, amountCents: take - booked, internal: true });
    excess.set(line.ref, excess.get(line.ref) - take);
    bookedLeft.set(line.ref, (bookedLeft.get(line.ref) || 0) - booked);
    left -= take;
  };
  const own = (lines || []).find((line) => lineRef != null && line.ref === lineRef);
  if (own) takeFrom(own, Infinity);
  for (const line of lines || []) if (line !== own) takeFrom(line, Math.max(0, (excess.get(line.ref) || 0) - (named.get(line.ref) || 0)));
  for (const line of lines || []) if (line !== own) takeFrom(line, Infinity);
  if (left > 0) rows.push({ lineRef: null, amountCents: left, internal: false });
  // Loop t5 D5-4 — the passes can take from the same line twice (its unnamed excess, then the rest): one row per (line, caisse), in the order
  // first taken, so the allocations written from them never collide on `idx_payment_allocations_key`.
  const merged = new Map();
  for (const row of rows) {
    const key = `${row.lineRef}\u0000${row.internal}`;
    if (merged.has(key)) merged.get(key).amountCents += row.amountCents;
    else merged.set(key, { ...row });
  }
  return [...merged.values()];
}

/**
 * The part of a second paid link to give back, as the poll and the notifier carry it: `null` when the whole link is owed.
 * @param {(number|null)} [duplicateCents]
 */
const duplicatePayment = (duplicateCents = null) => ({ duplicateCents });

/**
 * The effect a poll reports when a link is paid a second time: the keys the alert, the register and the notifier read.
 * @param {(number|null)} duplicateCents  the part owed (`null`: the whole link)
 * @param {object} [extra]  `{ reservationId, conflict }` where the caller names them
 */
const doublePaymentEffect = (duplicateCents, extra = {}) => ({ effect: 'double-payment', duplicateLink: true, ...duplicatePayment(duplicateCents), ...extra });

/** What an acompte link paid, then the full link, leaves to give back: the acompte part only, the rest is the solde. */
const fullOverDeposit = ({ depositCents, linkCents }) => Math.min(Number(depositCents || 0), Number(linkCents || 0));

/** What a full link brought beyond the solde still owed (rule 41). */
const duplicateOnSolde = ({ linkCents, balanceCents }) => Math.max(0, linkCents - balanceCents);

/** A basket link its plugin could not honour: the basket flagged « à rembourser », the part flagged when it is only a part. */
const flagRefundOwed = (basket, partCents) => ({ ...basket, refundOwed: true, ...(partCents ? { refundCents: partCents } : {}) });

module.exports = {
  owedOnBasket, owedOnLinkPayment, owedOnDuplicate, owedOnLineLowered, owedOnDocument, documentRowsInStep, refundRowsOfDocument, duplicatePayment, doublePaymentEffect, fullOverDeposit, duplicateOnSolde, flagRefundOwed,
};
