/**
 * paidLineJudgment — the one judgment of a write that takes money away from a line a note paid (specs/pricing-components.md rules 23, 104;
 * stabilisation loop t5, S5-1). Every save of a stay passes through it (`applyUpdate`): the fiche's « Enregistrer », the line API
 * (`extraSale.changeLine` / `removeLine`), a sale, a restate. One formula, so a paid line offered in the fiche and the same line offered
 * through its action end the same way.
 *
 *   notesOnKey(db, reservationId, key)  → the cents the stay's notes name on a line key: what the guest paid on that line, whatever it is
 *                                         worth now (a line offered after it was paid still carries it)
 *   refundedLoweredCents(db, reservationId) → the note money a refund on the trop-perçu already gave back (the settled `lineLowered`
 *                                         rows): never a credit again — the engine's note credit (rule 110) and `noteExcessCents` both deduct it
 *   noteExcessCents(db, reservationId, lineDiscounts)  → the note money no line claims and no bucket absorbs: received by the establishment
 *                                         beyond the total and not refunded yet (`lineDiscounts`: those a save carries, not stored yet)
 *   wayBack(db, reservationId, opts) / reopenedCredit(db, reservationId, opts) → `{ settle() }`: a write that bills a paid line again or frees
 *                                         its money (rules 109, 114), a refund on the trop-perçu deleted (rule 115), follows rule 104's credit
 *   begin(db, reservationId)            → `{ finish({ overpaid, forced, lineDiscounts }) }`, taken before the write; `finish`, called after the
 *                                         write inside the same transaction, answers the refusal that rolls it back, or null (`overpaid`: the
 *                                         save is about to answer the trop-perçu formula's 409 OVERPAID — only a removal is refused before it;
 *                                         `forced`: the operator confirmed; `lineDiscounts`: the line discounts the save carries, stored after it):
 *     - 409 `LINE_PAID` (« elle peut être offerte, pas retirée ») — a line a note pays left the stay. Its money stays credited until a refund
 *       (rule 23), and a later line of the same article would otherwise inherit the note's key and read as paid (S5-4).
 *     - 409 `LINE_REFUNDED` (« Ligne remboursée : la revendre comme une nouvelle ligne. ») — the write makes a note's key claim again money a
 *       refund on the trop-perçu already gave back (a paid line offered, its excess refunded, then un-offered or un-discounted): the guest
 *       would keep the line AND the money (loop t7 D7-1, rule 108). Taken before the overpaid branch: it is no trop-perçu to confirm.
 *     - 409 `OVERPAID` — the write freed note money (a paid line offered, discounted or lowered) and the stay absorbed less of it than it grew
 *       (rule 104 credits it to what is still due first). A note is money the ESTABLISHMENT collected (cash, card terminal, online link), on a
 *       platform stay too (loop t5 A5-1: the platform collected none of it, reservation-refunds rule 38 is about the platform's money): what
 *       nothing absorbs is a trop-perçu the operator confirms, then owed back (`lineLowered` obligation), whatever the channel.
 */
const { toCents } = require('./pricing/money');
const { settledByKey } = require('./pricing/storedLines');
const { parseNotes } = require('./midStayExtras');

const PAID_LINE_REMOVED = 'Ligne déjà payée : elle peut être offerte, pas retirée.';
const LINE_REFUNDED = 'Ligne remboursée : la revendre comme une nouvelle ligne.';
const eurosText = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const TABLES = { option: 'reservation_options', resource: 'reservation_resources', custom: 'reservation_custom_options' };
const BUCKETS = ['depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount'];

function notesByKeyCents(row) {
  const byKey = {};
  for (const [key, amount] of Object.entries(settledByKey(row && row.midStaySettledNotes))) byKey[key] = toCents(amount);
  return byKey;
}

function notesOnKey(db, reservationId, key) {
  const row = db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(Number(reservationId));
  return key ? Number(notesByKeyCents(row)[key] || 0) : 0;
}

// Rule 104 — the money the stay received beyond what its stored buckets carry: Σ (acompte, solde, complements, notes) − (price + tax), in cents.
function unabsorbedCents(row) {
  const notes = parseNotes(row.midStaySettledNotes).reduce((sum, note) => sum + toCents(note && note.total), 0);
  return BUCKETS.reduce((sum, field) => sum + toCents(row[field]), notes) - toCents(row.finalPrice) - toCents(row.touristTaxTotal);
}

function loweredCents(db, reservationId, status) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refund_obligations'").get();
  if (!table) return 0;
  return Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS cents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = ?")
    .get(Number(reservationId), status).cents);
}
const openLoweredCents = (db, reservationId) => loweredCents(db, reservationId, 'open');
const refundedLoweredCents = (db, reservationId) => loweredCents(db, reservationId, 'settled');

