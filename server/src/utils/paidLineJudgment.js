/**
 * paidLineJudgment — the one judgment of a write that takes money away from a line a note paid (specs/pricing-components.md rules 23, 104;
 * stabilisation loop t5, S5-1). Every save of a stay passes through it (`applyUpdate`): the fiche's « Enregistrer », the line API
 * (`extraSale.changeLine` / `removeLine`), a sale, a restate. One formula, so a paid line offered in the fiche and the same line offered
 * through its action end the same way.
 *
 *   notesOnKey(db, reservationId, key)  → the cents the stay's notes name on a line key: what the guest paid on that line, whatever it is
 *                                         worth now (a line offered after it was paid still carries it)
 *   refundedLoweredCents(db, reservationId) → the NOTE money a refund on the trop-perçu already gave back (the note part, `noteCents`, of
 *                                         the settled `lineLowered` rows): never a credit again — the engine's note credit (rule 110), the
 *                                         rule-108 refusal and `noteExcessCents` deduct it. A lowered row also holds the stay's own trop-perçu
 *                                         (a solde line discounted): that money given back is no note money (loop t8 B8-2)
 *   noteExcessCents(db, reservationId, lineDiscounts)  → the note money no line claims and no bucket absorbs: received by the establishment
 *                                         beyond the total and not refunded yet (`lineDiscounts`: those a save carries, not stored yet)
 *   wayBack(db, reservationId, opts) / reopenedCredit(db, reservationId, opts) → `{ settle() }`: a write that bills a paid line again or frees
 *                                         its money (rules 109, 118), a refund on the trop-perçu deleted (rule 119), follows rule 104's credit
 *   owedBackByKey(db, reservationId)    → { [key]: cents } the paid lines whose freed money is owed back now (open `lineLowered`)
 *   begin(db, reservationId)            → `{ finish({ overpaid, forced, lineDiscounts, holdOwed }) }`, taken before the write; `finish`, called after the
 *                                         write inside the same transaction, answers the refusal that rolls it back, or null (`overpaid`: the
 *                                         save is about to answer the trop-perçu formula's 409 OVERPAID — only a removal is refused before it;
 *                                         `forced`: the operator confirmed; `lineDiscounts`: the line discounts the save carries, stored after it):
 *     - 409 `LINE_PAID` (« elle peut être offerte, pas retirée ») — a line a note pays left the stay. Its money stays credited until a refund
 *       (rule 23), and a later line of the same article would otherwise inherit the note's key and read as paid (S5-4).
 *     - 409 `LINE_REFUNDED` (« Ligne remboursée : la revendre comme une nouvelle ligne. ») — the write makes a note's key claim again money a
 *       refund on the trop-perçu already gave back (a paid line offered, its excess refunded, then un-offered or un-discounted): the guest
 *       would keep the line AND the money (loop t7 D7-1, rule 108). Taken before the overpaid branch: it is no trop-perçu to confirm.
 *     - 409 `LINE_OWED` — only with `holdOwed` (a reception-only requester, reception-role-checkin-only rule 18): the write bills again a
 *       paid line whose freed money is owed back now (`owedBackByKey`), which would close the administrator's refund decision.
 *     - 409 `OVERPAID` — the write freed note money (a paid line offered, discounted or lowered) and the stay absorbed less of it than it grew
 *       (rule 104 credits it to what is still due first). A note is money the ESTABLISHMENT collected (cash, card terminal, online link), on a
 *       platform stay too (loop t5 A5-1: the platform collected none of it, reservation-refunds rule 38 is about the platform's money): what
 *       nothing absorbs is a trop-perçu the operator confirms, then owed back (`lineLowered` obligation), whatever the channel.
 */
const { toCents } = require('./pricing/money');
const { settledByKey } = require('./pricing/storedLines');
const { parseNotes } = require('./midStayExtras');
const { isDirectChannel } = require('./platformNameFormat');
const { readComplementPaidSplit } = require('./complementPaidSplit');

