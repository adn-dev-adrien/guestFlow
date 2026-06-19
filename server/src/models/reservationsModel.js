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
const { getOptionsSignature, getResourcesSignature, enrichHistoryChanges } = require('../utils/reservationAudit');
const { computeBedLinenAlert } = require('../utils/bedLinenAdequacy');
const { computePaymentStatus } = require('../utils/paymentStatus');
const { generateReservationNumber } = require('../utils/reservationNumber');
const establishmentClosuresModel = require('./establishmentClosuresModel');

// specs/force-extras-complement-on-platform.md §3 rule 1: every extra line written for a
// non-direct platform reservation is forced to `inComplement = 1`, regardless of the
// caller's payload. The model is authoritative — the client toggle is hidden in the UI
// for these reservations, but the rule applies even if a stale or hand-crafted payload
// arrives with `inComplement: 0`.
function isPlatformNonDirect(platform) {
  const normalized = formatPlatformName(platform) || 'direct';
  return String(normalized).toLowerCase() !== 'direct';
}

// Reads the reservation's stored `platform` value (just-persisted within the same
// transaction by `insertReservation` / `updateReservation`) and returns `true` if the
// reservation should have its extras forced to `inComplement = 1`. Returns `false` for
// a missing reservation (caller is mid-insert and the row hasn't landed yet — pricing
// engine + caller already validated the input) so we don't accidentally over-force.
function readPlatformForcing(database, reservationId) {
  const row = database.prepare('SELECT platform FROM reservations WHERE id = ?').get(reservationId);
  if (!row) return false;
  return isPlatformNonDirect(row.platform);
}