const lineFactsOf = (db, id) => require('../models/ports/stayRepository').create(db).lineFacts(id);
const netOf = (fact) => (fact ? Math.max(0, Number(fact.storedCents || 0) - Number(fact.discountCents || 0)) : 0);

// What the notes collected beyond what each paid key carries now: the note money no line claims (rule 104's `unclaimed`).
function unclaimedCents(notes, facts) {
  return Object.entries(notes).reduce((sum, [key, paid]) => sum + Math.max(0, paid - netOf(facts[key])), 0);
}

// A line discount a save carries (`lineDiscounts`, the line action's) is stored once the save went through: weighed here already.
function factsWith(db, id, lineDiscounts) {
  const facts = lineFactsOf(db, id);
  for (const [key, cents] of Object.entries(lineDiscounts && typeof lineDiscounts === 'object' ? lineDiscounts : {})) {
    if (facts[key]) facts[key] = { ...facts[key], discountCents: Math.max(0, Math.round(Number(cents) || 0)) };
  }
  return facts;
}

function noteExcessCents(db, reservationId, lineDiscounts = null) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? notesByKeyCents(row) : {};
  if (!row || !Object.keys(notes).length) return 0;
  // Loop t6 D6-1 — a refund on the trop-perçu gave part of that money back already (the `lineLowered` rows it settled): the notes and the
  // buckets still count it as received, so it comes off here, or a second lowering would owe it back a second time.
  const refunded = refundedLoweredCents(db, id);
  return Math.max(0, Math.min(unabsorbedCents(row), unclaimedCents(notes, factsWith(db, id, lineDiscounts))) - refunded);
}

// Loop t7 D7-2 (rule 106 d) — per line key a note paid, the note money beyond what the line charges now: what a refund on that line can give
// back of the `lineLowered` obligation. A key whose line still charges what its note paid owes nothing back, whatever a refund gives on it.
function noteExcessByKey(db, reservationId) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id);
  const notes = row ? notesByKeyCents(row) : {};
  if (!Object.keys(notes).length) return {};
  const facts = lineFactsOf(db, id);
  const out = {};
  for (const [key, paid] of Object.entries(notes)) if (paid - netOf(facts[key]) > 0) out[key] = paid - netOf(facts[key]);
  return out;
}

// Rule 108 (loop t7 D7-1) — the lowered paid lines whose excess a refund already gave back: putting one back at its price would make its note
// claim that money again, so the judgment refuses it (409 `LINE_REFUNDED`) and the fiche and the SAS do not offer the gesture. A line is listed
// when the note money no line claims, less its own excess, falls below what the refunds on the trop-perçu settled. Read-only.
//   → [{ key, table: 'option' | 'resource' | 'custom', lineId }]
function refundedLoweredLines(db, reservationId) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id);
  const notes = row ? notesByKeyCents(row) : {};
  if (!Object.keys(notes).length) return [];
  const refunded = refundedLoweredCents(db, id);
  if (refunded <= 0) return [];
  const facts = lineFactsOf(db, id);
  const unclaimed = unclaimedCents(notes, facts);
  return Object.entries(notes)
    .filter(([key, paid]) => facts[key] && paid - netOf(facts[key]) > 0 && unclaimed - (paid - netOf(facts[key])) < refunded)
    .map(([key]) => ({ key, table: facts[key].table, lineId: Number(facts[key].lineId) }));
}

// What the stay owes back on lowered paid lines, in the register (rule 23): held at `cents`.
function holdLowered(db, reservationId, cents) {
  const obligations = require('../models/refundObligationsModel');
  if (obligations.ready()) obligations.trimLowered(Number(reservationId), cents);
}