const PAID_LINE_REMOVED = 'Ligne déjà payée : elle peut être offerte, pas retirée.';
const LINE_REFUNDED = 'Ligne remboursée : la revendre comme une nouvelle ligne.';
// Reception-only: the rule-18 answer itself, no amount and no refund word (reception-role-checkin-only rule 18).
const LINE_OWED = 'Ligne déjà payée : à voir avec l’administrateur.';
const eurosText = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const TABLES = { option: 'reservation_options', resource: 'reservation_resources', custom: 'reservation_custom_options' };
const BUCKETS = ['depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount'];

function notesByKeyCents(row) {
  const byKey = {};
  for (const [key, amount] of Object.entries(settledByKey(row && row.midStaySettledNotes))) byKey[key] = toCents(amount);
  return byKey;
}

// Loop t8 B8-5 — a platform stay's arrival complement is money the ESTABLISHMENT collected (the platform holds the rest), and no trop-perçu
// formula reads it (reservation-refunds rule 38 is about the platform's money): once collected, each line it named claims what it
// collected on it (`complementPaidSplit.lines`, frozen at the flip), exactly as a note does. A direct stay's collected complement is the
// trop-perçu formula's (`complementCollectedExcess`), never read twice. Null split (collected before the column, or adjusted): nothing.
function platformComplementClaims(row) {
  if (!row || isDirectChannel(row.platform)) return null;
  if (Number(row.complementPaid || 0) !== 1 && Number(row.complementPaidCash || 0) !== 1) return null;
  const split = readComplementPaidSplit(row);
  const lines = (split && Array.isArray(split.lines) ? split.lines : []).filter((line) => line && line.key && Number(line.cents) > 0);
  return lines.length ? lines : null;
}