// Platform-sourced reservations carry `clientGrossAmount` (what the guest paid the platform, TTC).
// The owner's net stays in `finalPrice`. Commission = gross − net (clipped to 0). Null on direct bookings
// and on platform bookings without a recorded gross.
function deriveCommissionAmount(row) {
  if (!row) return null;
  if (String(row.platform || '').toLowerCase() === 'direct') return null;
  if (row.clientGrossAmount == null) return null;
  const gross = Number(row.clientGrossAmount);
  if (!Number.isFinite(gross)) return null;
  const net = Number(row.finalPrice || 0);
  return Math.max(0, Math.round((gross - net) * 100) / 100);
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
  // Option-driven planning cards (specs/option-planning-card.md §3.2). The selected occurrences for a
  // card-option are stored on reservation_options.cardOccurrences (JSON). Guarded so minimal test
  // schemas without the column simply skip the column in the INSERT/SELECT.
  const HAS_RO_CARD_OCCURRENCES = (() => {
    try { return database.prepare("PRAGMA table_info(reservation_options)").all().some((c) => c.name === 'cardOccurrences'); }
    catch { return false; }
  })();
  // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md), stored on
  // reservation_resources.sessions (JSON). Guarded for minimal test schemas.
  const HAS_RESERVATION_RESOURCE_SESSIONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions'); }
    catch { return false; }
  })();
  const serializeCardOccurrences = (opt) => (
    Array.isArray(opt.cardOccurrences) && opt.cardOccurrences.length > 0
      ? JSON.stringify(opt.cardOccurrences)
      : null
  );

  const model = {
    // ── Reads ────────────────────────────────────────────────────────────
    list({ propertyId, clientId, from, to } = {}) {
      let sql = `
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName,
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
        const { optionsTotal: _o, resourcesTotal: _r, ...reservation } = row;
        const payment = computePaymentStatus(row, today);
        return {
          ...reservation,
          customPrice: row.customPrice == null ? '' : Number(row.customPrice),
          clientGrossAmount: row.clientGrossAmount == null ? null : Number(row.clientGrossAmount),
          commissionAmount: deriveCommissionAmount(row),
          complementAmount: Number(row.complementAmount || 0),
          complementPaid: Number(row.complementPaid || 0),
          complementPaidDate: row.complementPaidDate || null,
          remainingDue: payment.remainingDue,
          paymentComplete: payment.paymentComplete,
        };
      });
    },

    // Live "jump to a reservation" search (specs/reservation-number-and-search.md §3 rule 8-9).
    // Matches kind='reservation' rows by number, firstName, lastName, "first last" or "last first"
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
        )
        ORDER BY r.startDate DESC, r.id DESC
        LIMIT 20
      `).all(like, like, like, like, like);
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

    getByIdWithDetails(id) {
      const reservation = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName, p.photo as propertyPhoto
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.id = ? AND r.kind = 'reservation'
      `).get(id);
      if (!reservation) return null;

      // `ro.*` already brings the new force-item-to-complement fields
      // (inComplement, acompteContribTtc, soldeContribTtc) — no need to enumerate.
      // `autoOptionType` is included so the client can tell apart manual vs auto options on load
      // (auto-options use a separate `autoOptionsInComplement` channel — spec §3.1).
      reservation.options = database.prepare(`
        SELECT ro.*, o.title, o.description, o.priceType as currentPriceType, o.price as currentUnitPrice,
          o.autoOptionType as autoOptionType,
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
      // Resolve option/resource ids → names once so the history diff reads naturally
      // ("Petit-déjeuner : 8 €" instead of "6:1:8.00:c0"). See specs/reservations-backend-mvc.md.
      const names = {
        optionNames: Object.fromEntries(database.prepare('SELECT id, title FROM options').all().map((o) => [Number(o.id), o.title])),
        resourceNames: Object.fromEntries(database.prepare('SELECT id, name FROM resources').all().map((r) => [Number(r.id), r.name])),
      };
      return rows.map((row) => {
        let changedFields = [];
        try { changedFields = JSON.parse(row.changedFields || '[]'); } catch { changedFields = []; }
        return { id: row.id, eventType: row.eventType, createdAt: row.createdAt, changedFields: enrichHistoryChanges(changedFields, names) };
      });
    },

    getPricingSnapshot(reservationId) {
      const lockedNightlyBreakdown = database.prepare(`
        SELECT date, seasonLabel, pricingMode, price
        FROM reservation_nights WHERE reservationId = ? ORDER BY date
      `).all(reservationId);
      // `inComplement` / `acompteContribTtc` / `soldeContribTtc` are surfaced so the engine can
      // thread them into the returned `quote.optionLines[i]` for the client + accounting model.
      const lockedOptionLines = database.prepare(`
        SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
          COALESCE(inComplement, 0) as inComplement,
          acompteContribTtc, soldeContribTtc
        FROM reservation_options WHERE reservationId = ?
      `).all(reservationId);
      const lockedResourceLines = database.prepare(`
        SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
          COALESCE(inComplement, 0) as inComplement,
          acompteContribTtc, soldeContribTtc
        FROM reservation_resources WHERE reservationId = ?
      `).all(reservationId);
      return { lockedNightlyBreakdown, lockedOptionLines, lockedResourceLines };
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
      return database.prepare('SELECT singleBeds, doubleBeds, maxAdults, maxChildren, maxBabies FROM properties WHERE id = ?').get(propertyId);
    },

    getPropertyIdOf(reservationId) {
      return database.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
    },

    getForUpdate(reservationId) {
      return database.prepare('SELECT propertyId, sourceType, icalSyncLocked, totalPrice, finalPrice FROM reservations WHERE id = ?').get(reservationId);
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
        clientGrossAmount, depositDisabled, touristTaxInComplement, depositAmountOverride } = payload;
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
      const result = database.prepare(`
        INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds,
          checkInTime, checkOutTime,
          platform, totalPrice, touristTaxRate, touristTaxTotal, discountPercent, customPrice, finalPrice, depositAmount, depositDueDate,
          balanceAmount, balanceDueDate, sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
          notes, cautionAmount, extraGuestSurchargeOffered, blocksPreviousNight, blocksNextNight, clientGrossAmount,
          depositDisabled, touristTaxInComplement, depositAmountOverride)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        extraGuestSurchargeOffered, clientGrossAmount, complementPaid, complementPaidDate,
        depositDisabled, touristTaxInComplement, depositAmountOverride } = payload;
      // specs/normalize-platform-names.md §3.2 rule 9 — same canonicalization as insertReservation.
      const platformNormalized = formatPlatformName(platform) || 'direct';
      const platformIsNonDirect = String(platformNormalized).toLowerCase() !== 'direct';
      const grossForPlatform = platformIsNonDirect
        ? (clientGrossAmount != null && clientGrossAmount !== '' ? Number(clientGrossAmount) : null)
        : Number(quote.finalPrice || 0);
      database.prepare(`
        UPDATE reservations SET propertyId=?, clientId=?, startDate=?, endDate=?, adults=?, children=?, teens=?, babies=?,
          singleBeds=?, doubleBeds=?, babyBeds=?,
          checkInTime=?, checkOutTime=?,
          platform=?, totalPrice=?, touristTaxRate=?, touristTaxTotal=?, discountPercent=?, customPrice=?, finalPrice=?, depositAmount=?, depositDueDate=?,
          depositPaid=?, depositPaidDate=?, balanceAmount=?, balanceDueDate=?, balancePaid=?, balancePaidDate=?,
          complementAmount=?, complementPaid=?, complementPaidDate=?, notes=?,
          cautionAmount=?, cautionReceived=?, cautionReceivedDate=?, cautionReturned=?, cautionReturnedDate=?, extraGuestSurchargeOffered=?, icalSyncLocked=?,
          blocksPreviousNight=?, blocksNextNight=?, clientGrossAmount=?,
          depositDisabled=?, touristTaxInComplement=?, depositAmountOverride=?,
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
        reservationId,
      );
      persistBreakfastTime(reservationId, payload);
      persistReservationNumber(reservationId, payload);
      persistEmailLanguage(reservationId, payload);
    },

    // `inComplement` is carried on every write. `acompteContribTtc`/`soldeContribTtc` are
    // owned by the payment-flip code path (`updatePayment` → `captureContribsOnFlip`); regular
    // saves preserve them by passing through the values the engine returned (which it reads
    // from the locked DB snapshot). Forced lines (`inComplement = 1`) always get NULL contribs
    // — they live 100 % in the Complément entry, never in Acompte/Solde.
    // specs/force-extras-complement-on-platform.md §3 rule 1: on non-direct platform
    // reservations, every extra line is forced to `inComplement = 1` regardless of the
    // payload's per-line value. The model reads the reservation's current `platform`
    // value (just written by `insertReservation` / `updateReservation` within the same
    // transaction) to compute `platformForcing`. This covers regular options,
    // auto-options (they flow through the same `optionLines` array) and the additive
    // `insertOptions` callsite.
    replaceOptions(reservationId, optionLines) {
      database.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(reservationId);
      this.insertOptions(reservationId, optionLines);
    },

    insertOptions(reservationId, optionLines) {
      const platformForcing = readPlatformForcing(database, reservationId);
      const cols = 'reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, acompteContribTtc, soldeContribTtc'
        + (HAS_RO_CARD_OCCURRENCES ? ', cardOccurrences' : '');
      const placeholders = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?' + (HAS_RO_CARD_OCCURRENCES ? ', ?' : '');
      const insertOpt = database.prepare(`INSERT INTO reservation_options (${cols}) VALUES (${placeholders})`);
      for (const opt of (optionLines || []).filter((line) => !line.isCustom)) {
        const forced = (opt.inComplement || platformForcing) ? 1 : 0;
        const args = [reservationId, opt.optionId, opt.quantity || 1, Number(opt.unitPrice || 0),
          Number(opt.billedUnits || 0), opt.priceType || 'per_stay', opt.totalPrice || 0, opt.offered ? 1 : 0,
          forced,
          forced ? null : (opt.acompteContribTtc != null ? Number(opt.acompteContribTtc) : null),
          forced ? null : (opt.soldeContribTtc != null ? Number(opt.soldeContribTtc) : null)];
        if (HAS_RO_CARD_OCCURRENCES) args.push(serializeCardOccurrences(opt));
        insertOpt.run(...args);
      }
    },

    deleteCustomOptions(reservationId) {
      database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(reservationId);
    },

    // Same platform-forcing rule as `replaceOptions` — see comment above.
    insertCustomOptions(reservationId, optionLines) {
      const platformForcing = readPlatformForcing(database, reservationId);
      const insertCustomOpt = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, acompteContribTtc, soldeContribTtc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      let sortOrder = 0;
      for (const line of optionLines || []) {
        if (!line.isCustom) continue;
        const forced = (line.inComplement || platformForcing) ? 1 : 0;
        insertCustomOpt.run(reservationId, String(line.title || line.description || '').trim(),
          Number(line.originalTotalPrice || line.totalPrice || 0), line.offered ? 1 : 0, sortOrder,
          forced,
          forced ? null : (line.acompteContribTtc != null ? Number(line.acompteContribTtc) : null),
          forced ? null : (line.soldeContribTtc != null ? Number(line.soldeContribTtc) : null));
        sortOrder += 1;
      }
    },

    replaceNights(reservationId, nightlyBreakdown) {
      database.prepare('DELETE FROM reservation_nights WHERE reservationId = ?').run(reservationId);
      this.insertNights(reservationId, nightlyBreakdown);
    },

    insertNights(reservationId, nightlyBreakdown) {
      if (!nightlyBreakdown || nightlyBreakdown.length === 0) return;
      const insertNight = database.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
      for (const night of nightlyBreakdown) {
        insertNight.run(reservationId, night.date, night.seasonLabel || 'Standard', night.pricingMode || 'fixed', Number(night.price || 0));
      }
    },

    deleteResources(reservationId) {
      database.prepare('DELETE FROM reservation_resources WHERE reservationId = ?').run(reservationId);
    },

    // Same platform-forcing rule as `replaceOptions` — see comment above. Note this is
    // the per-line writer; the caller (`replaceResources`-like flow in the controller)
    // already pre-deletes the reservation's rows in a separate step, so we pay the
    // `readPlatformForcing` query once per line. Cheap (~µs on a primary-key lookup).
    insertResourceLine(reservationId, rr, unitPrice, qty, priceType) {
      const platformForcing = readPlatformForcing(database, reservationId);
      const forced = (rr.inComplement || platformForcing) ? 1 : 0;
      // Hourly-scheduled sessions (specs/resource-hourly-scheduling.md): persisted as JSON when the
      // column exists; the planning cards + re-edit read them back.
      const sessions = Array.isArray(rr.sessions) && rr.sessions.length ? JSON.stringify(rr.sessions) : null;
      if (HAS_RESERVATION_RESOURCE_SESSIONS) {
        database.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, acompteContribTtc, soldeContribTtc, sessions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(reservationId, rr.resourceId, qty, unitPrice, Number(rr.billedUnits || qty),
            priceType || rr.priceType || 'per_stay', rr.totalPrice || unitPrice * qty, rr.offered ? 1 : 0,
            forced,
            forced ? null : (rr.acompteContribTtc != null ? Number(rr.acompteContribTtc) : null),
            forced ? null : (rr.soldeContribTtc != null ? Number(rr.soldeContribTtc) : null),
            sessions);
        return;
      }
      database.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, acompteContribTtc, soldeContribTtc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(reservationId, rr.resourceId, qty, unitPrice, Number(rr.billedUnits || qty),
          priceType || rr.priceType || 'per_stay', rr.totalPrice || unitPrice * qty, rr.offered ? 1 : 0,
          forced,
          forced ? null : (rr.acompteContribTtc != null ? Number(rr.acompteContribTtc) : null),
          forced ? null : (rr.soldeContribTtc != null ? Number(rr.soldeContribTtc) : null));
    },

    updatePaymentField(sql, ...params) {
      database.prepare(sql).run(...params);
    },

    remove(reservationId) {
      database.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
    },

    // ── Arrival / Departure SAS (specs/arrival-departure-sas.md §4.1) ──────────────
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

    // Single commit for the arrival SAS. `complementItems` = [{ label, amount }] (missing linen
    // elements + optionally the cleaning charge). Written as custom options inComplement=1 +
    // sasArrivalOrigin=1. Re-openable SAS: a re-commit REPLACES the SAS-origin complement lines
    // instead of appending (complementAmount adjusted by new − previous SAS sum), so it never
    // double-charges (specs/reopen-completed-sas.md §4). A paid complement stays frozen.
    commitArrivalSas(reservationId, {
      cautionReceived, complementItems = [],
      breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastNote,
      departureHandoverNote, extinguisherSealOkAtArrival,
    } = {}) {
      // Clamp drink counts to non-negative integers (authoritative server-side validation).
      const clampCount = (v) => (v === undefined ? undefined : Math.max(0, Math.round(Number(v) || 0)));
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
            breakfastCoffee = ?, breakfastTea = ?, breakfastChocolate = ?, breakfastNote = ?,
            updatedAt = datetime('now') WHERE id = ?`)
          .run(
            clampCount(breakfastCoffee) || 0,
            clampCount(breakfastTea) || 0,
            clampCount(breakfastChocolate) || 0,
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
            database.prepare("UPDATE reservations SET cautionReceived = 1, cautionReceivedDate = COALESCE(cautionReceivedDate, ?), updatedAt = datetime('now') WHERE id = ?")
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
          const priorSum = Math.round(Number(database.prepare(
            'SELECT COALESCE(SUM(amount), 0) AS s FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1',
          ).get(reservationId).s) * 100) / 100;
          database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1').run(reservationId);
          let added = 0;
          if (items.length > 0) {
            const maxSort = database.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options WHERE reservationId = ?').get(reservationId).m;
            const insert = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, sasArrivalOrigin) VALUES (?, ?, ?, 0, ?, 1, 1)');
            let sort = Number(maxSort) + 1;
            for (const it of items) { insert.run(reservationId, String(it.label).trim(), Math.round(Number(it.amount) * 100) / 100, sort); sort += 1; }
            added = Math.round(items.reduce((s, it) => s + Number(it.amount), 0) * 100) / 100;
          }
          const next = Math.max(0, Math.round((Number(compRow.complementAmount || 0) - priorSum + added) * 100) / 100);
          database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(next, reservationId);
        }
        return database.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(reservationId).complementAmount;
      });
      return tx();
    },

    // Single commit for the departure SAS: caution return + the dedicated end-of-stay complement.
    // The extinguisher charge is computed HERE (fat backend, specs/extinguisher-seal-and-repair-amounts.md
    // §3.2 — 2026-06-17): the client sends only `extinguisherCharges` = [{ repairKey, qty }]; the server
    // looks up the configured price, builds the lines, appends them to the end-of-stay detail, and the
    // stored amount is the authoritative sum of every line (no client-supplied total is trusted).
    commitDepartureSas(reservationId, { cautionReturned, endOfStayComplementDetail = null, extinguisherSealOkAtDeparture, extinguisherCharges } = {}) {
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
        const baseDetail = Array.isArray(endOfStayComplementDetail) ? endOfStayComplementDetail.slice() : [];
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
        // Extinguisher condition at departure (1 = bon état, 0 = pas bon état). The bill rides the detail.
        if (extinguisherSealOkAtDeparture !== undefined) {
          database.prepare("UPDATE reservations SET extinguisherSealOkAtDeparture = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(extinguisherSealOkAtDeparture ? 1 : 0, reservationId);
        }
      });
      tx();
    },
  };

  return model;
}

const defaultModel = createReservationsModel(db);
defaultModel.create = createReservationsModel;
defaultModel.__test = { deriveCommissionAmount };

module.exports = defaultModel;