function begin(db, reservationId) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? notesByKeyCents(row) : {};
  if (!row || !Object.keys(notes).length) return { finish: () => null };
  const facts = lineFactsOf(db, id);
  const paidLines = Object.keys(notes).filter((key) => facts[key]).map((key) => ({ key, table: facts[key].table, lineId: Number(facts[key].lineId) }));
  const before = {
    unabsorbed: unabsorbedCents(row), owed: openLoweredCents(db, id), unclaimed: unclaimedCents(notes, facts), refunded: refundedLoweredCents(db, id),
  };
  return {
    finish({ overpaid = false, forced = false, lineDiscounts = null } = {}) {
      const removed = paidLines.find(({ table, lineId }) => !db.prepare(`SELECT 1 FROM ${TABLES[table]} WHERE lineId = ? AND reservationId = ?`).get(lineId, id));
      if (removed) return { status: 409, body: { error: PAID_LINE_REMOVED, code: 'LINE_PAID' } };
      const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const unclaimedAfter = unclaimedCents(notesByKeyCents(after), factsWith(db, id, lineDiscounts));
      // Rule 108 — a note claiming again what a refund gave back: the line is sold anew, never put back.
      if (unclaimedAfter < before.unclaimed && unclaimedAfter < before.refunded) return { status: 409, body: { error: LINE_REFUNDED, code: 'LINE_REFUNDED' } };
      // A trop-perçu the save is about to ask confirmation of (409 OVERPAID) is that refusal's: once confirmed, it is owed back.
      if (overpaid) return null;
      const freed = unclaimedAfter - before.unclaimed;
      if (freed <= 0) return null;
      const owed = openLoweredCents(db, id);
      const gap = Math.min(freed, unabsorbedCents(after) - before.unabsorbed - (owed - before.owed));
      if (gap <= 0) return null;
      if (forced) {
        holdLowered(db, id, owed + gap);
        return null;
      }
      return {
        status: 409,
        body: {
          error: `Trop-perçu : ${eurosText(gap)} déjà encaissés au-delà du nouveau total.`, code: 'OVERPAID', overpaymentTtc: gap / 100, overpaymentMethod: null, overpaymentLines: [],
        },
      };
    },
  };
}

// The engine's rule-104 credit on the stored stay: what it takes off each bucket (`noteCreditCuts`), in cents, and the end-of-stay remainder it
// leaves (`midStayExtrasLines`, credited). A quote that cannot run reads no credit.
function creditOf(quoteOf, row) {
  let quote = null;
  try { quote = typeof quoteOf === 'function' ? quoteOf(row) : null; } catch { quote = null; }
  const ok = quote && !quote.error;
  const cuts = ok ? quote.noteCreditCuts || {} : {};
  return {
    complementAmount: toCents(cuts.complementAmount), depositAmount: toCents(cuts.depositAmount), balanceAmount: toCents(cuts.balanceAmount),
    remainder: ok ? toCents(quote.midStayRemainingTotal) : null, midStayLines: ok ? quote.midStayExtrasLines : null,
  };
}

// Takes up to `cents` off what the stay still asks, in the order rule 104 credits: the open complement (`complement`), the end-of-stay remainder
// (`midStay(lines)`, the writer that stores the engine's credited lines), the solde, the acompte — each by at most what the engine's credit now
// takes off it beyond `before`. → the cents taken.
function creditToBuckets(db, id, cents, before, after, { complement = false, midStay = null } = {}) {
  let rest = cents;
  let taken = 0;
  const take = (column, paid) => {
    const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    if (rest <= 0 || Number(row[paid] || 0) === 1) return;
    const cut = Math.min(rest, Math.max(0, after[column] - before[column]), Math.max(0, toCents(row[column])));
    if (cut <= 0) return;
    db.prepare(`UPDATE reservations SET ${column} = ROUND(COALESCE(${column}, 0) - ?, 2) WHERE id = ?`).run(cut / 100, id);
    rest -= cut;
    taken += cut;
  };
  if (complement && db.prepare('SELECT complementAmountOverride AS o FROM reservations WHERE id = ?').get(id).o == null) take('complementAmount', 'complementPaid');
  if (midStay && rest > 0 && before.remainder != null && after.remainder != null && before.remainder > after.remainder && Array.isArray(after.midStayLines)) {
    // The remainder is rewritten from the engine's credited lines only when that moves it down by no more than the credit left: a stored
    // remainder the engine no longer reproduces (an older stay, an adjustment) is left as it is.
    const stored = () => toCents(db.prepare('SELECT endOfStayComplementAmount AS a FROM reservations WHERE id = ?').get(id).a);
    const was = stored();
    const KEEP = Symbol('keep');
    try {
      db.transaction(() => {
        midStay(after.midStayLines);
        const cut = was - stored();
        if (cut <= 0 || cut > Math.min(rest, before.remainder - after.remainder)) throw KEEP;
        rest -= cut;
        taken += cut;
      })();
    } catch (err) {
      if (err !== KEEP) throw err;
    }
  }
  take('balanceAmount', 'balancePaid');
  take('depositAmount', 'depositPaid');
  return taken;
}

