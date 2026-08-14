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
const { formatPlatformName } = require('../utils/platformNameFormat');
const { formatTimeShort } = require('../utils/dateFr');
const { timeToHour, addIsoDays, EARLY_CHECKIN_BLOCK_HOUR, LATE_CHECKOUT_BLOCK_HOUR } = require('../utils/occupancy');
const { getOptionsSignature, getResourcesSignature, buildHistoryRows } = require('../utils/reservationAudit');
const { computeBedLinenAlert } = require('../utils/bedLinenAdequacy');
const { computePaymentStatus } = require('../utils/paymentStatus');
const { generateReservationNumber } = require('../utils/reservationNumber');
const { isPlatformCollectingTouristTax, getTypeMultiplier } = require('../utils/pricing');
const { isCleaningOption } = require('../utils/cleaningOption');
const { buildCheckoutComplement, END_OF_STAY_CLEANING_LABEL } = require('../utils/checkoutComplement');
const {
  buildExtrasBaseline, mergeMidStayIntoDetail, parseBaseline, extraLineKey,
  buildMidStayLine, parseNotes, nextNoteId, MID_STAY_SOURCE,
} = require('../utils/midStayExtras');
const { buildOperationalCollection } = require('../utils/operationalCollection');
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
function arrivalComplementDetailFromReservation(r) {
  if (!r) return { amount: 0, paid: 0, detail: [] };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const lines = [];
  // `qty`/`unitPrice`/`kind` (specs/j2-email-coffee-and-sas-complement.md) are additive: they let the
  // J-2 email render the same « label : qté × prix = total » lines as the SAS recap, and localise the
  // system labels (tax / remainder) per language. Existing consumers reading `label`/`amount` are
  // unaffected. `qty` mirrors the SAS: billedUnits, else quantity, else 1.
  for (const o of (r.options || [])) {
    if (Number(o.inComplement || 0) === 1 && Number(o.offered || 0) !== 1) {
      const amt = round2(o.totalPrice != null ? o.totalPrice : o.originalTotalPrice);
      if (amt > 0) lines.push({
        kind: 'option', label: String(o.title || o.description || 'Extra').trim(),
        qty: Number(o.billedUnits || o.quantity || 1), unitPrice: round2(o.unitPrice), amount: amt,
      });
    }
  }
  for (const res of (r.resources || [])) {
    if (Number(res.inComplement || 0) === 1 && Number(res.offered || 0) !== 1) {
      const amt = round2(res.totalPrice != null ? res.totalPrice : res.originalTotalPrice);
      if (amt > 0) lines.push({
        kind: 'resource', label: String(res.name || 'Ressource').trim(),
        qty: Number(res.billedUnits || res.quantity || 1), unitPrice: round2(res.unitPrice), amount: amt,
      });
    }
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

  // Single write point for « the end-of-stay complement + its register »: the detail, the re-summed
  // amount and the notes always move together, so the remainder + register invariant can't drift.
  const writeEndOfStayDetail = (reservationId, detailLines, notes) => {
    const lines = (detailLines || []).filter((l) => round2(l && l.amount) > 0);
    const amount = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
    const detailJson = lines.length ? JSON.stringify(lines) : null;
    if (!HAS_MID_STAY_NOTES) {
      database.prepare("UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(amount, detailJson, reservationId);
      return;
    }
    database.prepare(`UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?,
                             midStaySettledNotes = ?, updatedAt = datetime('now') WHERE id = ?`)
      .run(amount, detailJson, (notes && notes.length) ? JSON.stringify(notes) : null, reservationId);
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
    // Matches kind='reservation' rows by number, firstName, lastName, "first last", "last first" or email
    // (case-insensitive substring). Result is shaped + capped server-side (fat backend). Blank q → [].
    search({ q } = {}) {
      const term = String(q || '').trim().toLowerCase();
      if (!term) return [];
      const like = `%${term}%`;
      const rows = database.prepare(`
        SELECT r.id, r.reservationNumber, r.startDate, r.endDate,
               c.firstName, c.lastName, p.name AS propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND (
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
          p.defaultCautionAmount as propertyDefaultCautionAmount
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.id = ? AND r.kind = 'reservation'
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
      reservation.checkoutComplement = buildCheckoutComplement(
        reservation,
        arrivalComplementDetailFromReservation(reservation),
      );
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
        depositDisabled, touristTaxInComplement, depositAmountOverride } = payload;
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
      return result.lastInsertRowid;
    },

    updateReservation(reservationId, payload, quote, nightBlocks, nextIcalSyncLocked) {
      const { propertyId, clientId, startDate, endDate, adults, children, teens, babies,
        singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, customPrice,
        depositDueDate, depositPaid, depositPaidDate, balanceDueDate, balancePaid, balancePaidDate, notes,
        cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
        extraGuestSurchargeOffered, clientGrossAmount, platformCommissionAmount, acompteCommissionAmount, platformGrossAmount, platformPayoutAmount,
        complementPaid, complementPaidDate,
        depositDisabled, touristTaxInComplement, depositAmountOverride } = payload;
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
      return database.prepare('SELECT description, amount FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1 ORDER BY sortOrder, id')
        .all(reservationId);
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
      database.prepare("UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(cleaned.amount, cleaned.detail.length ? JSON.stringify(cleaned.detail) : null, reservationId);
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

    // Single commit for the arrival SAS. `complementItems` = [{ label, amount }] (missing linen
    // elements + optionally the cleaning charge). Written as custom options inComplement=1 +
    // sasArrivalOrigin=1. Re-openable SAS: a re-commit REPLACES the SAS-origin complement lines
    // instead of appending (complementAmount adjusted by new − previous SAS sum), so it never
    // double-charges (specs/reopen-completed-sas.md §4). A paid complement stays frozen.
    // specs/recall-unpaid-arrival-complement-at-checkout.md §3 rule 6 — itemise the arrival complement so
    // the departure SAS can recall it line-by-line.
    buildArrivalComplementDetail(reservationId) {
      const r = model.getByIdWithDetails(reservationId);
      if (!r) return { amount: 0, paid: 0, detail: [] };
      return arrivalComplementDetailFromReservation(r);
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
    resolveArrivalExtrasBaseline(reservationId, todayIso) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT startDate, arrivalExtrasBaseline FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.arrivalExtrasBaseline) return row.arrivalExtrasBaseline;
      if (!row.startDate || String(row.startDate) > String(todayIso)) return null;
      return JSON.stringify(buildExtrasBaseline(model.readExtraLines(reservationId)));
    },

    getArrivalExtrasBaseline(reservationId) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = ?').get(reservationId);
      return (row && row.arrivalExtrasBaseline) || null;
    },

    // Capture the baseline once, from the CURRENT lines, when the stay has started. Idempotent: an
    // already-captured baseline is never overwritten (that would swallow the mid-stay sales).
    captureArrivalExtrasBaselineIfDue(reservationId, todayIso) {
      if (!HAS_ARRIVAL_EXTRAS_BASELINE) return null;
      const row = database.prepare('SELECT startDate, arrivalExtrasBaseline FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      if (row.arrivalExtrasBaseline) return row.arrivalExtrasBaseline;
      if (!row.startDate || String(row.startDate) > String(todayIso)) return null;
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

    commitArrivalSas(reservationId, {
      cautionReceived, complementItems = [],
      breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk,
      breakfastPastries, breakfastCereals, breakfastBread, breakfastNote,
      departureHandoverNote, extinguisherSealOkAtArrival,
      complementSettled, complementPaidCash,
      // specs/sas-upsells-activate-catalogue-option.md §3.1 rule 4 — the two upsells are sent as
      // INTENT (booleans); the server resolves the option + its price. Tri-state, like the caution.
      cleaningAdded, bathLinenAdded,
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
        if (breakfastTime !== undefined) {
          const raw = String(breakfastTime || '').trim();
          const value = raw === '' ? null : (formatTimeShort(raw) || null);
          database.prepare('UPDATE reservations SET breakfastTime = ? WHERE id = ?').run(value, reservationId);
        }
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

        // Arrival complement — REPLACE the SAS-origin lines (specs/reopen-completed-sas.md §4 rule 4).
        // Drop the rows a prior run of THIS SAS created (sasArrivalOrigin=1), then re-insert the current
        // selection, adjusting complementAmount by (new sum − previous SAS sum) so re-opening never
        // double-counts. A paid complement is frozen. First commit: no tagged rows → pure add (legacy).
        const items = (complementItems || []).filter((i) => i && String(i.label || '').trim() && Number(i.amount) > 0);
        const compRow = database.prepare('SELECT complementAmount, complementPaid FROM reservations WHERE id = ?').get(reservationId);
        if (compRow && Number(compRow.complementPaid || 0) !== 1) {
          const sasOptionSum = () => (HAS_RO_SAS_ARRIVAL_ORIGIN ? Math.round(Number(database.prepare(
            'SELECT COALESCE(SUM(totalPrice), 0) AS s FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1',
          ).get(reservationId).s) * 100) / 100 : 0);
          // specs/sas-upsells-activate-catalogue-option.md §3.3 rule 10 — the delta now spans BOTH the
          // custom lines (linen elements) and the catalogue options the SAS sells.
          const priorSum = Math.round((Number(database.prepare(
            'SELECT COALESCE(SUM(amount), 0) AS s FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1',
          ).get(reservationId).s) + sasOptionSum()) * 100) / 100;
          database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1').run(reservationId);
          let added = 0;
          if (items.length > 0) {
            const maxSort = database.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options WHERE reservationId = ?').get(reservationId).m;
            const insert = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, sasArrivalOrigin) VALUES (?, ?, ?, 0, ?, 1, 1)');
            let sort = Number(maxSort) + 1;
            for (const it of items) { insert.run(reservationId, String(it.label).trim(), Math.round(Number(it.amount) * 100) / 100, sort); sort += 1; }
            added = Math.round(items.reduce((s, it) => s + Number(it.amount), 0) * 100) / 100;
          }

          // specs/sas-upsells-activate-catalogue-option.md §3.1-§3.2 — the ménage and the linge de
          // toilette activate their CATALOGUE option (so the laundry + linen stock finally count them),
          // priced by the engine, routed to the complement, tagged `sasArrivalOrigin` so a re-run may
          // remove them. Tri-state: `undefined` = step not shown → leave the reservation alone. An
          // option the operator sold from the fiche (`sasArrivalOrigin = 0`) is NEVER touched.
          const upsells = model.getSasUpsellOptions(reservationId);
          const applyUpsell = (offer, wanted) => {
            if (!HAS_RO_SAS_ARRIVAL_ORIGIN || wanted === undefined || !offer || !offer.optionId) return;
            if (offer.present && !offer.sasOrigin) return;
            if (wanted) {
              if (offer.totalPrice <= 0) return;
              database.prepare(`
                INSERT INTO reservation_options
                  (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, sasArrivalOrigin)
                VALUES (?, ?, 1, ?, ?, ?, ?, 0, 1, 1)
                ON CONFLICT(reservationId, optionId) DO UPDATE SET
                  quantity = 1, unitPrice = excluded.unitPrice, billedUnits = excluded.billedUnits,
                  priceType = excluded.priceType, totalPrice = excluded.totalPrice,
                  inComplement = 1, sasArrivalOrigin = 1
              `).run(reservationId, offer.optionId, offer.unitPrice, offer.billedUnits, offer.priceType, offer.totalPrice);
            } else if (offer.sasOrigin) {
              database.prepare('DELETE FROM reservation_options WHERE reservationId = ? AND optionId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
                .run(reservationId, offer.optionId);
            }
          };
          applyUpsell(upsells.cleaning, cleaningAdded);
          applyUpsell(upsells.bathLinen, bathLinenAdded);
          added = Math.round((added + sasOptionSum()) * 100) / 100;

          const next = Math.max(0, Math.round((Number(compRow.complementAmount || 0) - priorSum + added) * 100) / 100);
          database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(next, reservationId);
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
        if (complementSettled !== undefined) {
          if (complementSettled) {
            database.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = COALESCE(complementPaidDate, ?), complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
              .run(today, complementPaidCash ? 1 : 0, reservationId);
          } else {
            database.prepare("UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL, complementPaidCash = 0, updatedAt = datetime('now') WHERE id = ?")
              .run(reservationId);
          }
          persistComplementDeferred(reservationId, !complementSettled);
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
        const sasKeys = [
          ...database.prepare('SELECT description FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1')
            .all(reservationId)
            .map((r) => extraLineKey({ isCustom: true, title: r.description })),
          ...(HAS_RO_SAS_ARRIVAL_ORIGIN
            ? database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1')
              .all(reservationId)
              .map((r) => extraLineKey({ optionId: r.optionId }))
            : []),
        ].filter(Boolean);
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
    commitDepartureSas(reservationId, { cautionReturned, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture, extinguisherCharges, complementsSettled, complementsPaidCash } = {}) {
      const tx = database.transaction(() => {
        const today = new Date().toISOString().slice(0, 10);
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
        const baseDetail = (Array.isArray(endOfStayComplementDetail) ? endOfStayComplementDetail : [])
          .filter((l) => !(cleaningSold && String((l && l.label) || '').trim() === END_OF_STAY_CLEANING_LABEL));
        const extinguisherLines = [];
        if (extinguisherSealOkAtDeparture !== undefined && !extinguisherSealOkAtDeparture && Array.isArray(extinguisherCharges)) {
          const priceStmt = database.prepare('SELECT label, price FROM repair_amounts WHERE repairKey = ?');
          for (const charge of extinguisherCharges) {
            const repairKey = String((charge && charge.repairKey) || '').trim();
            const qty = Math.max(0, Math.floor(Number(charge && charge.qty) || 0));
            if (!repairKey || qty <= 0) continue;
            const row = priceStmt.get(repairKey);
            if (!row) continue;
            const lineAmount = Math.round(Math.max(0, Number(row.price) || 0) * qty * 100) / 100;
            if (lineAmount <= 0) continue;
            extinguisherLines.push({ repairKey, label: row.label, qty, amount: lineAmount });
          }
        }
        const detail = [...baseDetail, ...extinguisherLines];
        const amount = Math.max(0, Math.round(detail.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100);
        database.prepare("UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?, updatedAt = datetime('now') WHERE id = ?")
          .run(amount, detail.length ? JSON.stringify(detail) : null, reservationId);

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
