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
const { timeToHour, addIsoDays, EARLY_CHECKIN_BLOCK_HOUR, LATE_CHECKOUT_BLOCK_HOUR } = require('../utils/occupancy');
const { getOptionsSignature, getResourcesSignature } = require('../utils/reservationAudit');
const { computePaymentStatus } = require('../utils/paymentStatus');
const establishmentClosuresModel = require('./establishmentClosuresModel');

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
      if (propertyId) { sql += ' AND r.propertyId = ?'; params.push(propertyId); }
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

    getByIdWithDetails(id) {
      const reservation = database.prepare(`
        SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.id = ? AND r.kind = 'reservation'
      `).get(id);
      if (!reservation) return null;

      reservation.options = database.prepare(`
        SELECT ro.*, o.title, o.description, o.priceType as currentPriceType, o.price as currentUnitPrice,
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

      const customOptions = database.prepare(`
        SELECT rco.id as customOptionId, rco.description as title, rco.description, 1 as quantity,
          rco.amount as unitPrice, 1 as billedUnits, 'per_stay' as priceType,
          CASE WHEN COALESCE(rco.offered, 0) = 1 THEN 0 ELSE rco.amount END as totalPrice,
          rco.amount as originalTotalPrice,
          COALESCE(rco.offered, 0) as offered,
          1 as isCustom
        FROM reservation_custom_options rco
        WHERE rco.reservationId = ?
        ORDER BY rco.sortOrder, rco.id
      `).all(id);
      reservation.options = [...reservation.options, ...customOptions];

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
      `).all(id);

      reservation.nights = database.prepare(`
        SELECT date, seasonLabel, pricingMode, price
        FROM reservation_nights
        WHERE reservationId = ?
        ORDER BY date
      `).all(id);

      reservation.customPrice = reservation.customPrice == null ? '' : Number(reservation.customPrice);
      reservation.clientGrossAmount = reservation.clientGrossAmount == null ? null : Number(reservation.clientGrossAmount);
      reservation.commissionAmount = deriveCommissionAmount(reservation);
      reservation.complementAmount = Number(reservation.complementAmount || 0);
      reservation.complementPaid = Number(reservation.complementPaid || 0);
      reservation.complementPaidDate = reservation.complementPaidDate || null;
      const payment = computePaymentStatus(reservation);
      reservation.remainingDue = payment.remainingDue;
      reservation.paymentComplete = payment.paymentComplete;
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
      return rows.map((row) => {
        let changedFields = [];
        try { changedFields = JSON.parse(row.changedFields || '[]'); } catch { changedFields = []; }
        return { id: row.id, eventType: row.eventType, createdAt: row.createdAt, changedFields };
      });
    },

    getPricingSnapshot(reservationId) {
      const lockedNightlyBreakdown = database.prepare(`
        SELECT date, seasonLabel, pricingMode, price
        FROM reservation_nights WHERE reservationId = ? ORDER BY date
      `).all(reservationId);
      const lockedOptionLines = database.prepare(`
        SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered
        FROM reservation_options WHERE reservationId = ?
      `).all(reservationId);
      const lockedResourceLines = database.prepare(`
        SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered
        FROM reservation_resources WHERE reservationId = ?
      `).all(reservationId);
      return { lockedNightlyBreakdown, lockedOptionLines, lockedResourceLines };
    },

    getAuditSnapshotFromDb(reservationId) {
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!row) return null;
      const options = database.prepare('SELECT optionId, quantity, totalPrice FROM reservation_options WHERE reservationId = ?').all(reservationId);
      const customOptions = database.prepare('SELECT description, amount, offered FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(reservationId);
      const resources = database.prepare('SELECT resourceId, quantity, totalPrice, offered FROM reservation_resources WHERE reservationId = ?').all(reservationId);
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
        optionsSignature: getOptionsSignature([
          ...options,
          ...customOptions.map((line, idx) => ({ optionId: 1000000 + idx, quantity: 1, totalPrice: Number(line.offered ? 0 : (line.amount || 0)) })),
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
        clientGrossAmount } = payload;
      // gross is meaningful only for platform-sourced bookings (rule 7 of the spec).
      const grossForPlatform = String(platform || 'direct').toLowerCase() !== 'direct' && clientGrossAmount != null && clientGrossAmount !== ''
        ? Number(clientGrossAmount)
        : null;
      const result = database.prepare(`
        INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds,
          checkInTime, checkOutTime,
          platform, totalPrice, touristTaxRate, touristTaxTotal, discountPercent, customPrice, finalPrice, depositAmount, depositDueDate,
          balanceAmount, balanceDueDate, sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
          notes, cautionAmount, extraGuestSurchargeOffered, blocksPreviousNight, blocksNextNight, clientGrossAmount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
        singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
        checkInTime || '15:00', checkOutTime || '10:00',
        platform || 'direct', quote.totalPrice, quote.touristTaxRate || 0, quote.touristTaxTotal || 0, quote.discountPercent || 0,
        customPrice !== undefined && customPrice !== null && customPrice !== '' ? Number(customPrice) : null,
        quote.finalPrice,
        quote.depositAmount || 0, quote.depositDueDate || depositDueDate || null, quote.balanceAmount || 0, quote.balanceDueDate || balanceDueDate || null, sentenceCase(notes),
        cautionAmount || 0,
        extraGuestSurchargeOffered ? 1 : 0,
        nightBlocks.blocksPreviousNight,
        nightBlocks.blocksNextNight,
        grossForPlatform,
      );
      return result.lastInsertRowid;
    },

    updateReservation(reservationId, payload, quote, nightBlocks, nextIcalSyncLocked) {
      const { propertyId, clientId, startDate, endDate, adults, children, teens, babies,
        singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, customPrice,
        depositDueDate, depositPaid, depositPaidDate, balanceDueDate, balancePaid, balancePaidDate, notes,
        cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
        extraGuestSurchargeOffered, clientGrossAmount, complementPaid, complementPaidDate } = payload;
      const grossForPlatform = String(platform || 'direct').toLowerCase() !== 'direct' && clientGrossAmount != null && clientGrossAmount !== ''
        ? Number(clientGrossAmount)
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
          updatedAt=datetime('now')
        WHERE id=?
      `).run(
        propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
        singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
        checkInTime || '15:00', checkOutTime || '10:00',
        platform || 'direct', quote.totalPrice, quote.touristTaxRate || 0, quote.touristTaxTotal || 0, quote.discountPercent || 0,
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
        reservationId,
      );
    },

    replaceOptions(reservationId, optionLines) {
      database.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(reservationId);
      const insertOpt = database.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const opt of (optionLines || []).filter((line) => !line.isCustom)) {
        insertOpt.run(reservationId, opt.optionId, opt.quantity || 1, Number(opt.unitPrice || 0),
          Number(opt.billedUnits || 0), opt.priceType || 'per_stay', opt.totalPrice || 0, opt.offered ? 1 : 0);
      }
    },

    insertOptions(reservationId, optionLines) {
      const insertOpt = database.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const opt of (optionLines || []).filter((line) => !line.isCustom)) {
        insertOpt.run(reservationId, opt.optionId, opt.quantity || 1, Number(opt.unitPrice || 0),
          Number(opt.billedUnits || 0), opt.priceType || 'per_stay', opt.totalPrice || 0, opt.offered ? 1 : 0);
      }
    },

    deleteCustomOptions(reservationId) {
      database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(reservationId);
    },

    insertCustomOptions(reservationId, optionLines) {
      const insertCustomOpt = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder) VALUES (?, ?, ?, ?, ?)');
      let sortOrder = 0;
      for (const line of optionLines || []) {
        if (!line.isCustom) continue;
        insertCustomOpt.run(reservationId, String(line.title || line.description || '').trim(),
          Number(line.originalTotalPrice || line.totalPrice || 0), line.offered ? 1 : 0, sortOrder);
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

    insertResourceLine(reservationId, rr, unitPrice, qty, priceType) {
      database.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(reservationId, rr.resourceId, qty, unitPrice, Number(rr.billedUnits || qty),
          priceType || rr.priceType || 'per_stay', rr.totalPrice || unitPrice * qty, rr.offered ? 1 : 0);
    },

    updatePaymentField(sql, ...params) {
      database.prepare(sql).run(...params);
    },

    remove(reservationId) {
      database.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
    },
  };

  return model;
}

const defaultModel = createReservationsModel(db);
defaultModel.create = createReservationsModel;
defaultModel.__test = { deriveCommissionAmount };

module.exports = defaultModel;