// Rule 109 (loop t7 S7-1) — the way BACK of a write that bills again a line a note paid (« Offert » unticked) without passing through the
// fiche's save: the arrival SAS rewrites its lines and lets the engine restate the arrival complement only, so neither `syncLoweredObligations`
// nor `pinSaleDelta` ran. `wayBack(db, id, { quoteOf })` is taken before the write; `settle()`, called after it in the same transaction, gives
// back what the note money had been credited to, in the reverse order rule 104 credited it: the open `lineLowered` obligation closes first (the
// note pays the line again, nothing is owed back), then the acompte and the solde not yet paid get back what the credit took off them
// (`noteCreditCuts` of the engine before and after). Bounded by what the stay lost (Σ received − owed − total) and by the note money the
// lines claim again: a write that bills nothing paid again, or whose complement the engine already restated, moves nothing.
// Rule 114 (loop t8 S8-2) — and the way OUT, the same gesture the other way: a write that FREES note money (a paid line offered at the SAS)
// credits it as the line API does (`pinSaleDelta`): the solde, then the acompte, not yet paid lose what the engine's credit now takes off them,
// bounded by the money freed and by what the stay gained beyond its buckets. What no bucket absorbs is left to the judgment (`begin`), which
// answers the trop-perçu. Same gesture, same result, whichever screen.
//   quoteOf(row) → the engine's quote of the stored stay (`quoteStoredReservation`), or null
//   billedCents() → what the stay's lines bill now, when the writer moves `finalPrice` by it only after `settle` (the SAS: `moveFinalPriceBy`)
//   midStay(lines) → stores the engine's credited end-of-stay lines (`syncMidStayComplement`), for the way out
function wayBack(db, reservationId, { quoteOf, billedCents = null, midStay = null } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? notesByKeyCents(row) : {};
  if (!row || !Object.keys(notes).length) return { settle: () => 0 };
  const before = {
    unclaimed: unclaimedCents(notes, lineFactsOf(db, id)), kept: unabsorbedCents(row) - openLoweredCents(db, id), cuts: creditOf(quoteOf, row),
    billed: billedCents ? billedCents() : 0,
  };
  return {
    settle() {
      const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const reclaimed = before.unclaimed - unclaimedCents(notesByKeyCents(after), lineFactsOf(db, id));
      if (reclaimed === 0) return 0;
      const owed = openLoweredCents(db, id);
      const finalShift = billedCents ? billedCents() - before.billed : 0;
      const kept = unabsorbedCents(after) - finalShift - owed;
      if (reclaimed < 0) {
        const gained = Math.min(-reclaimed, kept - before.kept);
        return gained > 0 ? -creditToBuckets(db, id, gained, before.cuts, creditOf(quoteOf, after), { midStay }) : 0;
      }
      let rest = Math.min(reclaimed, before.kept - kept);
      if (rest <= 0) return 0;
      const closed = Math.min(owed, rest);
      if (closed > 0) holdLowered(db, id, owed - closed);
      rest -= closed;
      if (rest <= 0) return closed;
      const cuts = creditOf(quoteOf, after);
      let given = 0;
      for (const [column, paid] of [['depositAmount', 'depositPaid'], ['balanceAmount', 'balancePaid']]) {
        if (rest <= 0 || Number(after[paid] || 0) === 1) continue;
        const give = Math.min(rest, Math.max(0, before.cuts[column] - cuts[column]));
        if (give <= 0) continue;
        db.prepare(`UPDATE reservations SET ${column} = ROUND(COALESCE(${column}, 0) + ?, 2) WHERE id = ?`).run(give / 100, id);
        rest -= give;
        given += give;
      }
      return closed + given;
    },
  };
}

// Rule 115 (loop t8 S8-3) — a refund on the trop-perçu deleted gives its money back to the stay (`reopenSettledBy` reopens the `lineLowered`
// rows): that money is note credit again (rule 110 no longer deducts it), so rule 104 credits it to what is still due before anything is owed
// back — the open complement, the solde, the acompte not yet paid — exactly as a sale made AFTER the deletion would have. Taken before the
// reopen, `settle()` after it: the reopened obligation shrinks by what the buckets absorbed. A deletion followed by a sale and a sale followed by
// a deletion end the same way.
function reopenedCredit(db, reservationId, { quoteOf, midStay = null } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!row || !Object.keys(notesByKeyCents(row)).length) return { settle: () => 0 };
  const before = { owed: openLoweredCents(db, id), credit: creditOf(quoteOf, row) };
  return {
    settle() {
      const owed = openLoweredCents(db, id);
      if (owed - before.owed <= 0) return 0;
      const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const taken = creditToBuckets(db, id, owed - before.owed, before.credit, creditOf(quoteOf, after), { complement: true, midStay });
      if (taken > 0) holdLowered(db, id, owed - taken);
      return taken;
    },
  };
}

module.exports = {
  begin, wayBack, reopenedCredit, notesOnKey, noteExcessCents, noteExcessByKey, refundedLoweredLines, refundedLoweredCents, PAID_LINE_REMOVED, LINE_REFUNDED,
};
