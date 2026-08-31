/**
 * Reservations model — the sole DB access layer for the reservations domain
 * (reservations + reservation_options / reservation_custom_options / reservation_resources /
 * reservation_nights / reservation_history), plus the availability/capacity queries.
 *
 * Factory `create(db)` (+ a default bound to the production database), mirroring settingsModel.
 * SQL is moved verbatim from the former routes/reservations.js to preserve behavior exactly.
 */

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');
const { formatPlatformName, DIRECT_CHANNELS } = require('../utils/platformNameFormat');
const { formatTimeShort } = require('../utils/dateFr');
const { timeToHour, addIsoDays, EARLY_CHECKIN_BLOCK_HOUR, LATE_CHECKOUT_BLOCK_HOUR } = require('../utils/occupancy');
const { getOptionsSignature, getResourcesSignature, buildHistoryRows } = require('../utils/reservationAudit');
const { computeBedLinenAlert } = require('../utils/bedLinenAdequacy');
const { computePaymentStatus } = require('../utils/paymentStatus');

// Own channels, bound as NAMED parameters (the deadline read already uses `@today`, and better-sqlite3
// refuses a mix of named and positional binds). Single-sourced from platformNameFormat so adding a
// channel there reaches this read for free.
const DIRECT_CHANNEL_LIST = [...DIRECT_CHANNELS];
const DIRECT_CHANNEL_PLACEHOLDERS = DIRECT_CHANNEL_LIST.map((_, i) => `@directChannel${i}`).join(', ');
const DIRECT_CHANNEL_PARAMS = Object.fromEntries(
  DIRECT_CHANNEL_LIST.map((channel, i) => [`directChannel${i}`, channel]),
);
const { generateReservationNumber } = require('../utils/reservationNumber');
const { isPlatformCollectingTouristTax, getTypeMultiplier } = require('../utils/pricing');
const { isCleaningOption } = require('../utils/cleaningOption');
const { buildCheckoutComplement, END_OF_STAY_CLEANING_LABEL } = require('../utils/checkoutComplement');
const {
  buildExtrasBaseline, mergeMidStayIntoDetail, parseBaseline, extraLineKey,
  buildMidStayLine, parseNotes, nextNoteId, storedMidStayLines, resolveMidStaySplit, MID_STAY_SOURCE,
} = require('../utils/midStayExtras');
const { priceOptionSale, billablePersons } = require('../utils/sasOptionSale');
const { reconcileEndOfStayLines, isAdjustmentLine } = require('../utils/endOfStayAdjustment');
const { splitComplementByPoste, allocateComplementAdjustment, parseComplementAllocation } = require('../utils/complementAllocation');
const { buildOperationalCollection } = require('../utils/operationalCollection');
const { hasGuestArrived } = require('../utils/arrivalMoment');
const { bucketStates } = require('../utils/reservationSettlement');
const { resolveStayPayment } = require('../utils/stayPayment');
const { serialiseGroup, groupCovers, parseGroup, collectibleArrivalBuckets } = require('../utils/arrivalPaymentGroup');
const { captureContribsOnFlip, clearContribsOnUnflip } = require('../utils/forceItemContribsCapture');
const { buildArrivalPaymentDetail } = require('../utils/arrivalPaymentDetail');
const { resolveArrivalPaymentAdjustment } = require('../utils/arrivalPaymentAdjustment');
const bookingLinesModel = require('./bookingLinesModel');