// What the establishment collected per line key and a lowering of the line frees: the notes', and a platform stay's collected arrival
// complement's (`notesOnly`: the notes alone — the engine's note credit, rule 104, reads them only).
function claimsByKeyCents(row, { notesOnly = false } = {}) {
  const byKey = notesByKeyCents(row);
  const complement = notesOnly ? null : platformComplementClaims(row);
  for (const line of complement || []) byKey[line.key] = (byKey[line.key] || 0) + Math.round(Number(line.cents));
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

function loweredCents(db, reservationId, status, column = 'amountCents') {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refund_obligations'").get();
  if (!table) return 0;
  return Number(db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS cents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = ?`)
    .get(Number(reservationId), status).cents);
}
const openLoweredCents = (db, reservationId) => loweredCents(db, reservationId, 'open');
// Every cent the refunds on the trop-perçu gave back (note money or the stay's own), and its note part.
const settledLoweredCents = (db, reservationId) => loweredCents(db, reservationId, 'settled');
const refundedLoweredCents = (db, reservationId) => loweredCents(db, reservationId, 'settled', 'noteCents');
// What the refunds gave back of the money the claims name (`claimsByKeyCents`): the note part on a direct stay; on a platform stay every
// settled cent, since no trop-perçu opens a lowered row there — only money the establishment collected (notes, the arrival complement).
const refundedClaimedCents = (db, row) => (isDirectChannel(row.platform) ? refundedLoweredCents(db, row.id) : settledLoweredCents(db, row.id));

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

function noteExcessCents(db, reservationId, lineDiscounts = null, { notesOnly = false } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? claimsByKeyCents(row, { notesOnly }) : {};
  if (!row || !Object.keys(notes).length) return 0;
  // Loop t6 D6-1 — a refund on the trop-perçu gave part of that money back already (the `lineLowered` rows it settled): the buckets and the
  // notes still count it as received, so it comes off here, or a second lowering would owe it back a second time. Loop t8 B8-2 — every cent
  // given back comes off what the buckets hold beyond the total; only its NOTE part comes off what the notes left unclaimed: the stay's own
  // trop-perçu refunded (a solde line discounted) never cancels a note's money.
  const unabsorbed = unabsorbedCents(row) - settledLoweredCents(db, id);
  const unclaimed = unclaimedCents(notes, factsWith(db, id, lineDiscounts)) - (notesOnly ? refundedLoweredCents(db, id) : refundedClaimedCents(db, row));
  return Math.max(0, Math.min(unabsorbed, unclaimed));
}

// Loop t7 D7-2 (rule 106 d) — per line key a note paid, the note money beyond what the line charges now: what a refund on that line can give
// back of the `lineLowered` obligation. A key whose line still charges what its note paid owes nothing back, whatever a refund gives on it.
function noteExcessByKey(db, reservationId) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? claimsByKeyCents(row) : {};
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
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const listed = [...refundedNoteLines(db, row), ...refundedStayLines(db, row)];
  return listed.filter((line, index) => listed.findIndex((other) => other.key === line.key) === index);
}

function refundedNoteLines(db, row) {
  const notes = row ? claimsByKeyCents(row) : {};
  if (!Object.keys(notes).length) return [];
  const refunded = refundedClaimedCents(db, row);
  if (refunded <= 0) return [];
  const facts = lineFactsOf(db, row.id);
  const unclaimed = unclaimedCents(notes, facts);
  return Object.entries(notes)
    .filter(([key, paid]) => facts[key] && paid - netOf(facts[key]) > 0 && unclaimed - (paid - netOf(facts[key])) < refunded)
    .map(([key]) => ({ key, table: facts[key].table, lineId: Number(facts[key].lineId) }));
}

// Loop t9 B9-4 — a line the paid acompte or solde carried whose freed money is more than the stay still holds (`stayRefundGuard`).
function refundedStayLines(db, row) {
  const guard = stayRefundGuard(db, row);
  if (!guard) return [];
  const facts = lineFactsOf(db, row.id);
  const keyOf = new Map(Object.entries(facts).map(([key, fact]) => [`${fact.table}:${Number(fact.lineId)}`, key]));
  return stayFreedLines(db, row.id)
    .filter((line) => line.cents > guard.held && keyOf.has(`${line.table}:${line.lineId}`))
    .map((line) => ({ key: keyOf.get(`${line.table}:${line.lineId}`), table: line.table, lineId: line.lineId }));
}

// reception-role-checkin-only rule 18 (loop t8 A8-1) — the paid lines whose freed money is owed back right now (an open `lineLowered`
// obligation): putting one back to billed would close that refund decision, which is the administrator's. Read-only. → { [key]: cents }
function owedBackByKey(db, reservationId) {
  const id = Number(reservationId);
  return openLoweredCents(db, id) > 0 ? noteExcessByKey(db, id) : {};
}

// What the stay owes back on lowered paid lines, in the register (rule 23): held at `cents`.
function holdLowered(db, reservationId, cents) {
  const obligations = require('../models/refundObligationsModel');
  if (obligations.ready()) obligations.trimLowered(Number(reservationId), cents);
}

// Rule 108, reading of 2026-11-16 (loop t9 B9-4) — the same refusal for the stay's OWN money: a line the paid acompte or solde carried
// (its captured `acompteContribTtc` / `soldeContribTtc`), offered or discounted, the trop-perçu it left refunded, then charged again. The
// money that would pay it again is what the stay still holds beyond its total (the trop-perçu formula); what a write claims back beyond
// that was given back already: the guest would keep the line AND the money. Only on a direct stay a refund on the trop-perçu gave its own
// money back on (a platform's solde is the platform's, rule 38).
const CONTRIB_TABLES = [['reservation_options', 'option', 'totalPrice'], ['reservation_resources', 'resource', 'totalPrice'], ['reservation_custom_options', 'custom', 'amount']];
// Per line the paid acompte and solde carried: what they captured on it beyond what it charges now. → [{ table, lineId, cents }]
function stayFreedLines(db, id, lineDiscounts = null) {
  const row = db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(id);
  if (!row) return [];
  // A line discount the save carries is stored after it (`lineDiscounts`, by line key): weighed here already, as `factsWith` does.
  const carried = new Map();
  if (lineDiscounts && typeof lineDiscounts === 'object') {
    const facts = lineFactsOf(db, id);
    for (const [key, cents] of Object.entries(lineDiscounts)) {
      if (facts[key]) carried.set(`${facts[key].table}:${Number(facts[key].lineId)}`, Math.max(0, Math.round(Number(cents) || 0)));
    }
  }
  const out = [];
  for (const [table, short, total] of CONTRIB_TABLES) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    if (!columns.has('soldeContribTtc') || !columns.has('acompteContribTtc') || !columns.has('lineId')) continue;
    const discount = columns.has('discountCents') ? 'discountCents' : '0 AS discountCents';
    for (const line of db.prepare(`SELECT lineId, ${total} AS total, offered, ${discount}, acompteContribTtc, soldeContribTtc FROM ${table} WHERE reservationId = ?`).all(id)) {
      const contrib = (Number(row.depositPaid || 0) === 1 ? toCents(line.acompteContribTtc) : 0) + (Number(row.balancePaid || 0) === 1 ? toCents(line.soldeContribTtc) : 0);
      const discount = carried.has(`${short}:${Number(line.lineId)}`) ? carried.get(`${short}:${Number(line.lineId)}`) : Math.max(0, Number(line.discountCents || 0));
      const net = Number(line.offered || 0) === 1 ? 0 : Math.max(0, toCents(line.total) - discount);
      if (contrib - net > 0) out.push({ table: short, lineId: Number(line.lineId), cents: contrib - net });
    }
  }
  return out;
}
const stayFreedCents = (db, id, lineDiscounts = null) => stayFreedLines(db, id, lineDiscounts).reduce((sum, line) => sum + line.cents, 0);

function stayRefundGuard(db, row) {
  if (!row || !isDirectChannel(row.platform)) return null;
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('reservation_refunds', 'reservation_refund_lines')").get().n;
  if (tables !== 2) return null;
  const refundsModel = require('../models/refundsModel').createModel(db);
  const refundedStay = Math.round(refundsModel.overpaymentRefundedTtc(row.id) * 100) - refundedLoweredCents(db, row.id);
  if (refundedStay <= 0) return null;
  const { overpaymentContext } = require('../models/refundInputModel');
  const { overpayment } = require('./pricing/refunds/overpayment');
  const ctx = overpaymentContext(db, row.id);
  return { freed: stayFreedCents(db, row.id), held: ctx ? overpayment(ctx).cents : 0 };
}

function begin(db, reservationId) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const stayGuard = stayRefundGuard(db, row);
  const refusedOnStayMoney = (lineDiscounts = null) => stayGuard && stayGuard.freed - stayFreedCents(db, id, lineDiscounts) > stayGuard.held;
  const notes = row ? claimsByKeyCents(row) : {};
  if (!row || !Object.keys(notes).length) {
    return { finish: ({ lineDiscounts = null } = {}) => (refusedOnStayMoney(lineDiscounts) ? { status: 409, body: { error: LINE_REFUNDED, code: 'LINE_REFUNDED' } } : null) };
  }
  const facts = lineFactsOf(db, id);
  const paidLines = Object.keys(notes).filter((key) => facts[key]).map((key) => ({ key, table: facts[key].table, lineId: Number(facts[key].lineId) }));
  const before = {
    unabsorbed: unabsorbedCents(row), owed: openLoweredCents(db, id), unclaimed: unclaimedCents(notes, facts), refunded: refundedClaimedCents(db, row),
  };
  const owedBack = before.owed > 0 ? noteExcessByKey(db, id) : {};
  return {
    finish({ overpaid = false, forced = false, lineDiscounts = null, holdOwed = false } = {}) {
      const removed = paidLines.find(({ table, lineId }) => !db.prepare(`SELECT 1 FROM ${TABLES[table]} WHERE lineId = ? AND reservationId = ?`).get(lineId, id));
      if (removed) return { status: 409, body: { error: PAID_LINE_REMOVED, code: 'LINE_PAID' } };
      const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const unclaimedAfter = unclaimedCents(claimsByKeyCents(after), factsWith(db, id, lineDiscounts));
      // Rule 108 — a note claiming again what a refund gave back: the line is sold anew, never put back.
      if (unclaimedAfter < before.unclaimed && unclaimedAfter < before.refunded) return { status: 409, body: { error: LINE_REFUNDED, code: 'LINE_REFUNDED' } };
      if (refusedOnStayMoney(lineDiscounts)) return { status: 409, body: { error: LINE_REFUNDED, code: 'LINE_REFUNDED' } };
      // Reception-role-checkin-only rule 18 (loop t8 A8-1) — a reception write never bills again a paid line whose money is owed back.
      if (holdOwed) {
        const excessAfter = noteExcessByKey(db, id);
        if (Object.entries(owedBack).some(([key, cents]) => (excessAfter[key] || 0) < cents)) {
          return { status: 409, body: { error: LINE_OWED, code: 'LINE_OWED' } };
        }
      }
      // A trop-perçu the save is about to ask confirmation of (409 OVERPAID) is that refusal's: once confirmed, it is owed back.
      if (overpaid) return null;
      const freed = unclaimedAfter - before.unclaimed;
      if (freed <= 0) {
        // Loop t9 (B9-3 follow-up) — no paid line freed money, yet the stay now holds more beyond its total: a line rule 104's credit had paid
        // was offered, lowered or removed, and the credit comes back. It is owed back again as it was before that line took it — up to what
        // the claims still hold unclaimed (`noteExcessCents`), never more. On a platform stay the register is the only face of that money.
        const owedNow = openLoweredCents(db, id);
        const regained = Math.min(unabsorbedCents(after) - before.unabsorbed - (owedNow - before.owed), noteExcessCents(db, id, lineDiscounts) - owedNow);
        if (regained > 0) holdLowered(db, id, owedNow + regained);
        return null;
      }
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
// Rule 118 (loop t8 S8-2) — and the way OUT, the same gesture the other way: a write that FREES note money (a paid line offered at the SAS)
// credits it as the line API does (`pinSaleDelta`): the solde, then the acompte, not yet paid lose what the engine's credit now takes off them,
// bounded by the money freed and by what the stay gained beyond its buckets. What no bucket absorbs is left to the judgment (`begin`), which
// answers the trop-perçu. Same gesture, same result, whichever screen.
//   quoteOf(row) → the engine's quote of the stored stay (`quoteStoredReservation`), or null
//   billedCents() → what the stay's lines bill now, when the writer moves `finalPrice` by it only after `settle` (the SAS: `moveFinalPriceBy`)
//   midStay(lines) → stores the engine's credited end-of-stay lines (`syncMidStayComplement`), for the way out
function wayBack(db, reservationId, { quoteOf, billedCents = null, midStay = null } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const notes = row ? claimsByKeyCents(row) : {};
  if (!row || !Object.keys(notes).length) return { settle: () => 0 };
  const before = {
    unclaimed: unclaimedCents(notes, lineFactsOf(db, id)), kept: unabsorbedCents(row) - openLoweredCents(db, id), cuts: creditOf(quoteOf, row),
    billed: billedCents ? billedCents() : 0,
  };
  return {
    settle() {
      const after = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const reclaimed = before.unclaimed - unclaimedCents(claimsByKeyCents(after), lineFactsOf(db, id));
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

// Rule 119 (loop t8 S8-3) — a refund on the trop-perçu deleted gives its money back to the stay (`reopenSettledBy` reopens the `lineLowered`
// rows): that money is note credit again (rule 110 no longer deducts it), so rule 104 credits it to what is still due before anything is owed
// back — the open complement, the solde, the acompte not yet paid — exactly as a sale made AFTER the deletion would have. Taken before the
// reopen, `settle()` after it: the reopened obligation shrinks by what the buckets absorbed. A deletion followed by a sale and a sale followed by
// a deletion end the same way.
function reopenedCredit(db, reservationId, { quoteOf, midStay = null } = {}) {
  const id = Number(reservationId);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  // Loop t9 B9-2 (rule 121) — the stay's own over-collected money given back by the deleted refund is credit again too, not only a note's.
  if (!row) return { settle: () => 0 };
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
  begin, wayBack, reopenedCredit, notesOnKey, noteExcessCents, noteExcessByKey, refundedLoweredLines, refundedLoweredCents, platformComplementClaims,
  owedBackByKey, settledLoweredCents, PAID_LINE_REMOVED, LINE_REFUNDED,
};