// Label of the bath-linen line the arrival SAS may add (shared by the commit + the re-open
// reconstruction, like « Ménage »). specs/sas-bath-linen-upsell.md §3.1 rule 4.
const BATH_LINEN_LABEL = 'Linge de toilette';
const establishmentClosuresModel = require('./establishmentClosuresModel');
const { buildHistoryNameContext } = require('./historyNamesModel');
const { dropBathLinenGhost } = require('../utils/bathLinenGhostLine');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// End-of-stay complement detail (JSON array) → lines, tolerant to NULL / legacy garbage.
function parseDetailLines(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Business error the controller maps to a 409 with its code (specs/mid-stay-notes.md §4.3).
function midStayError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Platform-sourced reservations carry `clientGrossAmount` (what the guest paid the platform, TTC).
// The owner's net stays in `finalPrice`. Commission = gross − net (clipped to 0). Null on direct bookings
// and on platform bookings without a recorded gross.
// specs/caution-live-from-property.md §3 — the caution amount a reservation displays is LIVE from the
// property's current `defaultCautionAmount` until the caution is received, then FROZEN to the amount
// actually collected (stored in `reservations.cautionAmount`, frozen at receipt). Expects a row carrying
// `cautionReceived`, `cautionAmount` and `propertyDefaultCautionAmount`.
function resolveEffectiveCaution(row) {
  if (!row) return 0;
  if (Number(row.cautionReceived || 0) === 1) return Number(row.cautionAmount || 0);
  return Number(row.propertyDefaultCautionAmount || 0);
}

function deriveCommissionAmount(row) {
  if (!row) return null;
  if (String(row.platform || '').toLowerCase() === 'direct') return null;
  if (row.clientGrossAmount == null) return null;
  const gross = Number(row.clientGrossAmount);
  if (!Number.isFinite(gross)) return null;
  const net = Number(row.finalPrice || 0);
  return Math.max(0, Math.round((gross - net) * 100) / 100);
}

// specs/recall-unpaid-arrival-complement-at-checkout.md §3 rule 6 — itemise the arrival complement from a
// detailed reservation (the shape returned by getByIdWithDetails). Lines = the in-complement (non-offered)
// options / resources / custom options + the tourist-tax-in-complement line + a remainder line so the
// listed detail always sums to the authoritative `complementAmount`. Pure → unit-tested.
//
// specs/sas-offer-complement-lines.md §4.3 — every line carries a `ref` = the row behind it, which is
// what lets the SAS offer it. With `includeOffered` (SAS payload only) the already-offered extras are
// listed too, at `amount: 0` with their real price in `originalAmount`, so a gesture can be undone; the
// listed detail still sums to `complementAmount`. Every other consumer (J-2 email, recall display) keeps
// the billed-lines-only view.
// Les extras d'une réservation détaillée, dans la forme que `midStayExtras` sait découper
// (`readExtraLines` fait le même travail depuis SQL ; ici la réservation est déjà chargée).
function readExtraLinesFromDetailed(r) {
  const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
  return [
    ...(r.options || []).map((o) => (Number(o.isCustom || 0) === 1
      ? {
        isCustom: true, title: o.description || o.title,
        totalPrice: Number(o.offered || 0) === 1 ? 0 : num(o.totalPrice != null ? o.totalPrice : o.amount),
        offered: Number(o.offered || 0), inComplement: Number(o.inComplement || 0),
      }
      : {
        optionId: Number(o.optionId),
        totalPrice: Number(o.offered || 0) === 1 ? 0 : num(o.totalPrice),
        offered: Number(o.offered || 0), inComplement: Number(o.inComplement || 0),
      })),
    ...(r.resources || []).map((res) => ({
      resourceId: Number(res.resourceId),
      totalPrice: Number(res.offered || 0) === 1 ? 0 : num(res.totalPrice),
      offered: Number(res.offered || 0), inComplement: Number(res.inComplement || 0),
    })),
  ];
}

// specs/arrival-payment-detail-and-adjustment.md rule 23 — the réduction and the pourboire belong to
// ONE payment; when that payment goes, they go with it. Guarded: several minimal test schemas have
// neither column, and there is then nothing to clear.
function clearArrivalPaymentAdjustment(database, reservationId) {
  try {
    database.prepare("UPDATE reservations SET arrivalPaymentReduction = NULL, arrivalPaymentTip = NULL, updatedAt = datetime('now') WHERE id = ?")
      .run(reservationId);
  } catch {
    // No adjustment columns here: nothing to clear.
  }
}

function arrivalComplementDetailFromReservation(r, { includeOffered = false } = {}) {
  if (!r) return { amount: 0, paid: 0, detail: [] };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const lines = [];
  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.2 — une ligne « en complément » peut avoir
  // déjà quitté le complément d'ARRIVÉE : la part vendue en cours de séjour est facturée en fin de
  // séjour. La lister ici à son prix plein la faisait apparaître DEUX FOIS sur la carte fusionnée
  // (une fois côté arrivée, une fois côté fin de séjour) et rompait l'invariant de cette fonction —
  // « le détail somme au montant du complément » (Adrien, 2026-08-22). On retire donc la part
  // déplacée, clé par clé, avec le même découpage que le moteur et la comptabilité.
  const midStayByKey = { ...(resolveMidStaySplit(readExtraLinesFromDetailed(r), {
    baseline: r.arrivalExtrasBaseline,
    settled: Number(r.endOfStayComplementPaid || 0) === 1 || Number(r.endOfStayComplementPaidCash || 0) === 1,
    storedLines: storedMidStayLines(r.endOfStayComplementDetail),
    notes: r.midStaySettledNotes,
  }).byKey || {}) };
  // Consommée au fur et à mesure : deux lignes personnalisées de même libellé partagent une clé.
  const withoutMidStay = (line, real) => {
    const key = extraLineKey(line);
    const moved = Math.min(real, round2(midStayByKey[key] || 0));
    if (moved <= 0) return real;
    midStayByKey[key] = round2(midStayByKey[key] - moved);
    return round2(real - moved);
  };
  // `qty`/`unitPrice`/`kind` (specs/j2-email-coffee-and-sas-complement.md) are additive: they let the
  // J-2 email render the same « label : qté × prix = total » lines as the SAS recap, and localise the
  // system labels (tax / remainder) per language. Existing consumers reading `label`/`amount` are
  // unaffected. `qty` mirrors the SAS: billedUnits, else quantity, else 1.
  for (const o of (r.options || [])) {
    if (Number(o.inComplement || 0) !== 1) continue;
    const offered = Number(o.offered || 0) === 1;
    if (offered && !includeOffered) continue;
    const isCustom = Number(o.isCustom || 0) === 1;
    const full = round2(offered
      ? (o.originalTotalPrice != null ? o.originalTotalPrice : o.totalPrice)
      : (o.totalPrice != null ? o.totalPrice : o.originalTotalPrice));
    const real = offered ? full : withoutMidStay(
      isCustom ? { isCustom: true, title: o.description || o.title } : { optionId: Number(o.optionId) },
      full,
    );
    if (real <= 0) continue;
    lines.push({
      kind: 'option', label: String(o.title || o.description || 'Extra').trim(),
      qty: Number(o.billedUnits || o.quantity || 1), unitPrice: round2(o.unitPrice),
      amount: offered ? 0 : real,
      ref: { kind: isCustom ? 'custom' : 'option', id: Number(isCustom ? o.customOptionId : o.optionId) },
      ...(offered ? { offered: 1, originalAmount: real } : {}),
    });
  }
  for (const res of (r.resources || [])) {
    if (Number(res.inComplement || 0) !== 1) continue;
    const offered = Number(res.offered || 0) === 1;
    if (offered && !includeOffered) continue;
    const full = round2(offered
      ? (res.originalTotalPrice != null ? res.originalTotalPrice : res.totalPrice)
      : (res.totalPrice != null ? res.totalPrice : res.originalTotalPrice));
    const real = offered ? full : withoutMidStay({ resourceId: Number(res.resourceId) }, full);
    if (real <= 0) continue;
    lines.push({
      kind: 'resource', label: String(res.name || 'Ressource').trim(),
      qty: Number(res.billedUnits || res.quantity || 1), unitPrice: round2(res.unitPrice),
      amount: offered ? 0 : real,
      ref: { kind: 'resource', id: Number(res.resourceId) },
      ...(offered ? { offered: 1, originalAmount: real } : {}),
    });
  }
  const tax = round2(r.touristTaxInComplementAmount || 0);
  if (tax > 0) lines.push({ kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: tax, amount: tax });
  const amount = round2(r.complementAmount || 0);
  const listed = round2(lines.reduce((s, l) => s + l.amount, 0));
  const remainder = round2(amount - listed);
  if (remainder > 0.01) lines.push({ kind: 'remainder', label: "Complément d'arrivée", qty: 1, unitPrice: remainder, amount: remainder });
  return { amount, paid: Number(r.complementPaid || 0) === 1 ? 1 : 0, detail: lines };
}

function createReservationsModel(database) {
  // Per-reservation breakfast time (specs/breakfast-time.md). Persisted via a dedicated guarded
  // write so the core INSERT/UPDATE SQL stays untouched; absent in minimal test schemas → no-op.
  const HAS_RESERVATION_BREAKFAST_TIME = (() => {
    try { return database.prepare("PRAGMA table_info(reservations)").all().some((c) => c.name === 'breakfastTime'); }
    catch { return false; }
  })();
  function persistBreakfastTime(reservationId, payload) {
    if (!HAS_RESERVATION_BREAKFAST_TIME || !payload || payload.breakfastTime === undefined) return;
    const raw = String(payload.breakfastTime || '').trim();
    const value = raw === '' ? null : (formatTimeShort(raw) || null); // '' / invalid → NULL = use option default
    database.prepare('UPDATE reservations SET breakfastTime = ? WHERE id = ?').run(value, reservationId);
    applyBreakfastTimeToOccurrences(reservationId, value);
  }
  // specs/sas-breakfast-time-applies.md §3 — the breakfast hour of a stay lives in TWO places since the
  // planning cards shipped: `reservations.breakfastTime` and, per served morning, the `time` of the
  // breakfast option's `cardOccurrences`. The planning card and the push notice read the occurrence, so
  // a new hour that only lands on the reservation is invisible. Writing the hour therefore rewrites
  // every occurrence of the stay; clearing it puts them back on the option default. Guarded: no
  // `cardOccurrences` column, no breakfast option, or no stored occurrence → no-op.
  function applyBreakfastTimeToOccurrences(reservationId, timeOrNull) {
    let optionRow;
    try {
      optionRow = database.prepare(`
        SELECT ro.optionId AS optionId, ro.cardOccurrences AS cardOccurrences, o.breakfastTime AS optionTime
          FROM reservation_options ro JOIN options o ON o.id = ro.optionId
         WHERE ro.reservationId = ? AND o.autoOptionType = 'breakfast'
         ORDER BY ro.optionId LIMIT 1
      `).get(reservationId);
    } catch { return; } // minimal test schema without cardOccurrences / autoOptionType
    if (!optionRow || !optionRow.cardOccurrences) return;
    let occurrences = [];
    try { occurrences = JSON.parse(optionRow.cardOccurrences) || []; } catch { return; }
    if (!Array.isArray(occurrences) || occurrences.length === 0) return;
    const nextTime = timeOrNull || formatTimeShort(optionRow.optionTime) || '09:00';
    const next = occurrences.map((occ) => ({ ...occ, time: nextTime }));
    database.prepare('UPDATE reservation_options SET cardOccurrences = ? WHERE reservationId = ? AND optionId = ?')
      .run(JSON.stringify(next), reservationId, optionRow.optionId);
  }
  // Per-reservation email language (specs/email-language-fr-en.md). Guarded; 'en' or 'fr' (default), only
  // written when the payload carries it. Absent column (minimal test schema) → no-op.
  const HAS_EMAIL_LANGUAGE = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'emailLanguage'); }
    catch { return false; }
  })();
  function persistEmailLanguage(reservationId, payload) {
    if (!HAS_EMAIL_LANGUAGE || !payload || payload.emailLanguage === undefined) return;
    const value = String(payload.emailLanguage || '').toLowerCase() === 'en' ? 'en' : 'fr';
    database.prepare('UPDATE reservations SET emailLanguage = ? WHERE id = ?').run(value, reservationId);
  }
  // « En fin de séjour » marker (specs/defer-arrival-complement-to-checkout.md §3.2 rule 5). Guarded
  // so minimal test schemas without the column simply skip the write.
  const HAS_COMPLEMENT_DEFERRED = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'complementDeferredToCheckout'); }
    catch { return false; }
  })();
  // specs/adjustable-complement-amounts.md §3.1 rule 3 — '' / null = « no adjustment », i.e. the bucket
  // keeps whatever the engine (or the sum of the lines) produces. `undefined` means « the caller
  // didn't say », so the stored value is left alone; an explicit '' clears it.
  const toOverride = (v) => (v === undefined ? undefined
    : (v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v))));
  function persistComplementOverrides(reservationId, { complementAmountOverride, endOfStayComplementAmountOverride } = {}) {
    if (!HAS_COMPLEMENT_OVERRIDES) return;
    const arrival = toOverride(complementAmountOverride);
    const endOfStay = toOverride(endOfStayComplementAmountOverride);
    if (arrival !== undefined) {
      database.prepare("UPDATE reservations SET complementAmountOverride = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(arrival, reservationId);
    }
    if (endOfStay !== undefined) {
      database.prepare("UPDATE reservations SET endOfStayComplementAmountOverride = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(endOfStay, reservationId);
      // The adjustment materialises as a detail line, so the stored amount has to be rebuilt right
      // away — and NOT through `syncMidStayComplement`, whose « already collected » guard would skip
      // a correction made precisely because the money was collected wrong (§3.3 rule 22).
      model.applyEndOfStayAdjustment(reservationId);
    }
  }

  // specs/adjustable-complement-amounts.md §3.1 rule 4 + §3.2 — le montant annoncé a le dernier mot.
  // Les SAS déplacent `complementAmount` EN DIRECT, hors moteur de prix (le commit du SAS arrivée qui
  // ajoute ses lignes, « Offrir » qui en passe une à 0) : sans ce rappel, un passage au SAS effacerait
  // silencieusement l'ajustement jusqu'au prochain enregistrement de la fiche, et la ventilation
  // comptable stockée resterait accrochée à un montant qui n'existe plus.
  // `autoAmount` = ce que le SAS vient d'écrire, c'est-à-dire le montant du moteur sans l'ajustement :
  // c'est la base sur laquelle la ventilation se recalcule.
  function reapplyComplementOverride(reservationId, autoAmount) {
    if (!HAS_COMPLEMENT_OVERRIDES) return;
    const row = database.prepare('SELECT complementAmount, complementAmountOverride FROM reservations WHERE id = ?').get(reservationId);
    if (!row || row.complementAmountOverride == null) return;
    const target = Math.max(0, round2(row.complementAmountOverride));
    if (round2(row.complementAmount) !== target) {
      database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(target, reservationId);
    }
    model.syncComplementAllocation(reservationId, { autoAmount });
  }

  function persistComplementDeferred(reservationId, deferred) {
    if (!HAS_COMPLEMENT_DEFERRED) return;
    database.prepare("UPDATE reservations SET complementDeferredToCheckout = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(deferred ? 1 : 0, reservationId);
  }
  // Human-readable reservation number (specs/reservation-number-and-search.md §3). Guarded so minimal
  // test schemas without the column simply skip it.
  const HAS_RESERVATION_NUMBER = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'reservationNumber'); }
    catch { return false; }
  })();
  // Applied after the core INSERT/UPDATE (like persistBreakfastTime). Rules:
  //   - only `kind='reservation'` rows get a number (devis keep devisNumber);
  //   - a non-empty `payload.reservationNumber` is an operator override → stored verbatim (trimmed).
  //     Uniqueness is enforced by the controller (→ 400) before we get here; the partial unique index
  //     is the last-resort guard;
  //   - otherwise (undefined / blank) keep the existing number, and GENERATE one when missing — this
  //     covers creation AND devis→reservation conversion (kind just flipped, still numberless).
  function persistReservationNumber(reservationId, payload) {
    if (!HAS_RESERVATION_NUMBER) return;
    const row = database.prepare('SELECT reservationNumber, kind FROM reservations WHERE id = ?').get(reservationId);
    if (!row || row.kind !== 'reservation') return;
    const override = payload && payload.reservationNumber !== undefined ? String(payload.reservationNumber).trim() : '';
    if (override) {
      database.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run(override, reservationId);
      return;
    }
    if (!row.reservationNumber) {
      database.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?')
        .run(generateReservationNumber(database), reservationId);
    }
  }
  // Every write to reservation_options / _custom_options / _resources / _nights goes through this
  // shared store, which `devisModel` uses too (specs/devis-extras-parity-and-price-lock.md §4.1).
  const bookingLines = bookingLinesModel.buildModel(database);
  // « This option row was added by the arrival SAS » (specs/sas-upsells-activate-catalogue-option.md
  // §3.2 rule 5). Guarded so minimal test schemas without the column simply behave as legacy.
  const HAS_RO_SAS_ARRIVAL_ORIGIN = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'sasArrivalOrigin'); }
    catch { return false; }
  })();
  // Check-in / check-out hours of the stay — they bound the moments a card option can be served on
  // (specs/sas-breakfast-and-catering-upsell.md §3.2). Guarded: a minimal schema falls back to the
  // usual 15:00 / 10:00.
  const HAS_RESERVATION_CHECK_TIMES = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'checkInTime'); }
    catch { return false; }
  })();
  // Per-reservation moments of a card option (specs/option-planning-card.md §3.2). The arrival SAS
  // writes them when it sells the breakfast / a meal; guarded like every other optional column.
  const HAS_RO_CARD_OCCURRENCES = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'cardOccurrences'); }
    catch { return false; }
  })();
  // Served persons of a per-person card option (specs/card-option-served-persons.md §5), and the
  // property capacity that bounds it. Guarded like every other optional column.
  const HAS_RO_CARD_PERSONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'cardPersons'); }
    catch { return false; }
  })();
  const HAS_PROPERTY_MAX_GUESTS = (() => {
    try { return database.prepare('PRAGMA table_info(properties)').all().some((c) => c.name === 'maxGuests'); }
    catch { return false; }
  })();
  // Hours placed on real slots (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4). Same guard
  // rationale: a minimal test schema without the column just never writes a session.
  const HAS_RR_SESSIONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions'); }
    catch { return false; }
  })();
  // Extras baseline captured when the stay starts (specs/mid-stay-extras-to-end-of-stay-complement.md
  // §3.1). Guarded so minimal test schemas without the column simply never route anything to the
  // end-of-stay complement (legacy behaviour).
  const HAS_ARRIVAL_EXTRAS_BASELINE = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'arrivalExtrasBaseline'); }
    catch { return false; }
  })();
  // « Notes en séjour » register (specs/mid-stay-notes.md §3.1). Same guard rationale.
  const HAS_MID_STAY_NOTES = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'midStaySettledNotes'); }
    catch { return false; }
  })();

  // specs/adjustable-complement-amounts.md §3.3 — the operator's amount for the end-of-stay
  // complement. Guarded like every other late column so minimal test schemas simply see « no
  // adjustment » and behave exactly as before.
  const HAS_COMPLEMENT_OVERRIDES = (() => {
    try {
      const cols = database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
      return cols.includes('complementAmountOverride') && cols.includes('endOfStayComplementAmountOverride');
    } catch { return false; }
  })();
  const HAS_COMPLEMENT_ALLOCATION = (() => {
    try { return database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'complementAllocation'); }
    catch { return false; }
  })();
  function readEndOfStayOverride(reservationId) {
    if (!HAS_COMPLEMENT_OVERRIDES) return null;
    const row = database.prepare('SELECT endOfStayComplementAmountOverride FROM reservations WHERE id = ?').get(reservationId);
    return row && row.endOfStayComplementAmountOverride != null ? Number(row.endOfStayComplementAmountOverride) : null;
  }

  // Quand la base de référence des extras doit-elle exister ? — specs/mid-stay-extras-to-end-of-stay-complement.md
  // §3.1 rule 3, élargi le 2026-08-22 puis corrigé le 2026-08-24.
  //
  // Elle marquait « le séjour a commencé », par le calendrier. Deux corrections successives :
  //
  // 1. Il manquait le cas qui perd de l'argent : **un complément d'arrivée déjà encaissé est clos**.
  //    Ce qu'on vend après, séjour commencé ou non, ne peut plus y entrer — le moteur le gèle — et
  //    sans base de référence il n'entrait nulle part non plus : une option de 30 € ajoutée sur un
  //    complément encaissé montait le total du séjour sans qu'aucune échéance ne la réclame
  //    (constaté en production le 2026-08-22). L'encaissement ferme donc le bucket.
  // 2. Le calendrier répondait à une AUTRE question que « le client est-il là ? »
  //    (specs/arrival-moment-is-the-check-in.md). Le jour de l'arrivée, avant tout check-in, la base
  //    était déjà posée : une option ajoutée à la main passait donc pour « vendue en cours de séjour »
  //    et partait au complément de fin de séjour. L'arrivée est un acte de l'opérateur — le check-in
  //    ou le SAS d'arrivée —, jamais une date.
  const arrivalExtrasBaselineIsDue = (row) => {
    if (Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1) return true;
    return hasGuestArrived(row);
  };

  // Single write point for « the end-of-stay complement + its register »: the detail, the re-summed
  // amount and the notes always move together, so the remainder + register invariant can't drift.
  const writeEndOfStayDetail = (reservationId, detailLines, notes) => {
    // An OFFERED line (specs/sas-offer-complement-lines.md §3.3) is worth 0 € but must survive every
    // rewrite: it is the trace of the geste commercial and the only way to un-offer it on a re-open.
    // The « Ajustement » line is filtered out here on purpose: it is not a real line, it is recomputed
    // just below from whatever the real ones now weigh.
    const real = (detailLines || [])
      .filter((l) => l && !isAdjustmentLine(l))
      .filter((l) => round2(l.amount) > 0 || Number(l.offered || 0) === 1);
    // specs/adjustable-complement-amounts.md §3.3 rule 20 — every path that rewrites the detail goes
    // through here, so the operator's adjustment is re-applied by all of them: the mid-stay sync of a
    // fiche save, settling or cancelling a note, offering a line, a departure-SAS re-run.
    const { lines, amount } = reconcileEndOfStayLines({ lines: real, override: readEndOfStayOverride(reservationId) });
    const detailJson = lines.length ? JSON.stringify(lines) : null;
    if (!HAS_MID_STAY_NOTES) {
      database.prepare("UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(amount, detailJson, reservationId);
      return amount;
    }
    database.prepare(`UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?,
                             midStaySettledNotes = ?, updatedAt = datetime('now') WHERE id = ?`)
      .run(amount, detailJson, (notes && notes.length) ? JSON.stringify(notes) : null, reservationId);
    return amount;
  };
  // Resources live in their own pair of tables, absent from the minimal SAS test schemas — guarded so
  // an offer run there simply has no resource line to look at.
  const HAS_RESOURCE_TABLES = (() => {
    try {
      return database.prepare('PRAGMA table_info(reservation_resources)').all().length > 0
        && database.prepare('PRAGMA table_info(resources)').all().length > 0;
    } catch { return false; }
  })();

  // specs/sas-offer-complement-lines.md §3.3 rule 9 — apply the operator's « Offrir » decisions to the
  // in-complement extras. `refs` is the AUTHORITATIVE offered set (`[{ kind, id }]`): a line named in it
  // is offered, one absent from it is billed — so un-offering works on a re-open. Offering never loses
  // the price (a catalogue row keeps `unitPrice`/`billedUnits`, a custom row keeps `amount`), and
  // `complementAmount` moves by exactly the real price of every line that changed state.
  //
  // `skipSasOrigin` is what keeps the ARRIVAL commit coherent: the lines the SAS itself writes are
  // deleted and re-inserted a few lines below with their own offered flag, so they must not be steered
  // from here. At CHECK-OUT (the recalled arrival complement) every in-complement line is addressable.
  const applyOfferedComplementExtras = (reservationId, refs, { skipSasOrigin = false } = {}) => {
    if (!Array.isArray(refs)) return;
    const frozen = database.prepare('SELECT complementAmount, complementPaid FROM reservations WHERE id = ?').get(reservationId);
    if (!frozen || Number(frozen.complementPaid || 0) === 1) return;
    const wanted = new Set(refs
      .filter((x) => x && x.kind && x.id != null)
      .map((x) => `${String(x.kind)}:${Number(x.id)}`));
    let delta = 0;
    const move = (isOffered, want, real) => {
      if (want === isOffered) return false;
      delta = round2(delta + (want ? -real : real));
      return true;
    };

    const sasOriginCol = HAS_RO_SAS_ARRIVAL_ORIGIN ? 'COALESCE(ro.sasArrivalOrigin, 0)' : '0';
    const options = database.prepare(`
      SELECT ro.optionId, COALESCE(ro.offered, 0) AS offered, ${sasOriginCol} AS sasArrivalOrigin,
             COALESCE(
               NULLIF(ro.totalPrice, 0),
               NULLIF(round(COALESCE(ro.unitPrice, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2), 0),
               round(COALESCE(o.price, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2)
             ) AS realPrice
        FROM reservation_options ro JOIN options o ON ro.optionId = o.id
       WHERE ro.reservationId = ? AND COALESCE(ro.inComplement, 0) = 1
    `).all(reservationId);
    const setOption = database.prepare('UPDATE reservation_options SET offered = ?, totalPrice = ? WHERE reservationId = ? AND optionId = ?');
    for (const o of options) {
      if (skipSasOrigin && Number(o.sasArrivalOrigin) === 1) continue;
      const real = round2(o.realPrice);
      const want = wanted.has(`option:${Number(o.optionId)}`);
      if (!move(Number(o.offered) === 1, want, real)) continue;
      setOption.run(want ? 1 : 0, want ? 0 : real, reservationId, o.optionId);
    }

    const resources = !HAS_RESOURCE_TABLES ? [] : database.prepare(`
      SELECT rr.resourceId, COALESCE(rr.offered, 0) AS offered,
             COALESCE(
               NULLIF(rr.totalPrice, 0),
               NULLIF(round(COALESCE(rr.unitPrice, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2), 0),
               round(COALESCE(rs.price, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2)
             ) AS realPrice
        FROM reservation_resources rr JOIN resources rs ON rr.resourceId = rs.id
       WHERE rr.reservationId = ? AND COALESCE(rr.inComplement, 0) = 1
    `).all(reservationId);
    const setResource = database.prepare('UPDATE reservation_resources SET offered = ?, totalPrice = ? WHERE reservationId = ? AND resourceId = ?');
    for (const res of resources) {
      const real = round2(res.realPrice);
      const want = wanted.has(`resource:${Number(res.resourceId)}`);
      if (!move(Number(res.offered) === 1, want, real)) continue;
      setResource.run(want ? 1 : 0, want ? 0 : real, reservationId, res.resourceId);
    }

    // A custom line keeps its `amount` whatever happens — the read layer already resolves an offered
    // one to 0 € (`CASE WHEN offered = 1 THEN 0 ELSE amount END`), so the toggle is lossless for free.
    const customs = database.prepare(`
      SELECT id, amount, COALESCE(offered, 0) AS offered, COALESCE(sasArrivalOrigin, 0) AS sasArrivalOrigin
        FROM reservation_custom_options WHERE reservationId = ? AND COALESCE(inComplement, 0) = 1
    `).all(reservationId);
    const setCustom = database.prepare('UPDATE reservation_custom_options SET offered = ? WHERE id = ?');
    for (const c of customs) {
      if (skipSasOrigin && Number(c.sasArrivalOrigin) === 1) continue;
      const real = round2(c.amount);
      const want = wanted.has(`custom:${Number(c.id)}`);
      if (!move(Number(c.offered) === 1, want, real)) continue;
      setCustom.run(want ? 1 : 0, c.id);
    }

    if (delta === 0) return;
    const next = Math.max(0, round2(Number(frozen.complementAmount || 0) + delta));
    database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(next, reservationId);
    // Offrir une ligne change la COMPOSITION du complément, pas le montant annoncé : l'ajustement
    // reprend la main, et sa ventilation se recalcule sur les lignes qui restent.
    reapplyComplementOverride(reservationId, next);
  };

  // Client-visibility flag on the options catalog (specs/laundry-bath-mat.md §3 rule 11). Guarded
  // so minimal test schemas without the column degrade to "visible" (the SELECT emits 1).
  const HAS_OPTION_DISPLAY_TO_CLIENT = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'displayToClient'); }
    catch { return false; }
  })();
  const OPTION_DISPLAY_TO_CLIENT_SELECT = HAS_OPTION_DISPLAY_TO_CLIENT
    ? 'o.displayToClient as displayToClient' : '1 as displayToClient';

  const model = {
    // ── Reads ────────────────────────────────────────────────────────────
    list({ propertyId, clientId, from, to } = {}) {
      let sql = `
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName,
          p.defaultCautionAmount as propertyDefaultCautionAmount,
          COALESCE((SELECT SUM(ro.totalPrice) FROM reservation_options ro WHERE ro.reservationId = r.id), 0)
          + COALESCE((SELECT SUM(CASE WHEN COALESCE(rco.offered, 0) = 1 THEN 0 ELSE rco.amount END) FROM reservation_custom_options rco WHERE rco.reservationId = r.id), 0) as optionsTotal,
          COALESCE((SELECT SUM(rr.totalPrice) FROM reservation_resources rr WHERE rr.reservationId = r.id), 0) as resourcesTotal
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation'
      `;
      const params = [];
      if (propertyId) {
        sql += ' AND r.propertyId = ?'; params.push(propertyId);
        // specs/platforms-and-ical-rework.md §3 rule 10 — hide reservations of a platform DISABLED
        // for this property. DISPLAY filter only: availability/getOccupiedReservations is unchanged,
        // so a disabled platform's bookings still block dates (no double-booking regression).
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM ical_sources s
          WHERE s.propertyId = r.propertyId AND s.disabled = 1
            AND (lower(s.platformLabel) = lower(r.platform) OR lower(s.platformKey) = lower(r.platform))
        )`;
      }
      if (clientId) { sql += ' AND r.clientId = ?'; params.push(clientId); }
      if (from) { sql += ' AND r.endDate >= ?'; params.push(from); }
      if (to) { sql += ' AND r.startDate <= ?'; params.push(to); }
      sql += ' ORDER BY r.startDate';
      const today = new Date().toISOString().split('T')[0];
      return database.prepare(sql).all(...params).map((row) => {
        // optionsTotal/resourcesTotal are only used by the SQL aggregation; they are not part of the
        // response (preserves the former route behavior, which stripped them).
        const { optionsTotal: _o, resourcesTotal: _r, propertyDefaultCautionAmount: _c, ...reservation } = row;
        const payment = computePaymentStatus(row, today);
        return {
          ...reservation,
          // specs/caution-live-from-property.md §3 — live from property until received, then frozen.
          cautionAmount: resolveEffectiveCaution(row),
          customPrice: row.customPrice == null ? '' : Number(row.customPrice),
          clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
          commissionAmount: deriveCommissionAmount(row),
          complementAmount: Number(row.complementAmount || 0),
          complementPaid: Number(row.complementPaid || 0),
          complementPaidDate: row.complementPaidDate || null,
          // specs/defer-arrival-complement-to-checkout.md §3.2 rule 10 — lets the lists label a
          // deferred complement as collected at check-out (values unchanged).
          complementDeferredToCheckout: Number(row.complementDeferredToCheckout || 0),
          remainingDue: payment.remainingDue,
          paymentComplete: payment.paymentComplete,
        };
      });
    },

    // Live "jump to a reservation" search (specs/reservation-number-and-search.md §3 rule 8-9).
    // Matches reservations by number, firstName, lastName, "first last", "last first" or email
    // (case-insensitive substring). Result is shaped + capped server-side (fat backend). Blank q → [].
    // Cancelled stays are included and flagged (specs/payment-schedule-and-cancellation.md §3.5
    // rule 26): search is the one path that must still find them — every list view drops them.
    search({ q } = {}) {
      const term = String(q || '').trim().toLowerCase();
      if (!term) return [];
      const like = `%${term}%`;
      const rows = database.prepare(`
        SELECT r.id, r.reservationNumber, r.startDate, r.endDate, r.kind, r.cancelledAt,
               c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind IN ('reservation', 'cancelled') AND (
          LOWER(COALESCE(r.reservationNumber, '')) LIKE ?
          OR LOWER(COALESCE(c.firstName, '')) LIKE ?
          OR LOWER(COALESCE(c.lastName, '')) LIKE ?
          OR LOWER(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) LIKE ?
          OR LOWER(COALESCE(c.lastName, '') || ' ' || COALESCE(c.firstName, '')) LIKE ?
          OR LOWER(COALESCE(c.email, '')) LIKE ?
        )
        ORDER BY r.startDate DESC, r.id DESC
        LIMIT 20
      `).all(like, like, like, like, like, like);
      return rows.map((row) => ({
        id: row.id,
        reservationNumber: row.reservationNumber || '',
        clientFullName: `${String(row.firstName || '').trim()} ${String(row.lastName || '').trim()}`.trim(),
        propertyName: row.propertyName || '',
        startDate: row.startDate || '',
        endDate: row.endDate || '',
        cancelled: row.kind === 'cancelled',
        cancelledAt: row.cancelledAt || null,
      }));
    },

    // True when another reservation already carries this number (override-collision guard, →400 in
    // the controller). `exceptId` excludes the row being updated.
    isReservationNumberTaken(number, exceptId) {
      const value = String(number || '').trim();
      if (!value) return false;
      let sql = "SELECT 1 FROM reservations WHERE kind = 'reservation' AND reservationNumber = ?";
      const params = [value];
      if (exceptId) { sql += ' AND id != ?'; params.push(Number(exceptId)); }
      return Boolean(database.prepare(sql).get(...params));
    },

    getOccupiedReservations(propertyId, from, to, excludeReservationId) {
      let sql = `
        SELECT id, startDate, endDate, checkInTime, checkOutTime
        FROM reservations
        WHERE kind = 'reservation'
          AND propertyId = ?
          AND endDate > ?
          AND startDate < ?
      `;
      const params = [propertyId, from, to];
      if (excludeReservationId) { sql += ' AND id != ?'; params.push(excludeReservationId); }
      return database.prepare(sql).all(...params);
    },

    // Reservations whose check-in time on `todayIso` has been reached (≤ nowHHMM) and whose arrival
    // push hasn't been sent today yet. Drives the per-minute push tick (specs/pwa-push-notifications.md
    // §3.3). Default check-in 15:00 when unset, mirroring the rest of the app.
    dueArrivals(todayIso, nowHHMM) {
      return database.prepare(`
        SELECT r.id, r.startDate, COALESCE(r.checkInTime, '15:00') AS checkInTime,
               c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.startDate = ?
          AND COALESCE(r.checkInTime, '15:00') <= ?
          AND (r.arrivalNotifiedAt IS NULL OR r.arrivalNotifiedAt != ?)
        ORDER BY checkInTime, r.id
      `).all(todayIso, nowHHMM, todayIso);
    },

    // Symmetric to dueArrivals for check-out. Default check-out 10:00 when unset.
    dueDepartures(todayIso, nowHHMM) {
      return database.prepare(`
        SELECT r.id, r.endDate, COALESCE(r.checkOutTime, '10:00') AS checkOutTime,
               c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.endDate = ?
          AND COALESCE(r.checkOutTime, '10:00') <= ?
          AND (r.departureNotifiedAt IS NULL OR r.departureNotifiedAt != ?)
        ORDER BY checkOutTime, r.id
      `).all(todayIso, nowHHMM, todayIso);
    },

    stampArrivalNotified(reservationId, dateIso) {
      database.prepare('UPDATE reservations SET arrivalNotifiedAt = ? WHERE id = ?').run(dateIso, Number(reservationId));
    },
    stampDepartureNotified(reservationId, dateIso) {
      database.prepare('UPDATE reservations SET departureNotifiedAt = ? WHERE id = ?').run(dateIso, Number(reservationId));
    },
    // Breakfast push guard: the last day (YYYY-MM-DD) this reservation's breakfast was notified
    // (specs/sas-breakfast-bread-and-push.md rule 8).
    stampBreakfastNotified(reservationId, dateIso) {
      database.prepare('UPDATE reservations SET breakfastNotifiedDate = ? WHERE id = ?').run(dateIso, Number(reservationId));
    },

    getByIdWithDetails(id) {
      const reservation = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName, p.photo as propertyPhoto,
          p.defaultCautionAmount as propertyDefaultCautionAmount,
          -- Capacity of the logement: the ceiling of the « personnes servies » stepper the arrival SAS
          -- shows on a card option (specs/card-option-served-persons.md §3.1 rule 3).
          p.maxGuests as propertyMaxGuests
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        -- specs/payment-schedule-and-cancellation.md §3.5 rule 26 — a cancelled stay stays
        -- reachable: its fiche opens read-only so the operator can see what was cancelled and why.
        WHERE r.id = ? AND r.kind IN ('reservation', 'cancelled')
      `).get(id);
      if (!reservation) return null;
      // specs/caution-live-from-property.md §3: the caution amount is live from the property
      // (defaultCautionAmount) until it is received, then frozen to the collected amount.
      reservation.cautionAmount = resolveEffectiveCaution(reservation);

      // `ro.*` already brings the new force-item-to-complement fields
      // (inComplement, acompteContribTtc, soldeContribTtc) — no need to enumerate.
      // `autoOptionType` is included so the client can tell apart manual vs auto options on load
      // (auto-options use a separate `autoOptionsInComplement` channel — spec §3.1).
      reservation.options = database.prepare(`
        SELECT ro.*, o.title, o.description, o.priceType as currentPriceType, o.price as currentUnitPrice,
          o.autoOptionType as autoOptionType, ${OPTION_DISPLAY_TO_CLIENT_SELECT},
          COALESCE(
            NULLIF(ro.totalPrice, 0),
            NULLIF(round(COALESCE(ro.unitPrice, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2), 0),
            round(COALESCE(o.price, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2)
          ) as originalTotalPrice,
          ro.offered as offered
        FROM reservation_options ro
        JOIN options o ON ro.optionId = o.id
        WHERE ro.reservationId = ?
      `).all(id);

      // Option-driven planning cards (specs/option-planning-card.md §3.2): the per-reservation
      // selected occurrences are stored as a JSON string — parse them back to an array so the
      // fiche (ExtrasSection) can restore the checklist. Absent column / null → [].
      for (const opt of reservation.options) {
        if (typeof opt.cardOccurrences === 'string' && opt.cardOccurrences.trim()) {
          try { const parsed = JSON.parse(opt.cardOccurrences); opt.cardOccurrences = Array.isArray(parsed) ? parsed : []; }
          catch { opt.cardOccurrences = []; }
        } else {
          opt.cardOccurrences = [];
        }
      }

      const customOptions = database.prepare(`
        SELECT rco.id as customOptionId, rco.description as title, rco.description, 1 as quantity,
          rco.amount as unitPrice, 1 as billedUnits, 'per_stay' as priceType,
          CASE WHEN COALESCE(rco.offered, 0) = 1 THEN 0 ELSE rco.amount END as totalPrice,
          rco.amount as originalTotalPrice,
          COALESCE(rco.offered, 0) as offered,
          COALESCE(rco.inComplement, 0) as inComplement,
          COALESCE(rco.sasArrivalOrigin, 0) as sasArrivalOrigin,
          rco.acompteContribTtc as acompteContribTtc,
          rco.soldeContribTtc as soldeContribTtc,
          1 as isCustom
        FROM reservation_custom_options rco
        WHERE rco.reservationId = ?
        ORDER BY rco.sortOrder, rco.id
      `).all(id);
      reservation.options = [...reservation.options, ...customOptions];

      // `rr.*` already brings the new force-item-to-complement fields — see options above.
      reservation.resources = database.prepare(`
        SELECT rr.*, rs.name, rs.note, rs.propertyId, rs.priceType,
          COALESCE(
            NULLIF(rr.totalPrice, 0),
            NULLIF(round(COALESCE(rr.unitPrice, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2), 0),
            round(COALESCE(rs.price, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2)
          ) as originalTotalPrice,
          rr.offered as offered
        FROM reservation_resources rr
        JOIN resources rs ON rr.resourceId = rs.id
        WHERE rr.reservationId = ?
      `).all(id).map((rr) => ({
        ...rr,
        // Hourly-scheduled sessions (specs/resource-hourly-scheduling.md) parsed for the fiche editor.
        sessions: (() => { try { return rr.sessions ? JSON.parse(rr.sessions) : []; } catch { return []; } })(),
      }));

      reservation.nights = database.prepare(`
        SELECT date, seasonLabel, pricingMode, price
        FROM reservation_nights
        WHERE reservationId = ?
        ORDER BY date
      `).all(id);

      reservation.customPrice = reservation.customPrice == null ? '' : Number(reservation.customPrice);
      // Manual deposit override (specs/editable-deposit-amount.md): '' when auto, number when frozen —
      // mirrors customPrice so the form field repopulates correctly on load.
      reservation.depositAmountOverride = reservation.depositAmountOverride == null ? '' : Number(reservation.depositAmountOverride);
      reservation.clientGrossAmount = reservation.clientGrossAmount == null ? null : Number(reservation.clientGrossAmount);
      reservation.commissionAmount = deriveCommissionAmount(reservation);
      // specs/platform-commission-line.md — operator-entered platform commission; '' when unset so the
      // form's text field repopulates correctly on load (mirrors customPrice/depositAmountOverride).
      reservation.platformCommissionAmount = reservation.platformCommissionAmount == null ? '' : Number(reservation.platformCommissionAmount);
      // specs/platform-per-echeance-commission.md — the acompte commission; '' when unset so the form field repopulates.
      reservation.acompteCommissionAmount = reservation.acompteCommissionAmount == null ? '' : Number(reservation.acompteCommissionAmount);
      // specs/platform-payment-entry.md — brut (pins the total) + virement (reconciliation); '' when unset so
      // the form's fields repopulate correctly on load.
      reservation.platformGrossAmount = reservation.platformGrossAmount == null ? '' : Number(reservation.platformGrossAmount);
      reservation.platformPayoutAmount = reservation.platformPayoutAmount == null ? '' : Number(reservation.platformPayoutAmount);
      reservation.complementAmount = Number(reservation.complementAmount || 0);
      reservation.complementPaid = Number(reservation.complementPaid || 0);
      reservation.complementPaidDate = reservation.complementPaidDate || null;
      // specs/adjustable-complement-amounts.md §3.1 — '' when the bucket is on automatic, a number when
      // the operator froze it; mirrors `depositAmountOverride` so the form fields repopulate on load.
      reservation.complementAmountOverride = reservation.complementAmountOverride == null
        ? '' : Number(reservation.complementAmountOverride);
      reservation.endOfStayComplementAmountOverride = reservation.endOfStayComplementAmountOverride == null
        ? '' : Number(reservation.endOfStayComplementAmountOverride);
      // What the end-of-stay complement is worth WITHOUT the adjustment — the « Calcul auto (X €) »
      // hint. Its arrival twin comes from the live quote (`complementAmountAuto`), which the fiche
      // already refreshes on every keystroke.
      reservation.endOfStayComplementAmountAuto = round2(
        parseDetailLines(reservation.endOfStayComplementDetail)
          .filter((l) => !isAdjustmentLine(l))
          .reduce((sum, l) => sum + Number(l.amount || 0), 0),
      );
      const payment = computePaymentStatus(reservation);
      reservation.remainingDue = payment.remainingDue;
      reservation.paymentComplete = payment.paymentComplete;

      // Bed-linen adequacy flag for the planning arrival card (specs/planning-arrival-alerts.md
      // §3 rule 6). Skipped for properties where bed linen is a default-offered option (the
      // operator doesn't manage linen per stay there).
      const bedLinenProvidedByDefault = Boolean(database.prepare(`
        SELECT 1 FROM property_option_defaults d
        JOIN options o ON o.id = d.optionId
        WHERE d.propertyId = ? AND o.autoOptionType = 'bed_linen' AND d.offered = 1
        LIMIT 1
      `).get(reservation.propertyId));
      reservation.bedLinenAlert = computeBedLinenAlert({
        reservation,
        options: reservation.options,
        bedLinenProvidedByDefault,
      });
      // specs/per-platform-tourist-tax-three-way.md — the tourist-tax portion of the complement,
      // computed server-side so the SAS arrival recap can itemise a « Taxe de séjour » line. The tax
      // is in the complement ONLY when it's forced there (touristTaxInComplement = 1) or WE collect it
      // at arrival (case 3 `owner` = the platform does NOT charge the guest). Case 1 (platform collects
      // then reverses it to us) charges it in the BALANCE → NOT in the complement. Direct (balance) and
      // offered platforms (touristTaxTotal = 0) → 0.
      const taxPlatform = String(reservation.platform || 'direct').toLowerCase();
      const weCollectAtArrival = taxPlatform !== 'direct'
        && Number(reservation.touristTaxTotal || 0) > 0
        && !isPlatformCollectingTouristTax(database, reservation.propertyId, taxPlatform);
      reservation.touristTaxInComplementAmount = (
        Number(reservation.touristTaxInComplement || 0) === 1 || weCollectAtArrival
      ) ? Number(reservation.touristTaxTotal || 0) : 0;
      // specs/defer-arrival-complement-to-checkout.md §3.2 rules 6-7 — the single « complément de fin
      // de séjour » the fiche renders when the operator deferred the arrival complement to check-out.
      // Server-built (amount + detail lines + paid state) so the client only renders it.
      const arrivalDetail = arrivalComplementDetailFromReservation(reservation);
      reservation.checkoutComplement = buildCheckoutComplement(reservation, arrivalDetail);
      // specs/adjustable-complement-amounts.md §3.6 — everything the fiche needs to render the
      // adjustment field: the floor it may not go under (the tourist tax + the accommodation auto-gap,
      // neither of which an adjustment ever touches) and the ventilation the accounting will book,
      // ready to display. Decided here, rendered there.
      const storedAllocation = parseComplementAllocation(reservation.complementAllocation);
      const posteBase = splitComplementByPoste(arrivalDetail.detail, reservation.complementAmount);
      const accommodationShare = storedAllocation ? storedAllocation.accommodation : posteBase.accommodation;
      reservation.complementAdjustment = {
        floor: round2(accommodationShare + posteBase.tax),
        accommodation: accommodationShare,
        tax: posteBase.tax,
        allocation: storedAllocation
          ? [
            { label: 'Hébergement', amount: storedAllocation.accommodation, locked: true },
            { label: 'Prestations', amount: storedAllocation.options },
            { label: 'Activités', amount: storedAllocation.resources },
            { label: 'Taxe de séjour', amount: posteBase.tax, locked: true },
          ].filter((poste) => poste.amount > 0)
          : null,
      };
      // specs/dashboard-collection-alert.md §4.3 — the day-of-operations « what's left to collect at
      // the door » block the Dashboard rows render. Deliberately NOT in the reception payload: the
      // receptionView whitelist drops it (it carries the acompte/solde states).
      reservation.operationalCollection = buildOperationalCollection(
        reservation,
        reservation.checkoutComplement,
      );
      return reservation;
    },

    getHistoryMeta(id) {
      return database.prepare('SELECT id, createdAt FROM reservations WHERE id = ?').get(id);
    },

    getHistory(id) {
      const rows = database.prepare(`
        SELECT id, eventType, changedFields, createdAt
        FROM reservation_history
        WHERE reservationId = ?
        ORDER BY datetime(createdAt) DESC, id DESC
      `).all(id);
      const names = buildHistoryNameContext(database);
      return rows.map((row) => {
        let changedFields = [];
        try { changedFields = JSON.parse(row.changedFields || '[]'); } catch { changedFields = []; }
        const { changes, derived } = buildHistoryRows(changedFields, names);
        return { id: row.id, eventType: row.eventType, createdAt: row.createdAt, changes, derived };
      });
    },

    getPricingSnapshot(reservationId) {
      return bookingLines.getPricingSnapshot(reservationId);
    },

    // specs/tourist-tax-included-services-deduction.md rule 5 — the option ids the booking already
    // carries. An update uses them to put back an included service the payload dropped, WITHOUT ever
    // adding one the booking never had (specs/reservation-option-immutability.md rule 3).
    listCarriedOptionIds(reservationId) {
      return database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?')
        .all(reservationId)
        .map((r) => Number(r.optionId));
    },

    getAuditSnapshotFromDb(reservationId) {
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      const options = database.prepare('SELECT optionId, quantity, totalPrice, COALESCE(inComplement, 0) as inComplement FROM reservation_options WHERE reservationId = ?').all(reservationId);
      const customOptions = database.prepare('SELECT description, amount, offered, COALESCE(inComplement, 0) as inComplement FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(reservationId);
      const resources = database.prepare('SELECT resourceId, quantity, totalPrice, offered, COALESCE(inComplement, 0) as inComplement FROM reservation_resources WHERE reservationId = ?').all(reservationId);
      return {
        propertyId: Number(row.propertyId),
        clientId: Number(row.clientId),
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        adults: Number(row.adults || 0),
        children: Number(row.children || 0),
        teens: Number(row.teens || 0),
        babies: Number(row.babies || 0),
        singleBeds: row.singleBeds === null ? null : Number(row.singleBeds),
        doubleBeds: row.doubleBeds === null ? null : Number(row.doubleBeds),
        babyBeds: row.babyBeds === null ? null : Number(row.babyBeds),
        checkInTime: row.checkInTime || null,
        checkOutTime: row.checkOutTime || null,
        platform: row.platform || null,
        totalPrice: Number(row.totalPrice || 0),
        touristTaxRate: Number(row.touristTaxRate || 0),
        touristTaxTotal: Number(row.touristTaxTotal || 0),
        discountPercent: Number(row.discountPercent || 0),
        customPrice: row.customPrice == null ? null : Number(row.customPrice),
        finalPrice: Number(row.finalPrice || 0),
        depositAmount: Number(row.depositAmount || 0),
        depositDueDate: row.depositDueDate || null,
        depositPaidDate: row.depositPaidDate || null,
        balanceAmount: Number(row.balanceAmount || 0),
        balanceDueDate: row.balanceDueDate || null,
        balancePaidDate: row.balancePaidDate || null,
        complementAmount: Number(row.complementAmount || 0),
        complementPaid: Number(row.complementPaid || 0),
        complementPaidDate: row.complementPaidDate || null,
        clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
        notes: row.notes || null,
        cautionAmount: Number(row.cautionAmount || 0),
        cautionReceived: Number(row.cautionReceived || 0),
        cautionReceivedDate: row.cautionReceivedDate || null,
        cautionReturned: Number(row.cautionReturned || 0),
        cautionReturnedDate: row.cautionReturnedDate || null,
        extraGuestSurchargeOffered: Number(row.extraGuestSurchargeOffered || 0),
        // Per-reservation deposit opt-out (specs/disable-deposit-per-reservation.md).
        depositDisabled: Number(row.depositDisabled || 0),
        touristTaxInComplement: Number(row.touristTaxInComplement || 0),
        optionsSignature: getOptionsSignature([
          ...options,
          ...customOptions.map((line, idx) => ({
            optionId: 1000000 + idx,
            quantity: 1,
            totalPrice: Number(line.offered ? 0 : (line.amount || 0)),
            inComplement: Number(line.inComplement || 0),
          })),
        ]),
        resourcesSignature: getResourcesSignature(resources),
      };
    },

    getPropertyBeds(propertyId) {
      return database.prepare('SELECT singleBeds, doubleBeds FROM properties WHERE id = ?').get(propertyId);
    },

    getPropertyCapacity(propertyId) {
      return database.prepare('SELECT singleBeds, doubleBeds, maxGuests, maxBabies FROM properties WHERE id = ?').get(propertyId);
    },

    getPropertyIdOf(reservationId) {
      return database.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
    },

    getForUpdate(reservationId) {
      // Also returns the date/time + occupancy columns so the controller can tell whether an edit
      // actually changed anything the availability / capacity guards protect — see
      // specs/edit-reservation-blocked-by-overlap.md (don't re-block a finance-only edit on a
      // pre-existing overlap/capacity issue).
      return database.prepare(`
        SELECT propertyId, sourceType, icalSyncLocked, totalPrice, finalPrice,
               startDate, endDate, checkInTime, checkOutTime,
               adults, children, teens, babies, singleBeds, doubleBeds, babyBeds
          FROM reservations WHERE id = ?
      `).get(reservationId);
    },

    getForArchiveCheck(reservationId) {
      return database.prepare('SELECT id, endDate FROM reservations WHERE id = ?').get(reservationId);
    },

    getBasic(reservationId) {
      return database.prepare('SELECT id FROM reservations WHERE id = ?').get(reservationId);
    },

    // The just-assigned/overridden number, returned to the client after create/update so the fiche
    // field repopulates. Empty string when the column is absent (minimal schema) or unset.
    getReservationNumber(reservationId) {
      if (!HAS_RESERVATION_NUMBER) return '';
      const row = database.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(reservationId);
      return (row && row.reservationNumber) || '';
    },

    // Batched lookup of (id, firstName, lastName, startDate, endDate) for a list of reservation
    // ids. Used by the Dashboard linen-shortage alert to label impacted chips with the client
    // name instead of a bare #id.
    findClientNamesByIds(ids) {
      const cleanIds = Array.from(new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
      if (cleanIds.length === 0) return [];
      const placeholders = cleanIds.map(() => '?').join(',');
      return database.prepare(`
        SELECT r.id, r.startDate, r.endDate, c.firstName, c.lastName
          FROM reservations r
          LEFT JOIN clients c ON c.id = r.clientId
         WHERE r.id IN (${placeholders})
      `).all(...cleanIds);
    },

    // Dashboard card (specs/dashboard-ical-new-reservations.md): reservations imported via iCal
    // during the CURRENT day (UTC, matching the app's datetime('now') convention). Fully shaped
    // server-side — clientName + platformLabel ready to render, ordered most-recent-import first.
    listNewIcalReservationsToday() {
      const rows = database.prepare(`
        SELECT r.id AS reservationId, r.startDate, r.endDate, r.createdAt,
               r.sourcePlatformKey, s.name AS sourceName,
               c.firstName, c.lastName, p.name AS propertyName
          FROM reservations r
          LEFT JOIN clients c      ON c.id = r.clientId
          LEFT JOIN properties p   ON p.id = r.propertyId
          LEFT JOIN ical_sources s ON s.id = r.sourceIcalSourceId
         WHERE r.kind = 'reservation'
           AND r.sourceType = 'ical'
           AND date(r.createdAt) = date('now')
         ORDER BY datetime(r.createdAt) DESC, r.id DESC
      `).all();
      return rows.map((row) => {
        const clientName = `${String(row.firstName || '').trim()} ${String(row.lastName || '').trim()}`.trim();
        const platformLabel = String(row.sourceName || '').trim()
          || (row.sourcePlatformKey ? formatPlatformName(row.sourcePlatformKey) : '');
        return {
          reservationId: row.reservationId,
          clientName: clientName || `#${row.reservationId}`,
          propertyName: row.propertyName || '',
          platformLabel,
          startDate: row.startDate || '',
          endDate: row.endDate || '',
          createdAt: row.createdAt || '',
        };
      });
    },

    // Dashboard alert (specs/site-booking-notifications.md §3 rule 5): site-origin devis still
    // pending handling — requestOrigin='public', kind='devis', still draft, not yet converted.
    // Disappears from the alert once the operator changes its status / converts / deletes it.
    listPendingPublicDevis() {
      const rows = database.prepare(`
        SELECT r.id, r.devisNumber, r.startDate, r.endDate, r.finalPrice, r.createdAt,
               c.firstName, c.lastName, p.name AS propertyName
          FROM reservations r
          LEFT JOIN clients c    ON c.id = r.clientId
          LEFT JOIN properties p ON p.id = r.propertyId
         WHERE r.kind = 'devis'
           AND r.requestOrigin = 'public'
           AND COALESCE(r.devisStatus, 'draft') = 'draft'
           AND r.convertedReservationId IS NULL
         ORDER BY datetime(r.createdAt) DESC, r.id DESC
      `).all();
      return rows.map((row) => {
        const clientName = `${String(row.firstName || '').trim()} ${String(row.lastName || '').trim()}`.trim();
        return {
          id: row.id,
          devisNumber: row.devisNumber || '',
          clientName: clientName || `#${row.id}`,
          propertyName: row.propertyName || '',
          startDate: row.startDate || '',
          endDate: row.endDate || '',
          finalPrice: Number(row.finalPrice || 0),
          createdAt: row.createdAt || '',
        };
      });
    },

    // Full reservation row, used by the contrib-capture path (force-item-to-complement.md)
    // to feed `calculateReservationQuote` with the latest persisted state at flip time.
    getRow(reservationId) {
      return database.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    },

    // ── Availability / capacity ──────────────────────────────────────────
    // Authoritative availability check (verbatim from the former route). Returns an error object or null.
    //
    // `options.allowPastDates` (default false) lifts ONLY the "startDate < today" guard. The
    // overlap/conflict/capacity/closure rules below are untouched — they remain correctness
    // checks even when the admin has flipped the past-reservation unlock in Paramètres.
    // See specs/admin-unlock-past-reservations.md §3.5 + §3.6.
    validateAvailability(propertyId, startDate, endDate, checkInTime, checkOutTime, excludeId, nightBlocks = {}, options = {}) {
      const property = database.prepare('SELECT cleaningHours FROM properties WHERE id = ?').get(propertyId);
      const cleaning = property ? (property.cleaningHours ?? 3) : 3;

      const today = new Date().toISOString().split('T')[0];
      if (startDate < today && !options.allowPastDates) {
        return { error: 'Impossible de réserver dans le passé.' };
      }

      const newBLocksPrev = Number(nightBlocks.blocksPreviousNight || 0) === 1;
      const newBlocksNext = Number(nightBlocks.blocksNextNight || 0) === 1;
      const newEffStart = newBLocksPrev ? addIsoDays(startDate, -1) : startDate;
      const newEffEnd = newBlocksNext ? addIsoDays(endDate, 1) : endDate;

      // Bind EARLY_CHECKIN_BLOCK_HOUR and LATE_CHECKOUT_BLOCK_HOUR as parameters rather than
      // interpolating them. Even though they're trusted integer constants today, the previous
      // ${...} form triggered SQL-injection static-analysis warnings every time the file got
      // grep'd, and any future refactor that turned them into user-controlled values would
      // have produced a silent injection. Cleaned up in the 2026-06-01 security audit (M5).
      let overlapSql = `
        SELECT id
        FROM reservations
        WHERE kind = 'reservation'
          AND propertyId = ?
          AND (CASE WHEN CAST(SUBSTR(COALESCE(checkInTime,  '15:00'), 1, 2) AS INTEGER) <= ?
                    THEN date(startDate, '-1 day') ELSE startDate END) < ?
          AND (CASE WHEN CAST(SUBSTR(COALESCE(checkOutTime, '10:00'), 1, 2) AS INTEGER) >= ?
                    THEN date(endDate,   '+1 day') ELSE endDate   END) > ?
      `;
      const overlapParams = [propertyId, EARLY_CHECKIN_BLOCK_HOUR, newEffEnd, LATE_CHECKOUT_BLOCK_HOUR, newEffStart];
      if (excludeId) { overlapSql += ' AND id != ?'; overlapParams.push(excludeId); }
      const strictOverlaps = database.prepare(overlapSql).all(...overlapParams);
      if (strictOverlaps.length > 0) {
        return { error: 'Ce logement est déjà réservé pour ces dates.' };
      }

      let prevSql = "SELECT checkOutTime FROM reservations WHERE kind = 'reservation' AND propertyId = ? AND endDate = ?";
      const prevParams = [propertyId, startDate];
      if (excludeId) { prevSql += ' AND id != ?'; prevParams.push(excludeId); }
      const prevRes = database.prepare(prevSql).get(...prevParams);
      if (prevRes) {
        const prevCheckOut = timeToHour(prevRes.checkOutTime || '10:00');
        const newCheckIn = timeToHour(checkInTime || '15:00');
        if (newCheckIn < prevCheckOut + cleaning) {
          const availH = String(Math.floor(prevCheckOut + cleaning)).padStart(2, '0');
          const availM = (prevCheckOut + cleaning) % 1 >= 0.5 ? '30' : '00';
          return {
            error: `Arrivée impossible à ${checkInTime || '15:00'}. Le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h ménage).`,
          };
        }
      }

      let nextSql = "SELECT checkInTime FROM reservations WHERE kind = 'reservation' AND propertyId = ? AND startDate = ?";
      const nextParams = [propertyId, endDate];
      if (excludeId) { nextSql += ' AND id != ?'; nextParams.push(excludeId); }
      const nextRes = database.prepare(nextSql).get(...nextParams);
      if (nextRes) {
        const newCheckOut = timeToHour(checkOutTime || '10:00');
        const nextCheckIn = timeToHour(nextRes.checkInTime || '15:00');
        if (newCheckOut + cleaning > nextCheckIn) {
          const maxCheckOut = nextCheckIn - cleaning;
          const maxH = String(Math.floor(maxCheckOut)).padStart(2, '0');
          const maxM = maxCheckOut % 1 >= 0.5 ? '30' : '00';
          return {
            error: `Départ à ${checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale est ${maxH}:${maxM}.`,
          };
        }
      }

      const coveringClosure = establishmentClosuresModel.findCoveringClosure(propertyId, startDate, endDate);
      if (coveringClosure) {
        return {
          error: `Fermeture en place sur cette période : « ${coveringClosure.label} » du ${coveringClosure.startDate} au ${coveringClosure.endDate}.`,
          code: 'CLOSURE_COVERS_DATE',
        };
      }

      return null;
    },

    // Baby-bed availability (verbatim). excludeId optional (PUT).
    getBabyBedAvailability(propertyId, startDate, endDate, excludeId) {
      const allBabyBeds = database.prepare(`
        SELECT * FROM resources
        WHERE lower(name) = lower('Lit bébé') OR lower(name) = lower('Lit bebe')
      `).all();
      const propertyIdNum = propertyId != null ? Number(propertyId) : null;
      // Applicability from the resource_properties pivot (no rows = global). Robust if the table is absent.
      let scopeStmt = null;
      try { scopeStmt = database.prepare('SELECT propertyId FROM resource_properties WHERE resourceId = ?'); } catch { scopeStmt = null; }
      const scopedIdsFor = (id) => {
        if (!scopeStmt) return [];
        try { return scopeStmt.all(id).map((row) => Number(row.propertyId)); } catch { return []; }
      };
      const babyResources = allBabyBeds
        .map((r) => ({ ...r, scopedIds: scopedIdsFor(r.id) }))
        .filter((r) => r.scopedIds.length === 0 || (propertyIdNum != null && r.scopedIds.includes(propertyIdNum)));
      const babyTotal = babyResources.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      const babyHasGlobal = babyResources.some((r) => r.scopedIds.length === 0);
      let babyReservedSql = "SELECT COALESCE(SUM(COALESCE(babyBeds, 0)), 0) as reserved FROM reservations WHERE kind = 'reservation' AND startDate < ? AND endDate > ?";
      const babyReservedParams = [endDate, startDate];
      if (excludeId) { babyReservedSql += ' AND id != ?'; babyReservedParams.push(excludeId); }
      if (!babyHasGlobal) { babyReservedSql += ' AND propertyId = ?'; babyReservedParams.push(propertyId); }
      const babyReserved = database.prepare(babyReservedSql).get(...babyReservedParams).reserved || 0;
      return Math.max(0, Number(babyTotal) - Number(babyReserved));
    },

    getResourceById(resourceId) {
      return database.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    },

    getResourceFreeMinutes(propertyId, resourceId) {
      const row = database.prepare('SELECT freeMinutes FROM property_resource_prices WHERE propertyId = ? AND resourceId = ?').get(Number(propertyId), Number(resourceId));
      return Number(row?.freeMinutes || 0);
    },

    getResourceReservedQuantity(resourceId, startDate, endDate, excludeId) {
      let sql = `
        SELECT COALESCE(SUM(rr2.quantity), 0) as reserved
        FROM reservation_resources rr2
        JOIN reservations r2 ON r2.id = rr2.reservationId
        WHERE r2.kind = 'reservation' AND rr2.resourceId = ? AND r2.startDate < ? AND r2.endDate > ?
      `;
      const params = [resourceId, endDate, startDate];
      if (excludeId) { sql += ' AND rr2.reservationId != ?'; params.push(excludeId); }
      return database.prepare(sql).get(...params).reserved || 0;
    },

    // ── Writes ───────────────────────────────────────────────────────────
    addHistoryEntry(reservationId, eventType, changes) {
      database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
        .run(reservationId, eventType, JSON.stringify(changes || []));
    },

    insertReservation(payload, quote, nightBlocks) {
      const { propertyId, clientId, startDate, endDate, adults, children, teens, babies,
        singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, customPrice,
        depositDueDate, balanceDueDate, notes, cautionAmount, extraGuestSurchargeOffered,
        clientGrossAmount, platformCommissionAmount, acompteCommissionAmount, platformGrossAmount, platformPayoutAmount,
        depositDisabled, touristTaxInComplement, depositAmountOverride,
        complementAmountOverride, endOfStayComplementAmountOverride } = payload;
      // specs/normalize-platform-names.md §3.2 rule 9 — `reservations.platform` is normalized
      // to UpperCamelCase here so direct DB queries (`SELECT DISTINCT platform`) yield a
      // case-uniform set. The 'direct' enum stays lowercase (formatPlatformName preserves it).
      const platformNormalized = formatPlatformName(platform) || 'direct';
      // accounting-platform-commission-and-no-deposit.md §3.2 rule 4: `clientGrossAmount`
      // is populated on every reservation now. For platforms = the operator-typed gross;
      // for directs = `finalPrice` (since gross === net trivially). This homogenises the
      // shape so the accounting engine doesn't have to special-case NULLs.
      const platformIsNonDirect = String(platformNormalized).toLowerCase() !== 'direct';
      const grossForPlatform = platformIsNonDirect
        ? (clientGrossAmount != null && clientGrossAmount !== '' ? Number(clientGrossAmount) : null)
        : Number(quote.finalPrice || 0);
      // specs/platform-commission-line.md — operator-entered platform commission (€), clamped ≥ 0.
      // NULL on direct bookings (no commission). Drives the fiche « net perçu » only; the accounting
      // commission stays derived from `clientGrossAmount`.
      const platformCommissionForStore = platformIsNonDirect
        ? (platformCommissionAmount != null && platformCommissionAmount !== '' ? Math.max(0, Number(platformCommissionAmount)) : null)
        : null;
      // specs/platform-per-echeance-commission.md — the acompte commission (€, ≥ 0, NULL on direct).
      const acompteCommissionForStore = platformIsNonDirect
        ? (acompteCommissionAmount != null && acompteCommissionAmount !== '' ? Math.max(0, Number(acompteCommissionAmount)) : null)
        : null;
      // specs/platform-payment-entry.md — brut (pins the total) + virement (reconciliation), ≥ 0, NULL on direct.
      const platformGrossForStore = platformIsNonDirect
        ? (platformGrossAmount != null && platformGrossAmount !== '' ? Math.max(0, Number(platformGrossAmount)) : null)
        : null;
      const platformPayoutForStore = platformIsNonDirect
        ? (platformPayoutAmount != null && platformPayoutAmount !== '' ? Math.max(0, Number(platformPayoutAmount)) : null)
        : null;
      const result = database.prepare(`
        INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds,
          checkInTime, checkOutTime,
          platform, totalPrice, touristTaxRate, touristTaxTotal, discountPercent, customPrice, finalPrice, depositAmount, depositDueDate,
          balanceAmount, balanceDueDate, sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
          notes, cautionAmount, extraGuestSurchargeOffered, blocksPreviousNight, blocksNextNight, clientGrossAmount,
          depositDisabled, touristTaxInComplement, depositAmountOverride, platformCommissionAmount, acompteCommissionAmount, platformGrossAmount, platformPayoutAmount,
          tariffSnapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
        singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
        checkInTime || '15:00', checkOutTime || '10:00',
        platformNormalized, quote.totalPrice, quote.touristTaxRate || 0, quote.touristTaxTotal || 0, quote.discountPercent || 0,
        customPrice !== undefined && customPrice !== null && customPrice !== '' ? Number(customPrice) : null,
        quote.finalPrice,
        quote.depositAmount || 0, quote.depositDueDate || depositDueDate || null, quote.balanceAmount || 0, quote.balanceDueDate || balanceDueDate || null, sentenceCase(notes),
        cautionAmount || 0,
        extraGuestSurchargeOffered ? 1 : 0,
        nightBlocks.blocksPreviousNight,
        nightBlocks.blocksNextNight,
        grossForPlatform,
        depositDisabled ? 1 : 0,
        touristTaxInComplement ? 1 : 0,
        depositAmountOverride === undefined || depositAmountOverride === null || depositAmountOverride === '' ? null : Number(depositAmountOverride),
        platformCommissionForStore,
        acompteCommissionForStore,
        platformGrossForStore,
        platformPayoutForStore,
        // specs/tariff-recipes/spec.md §3.2 rule 12bis — the tariff this reservation is SOLD under.
        // Written once, at creation, and replayed by every later save so a recipe change never
        // re-prices what is already in the database.
        quote.tariffSnapshot ? JSON.stringify(quote.tariffSnapshot) : null,
      );
      persistBreakfastTime(result.lastInsertRowid, payload);
      persistReservationNumber(result.lastInsertRowid, payload);
      persistEmailLanguage(result.lastInsertRowid, payload);
      persistComplementOverrides(result.lastInsertRowid, { complementAmountOverride, endOfStayComplementAmountOverride });
      return result.lastInsertRowid;
    },

    /**
     * specs/collect-stay-payment-at-check-in.md §3.3 rule 15 — a stay bucket whose paid flag is
     * FLIPPED outside the arrival SAS stops being the SAS's: its ownership marker goes, and so does
     * its caisse-interne flag (a bucket the operator just un-ticked must not keep reading « settled »
     * through the cash flag, and a payment recorded on the fiche is never caisse interne).
     *
     * Called on a real change only: saving the fiche for an unrelated reason must not silently pull
     * a stay collected at the door back into the accounting.
     */
    releaseStayBucket(reservationId, bucket) {
      const marker = bucket === 'deposit' ? 'depositPaidAtArrival' : 'balancePaidAtArrival';
      const cash = bucket === 'deposit' ? 'depositPaidCash' : 'balancePaidCash';
      try {
        database.prepare(`UPDATE reservations SET ${marker} = 0, ${cash} = 0, updatedAt = datetime('now') WHERE id = ?`)
          .run(reservationId);
      } catch {
        // Minimal test schemas without the columns: nothing to release.
      }
      model.releaseArrivalPaymentGroup(reservationId, bucket);
    },

    /**
     * Record the single arrival payment FROM THE FICHE
     * (specs/single-payment-from-the-fiche.md §3.2), without running a single SAS page.
     *
     * That restraint is the feature: re-opening the wizard to record one payment costs eleven pages,
     * several questions whose wrong answer REMOVES a sale, and — measured on 2026-08-31 — the
     * « préparé » flags of the planning cards. Here nothing but the payment columns is touched, so
     * the options, their `cardOccurrences` and the breakfast composition are safe by construction.
     *
     * `mode` is 'card' | 'cash' | 'undo'. The date is the operator's and is validated BEFORE this
     * runs (utils/arrivalPaymentDate) — the transaction never opens on a refused date.
     *
     * @returns {{buckets: string[], total: number, grouped: boolean}}
     */
    settleArrivalBuckets(reservationId, { mode, date } = {}) {
      const run = database.transaction(() => {
        const row = model.getRow(reservationId);
        if (!row) return { buckets: [], total: 0, grouped: false };

        if (mode === 'undo') {
          const group = parseGroup(row.arrivalPaymentGroup);
          if (!group) return { buckets: [], total: 0, grouped: false };
            for (const bucket of group.buckets) {
            if (bucket === 'endOfStayComplement') {
              database.prepare("UPDATE reservations SET endOfStayComplementPaid = 0, endOfStayComplementPaidDate = NULL, endOfStayComplementPaidCash = 0, updatedAt = datetime('now') WHERE id = ?")
                .run(reservationId);
            } else if (bucket === 'complement') {
              database.prepare("UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL, complementPaidCash = 0, updatedAt = datetime('now') WHERE id = ?")
                .run(reservationId);
              try {
                database.prepare('UPDATE reservations SET complementPaidAtArrival = 0 WHERE id = ?').run(reservationId);
              } catch { /* no marker column on a minimal schema */ }
            } else {
              const cols = bucket === 'deposit'
                ? ['depositPaid', 'depositPaidDate', 'depositPaidCash', 'depositPaidAtArrival']
                : ['balancePaid', 'balancePaidDate', 'balancePaidCash', 'balancePaidAtArrival'];
              const [paidCol, dateCol, cashCol, markerCol] = cols;
              database.prepare(`UPDATE reservations SET ${paidCol} = 0, ${dateCol} = NULL, ${cashCol} = 0, ${markerCol} = 0, updatedAt = datetime('now') WHERE id = ?`)
                .run(reservationId);
              clearContribsOnUnflip({ db: database, reservationId, bucket });
            }
          }
          database.prepare("UPDATE reservations SET arrivalPaymentGroup = NULL, updatedAt = datetime('now') WHERE id = ?")
            .run(reservationId);
          clearArrivalPaymentAdjustment(database, reservationId);
          return { buckets: group.buckets, total: group.total, grouped: false };
        }

        const cash = mode === 'cash' ? 1 : 0;
        const collectible = collectibleArrivalBuckets(row);
        if (collectible.length === 0) return { buckets: [], total: 0, grouped: false };

        for (const { bucket } of collectible) {
          if (bucket === 'endOfStayComplement') {
            // Scheduled for the door on departure, but this guest paid it on arrival: same columns,
            // same accounting, booked at the date the money actually changed hands.
            database.prepare("UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
              .run(date, cash, reservationId);
          } else if (bucket === 'complement') {
            database.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = ?, complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
              .run(date, cash, reservationId);
            try {
              database.prepare('UPDATE reservations SET complementPaidAtArrival = 1 WHERE id = ?').run(reservationId);
            } catch { /* no marker column on a minimal schema */ }
            // Collecting the arrival complement CLOSES it: what is sold afterwards goes to the
            // end-of-stay complement instead of drifting between échéances (same rule as the fiche's
            // own « Marquer complément payé », specs/mid-stay-extras-to-end-of-stay-complement.md).
            model.captureArrivalExtrasBaseline(reservationId);
            persistComplementDeferred(reservationId, false);
          } else {
            // Best effort, exactly as at check-in: on a booking whose stored solde is the platform's
            // own figure the capture legitimately fails, and losing the payment over an attribution
            // the operator cannot fix would be worse than storing it with NULL contribs.
            model.captureStayContribs(reservationId, bucket);
            const cols = bucket === 'deposit'
              ? ['depositPaid', 'depositPaidDate', 'depositPaidCash', 'depositPaidAtArrival']
              : ['balancePaid', 'balancePaidDate', 'balancePaidCash', 'balancePaidAtArrival'];
            const [paidCol, dateCol, cashCol, markerCol] = cols;
            database.prepare(`UPDATE reservations SET ${paidCol} = 1, ${dateCol} = ?, ${cashCol} = ?, ${markerCol} = 1, updatedAt = datetime('now') WHERE id = ?`)
              .run(date, cash, reservationId);
          }
        }

        const buckets = collectible.map((b) => b.bucket);
        const total = Math.round(collectible.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;
        // A group of one is not a group: a lone bucket settled here is an ordinary payment, and the
        // fiche must not announce a « paiement unique » that groups nothing.
        const json = serialiseGroup({ at: date, cash, total, buckets });
        try {
          database.prepare("UPDATE reservations SET arrivalPaymentGroup = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(json, reservationId);
        } catch { /* no column on a minimal schema: the settlement above still stands */ }
        return { buckets, total, grouped: Boolean(json) };
      });
      return run();
    },

    /**
     * The complement's twin of `releaseStayBucket` (specs/single-payment-at-check-in.md rules 8-9):
     * a complement flipped from the fiche is no longer the SAS's, so its ownership marker goes and
     * any single payment that named it is dissolved. Guarded — a minimal test schema has neither
     * column, and there is then nothing to release.
     */
    /**
     * specs/single-payment-from-the-fiche.md rule 2bis — the end-of-stay complement is now groupable,
     * so flipping it from the fiche must dissolve the group like every other bucket does.
     */
    releaseEndOfStayBucket(reservationId) {
      model.releaseArrivalPaymentGroup(reservationId, 'endOfStayComplement');
    },

    releaseComplementBucket(reservationId) {
      try {
        database.prepare("UPDATE reservations SET complementPaidAtArrival = 0, updatedAt = datetime('now') WHERE id = ?")
          .run(reservationId);
      } catch {
        // No marker column here: nothing to release.
      }
      model.releaseArrivalPaymentGroup(reservationId, 'complement');
    },

    /**
     * specs/single-payment-at-check-in.md §3.2 rule 8 — a bucket that stops being settled takes the
     * whole group down with it. The group says « these buckets were ONE collection »; once one of
     * them is no longer collected, that sentence is false, and the fiche must stop showing a payment
     * that no longer exists. All-or-nothing by construction, so there is nothing to shrink.
     */
    releaseArrivalPaymentGroup(reservationId, bucket) {
      try {
        const row = database.prepare('SELECT arrivalPaymentGroup FROM reservations WHERE id = ?').get(reservationId);
        if (!row || !groupCovers(row.arrivalPaymentGroup, bucket)) return;
        database.prepare("UPDATE reservations SET arrivalPaymentGroup = NULL, updatedAt = datetime('now') WHERE id = ?")
          .run(reservationId);
        // specs/arrival-payment-detail-and-adjustment.md rule 23 — the réduction dies with the payment
        // it was granted on. Left behind, it would keep lowering `comptaCollected` and the total du
        // séjour of a collection that no longer exists.
        clearArrivalPaymentAdjustment(database, reservationId);
      } catch {
        // Minimal test schemas without the column: no group to release.
      }
    },

    /**
     * specs/arrival-payment-detail-and-adjustment.md §3.2 — what the guest actually handed over.
     *
     * `target` is the operator's amount; the réduction and the pourboire are DERIVED from it against
     * the buckets the group settled, and the réduction is clamped to the accommodation before being
     * stored (rule 16). Storing the derived pair rather than the target is what lets every reader —
     * the fiche, `comptaCollected`, the journal — apply it without re-deriving anything.
     *
     * `null` clears the adjustment. Returns the resolution, or `null` when there is no group to
     * adjust (a payment must exist before it can have been made for less).
     */
    setArrivalPaymentAdjustment(reservationId, { target } = {}) {
      const run = database.transaction(() => {
        const reservation = model.getByIdWithDetails(reservationId);
        if (!reservation) return null;
        const group = parseGroup(reservation.arrivalPaymentGroup);
        if (!group) return null;
        const detail = buildArrivalPaymentDetail(reservation, {
          buckets: group.buckets,
          complementDetail: group.buckets.includes('complement')
            ? arrivalComplementDetailFromReservation(reservation, { includeOffered: true })
            : null,
        });
        const resolved = resolveArrivalPaymentAdjustment({
          bucketsTotal: detail.bucketsTotal,
          accommodation: detail.accommodation,
          target,
        });
        database.prepare(`UPDATE reservations SET arrivalPaymentReduction = ?, arrivalPaymentTip = ?,
                          updatedAt = datetime('now') WHERE id = ?`)
          .run(resolved.reduction || null, resolved.tip || null, reservationId);
        // The group records what the guest handed over, so its total follows the adjustment. A total
        // of 0 € (everything given away) is the one case left alone: `buildGroup` refuses a group
        // worth nothing, and rewriting it would DELETE the payment instead of adjusting it. The fiche
        // computes its total live from the lines, so nothing is lost by keeping the stored one.
        if (resolved.total > 0) {
          database.prepare("UPDATE reservations SET arrivalPaymentGroup = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(serialiseGroup({ ...group, total: resolved.total }), reservationId);
        }
        return resolved;
      });
      return run();
    },

    updateReservation(reservationId, payload, quote, nightBlocks, nextIcalSyncLocked) {
      const { propertyId, clientId, startDate, endDate, adults, children, teens, babies,
        singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, customPrice,
        depositDueDate, depositPaid, depositPaidDate, balanceDueDate, balancePaid, balancePaidDate, notes,
        cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
        extraGuestSurchargeOffered, clientGrossAmount, platformCommissionAmount, acompteCommissionAmount, platformGrossAmount, platformPayoutAmount,
        complementPaid, complementPaidDate,
        depositDisabled, touristTaxInComplement, depositAmountOverride,
        complementAmountOverride, endOfStayComplementAmountOverride } = payload;
      // specs/normalize-platform-names.md §3.2 rule 9 — same canonicalization as insertReservation.
      const platformNormalized = formatPlatformName(platform) || 'direct';
      const platformIsNonDirect = String(platformNormalized).toLowerCase() !== 'direct';
      const grossForPlatform = platformIsNonDirect
        ? (clientGrossAmount != null && clientGrossAmount !== '' ? Number(clientGrossAmount) : null)
        : Number(quote.finalPrice || 0);
      // specs/platform-commission-line.md — operator-entered platform commission (€), clamped ≥ 0; NULL on direct.
      const platformCommissionForStore = platformIsNonDirect
        ? (platformCommissionAmount != null && platformCommissionAmount !== '' ? Math.max(0, Number(platformCommissionAmount)) : null)
        : null;
      // specs/platform-per-echeance-commission.md — the acompte commission (€, ≥ 0, NULL on direct).
      const acompteCommissionForStore = platformIsNonDirect
        ? (acompteCommissionAmount != null && acompteCommissionAmount !== '' ? Math.max(0, Number(acompteCommissionAmount)) : null)
        : null;
      // specs/platform-payment-entry.md — brut (pins the total) + virement (reconciliation), ≥ 0, NULL on direct.
      const platformGrossForStore = platformIsNonDirect
        ? (platformGrossAmount != null && platformGrossAmount !== '' ? Math.max(0, Number(platformGrossAmount)) : null)
        : null;
      const platformPayoutForStore = platformIsNonDirect
        ? (platformPayoutAmount != null && platformPayoutAmount !== '' ? Math.max(0, Number(platformPayoutAmount)) : null)
        : null;
      // Rule 15 — read the stay flags BEFORE they are overwritten, so the SAS ownership markers are
      // released on a real flip and only on a real flip.
      const beforeStay = database.prepare('SELECT depositPaid, balancePaid, complementPaid FROM reservations WHERE id = ?').get(reservationId) || {};
      database.prepare(`
        UPDATE reservations SET propertyId=?, clientId=?, startDate=?, endDate=?, adults=?, children=?, teens=?, babies=?,
          singleBeds=?, doubleBeds=?, babyBeds=?,
          checkInTime=?, checkOutTime=?,
          platform=?, totalPrice=?, touristTaxRate=?, touristTaxTotal=?, discountPercent=?, customPrice=?, finalPrice=?, depositAmount=?, depositDueDate=?,
          depositPaid=?, depositPaidDate=?, balanceAmount=?, balanceDueDate=?, balancePaid=?, balancePaidDate=?,
          complementAmount=?, complementPaid=?, complementPaidDate=?, notes=?,
          cautionAmount=?, cautionReceived=?, cautionReceivedDate=?, cautionReturned=?, cautionReturnedDate=?, extraGuestSurchargeOffered=?, icalSyncLocked=?,
          blocksPreviousNight=?, blocksNextNight=?, clientGrossAmount=?,
          depositDisabled=?, touristTaxInComplement=?, depositAmountOverride=?, platformCommissionAmount=?,
          acompteCommissionAmount=?, platformGrossAmount=?, platformPayoutAmount=?,
          updatedAt=datetime('now')
        WHERE id=?
      `).run(
        propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
        singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
        checkInTime || '15:00', checkOutTime || '10:00',
        platformNormalized, quote.totalPrice, quote.touristTaxRate || 0, quote.touristTaxTotal || 0, quote.discountPercent || 0,
        customPrice !== undefined && customPrice !== null && customPrice !== '' ? Number(customPrice) : null,
        quote.finalPrice,
        quote.depositAmount || 0, quote.depositDueDate || depositDueDate || null,
        depositPaid ? 1 : 0, depositPaid ? (depositPaidDate || null) : null,
        quote.balanceAmount || 0, quote.balanceDueDate || balanceDueDate || null,
        balancePaid ? 1 : 0, balancePaid ? (balancePaidDate || null) : null,
        Number(quote.complementAmount || 0), complementPaid ? 1 : 0, complementPaid ? (complementPaidDate || null) : null,
        sentenceCase(notes),
        cautionAmount || 0, cautionReceived ? 1 : 0, cautionReceivedDate || null,
        cautionReturned ? 1 : 0, cautionReturnedDate || null, extraGuestSurchargeOffered ? 1 : 0, nextIcalSyncLocked,
        nightBlocks.blocksPreviousNight, nightBlocks.blocksNextNight, grossForPlatform,
        depositDisabled ? 1 : 0,
        touristTaxInComplement ? 1 : 0,
        depositAmountOverride === undefined || depositAmountOverride === null || depositAmountOverride === '' ? null : Number(depositAmountOverride),
        platformCommissionForStore,
        acompteCommissionForStore,
        platformGrossForStore,
        platformPayoutForStore,
        reservationId,
      );
      persistBreakfastTime(reservationId, payload);
      persistReservationNumber(reservationId, payload);
      persistEmailLanguage(reservationId, payload);
      persistComplementOverrides(reservationId, { complementAmountOverride, endOfStayComplementAmountOverride });
      if (Number(beforeStay.depositPaid || 0) !== (depositPaid ? 1 : 0)) model.releaseStayBucket(reservationId, 'deposit');
      if (Number(beforeStay.balancePaid || 0) !== (balancePaid ? 1 : 0)) model.releaseStayBucket(reservationId, 'balance');
      // Same ownership release for the complement (specs/single-payment-at-check-in.md rules 8-9):
      // a full fiche save that flips it dissolves the single payment that named it.
      if (Number(beforeStay.complementPaid || 0) !== (complementPaid ? 1 : 0)) model.releaseComplementBucket(reservationId);
    },

    // `inComplement` is carried on every write, authoritative as resolved by the pricing engine
    // (specs/force-extras-complement-on-platform.md §3): the engine applies the platform default
    // for unflagged lines AND honours an explicit operator override, so the model trusts the value
    // verbatim — no second-guessing here. `acompteContribTtc`/`soldeContribTtc` are owned by the
    // payment-flip code path (`updatePayment` → `captureContribsOnFlip`); regular saves preserve
    // them by passing through the values the engine returned. Lines in Complément (`inComplement = 1`)
    // always get NULL contribs — they live 100 % in the Complément entry, never in Acompte/Solde.
    // The four line tables are written by ONE module, shared with `devisModel`
    // (specs/devis-extras-parity-and-price-lock.md §4.1): a devis and a reservation store their lines in
    // the same children, so a new column must land on both sides at once or not at all.
    replaceOptions(reservationId, optionLines) {
      bookingLines.replaceOptions(reservationId, optionLines);
    },

    insertOptions(reservationId, optionLines, sasOriginIds = []) {
      bookingLines.insertOptions(reservationId, optionLines, sasOriginIds);
    },

    deleteCustomOptions(reservationId) {
      bookingLines.deleteCustomOptions(reservationId);
    },

    insertCustomOptions(reservationId, optionLines) {
      bookingLines.insertCustomOptions(reservationId, optionLines);
    },

    replaceNights(reservationId, nightlyBreakdown) {
      bookingLines.replaceNights(reservationId, nightlyBreakdown);
    },

    insertNights(reservationId, nightlyBreakdown) {
      bookingLines.insertNights(reservationId, nightlyBreakdown);
    },

    deleteResources(reservationId) {
      bookingLines.deleteResources(reservationId);
    },

    insertResourceLine(reservationId, rr, unitPrice, qty, priceType) {
      bookingLines.insertResourceLine(reservationId, rr, unitPrice, qty, priceType);
    },

    updatePaymentField(sql, ...params) {
      database.prepare(sql).run(...params);
    },

    remove(reservationId) {
      database.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
    },

    // ── Payment deadlines & cancellation (specs/payment-schedule-and-cancellation.md) ──────────
    // Everything the deadline card could possibly be about: a reservation with an unpaid acompte or
    // solde — platform bookings included since specs/platform-payout-due-date.md, whose payout
    // deadline falls AFTER the stay. The state itself is decided by utils/paymentDeadlines (pure) —
    // this read only narrows the set.
    //
    // The 60-day floor is a coarse pre-filter, not the visibility rule: the real windows (30 days
    // after the departure for an own channel, 30 days after the payout deadline for a platform) are
    // applied in the pure layer, which is the only place that knows a row's channel and its driving
    // échéance (rule 21). It used to be 30 days here, which would have cut a platform row down to
    // nine days of visibility.
    listPaymentDeadlineCandidates(today) {
      return database.prepare(`
        SELECT r.id, r.reservationNumber, r.platform, r.startDate, r.endDate, r.finalPrice,
               r.depositAmount, r.depositPaid, r.depositDueDate,
               r.balanceAmount, r.balancePaid, r.balanceDueDate,
               r.paymentAlertSnoozedUntil,
               c.firstName, c.lastName, c.email,
               p.name AS propertyName, p.cancelAfterBalanceDueDays,
               -- Has the guest ever actually been ASKED for this money? (rule 15) The pure layer needs
               -- it to tell « à demander » from « en retard », and to refuse to propose a cancellation
               -- over a solde nobody ever claimed (rule 12bis).
               EXISTS (SELECT 1 FROM email_log l JOIN email_templates t ON t.id = l.templateId
                        WHERE l.reservationId = r.id AND t.stableKey = 'deposit_request'
                          AND l.status = 'sent') AS depositRequestSent,
               EXISTS (SELECT 1 FROM email_log l JOIN email_templates t ON t.id = l.templateId
                        WHERE l.reservationId = r.id AND t.stableKey = 'balance_request'
                          AND l.status = 'sent') AS balanceRequestSent
          FROM reservations r
          JOIN clients c ON c.id = r.clientId
          JOIN properties p ON p.id = r.propertyId
         WHERE r.kind = 'reservation'
           AND (
             -- Money outstanding on an échéance.
             (r.endDate >= date(@today, '-60 days')
              AND ((r.depositAmount > 0 AND r.depositPaid = 0)
                OR (r.balanceAmount > 0 AND r.balancePaid = 0)))
             -- specs/platform-payout-due-date.md §3.2bis — a platform booking carrying NO figures at
             -- all. The clause above cannot see it (every amount is 0), which is exactly why an
             -- import whose price was never entered went unnoticed for good. No date floor here: an
             -- amount missing from the books does not become acceptable by ageing (rule 29).
             OR (COALESCE(r.finalPrice, 0) = 0
                 AND COALESCE(r.depositAmount, 0) = 0
                 AND COALESCE(r.balanceAmount, 0) = 0
                 AND LOWER(COALESCE(NULLIF(TRIM(r.platform), ''), 'direct')) NOT IN (${DIRECT_CHANNEL_PLACEHOLDERS}))
           )
         ORDER BY r.startDate, r.id
      `).all({ today, ...DIRECT_CHANNEL_PARAMS });
    },

    // The booking channel alone — all the dunning guard needs to know before sending anything
    // (specs/platform-payout-due-date.md rule 20). Returns null when the reservation is gone.
    getPlatform(reservationId) {
      const row = database.prepare('SELECT platform FROM reservations WHERE id = ?').get(Number(reservationId));
      return row ? row.platform : null;
    },

    // Hide one reservation's deadline row until `until`. The échéances themselves never move: the
    // emails, the PDF and the cancellation date keep the dates the guest was promised (rule 18).
    snoozePaymentAlert(reservationId, until) {
      database.prepare("UPDATE reservations SET paymentAlertSnoozedUntil = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(until, Number(reservationId));
    },

    // The snapshot the cancellation needs: the reservation plus the client and property names that
    // the indemnity card freezes. Accepts an already-cancelled row so the controller can answer 409
    // rather than 404 on a double click.
    getForCancellation(reservationId) {
      return database.prepare(`
        SELECT r.*, c.firstName, c.lastName, c.email, p.name AS propertyName
          FROM reservations r
          JOIN clients c ON c.id = r.clientId
          JOIN properties p ON p.id = r.propertyId
         WHERE r.id = ? AND r.kind IN ('reservation', 'cancelled')
      `).get(Number(reservationId));
    },

    // The acompte's per-bucket contributions — the very shares accounting credited when it was
    // cashed, so the requalification avoir can mirror that entry line for line. NULL when the
    // reservation predates the contrib capture: the caller then books a single line.
    depositContribBuckets(reservationId) {
      const id = Number(reservationId);
      const row = database.prepare(`
        SELECT accommodationAcompteContribTtc AS accommodation, touristTaxAcompteContribTtc AS tax
          FROM reservations WHERE id = ?
      `).get(id);
      if (!row || row.accommodation == null) return null;
      const sumOf = (table) => Number(database.prepare(
        `SELECT COALESCE(SUM(acompteContribTtc), 0) AS total FROM ${table} WHERE reservationId = ?`,
      ).get(id).total || 0);
      return {
        // Same reclass as the deposit entry: a legacy acompte that physically collected a share of
        // the tourist tax keeps it inside its accommodation bucket (accountingModel §deposit).
        accommodation: round2(Number(row.accommodation || 0) + Number(row.tax || 0)),
        options: round2(sumOf('reservation_options') + sumOf('reservation_custom_options')),
        resources: round2(sumOf('reservation_resources')),
      };
    },

    // The cancellation write itself: `kind` leaves 'reservation', which is what frees the dates
    // everywhere at once (every operational query filters on it). Amounts, échéances and paid flags
    // are left exactly as they were — they are history now, and accounting still reads them.
    markCancelled(reservationId, { reason = '', cancelledBy = null, cancelledAt = null } = {}) {
      database.prepare(`
        UPDATE reservations
           SET kind = 'cancelled',
               cancelledAt = COALESCE(?, datetime('now')),
               cancellationReason = ?,
               cancelledBy = ?,
               paymentAlertSnoozedUntil = NULL,
               updatedAt = datetime('now')
         WHERE id = ? AND kind = 'reservation'
      `).run(cancelledAt, String(reason || ''), cancelledBy == null ? null : Number(cancelledBy), Number(reservationId));
    },

    // ── Arrival / Departure SAS (specs/arrival-departure-sas.md §4.1) ──────────────
    // The two catalogue options the ARRIVAL SAS can sell (specs/sas-upsells-activate-catalogue-option.md
    // §3.1): « Ménage » and « Linge de toilette ». Resolves, for each, the option id, the engine price
    // for THIS reservation (per-property override → `getTypeMultiplier` on the option's own priceType)
    // and whether the reservation already carries it — distinguishing a row the SAS itself added
    // (`sasOrigin`, removable by re-running the SAS) from one the operator sold on the fiche.
    // Single source of truth for the SAS payload, the commit and the tests.
    getSasUpsellOptions(reservationId) {
      const res = database.prepare(`
        SELECT id, propertyId, adults, teens, children,
               (SELECT COUNT(*) FROM reservation_nights rn WHERE rn.reservationId = reservations.id) AS nights
          FROM reservations WHERE id = ?
      `).get(reservationId);
      const empty = { optionId: null, unitPrice: 0, priceType: null, billedUnits: 0, totalPrice: 0, persons: 0, present: false, sasOrigin: false };
      if (!res) return { cleaning: { ...empty }, bathLinen: { ...empty } };

      const persons = (Number(res.adults) || 0) + (Number(res.teens) || 0) + (Number(res.children) || 0);
      const nights = Number(res.nights) || 0;
      const linked = database.prepare(
        `SELECT optionId, ${HAS_RO_SAS_ARRIVAL_ORIGIN ? 'COALESCE(sasArrivalOrigin, 0)' : '0'} AS sasArrivalOrigin FROM reservation_options WHERE reservationId = ?`,
      ).all(reservationId);

      const resolve = (autoOptionType) => {
        const opt = database.prepare('SELECT id, price, priceType FROM options WHERE autoOptionType = ? LIMIT 1').get(autoOptionType);
        if (!opt) return { ...empty, persons };
        let override;
        try {
          override = database.prepare('SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?')
            .get(opt.id, Number(res.propertyId));
        } catch { override = undefined; }
        const unitPrice = Math.round((override ? Number(override.price) : Number(opt.price || 0)) * 100) / 100;
        const priceType = opt.priceType || 'per_stay';
        const billedUnits = getTypeMultiplier(priceType, persons, nights);
        const row = linked.find((l) => Number(l.optionId) === Number(opt.id));
        return {
          optionId: opt.id,
          unitPrice,
          priceType,
          billedUnits,
          totalPrice: Math.round(unitPrice * billedUnits * 100) / 100,
          persons,
          present: Boolean(row),
          sasOrigin: Boolean(row && Number(row.sasArrivalOrigin) === 1),
        };
      };
      return { cleaning: resolve('cleaning'), bathLinen: resolve('bathroom_linen') };
    },

    // The custom lines a previous arrival SAS wrote (the billed linen elements). Feeds the SAS history
    // snapshot (specs/arrival-departure-sas.md §3.7).
    listSasArrivalCustomLines(reservationId) {
      // `offered` rides along so the history says « Taie d'oreiller ×2 (offert) » rather than showing
      // the price of a line the guest was never charged (specs/sas-offer-complement-lines.md §3.5).
      return database.prepare('SELECT description, amount, COALESCE(offered, 0) AS offered FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1 ORDER BY sortOrder, id')
        .all(reservationId);
    },

    // The catalogue prestations the arrival SAS sold (petit déjeuner, restauration) — title, billed
    // units and amount for the history snapshot (specs/sas-breakfast-and-catering-upsell.md §3.5).
    // The ménage and the linge de toilette carry their own history field, so they are excluded here.
    listSasArrivalOptionLines(reservationId) {
      if (!HAS_RO_SAS_ARRIVAL_ORIGIN) return [];
      const upsells = model.getSasUpsellOptions(reservationId);
      const excluded = new Set([upsells.cleaning.optionId, upsells.bathLinen.optionId]
        .filter((id) => id != null).map(Number));
      return database.prepare(`
        SELECT ro.optionId AS optionId, o.title AS label, ro.billedUnits AS qty, ro.totalPrice AS amount,
               ro.quantity AS moments${HAS_RO_CARD_PERSONS ? ', ro.cardPersons AS cardPersons' : ', NULL AS cardPersons'}
          FROM reservation_options ro JOIN options o ON o.id = ro.optionId
         WHERE ro.reservationId = ? AND COALESCE(ro.sasArrivalOrigin, 0) = 1
         ORDER BY o.title
      `).all(reservationId)
        .filter((row) => !excluded.has(Number(row.optionId)))
        // « 1 moment × 2 pers. servies » — a reduced number of covers is a decision worth reading back
        // in the history (specs/card-option-served-persons.md §3.3 rule 15).
        .map(({ moments, cardPersons, ...row }) => (Number(cardPersons) > 0
          ? { ...row, detail: `${Number(moments) || 1} × ${Number(cardPersons)} pers. servies` }
          : row));
    },

    // « Is the cleaning already sold on this reservation? » — single source of truth for both SAS
    // ends (specs/defer-arrival-complement-to-checkout.md §3.1 rule 1): a booked cleaning option, a
    // « Ménage » line added by the arrival SAS (custom option, no tag → matched by name), or a
    // property offering cleaning as a default. When true the guest is not responsible for the
    // end-of-stay cleaning: the arrival ménage page is hidden AND the departure one never bills.
    isCleaningSoldForReservation(reservationId) {
      const booked = database.prepare(`
        SELECT o.title AS title, o.autoOptionType AS autoOptionType
        FROM reservation_options ro JOIN options o ON ro.optionId = o.id
        WHERE ro.reservationId = ?
      `).all(reservationId);
      if (booked.some(isCleaningOption)) return true;
      const customs = database.prepare('SELECT description AS title FROM reservation_custom_options WHERE reservationId = ?').all(reservationId);
      if (customs.some(isCleaningOption)) return true;
      const row = database.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return false;
      try {
        return Boolean(database.prepare(`
          SELECT 1 FROM property_option_defaults d
          JOIN options o ON o.id = d.optionId
          WHERE d.propertyId = ? AND o.autoOptionType = 'cleaning' AND d.offered = 1 LIMIT 1
        `).get(Number(row.propertyId)));
      } catch { return false; }
    },

    // Effective price of the cleaning option (autoOptionType='cleaning') for a property:
    // per-property override (property_option_prices) wins over the option's base price.
    // null when there is no cleaning option configured.
    getCleaningPriceForProperty(propertyId) {
      const opt = database.prepare("SELECT id, price FROM options WHERE autoOptionType = 'cleaning' LIMIT 1").get();
      if (!opt) return null;
      let override;
      try {
        override = database.prepare('SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?')
          .get(opt.id, Number(propertyId));
      } catch { override = undefined; }
      return Math.round((override ? Number(override.price) : Number(opt.price || 0)) * 100) / 100;
    },

    // specs/sas-bath-linen-ghost-line.md — erase a `arrivalBathLinen` billing line wherever it is still
    // stored, recomputing the end-of-stay amount from the lines that remain. Returns true when it wrote.
    dropBathLinenGhostLine(reservationId) {
      const row = database.prepare('SELECT endOfStayComplementDetail FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return false;
      const cleaned = dropBathLinenGhost(row.endOfStayComplementDetail);
      if (!cleaned) return false;
      writeEndOfStayDetail(reservationId, cleaned.detail, model.getMidStaySettledNotes(reservationId));
      return true;
    },

    // Bath-linen upsell offer for the arrival SAS (specs/sas-bath-linen-upsell.md §3.1). Resolves the
    // « Linge de toilette » option, applies the per-property price override, and prices it PER PERSON
    // exactly as the reservation engine (getTypeMultiplier on the option's own priceType — `per_person`
    // → persons). `persons = adults + teens + children` (babies excluded, like pricing.js). Not offered
    // when the option is missing, already on the reservation, or the computed amount is ≤ 0.
    getBathLinenOfferForReservation(reservation) {
      const empty = { available: false, unitPrice: 0, priceType: null, persons: 0, nights: 0, amount: 0, label: BATH_LINEN_LABEL };
      if (!reservation) return empty;
      const alreadyTaken = (reservation.options || []).some((o) => o.autoOptionType === 'bathroom_linen');
      if (alreadyTaken) return empty;
      const opt = database.prepare("SELECT id, price, priceType FROM options WHERE autoOptionType = 'bathroom_linen' LIMIT 1").get();
      if (!opt) return empty;
      let override;
      try {
        override = database.prepare('SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?')
          .get(opt.id, Number(reservation.propertyId));
      } catch { override = undefined; }
      const unitPrice = Math.round((override ? Number(override.price) : Number(opt.price || 0)) * 100) / 100;
      const priceType = opt.priceType || 'per_stay';
      const persons = Number(reservation.adults || 0) + Number(reservation.teens || 0) + Number(reservation.children || 0);
      const nights = Array.isArray(reservation.nights) ? reservation.nights.length : 0;
      const amount = Math.round(unitPrice * getTypeMultiplier(priceType, persons, nights) * 100) / 100;
      return { available: amount > 0, unitPrice, priceType, persons, nights, amount, label: BATH_LINEN_LABEL };
    },

    // Prestations the arrival SAS sells (specs/sas-breakfast-and-catering-upsell.md §3.3): the
    // breakfast and the « Restauration » catalogue. The wizard sends INTENT — `[{ optionId,
    // occurrences }]` for a card option, `[{ optionId, units }]` otherwise — and everything priced is
    // resolved here: the catalogue row, the per-property price override, then the engine arithmetic
    // (utils/sasOptionSale.js). An option the operator sold from the fiche is skipped: the sale step
    // is hidden for it, and its money must never be re-routed to the complement.
    resolveSasOptionSales(reservationId, sales) {
      if (!Array.isArray(sales) || sales.length === 0) return [];
      const res = database.prepare(`
        SELECT reservations.id AS id, propertyId, adults, teens, children, startDate, endDate,
               ${HAS_RESERVATION_CHECK_TIMES ? 'checkInTime, checkOutTime,' : "'15:00' AS checkInTime, '10:00' AS checkOutTime,"}
               ${HAS_PROPERTY_MAX_GUESTS ? 'COALESCE(p.maxGuests, 0)' : '0'} AS maxGuests,
               (SELECT COUNT(*) FROM reservation_nights rn WHERE rn.reservationId = reservations.id) AS nights
          FROM reservations
          ${HAS_PROPERTY_MAX_GUESTS ? 'LEFT JOIN properties p ON p.id = reservations.propertyId' : ''}
         WHERE reservations.id = ?
      `).get(reservationId);
      if (!res) return [];
      const persons = billablePersons(res);
      const stay = {
        startDate: res.startDate,
        endDate: res.endDate,
        checkInTime: res.checkInTime || '15:00',
        checkOutTime: res.checkOutTime || '10:00',
      };
      const fiche = new Set(database
        .prepare(`SELECT optionId FROM reservation_options WHERE reservationId = ?
                  ${HAS_RO_SAS_ARRIVAL_ORIGIN ? 'AND COALESCE(sasArrivalOrigin, 0) = 0' : ''}`)
        .all(reservationId)
        .map((r) => Number(r.optionId)));
      const readOption = database.prepare('SELECT * FROM options WHERE id = ?');
      const out = [];
      const seen = new Set();
      for (const sale of sales) {
        const optionId = Number(sale?.optionId);
        if (!optionId || seen.has(optionId) || fiche.has(optionId)) continue;
        const option = readOption.get(optionId);
        if (!option) continue;
        let override;
        try {
          override = database.prepare('SELECT price FROM property_option_prices WHERE optionId = ? AND propertyId = ?')
            .get(optionId, Number(res.propertyId));
        } catch { override = undefined; }
        const line = priceOptionSale(option, {
          unitPrice: override ? Number(override.price) : Number(option.price || 0),
          persons,
          nights: Number(res.nights) || 0,
          stay,
          occurrences: sale?.occurrences,
          units: sale?.units,
          // How many covers each moment serves (specs/card-option-served-persons.md §3.3 rule 12).
          servedPersons: sale?.persons,
          maxPersons: Number(res.maxGuests) || 0,
        });
        if (!line) continue;
        seen.add(optionId);
        out.push({ ...line, title: option.title || 'Prestation' });
      }
      return out;
    },

    // Single commit for the arrival SAS. `complementItems` = [{ label, amount }] (missing linen
    // elements + optionally the cleaning charge). Written as custom options inComplement=1 +
    // sasArrivalOrigin=1. Re-openable SAS: a re-commit REPLACES the SAS-origin complement lines
    // instead of appending (complementAmount adjusted by new − previous SAS sum), so it never
    // double-charges (specs/reopen-completed-sas.md §4). A paid complement stays frozen.
    // specs/recall-unpaid-arrival-complement-at-checkout.md §3 rule 6 — itemise the arrival complement so
    // the departure SAS can recall it line-by-line.
    buildArrivalComplementDetail(reservationId, options = {}) {
      const r = model.getByIdWithDetails(reservationId);
      if (!r) return { amount: 0, paid: 0, detail: [] };
      return arrivalComplementDetailFromReservation(r, options);
    },

    // ── Prestations vendues en cours de séjour ────────────────────────────────
    // specs/mid-stay-extras-to-end-of-stay-complement.md. The baseline is the extras as they stood
    // when the stay started; everything above it is sold mid-stay and billed in the end-of-stay
    // complement. Read straight from the child tables so it reflects the state BEFORE the save that
    // triggers the capture.

    // Extra lines in the shape `midStayExtras` keys them by (custom lines carry their label).
    readExtraLines(reservationId) {
      const options = database.prepare('SELECT optionId, totalPrice, offered FROM reservation_options WHERE reservationId = ?').all(reservationId);
      const resources = database.prepare('SELECT resourceId, totalPrice, offered FROM reservation_resources WHERE reservationId = ?').all(reservationId);
      const customs = database.prepare('SELECT description, amount, offered FROM reservation_custom_options WHERE reservationId = ?').all(reservationId);
      return [
        ...options.map((o) => ({ optionId: Number(o.optionId), totalPrice: Number(o.totalPrice || 0), offered: Number(o.offered || 0) })),
        ...resources.map((r) => ({ resourceId: Number(r.resourceId), totalPrice: Number(r.totalPrice || 0), offered: Number(r.offered || 0) })),
        // A custom line stores its ORIGINAL amount; an offered one is worth 0 like in the engine.
        ...customs.map((c) => ({
          isCustom: true,
          title: c.description,
          totalPrice: Number(c.offered || 0) === 1 ? 0 : Number(c.amount || 0),
          offered: Number(c.offered || 0),
        })),
      ];
    },

    // The baseline the ENGINE should use right now. It is captured lazily, on the first save at/after
    // `startDate`, so a stay that started but was never re-saved has none yet — and the live preview
    // would then show a mid-stay sale as nothing at all. Synthesize the very baseline the next save
    // WOULD store (the extras currently stored), so the preview matches the post-save reality
    // without the read path ever writing (specs/mid-stay-notes.md §4.1).
    resolveArrivalExtrasBaseline(reservationId) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.arrivalExtrasBaseline) return row.arrivalExtrasBaseline;
      if (!arrivalExtrasBaselineIsDue(row)) return null;
      return JSON.stringify(buildExtrasBaseline(model.readExtraLines(reservationId)));
    },

    getArrivalExtrasBaseline(reservationId) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = ?').get(reservationId);
      return (row && row.arrivalExtrasBaseline) || null;
    },

    // Capture the baseline once, from the CURRENT lines, when the stay has started. Idempotent: an
    // already-captured baseline is never overwritten (that would swallow the mid-stay sales).
    captureArrivalExtrasBaselineIfDue(reservationId) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.arrivalExtrasBaseline) return row.arrivalExtrasBaseline;
      if (!arrivalExtrasBaselineIsDue(row)) return null;
      const baseline = JSON.stringify(buildExtrasBaseline(model.readExtraLines(reservationId)));
      database.prepare("UPDATE reservations SET arrivalExtrasBaseline = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(baseline, reservationId);
      return baseline;
    },

    // Same capture, without the date gate: the arrival SAS IS the moment the stay starts (it marks the
    // check-in done), so a check-in that sells a prestation on an already-collected complement needs
    // the pre-sale state pinned right now — else the sale would have no baseline to stand above and
    // its money would never reach the end-of-stay complement
    // (specs/sas-breakfast-and-catering-upsell.md §3.4). Idempotent: an existing baseline is kept.
    captureArrivalExtrasBaseline(reservationId) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.arrivalExtrasBaseline) return row.arrivalExtrasBaseline;
      const baseline = JSON.stringify(buildExtrasBaseline(model.readExtraLines(reservationId)));
      database.prepare("UPDATE reservations SET arrivalExtrasBaseline = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(baseline, reservationId);
      return baseline;
    },

    // Fold specific keys into the baseline at their CURRENT amount — used by the arrival SAS for the
    // lines it writes itself (§3.1 rule 4): they belong to the arrival complement by construction and
    // must never drift into the end-of-stay one, even when the SAS is re-run days later.
    addKeysToArrivalExtrasBaseline(reservationId, keys) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE || !keys || keys.length === 0) return;
      const stored = model.getArrivalExtrasBaseline(reservationId);
      if (!stored) return; // no baseline yet → the capture will include these lines anyway.
      const baseline = parseBaseline(stored) || {};
      const current = buildExtrasBaseline(model.readExtraLines(reservationId));
      let changed = false;
      for (const key of new Set(keys)) {
        const amount = Number(current[key] || 0);
        if (amount > 0 && Number(baseline[key] || 0) !== amount) { baseline[key] = amount; changed = true; }
      }
      if (!changed) return;
      database.prepare("UPDATE reservations SET arrivalExtrasBaseline = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(JSON.stringify(baseline), reservationId);
    },

    // ── Notes en séjour (specs/mid-stay-notes.md) ─────────────────────────────
    // A note is ONE punctual collection during the stay. Settling MOVES stored amounts from the
    // end-of-stay remainder into the register, inside a single transaction: the invariant
    // « remainder + register = everything sold mid-stay » holds at every step, and no money is ever
    // re-priced here (the engine reconverges on the next save because remaining = midStay − settled).

    getMidStaySettledNotes(reservationId) {
      if (!HAS_MID_STAY_NOTES) return [];
      const row = database.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(reservationId);
      return parseNotes(row && row.midStaySettledNotes);
    },

    /**
     * @param {Array} items `[{ key, amount }]` — what the operator put on the note. Each amount is
     *        validated against the STORED remainder of its key (never against a recomputed price).
     * @param {boolean} cash « Caisse interne » → collected, but off the books.
     * @returns {object} the stored note.
     * @throws {Error} `code` = END_OF_STAY_SETTLED | NOTE_EMPTY | NOTE_AMOUNT_INVALID
     */
    settleMidStayNote(reservationId, { items = [], cash = false } = {}) {
      if (!HAS_MID_STAY_NOTES) throw midStayError('NOTE_EMPTY', 'Notes en séjour indisponibles.');
      const tx = database.transaction(() => {
        const row = database.prepare(`SELECT endOfStayComplementDetail, endOfStayComplementPaid,
                                             endOfStayComplementPaidCash, midStaySettledNotes
                                        FROM reservations WHERE id = ?`).get(reservationId);
        if (!row) throw midStayError('NOTE_NOT_FOUND', 'Réservation introuvable.');
        if (Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1) {
          throw midStayError('END_OF_STAY_SETTLED', 'Le complément de fin de séjour est déjà encaissé.');
        }
        const detail = parseDetailLines(row.endOfStayComplementDetail);
        const sasLines = detail.filter((l) => l.source !== MID_STAY_SOURCE);
        // Remaining lines per key, in stored order — an amount is consumed across them.
        const midByKey = new Map();
        for (const line of detail.filter((l) => l.source === MID_STAY_SOURCE)) {
          const key = line.key || extraLineKey(line);
          if (!midByKey.has(key)) midByKey.set(key, []);
          midByKey.get(key).push({ ...line, key });
        }

        const noteLines = [];
        for (const item of (items || [])) {
          const key = item && String(item.key || '');
          const asked = round2(item && item.amount);
          const lines = midByKey.get(key) || [];
          const remaining = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
          if (!key || asked <= 0) throw midStayError('NOTE_AMOUNT_INVALID', 'Montant de note invalide.');
          // 0.005 tolerance: the client's amount comes from the engine, rounded to the cent.
          if (asked > round2(remaining + 0.005)) {
            throw midStayError('NOTE_AMOUNT_INVALID', `Montant supérieur au reste à percevoir (${remaining} €).`);
          }
          let left = Math.min(asked, remaining);
          const taken = { label: lines[0].label, unitPrice: Number(lines[0].unitPrice || 0), amount: 0 };
          for (const line of lines) {
            if (left <= 0) break;
            const part = round2(Math.min(Number(line.amount || 0), left));
            taken.amount = round2(taken.amount + part);
            line.amount = round2(Number(line.amount || 0) - part);
            left = round2(left - part);
          }
          const { source, ...noteLine } = buildMidStayLine({ ...taken, key });
          noteLines.push(noteLine);
        }
        if (noteLines.length === 0) throw midStayError('NOTE_EMPTY', 'La note est vide.');

        // Partially consumed lines are rebuilt so their qty/unitPrice stay coherent with the amount.
        const nextMidLines = [];
        for (const lines of midByKey.values()) {
          for (const line of lines) {
            if (round2(line.amount) <= 0) continue;
            nextMidLines.push(buildMidStayLine({
              label: line.label, unitPrice: Number(line.unitPrice || 0), amount: line.amount, key: line.key,
            }));
          }
        }

        const notes = parseNotes(row.midStaySettledNotes);
        const note = {
          id: nextNoteId(notes),
          paidDate: new Date().toISOString().slice(0, 10),
          paidCash: cash ? 1 : 0,
          total: round2(noteLines.reduce((s, l) => s + Number(l.amount || 0), 0)),
          lines: noteLines,
        };
        notes.push(note);
        writeEndOfStayDetail(reservationId, [...sasLines, ...nextMidLines], notes);
        return note;
      });
      return tx();
    },

    // Inverse move: the note's lines go back to « à percevoir », merged into the remainder line of
    // their key. Cancelling an encaissement never un-sells the prestations (§3.1 rule 3).
    cancelMidStayNote(reservationId, noteId) {
      if (!HAS_MID_STAY_NOTES) throw midStayError('NOTE_NOT_FOUND', 'Note introuvable.');
      const tx = database.transaction(() => {
        const row = database.prepare(`SELECT endOfStayComplementDetail, endOfStayComplementPaid,
                                             endOfStayComplementPaidCash, midStaySettledNotes
                                        FROM reservations WHERE id = ?`).get(reservationId);
        if (!row) throw midStayError('NOTE_NOT_FOUND', 'Réservation introuvable.');
        if (Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1) {
          throw midStayError('END_OF_STAY_SETTLED', 'Le complément de fin de séjour est déjà encaissé.');
        }
        const notes = parseNotes(row.midStaySettledNotes);
        const note = notes.find((n) => Number(n.id) === Number(noteId));
        if (!note) throw midStayError('NOTE_NOT_FOUND', 'Note introuvable.');

        const detail = parseDetailLines(row.endOfStayComplementDetail);
        const sasLines = detail.filter((l) => l.source !== MID_STAY_SOURCE);
        const midByKey = new Map();
        for (const line of detail.filter((l) => l.source === MID_STAY_SOURCE)) {
          const key = line.key || extraLineKey(line);
          const prev = midByKey.get(key);
          midByKey.set(key, {
            label: (prev && prev.label) || line.label,
            unitPrice: Number((prev && prev.unitPrice) || line.unitPrice || 0),
            amount: round2((prev ? prev.amount : 0) + Number(line.amount || 0)),
            key,
          });
        }
        for (const line of (note.lines || [])) {
          const key = line.key || extraLineKey(line);
          const prev = midByKey.get(key);
          midByKey.set(key, {
            label: (prev && prev.label) || line.label,
            unitPrice: Number((prev && prev.unitPrice) || line.unitPrice || 0),
            amount: round2((prev ? prev.amount : 0) + Number(line.amount || 0)),
            key,
          });
        }
        const nextMidLines = [...midByKey.values()]
          .filter((l) => round2(l.amount) > 0)
          .map((l) => buildMidStayLine(l));

        writeEndOfStayDetail(
          reservationId,
          [...sasLines, ...nextMidLines],
          notes.filter((n) => Number(n.id) !== Number(noteId)),
        );
        return note;
      });
      return tx();
    },

    /**
     * specs/adjustable-complement-amounts.md §3.4 — edit a note of the mid-stay register in place:
     * its amount, its payment date, its CB / caisse-interne mode.
     *
     * The bucket « durant le séjour » is not an amount but a register, so the adjustable unit is the
     * NOTE: `Σ notes` must keep matching what the card shows. Lowering a note therefore does not
     * destroy money — it hands it back to what is still to collect at check-out, exactly the move
     * « annuler la note » already makes. The prestations themselves are never un-sold (rule 26): to
     * really write the money off, the operator offers the line in the departure SAS.
     *
     * @throws {Error} `code` = NOTE_NOT_FOUND | NOTE_AMOUNT_INVALID | END_OF_STAY_SETTLED
     */
    adjustMidStayNote(reservationId, { id, total, paidDate, cash } = {}) {
      if (!HAS_MID_STAY_NOTES) throw midStayError('NOTE_NOT_FOUND', 'Note introuvable.');
      const tx = database.transaction(() => {
        const row = database.prepare(`SELECT endOfStayComplementDetail, endOfStayComplementPaid,
                                             endOfStayComplementPaidCash, midStaySettledNotes
                                        FROM reservations WHERE id = ?`).get(reservationId);
        if (!row) throw midStayError('NOTE_NOT_FOUND', 'Réservation introuvable.');
        if (Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1) {
          throw midStayError('END_OF_STAY_SETTLED', 'Le complément de fin de séjour est déjà encaissé.');
        }
        const notes = parseNotes(row.midStaySettledNotes);
        const note = notes.find((n) => Number(n.id) === Number(id));
        if (!note) throw midStayError('NOTE_NOT_FOUND', 'Note introuvable.');

        if (paidDate !== undefined) note.paidDate = paidDate || note.paidDate;
        if (cash !== undefined) note.paidCash = cash ? 1 : 0;

        // Date / mode only: nothing moves between the note and the remainder.
        if (total === undefined || total === null || total === '') {
          writeEndOfStayDetail(reservationId, parseDetailLines(row.endOfStayComplementDetail), notes);
          return note;
        }

        const nextTotal = round2(total);
        if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
          throw midStayError('NOTE_AMOUNT_INVALID', 'Montant de note invalide. Pour annuler l\'encaissement, supprimez la note.');
        }

        const detail = parseDetailLines(row.endOfStayComplementDetail);
        const sasLines = detail.filter((l) => l.source !== MID_STAY_SOURCE);
        // Remaining amount per key, aggregated — same shape `cancelMidStayNote` builds.
        const midByKey = new Map();
        const give = (line) => {
          const key = line.key || extraLineKey(line);
          const prev = midByKey.get(key);
          midByKey.set(key, {
            label: (prev && prev.label) || line.label,
            unitPrice: Number((prev && prev.unitPrice) || line.unitPrice || 0),
            amount: round2((prev ? prev.amount : 0) + Number(line.amount || 0)),
            key,
          });
        };
        for (const line of detail.filter((l) => l.source === MID_STAY_SOURCE)) give(line);
        // Hand the note's own lines back first: raising a note may legitimately re-take them.
        const noteKeys = [];
        for (const line of (note.lines || [])) {
          const key = line.key || extraLineKey(line);
          if (!noteKeys.includes(key)) noteKeys.push(key);
          give(line);
        }

        const available = round2(noteKeys.reduce((sum, key) => sum + Number((midByKey.get(key) || {}).amount || 0), 0));
        if (nextTotal > round2(available + 0.005)) {
          throw midStayError('NOTE_AMOUNT_INVALID', `Montant supérieur au reste à percevoir sur ces prestations (${available} €).`);
        }

        // Re-consume the new total over the note's own keys, in their original order.
        const noteLines = [];
        let left = nextTotal;
        for (const key of noteKeys) {
          if (left <= 0) break;
          const pool = midByKey.get(key);
          if (!pool || pool.amount <= 0) continue;
          const part = round2(Math.min(pool.amount, left));
          pool.amount = round2(pool.amount - part);
          left = round2(left - part);
          const { source, ...noteLine } = buildMidStayLine({ label: pool.label, unitPrice: pool.unitPrice, amount: part, key });
          noteLines.push(noteLine);
        }
        note.lines = noteLines;
        note.total = round2(noteLines.reduce((sum, l) => sum + Number(l.amount || 0), 0));

        const nextMidLines = [...midByKey.values()]
          .filter((l) => round2(l.amount) > 0)
          .map((l) => buildMidStayLine(l));
        writeEndOfStayDetail(reservationId, [...sasLines, ...nextMidLines], notes);
        return note;
      });
      return tx();
    },

    // specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-14 — the fiche writes the very same
    // marker the arrival SAS recap writes. One column, two entry points, last gesture wins.
    setComplementDeferredToCheckout(reservationId, deferred) {
      persistComplementDeferred(reservationId, deferred);
    },

    // specs/adjustable-complement-amounts.md §3.3 rule 22 — re-run the single write point on the
    // CURRENT lines so the « Ajustement » line is rebuilt. Deliberately without `syncMidStayComplement`'s
    // « already collected » guard: adjusting an amount that was collected wrong is the main use case.
    applyEndOfStayAdjustment(reservationId) {
      const row = database.prepare('SELECT endOfStayComplementDetail FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return;
      writeEndOfStayDetail(reservationId, parseDetailLines(row.endOfStayComplementDetail), model.getMidStaySettledNotes(reservationId));
    },

    // specs/adjustable-complement-amounts.md §3.6 rule 36 — the accounting ventilation of an ADJUSTED
    // arrival complement, decided here (by the fiche, at save time) and stored, so the export reads it
    // verbatim instead of deriving it. `autoAmount` is the complement the engine produced BEFORE the
    // adjustment: the postes are those of the auto complement, only their weights move.
    // No adjustment → the column is cleared and the export derives as it always has.
    syncComplementAllocation(reservationId, { autoAmount } = {}) {
      if (!HAS_COMPLEMENT_ALLOCATION || !HAS_COMPLEMENT_OVERRIDES) return null;
      const row = database.prepare('SELECT complementAmountOverride, complementAmount FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.complementAmountOverride == null) {
        database.prepare('UPDATE reservations SET complementAllocation = NULL WHERE id = ?').run(reservationId);
        return null;
      }
      const reservation = model.getByIdWithDetails(reservationId);
      if (!reservation) return null;
      const auto = autoAmount != null ? Number(autoAmount) : Number(row.complementAmount || 0);
      const base = splitComplementByPoste(arrivalComplementDetailFromReservation(reservation).detail, auto);
      const allocation = allocateComplementAdjustment({ target: Number(row.complementAmount || 0), ...base });
      // §3.6 règle 33 — le plancher est une règle serveur, pas une politesse du champ : un ajustement
      // sous `hébergement + taxe` est remonté au plancher AVANT d'être stocké. Sans ça, la somme des
      // postes (bornée, elle) dépasserait le montant stocké et l'écart repartirait dans la ligne de
      // résidu de l'export — précisément ce que la règle 37 interdit.
      if (allocation.floored) {
        database.prepare("UPDATE reservations SET complementAmount = ?, complementAmountOverride = ?, updatedAt = datetime('now') WHERE id = ?")
          .run(allocation.total, allocation.total, reservationId);
      }
      const stored = {
        accommodation: allocation.accommodation,
        options: allocation.options,
        resources: allocation.resources,
        tax: allocation.tax,
        // Le montant que le moteur produisait avant l'ajustement : l'export s'en sert comme
        // dénominateur de son gross-up, pour ne pas re-gonfler une baisse volontaire (§3.6 règle 37).
        auto: round2(auto),
      };
      database.prepare('UPDATE reservations SET complementAllocation = ? WHERE id = ?')
        .run(JSON.stringify(stored), reservationId);
      return allocation;
    },

    // The floor an arrival-complement adjustment may not go under: the tourist tax + the accommodation
    // auto-gap, neither of which an adjustment ever touches (§3.6 rules 32-34). Returned to the client
    // so the field can refuse the value with a reason instead of silently clamping it.
    complementAdjustmentFloor(reservationId, autoAmount) {
      const reservation = model.getByIdWithDetails(reservationId);
      if (!reservation) return null;
      const auto = autoAmount != null ? Number(autoAmount) : Number(reservation.complementAmount || 0);
      const base = splitComplementByPoste(arrivalComplementDetailFromReservation(reservation).detail, auto);
      return { ...base, floor: round2(base.accommodation + base.tax) };
    },

    // Rewrite the mid-stay lines of the end-of-stay complement and re-total it. Frozen once that
    // complement is collected (§3.5 rule 18): an amount already in the till is never re-priced.
    // `midStayLines` = the REMAINDER computed by the engine (what the notes have not collected).
    syncMidStayComplement(reservationId, midStayLines) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return;
      const row = database.prepare(`SELECT endOfStayComplementDetail, endOfStayComplementAmount,
                                           endOfStayComplementPaid, endOfStayComplementPaidCash
                                      FROM reservations WHERE id = ?`).get(reservationId);
      if (!row) return;
      if (Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1) return;
      const { detail, amount } = mergeMidStayIntoDetail(row.endOfStayComplementDetail, midStayLines);
      const sameAmount = Math.abs(Number(row.endOfStayComplementAmount || 0) - amount) < 0.005;
      const nextDetail = detail.length ? JSON.stringify(detail) : null;
      if (sameAmount && nextDetail === (row.endOfStayComplementDetail || null)) return;
      // The register is left untouched: only the remainder half of the pair moves here.
      writeEndOfStayDetail(reservationId, detail, model.getMidStaySettledNotes(reservationId));
    },

    /**
     * Per-bucket contribution snapshot for a stay settled at the door
     * (specs/collect-stay-payment-at-check-in.md §3.3 rule 13, revised 2026-08-30).
     *
     * BEST EFFORT on purpose. The capture replays the pricing engine and asserts that the line
     * contributions sum to the stored échéance; on a booking whose stored solde is the platform's
     * figure — most OTA stays — the two legitimately disagree and it throws. Letting that abort the
     * commit would cost the whole check-in (caution, upsells, planning flags) for something the
     * operator cannot fix at the door, so the failure is logged and the money is recorded with NULL
     * contribs: the accounting then derives the attribution the legacy way, which is exactly what a
     * full fiche save has always done with these same reservations.
     */
    captureStayContribs(reservationId, bucket) {
      try {
        captureContribsOnFlip({ db: database, reservation: model.getRow(reservationId), bucket });
        return true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[sas-stay-payment] contribs not captured on ${bucket} of reservation ${reservationId}: ${err.message}`);
        return false;
      }
    },

    commitArrivalSas(reservationId, {
      cautionReceived, complementItems = [],
      breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk,
      breakfastPastries, breakfastCereals, breakfastBread, breakfastNote,
      departureHandoverNote, extinguisherSealOkAtArrival,
      complementSettled, complementPaidCash,
      // specs/single-payment-at-check-in.md §3.2 — the guest handed over ONE payment covering the
      // stay AND the complement. INTENT only: the server records which buckets it actually settled
      // and what they came to, so the group can never claim a collection that did not happen.
      groupArrivalPayment,
      // specs/collect-stay-payment-at-check-in.md §3.3 — the SÉJOUR itself settled at the door
      // (a last-minute stay arrives unpaid). Tri-state like the caution: `undefined` = the step never
      // ran → the acompte / solde are left exactly as they are.
      stayPaid, stayPaidCash,
      // specs/sas-upsells-activate-catalogue-option.md §3.1 rule 4 — the two upsells are sent as
      // INTENT (booleans); the server resolves the option + its price. Tri-state, like the caution.
      cleaningAdded, bathLinenAdded,
      // specs/sas-breakfast-and-catering-upsell.md §3.3 — the breakfast + « Restauration » prestations
      // sold at check-in, as INTENT: `[{ optionId, occurrences }]` (card option) or
      // `[{ optionId, units }]`. `undefined` = the sale steps never ran → nothing is touched.
      soldOptions,
      // specs/sas-offer-complement-lines.md §3.2 — gestes commerciaux decided on the recap:
      // `offeredExtras` is the authoritative offered set of the PRE-EXISTING in-complement lines,
      // `cleaningOffered` / `bathLinenOffered` bill the upsell 0 € while still activating its option
      // (so the laundry + the linen stock keep counting it), and each `complementItems` entry carries
      // its own `offered` flag.
      offeredExtras, cleaningOffered, bathLinenOffered,
      // specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 24 — the hours the guest placed
      // on real slots, `[{ resourceId, date, start, end }]`. Already validated by the controller;
      // `undefined` = the step was skipped → the stored sessions are left exactly as they were.
      resourceBlocks,
    } = {}) {
      // Clamp drink/food counts to non-negative integers (authoritative server-side validation).
      const clampCount = (v) => (v === undefined ? undefined : Math.max(0, Math.round(Number(v) || 0)));
      // Bread is counted in baguettes with half steps (specs/sas-breakfast-bread-and-push.md rule 2).
      const clampHalf = (v) => (v === undefined ? undefined : Math.max(0, Math.round((Number(v) || 0) * 2) / 2));
      const tx = database.transaction(() => {
        const today = new Date().toISOString().slice(0, 10);
        // Mark the arrival SAS done (refreshed on every re-commit; the planning button stays a
        // clickable ✓ so the SAS can be re-opened — specs/reopen-completed-sas.md §3 rule 1 & 7).
        database.prepare("UPDATE reservations SET arrivalSasDoneAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(reservationId);

        // Breakfast composition + hour (specs/sas-breakfast-and-handover-note.md). breakfastTime '' /
        // invalid → NULL (= fall back to the option default). Counts default 0 when omitted.
        // Single write path with the fiche (specs/sas-breakfast-time-applies.md §3 rule 2): the hour
        // lands on the reservation AND on the stay's breakfast occurrences, which is what the planning
        // card and the push notice actually read.
        persistBreakfastTime(reservationId, { breakfastTime });
        database.prepare(`UPDATE reservations SET
            breakfastCoffee = ?, breakfastTea = ?, breakfastChocolate = ?, breakfastMilk = ?,
            breakfastPastries = ?, breakfastCereals = ?, breakfastBread = ?, breakfastNote = ?,
            updatedAt = datetime('now') WHERE id = ?`)
          .run(
            clampCount(breakfastCoffee) || 0,
            clampCount(breakfastTea) || 0,
            clampCount(breakfastChocolate) || 0,
            clampCount(breakfastMilk) || 0,
            clampCount(breakfastPastries) || 0,
            clampCount(breakfastCereals) || 0,
            clampHalf(breakfastBread) || 0,
            (breakfastNote && String(breakfastNote).trim()) || null,
            reservationId,
          );

        // Handover note authored at arrival, surfaced at departure. Empty → NULL.
        database.prepare("UPDATE reservations SET departureHandoverNote = ?, updatedAt = datetime('now') WHERE id = ?")
          .run((departureHandoverNote && String(departureHandoverNote).trim()) || null, reservationId);

        // Fire-extinguisher seal baseline at arrival (specs/extinguisher-seal-and-repair-amounts.md):
        // default-present (the client sends 1 unless flagged missing). Recorded only; never bills here.
        if (extinguisherSealOkAtArrival !== undefined) {
          database.prepare("UPDATE reservations SET extinguisherSealOkAtArrival = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(extinguisherSealOkAtArrival ? 1 : 0, reservationId);
        }

        // Caution received — faithful, reversible edit (specs/reopen-completed-sas.md §6). `undefined`
        // (the caution step wasn't shown this run) leaves the marker untouched; true sets it (keeping
        // the first date via COALESCE); false clears the marker AND its date.
        if (cautionReceived !== undefined) {
          if (cautionReceived) {
            // specs/caution-live-from-property.md §3 rule 2 — freeze the live property caution into the
            // reservation at the moment of receipt, so the collected amount never moves afterwards.
            database.prepare("UPDATE reservations SET cautionReceived = 1, cautionReceivedDate = COALESCE(cautionReceivedDate, ?), cautionAmount = (SELECT defaultCautionAmount FROM properties WHERE id = reservations.propertyId), updatedAt = datetime('now') WHERE id = ?")
              .run(today, reservationId);
          } else {
            database.prepare("UPDATE reservations SET cautionReceived = 0, cautionReceivedDate = NULL, updatedAt = datetime('now') WHERE id = ?")
              .run(reservationId);
          }
        }

        // Hours placed on real slots during the SAS. REPLACE, never append: a re-opened SAS must be
        // able to move or remove a block (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4
        // rule 26). Only the resources named in the payload are rewritten, so a resource the operator
        // never opened keeps its sessions.
        if (HAS_RR_SESSIONS && Array.isArray(resourceBlocks)) {
          const byResource = new Map();
          for (const b of resourceBlocks) {
            const key = Number(b?.resourceId);
            if (!key) continue;
            if (!byResource.has(key)) byResource.set(key, []);
            byResource.get(key).push({ date: b.date, start: b.start, end: b.end });
          }
          const writeSessions = database.prepare('UPDATE reservation_resources SET sessions = ? WHERE reservationId = ? AND resourceId = ?');
          for (const [resourceId, sessions] of byResource) {
            sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)));
            writeSessions.run(JSON.stringify(sessions), reservationId, resourceId);
          }
        }

        // Arrival complement — REPLACE the SAS-origin lines (specs/reopen-completed-sas.md §4 rule 4).
        // Drop the rows a prior run of THIS SAS created (sasArrivalOrigin=1), then re-insert the current
        // selection, adjusting complementAmount by (new sum − previous SAS sum) so re-opening never
        // double-counts. A paid complement is frozen. First commit: no tagged rows → pure add (legacy).
        const items = (complementItems || []).filter((i) => i && String(i.label || '').trim() && Number(i.amount) > 0);
        // specs/sas-offer-complement-lines.md §3.3 — the gestes commerciaux on the PRE-EXISTING lines
        // land first: they move `complementAmount` themselves, so the SAS delta below must read the
        // amount AFTER them. The SAS-origin rows are skipped here — they are rebuilt just below with
        // their own `offered` flag.
        applyOfferedComplementExtras(reservationId, offeredExtras, { skipSasOrigin: true });
        const compRow = database.prepare('SELECT complementAmount, complementPaid FROM reservations WHERE id = ?').get(reservationId);
        // specs/sas-breakfast-and-catering-upsell.md §3.3 — the prestations the two sale steps sold,
        // priced server-side. `null` = the steps never ran (tri-state, like the upsell booleans) →
        // the reservation's SAS-sold options are left exactly as they are.
        const sales = Array.isArray(soldOptions) ? model.resolveSasOptionSales(reservationId, soldOptions) : null;
        // The ménage / linge de toilette own their own booleans — the generic writer must never
        // remove a row it doesn't manage.
        const upsells = model.getSasUpsellOptions(reservationId);
        const upsellOptionIds = new Set([upsells.cleaning.optionId, upsells.bathLinen.optionId]
          .filter((id) => id != null).map(Number));
        // Replace, never append (specs/reopen-completed-sas.md §4 rule 4): every SAS-sold option that
        // is not in this run's selection goes, the selected ones are re-priced. Their money is routed
        // to the complement (`inComplement = 1`) and tagged `sasArrivalOrigin = 1`, and their moments
        // are stored so the planning cards + the breakfast prep see the sale.
        const writeSoldOptions = (lines) => {
          if (!HAS_RO_SAS_ARRIVAL_ORIGIN || !lines) return;
          const keep = new Set(lines.map((l) => Number(l.optionId)));
          const drop = database.prepare('DELETE FROM reservation_options WHERE reservationId = ? AND optionId = ? AND COALESCE(sasArrivalOrigin, 0) = 1');
          for (const row of database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1').all(reservationId)) {
            const id = Number(row.optionId);
            if (!keep.has(id) && !upsellOptionIds.has(id)) drop.run(reservationId, id);
          }
          const occColumn = HAS_RO_CARD_OCCURRENCES;
          const perColumn = HAS_RO_CARD_PERSONS;
          const upsert = database.prepare(`
            INSERT INTO reservation_options
              (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, sasArrivalOrigin${occColumn ? ', cardOccurrences' : ''}${perColumn ? ', cardPersons' : ''})
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1${occColumn ? ', ?' : ''}${perColumn ? ', ?' : ''})
            ON CONFLICT(reservationId, optionId) DO UPDATE SET
              quantity = excluded.quantity, unitPrice = excluded.unitPrice, billedUnits = excluded.billedUnits,
              priceType = excluded.priceType, totalPrice = excluded.totalPrice,
              inComplement = 1, sasArrivalOrigin = 1${occColumn ? ', cardOccurrences = excluded.cardOccurrences' : ''}${perColumn ? ', cardPersons = excluded.cardPersons' : ''}
          `);
          for (const l of lines) {
            const params = [reservationId, l.optionId, l.quantity, l.unitPrice, l.billedUnits, l.priceType, l.totalPrice];
            if (occColumn) params.push(l.cardOccurrences && l.cardOccurrences.length ? JSON.stringify(l.cardOccurrences) : null);
            // Only a deliberately reduced (or raised) number of covers is stored; NULL keeps the line
            // following the party (specs/card-option-served-persons.md §3.1 rule 4).
            if (perColumn) params.push(l.cardPersons != null ? Number(l.cardPersons) : null);
            upsert.run(...params);
          }
        };
        // Keys the frozen branch must NOT fold into the arrival baseline (they are mid-stay sales).
        let midStaySaleKeys = [];
        if (compRow && Number(compRow.complementPaid || 0) !== 1) {
          const sasOptionSum = () => (HAS_RO_SAS_ARRIVAL_ORIGIN ? Math.round(Number(database.prepare(
            'SELECT COALESCE(SUM(totalPrice), 0) AS s FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1',
          ).get(reservationId).s) * 100) / 100 : 0);
          // specs/sas-upsells-activate-catalogue-option.md §3.3 rule 10 — the delta now spans BOTH the
          // custom lines (linen elements) and the catalogue options the SAS sells. An OFFERED line is
          // worth 0 € on both sides of the delta (it keeps its `amount`, it just isn't billed).
          const priorSum = Math.round((Number(database.prepare(
            'SELECT COALESCE(SUM(CASE WHEN COALESCE(offered, 0) = 1 THEN 0 ELSE amount END), 0) AS s FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1',
          ).get(reservationId).s) + sasOptionSum()) * 100) / 100;
          database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1').run(reservationId);
          let added = 0;
          if (items.length > 0) {
            const maxSort = database.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options WHERE reservationId = ?').get(reservationId).m;
            const insert = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, sasArrivalOrigin) VALUES (?, ?, ?, ?, ?, 1, 1)');
            let sort = Number(maxSort) + 1;
            for (const it of items) {
              insert.run(reservationId, String(it.label).trim(), Math.round(Number(it.amount) * 100) / 100, it.offered ? 1 : 0, sort);
              sort += 1;
            }
            added = Math.round(items.filter((it) => !it.offered).reduce((s, it) => s + Number(it.amount), 0) * 100) / 100;
          }

          // specs/sas-upsells-activate-catalogue-option.md §3.1-§3.2 — the ménage and the linge de
          // toilette activate their CATALOGUE option (so the laundry + linen stock finally count them),
          // priced by the engine, routed to the complement, tagged `sasArrivalOrigin` so a re-run may
          // remove them. Tri-state: `undefined` = step not shown → leave the reservation alone. An
          // option the operator sold from the fiche (`sasArrivalOrigin = 0`) is NEVER touched.
          // `upsells` is resolved once for the whole transaction above — the sold-options writer needs
          // it too, to know which rows it must never remove.
          // specs/sas-offer-complement-lines.md §3.2 rule 8 — « Offrir » is NOT « Non merci »: an
          // offered upsell stays activated (the laundry + the linen stock count it) but is stored at
          // `totalPrice = 0`, so it costs the guest nothing and drops out of the complement.
          const applyUpsell = (offer, wanted, offered) => {
            if (!HAS_RO_SAS_ARRIVAL_ORIGIN || wanted === undefined || !offer || !offer.optionId) return;
            if (offer.present && !offer.sasOrigin) return;
            if (wanted) {
              if (offer.totalPrice <= 0) return;
              database.prepare(`
                INSERT INTO reservation_options
                  (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, sasArrivalOrigin)
                VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, 1)
                ON CONFLICT(reservationId, optionId) DO UPDATE SET
                  quantity = 1, unitPrice = excluded.unitPrice, billedUnits = excluded.billedUnits,
                  priceType = excluded.priceType, totalPrice = excluded.totalPrice,
                  offered = excluded.offered, inComplement = 1, sasArrivalOrigin = 1
              `).run(
                reservationId, offer.optionId, offer.unitPrice, offer.billedUnits, offer.priceType,
                offered ? 0 : offer.totalPrice, offered ? 1 : 0,
              );
            } else if (offer.sasOrigin) {
              database.prepare('DELETE FROM reservation_options WHERE reservationId = ? AND optionId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
                .run(reservationId, offer.optionId);
            }
          };
          applyUpsell(upsells.cleaning, cleaningAdded, cleaningOffered);
          applyUpsell(upsells.bathLinen, bathLinenAdded, bathLinenOffered);
          // The breakfast + « Restauration » sales ride the very same delta: `sasOptionSum()` reads
          // every SAS-origin option row, so a re-commit re-prices instead of stacking.
          writeSoldOptions(sales);
          added = Math.round((added + sasOptionSum()) * 100) / 100;

          const next = Math.max(0, Math.round((Number(compRow.complementAmount || 0) - priorSum + added) * 100) / 100);
          database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(next, reservationId);
          // Le SAS a écrit son montant hors moteur : rendre la main à l'ajustement de l'opérateur.
          reapplyComplementOverride(reservationId, next);
        } else if (compRow && sales) {
          // The arrival complement is already collected, and a collected complement never moves again
          // (specs/frozen-complement-trusts-client.md). Selling now is therefore a sale made DURING the
          // stay: the option is still written — it has to be prepared, planned and counted — but its
          // money takes the mid-stay route, i.e. the end-of-stay complement, collectable on the spot
          // with a « note » or at check-out (specs/mid-stay-notes.md). Capturing the baseline first is
          // what makes the sale (and only the sale) stand above it.
          model.captureArrivalExtrasBaseline(reservationId);
          // Which SAS-sold options were already routed there, so a re-run that drops one takes its
          // money back out (the keys are read BEFORE the rows are rewritten).
          const previousSaleKeys = new Set((HAS_RO_SAS_ARRIVAL_ORIGIN
            ? database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1').all(reservationId)
            : []).map((r) => extraLineKey({ optionId: r.optionId })).filter(Boolean));
          writeSoldOptions(sales);
          midStaySaleKeys = sales.map((l) => extraLineKey({ optionId: l.optionId })).filter(Boolean);
          // Merge into the mid-stay lines already stored (a prestation sold on the fiche earlier in
          // the stay keeps its own line verbatim) rather than recomputing the whole split.
          const detailRow = database.prepare('SELECT endOfStayComplementDetail FROM reservations WHERE id = ?').get(reservationId);
          const byKey = new Map();
          for (const line of storedMidStayLines(detailRow && detailRow.endOfStayComplementDetail)) {
            const key = line.key || extraLineKey(line);
            if (key && previousSaleKeys.has(key) && !midStaySaleKeys.includes(key)) continue;
            byKey.set(key || line.label, line);
          }
          for (const line of sales) {
            const key = extraLineKey({ optionId: line.optionId });
            byKey.set(key, buildMidStayLine({
              label: line.title, unitPrice: line.unitPrice, amount: line.totalPrice, key,
            }));
          }
          model.syncMidStayComplement(reservationId, [...byKey.values()]);
        }

        // specs/recall-unpaid-arrival-complement-at-checkout.md §3 rule 2 — explicit « Complément encaissé »
        // confirmation on the arrival recap. Tri-state (same contract as the caution): undefined leaves the
        // marker untouched; true marks the arrival complement paid (first date kept via COALESCE); false
        // clears it. A normally-collected complement is thus NOT recalled at departure; a forgotten one
        // stays unpaid and IS recalled.
        // specs/defer-arrival-complement-to-checkout.md §3.2 rule 5 — the same answer also records
        // WHERE the complement will be collected: « En fin de séjour » (not settled) marks the
        // reservation deferred so every view presents a single end-of-stay complement; settling on
        // the spot clears the marker (fully reversible on a re-open).
        // specs/single-payment-at-check-in.md §3.2 — what THIS commit actually settled, which is what
        // the group is allowed to claim. Filled by the two blocks below, read once at the end.
        const settledByThisCommit = [];
        if (complementSettled !== undefined) {
          if (complementSettled) {
            database.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = COALESCE(complementPaidDate, ?), complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
              .run(today, complementPaidCash ? 1 : 0, reservationId);
            settledByThisCommit.push('complement');
          } else {
            database.prepare("UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL, complementPaidCash = 0, updatedAt = datetime('now') WHERE id = ?")
              .run(reservationId);
          }
          // `complementPaidAtArrival` mirrors the two stay markers (specs/single-payment-at-check-in.md
          // rule 9): the settlement is the SAS's own, so a re-open may undo it and a fiche edit takes
          // it away. Written apart and guarded — several minimal test schemas have no such column, and
          // the settlement above must not depend on it.
          try {
            database.prepare("UPDATE reservations SET complementPaidAtArrival = ? WHERE id = ?")
              .run(complementSettled ? 1 : 0, reservationId);
          } catch {
            // No marker column here: the complement is settled all the same.
          }
          persistComplementDeferred(reservationId, !complementSettled);
        }

        // specs/collect-stay-payment-at-check-in.md §3.3 rules 13-14 — the stay collected at the door.
        // Runs AFTER the complement lines: the contribution capture replays the engine on the stored
        // reservation, and the SAS lines are `inComplement = 1`, so they contribute NULL and leave the
        // acompte / solde conservation invariant alone. A capture that breaks it THROWS, which rolls
        // the whole check-in back rather than booking a half-attributed encaissement.
        if (stayPaid !== undefined) {
          const row = model.getRow(reservationId);
          const buckets = bucketStates(row);
          const targets = [
            {
              key: 'deposit',
              bucket: buckets.deposit,
              cols: ['depositPaid', 'depositPaidDate', 'depositPaidCash', 'depositPaidAtArrival'],
              prev: {
                paid: row.depositPaid, cash: row.depositPaidCash, date: row.depositPaidDate, atArrival: row.depositPaidAtArrival,
              },
            },
            {
              key: 'balance',
              bucket: buckets.balance,
              cols: ['balancePaid', 'balancePaidDate', 'balancePaidCash', 'balancePaidAtArrival'],
              prev: {
                paid: row.balancePaid, cash: row.balancePaidCash, date: row.balancePaidDate, atArrival: row.balancePaidAtArrival,
              },
            },
          ];
          for (const target of targets) {
            const next = resolveStayPayment({
              bucket: target.bucket, prev: target.prev, stayPaid, stayPaidCash: Boolean(stayPaidCash), today,
            });
            if (!next) continue;
            const was = Number(target.prev.paid || 0) === 1;
            const willBe = next.paid === 1;
            // Re-read the row for the capture: the acompte is settled first in this very loop, and the
            // solde capture is defined as « what the line still owes AFTER its acompte snapshot ».
            // Handing it the pre-loop row makes it claim the whole line and break its own invariant.
            if (!was && willBe) model.captureStayContribs(reservationId, target.key);
            else if (was && !willBe) clearContribsOnUnflip({ db: database, reservationId, bucket: target.key });
            const [paidCol, dateCol, cashCol, markerCol] = target.cols;
            database.prepare(`UPDATE reservations SET ${paidCol} = ?, ${dateCol} = ?, ${cashCol} = ?, ${markerCol} = ?, updatedAt = datetime('now') WHERE id = ?`)
              .run(next.paid, next.date, next.cash, next.atArrival, reservationId);
            if (willBe) settledByThisCommit.push(target.key);
          }
        }

        // specs/single-payment-at-check-in.md §3.2 rules 6-7 — the group. Nothing above changed:
        // every bucket keeps its own amount, its own date and its own accounting. What is added is
        // the sentence « these buckets were one collection », written from what the commit really
        // settled rather than from what the client claimed. Fewer than two buckets settled → no
        // group, and any previous one is dropped (the re-opened SAS that undoes a single payment
        // lands here with an empty list).
        if (groupArrivalPayment !== undefined) {
          const after = model.getRow(reservationId);
          const amountOf = { deposit: 'depositAmount', balance: 'balanceAmount', complement: 'complementAmount' };
          const total = settledByThisCommit.reduce((sum, b) => sum + (Number(after[amountOf[b]]) || 0), 0);
          const json = groupArrivalPayment
            ? serialiseGroup({
              at: today,
              cash: Boolean(stayPaidCash || complementPaidCash),
              total,
              buckets: settledByThisCommit,
            })
            : null;
          try {
            database.prepare("UPDATE reservations SET arrivalPaymentGroup = ?, updatedAt = datetime('now') WHERE id = ?")
              .run(json, reservationId);
          } catch {
            // Minimal test schemas without the column: the settlement above still stands.
          }
        }
        // specs/sas-bath-linen-ghost-line.md §3 rules 1-2 — the arrival SAS never writes a billing line
        // into the end-of-stay complement: what the guest takes is the catalogue option activated on the
        // fiche just above. Any line left by the removed « réglé en fin de séjour » flow is dropped here,
        // unconditionally (NOT gated on the bath-linen step being shown — that gate is exactly why a
        // reservation carrying both the option and the ghost line could never repair itself).
        model.dropBathLinenGhostLine(reservationId);

        // specs/arrival-departure-sas.md §3.6 — going all the way through the arrival SAS validates the
        // planning coche AND the dashboard « Prêt » + « Arrivé » (checkInReady is both). Forward-only
        // convenience: completing the SAS means the guest is in; re-committing re-affirms it, and it's
        // never auto-unticked here (the operator can always uncheck it on the planning/dashboard).
        database.prepare("UPDATE reservations SET checkInReady = 1, checkInDone = 1, updatedAt = datetime('now') WHERE id = ?").run(reservationId);

        // specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 4 — the SAS runs after the
        // stay started, so its own lines would look like mid-stay sales at the next fiche save. They
        // belong to the ARRIVAL complement (they are already in `complementAmount`), so fold them
        // into the baseline at their current amount. Re-running the SAS re-folds the new amounts.
        // A sale made on a FROZEN complement is the exception: it was routed to the end-of-stay
        // complement just above, so folding its key here would erase it from the mid-stay split.
        const midStayKeySet = new Set(midStaySaleKeys);
        const sasKeys = [
          ...database.prepare('SELECT description FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1')
            .all(reservationId)
            .map((r) => extraLineKey({ isCustom: true, title: r.description })),
          ...(HAS_RO_SAS_ARRIVAL_ORIGIN
            ? database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
              .all(reservationId)
              .map((r) => extraLineKey({ optionId: r.optionId }))
            : []),
        ].filter((key) => key && !midStayKeySet.has(key));
        model.addKeysToArrivalExtrasBaseline(reservationId, sasKeys);

        return database.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(reservationId).complementAmount;
      });
      return tx();
    },

    // Single commit for the departure SAS: caution return + the dedicated end-of-stay complement.
    // The extinguisher charge is computed HERE (fat backend, specs/extinguisher-seal-and-repair-amounts.md
    // §3.2 — 2026-06-17): the client sends only `extinguisherCharges` = [{ repairKey, qty }]; the server
    // looks up the configured price, builds the lines, appends them to the end-of-stay detail, and the
    // stored amount is the authoritative sum of every line (no client-supplied total is trusted).
    commitDepartureSas(reservationId, {
      cautionReturned, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture, extinguisherCharges,
      complementsSettled, complementsPaidCash,
      // specs/sas-offer-complement-lines.md §3.2 rule 6 — the arrival complement is collected at the
      // door when it was never settled, so its lines are offerable here too. Authoritative set, same
      // contract as the arrival `offeredExtras` (every in-complement line is addressable at check-out,
      // including the ones the arrival SAS wrote).
      offeredArrivalExtras,
    } = {}) {
      const tx = database.transaction(() => {
        const today = new Date().toISOString().slice(0, 10);
        // specs/sas-offer-complement-lines.md §3.2 rule 6.ter — the check-out recap only RECALLS the
        // arrival complement when something is still owed on it (amount > 0 and unpaid). When it is
        // not recalled, the recap rendered no arrival line, so it holds no authority over their
        // `offered` flags: an empty set coming from that screen means « nothing was shown », never
        // « nothing is offered ». Taken literally it billed back every offered line — and an arrival
        // complement made entirely of gestes commerciaux sums to 0 €, which is exactly the case where
        // it is not recalled.
        const recall = database.prepare('SELECT complementAmount, complementPaid FROM reservations WHERE id = ?').get(reservationId);
        const recallsArrival = Boolean(recall) && Number(recall.complementPaid || 0) !== 1 && round2(recall.complementAmount) > 0;
        applyOfferedComplementExtras(reservationId, recallsArrival ? offeredArrivalExtras : undefined);
        // Mark the departure SAS done (refreshed on every re-commit; the planning button stays a
        // clickable ✓ so the SAS can be re-opened — specs/reopen-completed-sas.md §3 rule 1 & 7).
        database.prepare("UPDATE reservations SET departureSasDoneAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(reservationId);
        // Caution returned — faithful, reversible edit (specs/reopen-completed-sas.md §6). Same
        // undefined / set / clear contract as the arrival caution.
        if (cautionReturned !== undefined) {
          if (cautionReturned) {
            database.prepare("UPDATE reservations SET cautionReturned = 1, cautionReturnedDate = COALESCE(cautionReturnedDate, ?), updatedAt = datetime('now') WHERE id = ?")
              .run(today, reservationId);
          } else {
            database.prepare("UPDATE reservations SET cautionReturned = 0, cautionReturnedDate = NULL, updatedAt = datetime('now') WHERE id = ?")
              .run(reservationId);
          }
        }
        // Server-built extinguisher lines: only when the extinguisher is NOT in good condition and a
        // quantity is requested. Price is read from repair_amounts (authoritative); a 0 € or 0-qty
        // tariff produces no line.
        // specs/defer-arrival-complement-to-checkout.md §3.1 rule 3 — authoritative guard: when the
        // cleaning is ALREADY sold on the reservation (booked option, « Ménage » line added by the
        // arrival SAS, or property default), the end-of-stay cleaning can never be billed. Drops the
        // line whatever the client sends, and drops a line stored by an earlier commit on re-run
        // (rule 4: re-running the departure SAS is how an over-billed stay is corrected).
        const cleaningSold = model.isCleaningSoldForReservation(reservationId);
        // specs/sas-offer-complement-lines.md §3.3 rule 9 — an offered line is stored at 0 € but keeps
        // its label, its quantity, its unit price and its `source`/`key` tags: that is what shows the
        // real price struck through on the recap, and what lets a re-open bill it again.
        // The real total is stored VERBATIM in `originalAmount`, never left to be re-derived — that is
        // what makes the gesture reversible (§3.1 rule 3). `qty × unitPrice` is not that total: a
        // « préservée » line (rule 6.bis) carries no unit price at all, so it was stored 1 × 0 € and
        // its price was simply gone; and `buildMidStayLine` legitimately emits 2 × 16,67 € for a
        // 33,33 € line, which re-derives one cent too high. Quantity and unit price are left exactly
        // as sent — they are the recap wording and the history, not the price.
        const offerLine = (line) => {
          if (Number(line && line.offered ? 1 : 0) !== 1) return line;
          // The recap sends the real total in `amount` — a line is zeroed HERE, not on the way in. The
          // fallback makes the write idempotent all the same: re-committing an already-stored offered
          // row verbatim would otherwise read its zeroed `amount` and overwrite the price with 0,
          // destroying it. No client does that today; nothing should be one refactor away from it.
          const sent = round2(line.amount);
          return { ...line, offered: 1, amount: 0, originalAmount: sent > 0 ? sent : round2(line.originalAmount) };
        };
        const baseDetail = (Array.isArray(endOfStayComplementDetail) ? endOfStayComplementDetail : [])
          .filter((l) => !(cleaningSold && String((l && l.label) || '').trim() === END_OF_STAY_CLEANING_LABEL))
          .map(offerLine);
        const extinguisherLines = [];
        if (extinguisherSealOkAtDeparture !== undefined && !extinguisherSealOkAtDeparture && Array.isArray(extinguisherCharges)) {
          const priceStmt = database.prepare('SELECT label, price FROM repair_amounts WHERE repairKey = ?');
          for (const charge of extinguisherCharges) {
            const repairKey = String((charge && charge.repairKey) || '').trim();
            const qty = Math.max(0, Math.floor(Number(charge && charge.qty) || 0));
            if (!repairKey || qty <= 0) continue;
            const row = priceStmt.get(repairKey);
            if (!row) continue;
            const unitPrice = Math.max(0, Number(row.price) || 0);
            const lineAmount = Math.round(unitPrice * qty * 100) / 100;
            if (lineAmount <= 0) continue;
            extinguisherLines.push(charge && charge.offered
              ? { repairKey, label: row.label, qty, unitPrice, amount: 0, offered: 1, originalAmount: lineAmount }
              : { repairKey, label: row.label, qty, amount: lineAmount });
          }
        }
        // specs/adjustable-complement-amounts.md §3.3 rule 20 — through the single write point, so a
        // re-run of the departure SAS re-applies the operator's adjustment instead of erasing it.
        const amount = writeEndOfStayDetail(reservationId, [...baseDetail, ...extinguisherLines], model.getMidStaySettledNotes(reservationId));

        // specs/recall-unpaid-arrival-complement-at-checkout.md §3 rules 4-5 — « Compléments encaissés »
        // confirmation on the departure recap. Tri-state (same contract as the caution). When ON, mark
        // paid WHATEVER has a positive amount, at the checkout moment:
        //   - the end-of-stay complement (when amount > 0);
        //   - the RECALLED arrival complement (when it's still unsettled: amount > 0 AND complementPaid = 0).
        // The two amounts stay SEPARATE in the DB (the tourist tax keeps its 46710000 routing). When OFF,
        // clear the end-of-stay marker (its own field). The arrival recall is mark-only here — an
        // over-collected arrival complement is reverted on the fiche (it can't be told apart from a
        // check-in collection without extra state).
        if (complementsSettled !== undefined) {
          const cash = complementsPaidCash ? 1 : 0;
          if (complementsSettled) {
            if (amount > 0) {
              database.prepare("UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = COALESCE(endOfStayComplementPaidDate, ?), endOfStayComplementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
                .run(today, cash, reservationId);
            }
            const arr = database.prepare('SELECT complementAmount, complementPaid FROM reservations WHERE id = ?').get(reservationId);
            if (arr && Number(arr.complementAmount || 0) > 0 && Number(arr.complementPaid || 0) === 0) {
              database.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = COALESCE(complementPaidDate, ?), complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
                .run(today, cash, reservationId);
            }
          } else {
            database.prepare("UPDATE reservations SET endOfStayComplementPaid = 0, endOfStayComplementPaidDate = NULL, endOfStayComplementPaidCash = 0, updatedAt = datetime('now') WHERE id = ?")
              .run(reservationId);
          }
        }
        // Extinguisher condition at departure (1 = bon état, 0 = pas bon état). The bill rides the detail.
        if (extinguisherSealOkAtDeparture !== undefined) {
          database.prepare("UPDATE reservations SET extinguisherSealOkAtDeparture = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(extinguisherSealOkAtDeparture ? 1 : 0, reservationId);
        }

        // specs/arrival-departure-sas.md §3.6 — going all the way through the departure SAS validates the
        // planning coche = dashboard « Parti » (checkOutDone). Same forward-only, never-auto-untick rule
        // as the arrival flags above.
        database.prepare("UPDATE reservations SET checkOutDone = 1, updatedAt = datetime('now') WHERE id = ?").run(reservationId);
      });
      tx();
    },
  };

  return model;
}

const defaultModel = createReservationsModel(db);
defaultModel.create = createReservationsModel;
defaultModel.__test = { deriveCommissionAmount, arrivalComplementDetailFromReservation, resolveEffectiveCaution };

module.exports = defaultModel;
