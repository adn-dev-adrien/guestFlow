/**
 * Devis model — devis are now rows in the unified `reservations` table with `kind='devis'`
 * (their lines live in the `reservation_*` children). This model is the sole devis-domain DB access:
 * list, enrich, CRUD (create + update share one persist helper), status, history/audit, the payment
 * schedule, and the two convert flows. Pricing comes from the shared engine (`calculateReservationQuote`).
 *
 * The devis-specific `status` is stored in `reservations.devisStatus`; reads alias it back to `status`
 * to keep the devis API contract unchanged. Every devis read/write is scoped to `kind='devis'`.
 *
 * `create`/`update`/… return `{ ok, status?, data }` or `{ error, status }` so the controller stays thin.
 * Exports a default model bound to the production DB, and a `buildModel(db)` factory for tests.
 */

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { sentenceCase } = require('../utils/textFormatters');
const { roundMoney, addDaysToIsoDate } = require('../utils/devisHelpers');

const DEVIS_HISTORY_FIELD_LABELS = {
  propertyId: 'Logement', clientId: 'Client', startDate: 'Date arrivée', endDate: 'Date départ',
  adults: 'Adultes', children: 'Enfants', teens: 'Ados', babies: 'Bébés',
  singleBeds: 'Lits simples', doubleBeds: 'Lits doubles', babyBeds: 'Lits bébé',
  checkInTime: 'Heure arrivée', checkOutTime: 'Heure départ', platform: 'Plateforme',
  totalPrice: 'Prix hébergement', customPrice: 'Prix personnalisé', touristTaxRate: 'Taux taxe de séjour',
  touristTaxTotal: 'Taxe de séjour', discountPercent: 'Réduction (%)', finalPrice: 'Prix final',
  depositAmount: 'Acompte', depositDueDate: 'Date acompte', balanceAmount: 'Solde',
  balanceDueDate: 'Date solde', status: 'Statut', notes: 'Notes',
};

function createModel(database) {
  // ---- payment schedule ----
  function resolvePaymentSchedule(row, property) {
    const totalStayPrice = roundMoney(Number(row.finalPrice || 0) + Number(row.touristTaxTotal || 0));
    const depositPercent = Number(property?.depositPercent || 0);
    const depositAmount = roundMoney(totalStayPrice * (depositPercent / 100));
    const balanceAmount = roundMoney(totalStayPrice - depositAmount);
    const depositDueDate = row.startDate ? addDaysToIsoDate(row.startDate, -Number(property?.depositDaysBefore || 0)) : null;
    const balanceDueDate = row.startDate ? addDaysToIsoDate(row.startDate, -Number(property?.balanceDaysBefore || 0)) : null;
    return { depositAmount, balanceAmount, depositDueDate, balanceDueDate, totalStayPrice };
  }

  // ---- enrich (full devis with lines, client, property, schedule) ----
  function enrichDevis(row) {
    if (!row) return null;
    const options = database.prepare(`
      SELECT ro.*, o.title, o.priceType as optionPriceType, o.autoOptionType, o.autoFullNightThreshold,
        COALESCE(NULLIF(ro.totalPrice, 0), NULLIF(round(COALESCE(ro.unitPrice, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2), 0),
          round(COALESCE(o.price, 0) * COALESCE(ro.billedUnits, ro.quantity, 0), 2)) as originalTotalPrice,
        ro.offered as offered
      FROM reservation_options ro JOIN options o ON ro.optionId = o.id WHERE ro.reservationId = ?
    `).all(row.id);
    const customOptions = database.prepare(`
      SELECT rco.id as customOptionId, rco.description as title, rco.description, 1 as quantity,
        rco.amount as unitPrice, 1 as billedUnits, 'per_stay' as priceType,
        CASE WHEN COALESCE(rco.offered, 0) = 1 THEN 0 ELSE rco.amount END as totalPrice,
        rco.amount as originalTotalPrice, COALESCE(rco.offered, 0) as offered, 1 as isCustom
      FROM reservation_custom_options rco WHERE rco.reservationId = ? ORDER BY rco.sortOrder, rco.id
    `).all(row.id);
    const resources = database.prepare(`
      SELECT rr.*, r.name, r.priceType as resourcePriceType,
        COALESCE(NULLIF(rr.totalPrice, 0), NULLIF(round(COALESCE(rr.unitPrice, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2), 0),
          round(COALESCE(r.price, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2)) as originalTotalPrice,
        rr.offered as offered
      FROM reservation_resources rr JOIN resources r ON rr.resourceId = r.id WHERE rr.reservationId = ?
    `).all(row.id);
    const nights = database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(row.id);
    const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId);
    const property = database.prepare('SELECT id, name, defaultCheckIn AS checkInTime, defaultCheckOut AS checkOutTime, defaultCautionAmount, vatPercentageAccommodation, vatPercentageOptions, vatPercentageResources, depositPercent, depositDaysBefore, balanceDaysBefore FROM properties WHERE id = ?').get(row.propertyId);
    const schedule = resolvePaymentSchedule(row, property);
    return { ...row, status: row.devisStatus, ...schedule, options: [...options, ...customOptions], resources, nights, client, property };
  }

  // ---- audit / history ----
  function normalizeDevisHistoryValue(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Math.round(value * 100) / 100;
    return value;
  }

  function snapshotFromDb(devisId) {
    const row = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(devisId);
    if (!row) return null;
    return {
      propertyId: Number(row.propertyId), clientId: Number(row.clientId),
      startDate: row.startDate || null, endDate: row.endDate || null,
      adults: Number(row.adults || 0), children: Number(row.children || 0), teens: Number(row.teens || 0), babies: Number(row.babies || 0),
      singleBeds: row.singleBeds === null ? null : Number(row.singleBeds),
      doubleBeds: row.doubleBeds === null ? null : Number(row.doubleBeds),
      babyBeds: row.babyBeds === null ? null : Number(row.babyBeds),
      checkInTime: row.checkInTime || null, checkOutTime: row.checkOutTime || null, platform: row.platform || null,
      totalPrice: Number(row.totalPrice || 0), customPrice: row.customPrice == null ? null : Number(row.customPrice),
      touristTaxRate: Number(row.touristTaxRate || 0), touristTaxTotal: Number(row.touristTaxTotal || 0),
      discountPercent: Number(row.discountPercent || 0), finalPrice: Number(row.finalPrice || 0),
      depositAmount: Number(row.depositAmount || 0), depositDueDate: row.depositDueDate || null,
      balanceAmount: Number(row.balanceAmount || 0), balanceDueDate: row.balanceDueDate || null,
      status: row.devisStatus || null, notes: row.notes || null,
    };
  }

  function snapshotFromPayload(payload, quote) {
    return {
      propertyId: Number(payload.propertyId), clientId: Number(payload.clientId),
      startDate: payload.startDate || null, endDate: payload.endDate || null,
      adults: Number(payload.adults || 0), children: Number(payload.children || 0), teens: Number(payload.teens || 0), babies: Number(payload.babies || 0),
      singleBeds: payload.singleBeds === null || payload.singleBeds === undefined || payload.singleBeds === '' ? null : Number(payload.singleBeds),
      doubleBeds: payload.doubleBeds === null || payload.doubleBeds === undefined || payload.doubleBeds === '' ? null : Number(payload.doubleBeds),
      babyBeds: payload.babyBeds === null || payload.babyBeds === undefined || payload.babyBeds === '' ? null : Number(payload.babyBeds),
      checkInTime: payload.checkInTime || null, checkOutTime: payload.checkOutTime || null, platform: payload.platform || null,
      totalPrice: quote.totalPrice == null ? null : Number(quote.totalPrice),
      customPrice: payload.customPrice === undefined || payload.customPrice === null || payload.customPrice === '' ? null : Number(payload.customPrice),
      touristTaxRate: Number(quote.touristTaxRate || 0), touristTaxTotal: Number(quote.touristTaxTotal || 0),
      discountPercent: Number(payload.discountPercent || 0),
      finalPrice: quote.finalPrice == null ? null : Number(quote.finalPrice),
      depositAmount: Number(quote.depositAmount || 0), depositDueDate: quote.depositDueDate || payload.depositDueDate || null,
      balanceAmount: Number(quote.balanceAmount || 0), balanceDueDate: quote.balanceDueDate || payload.balanceDueDate || null,
      status: payload.status || null, notes: sentenceCase(payload.notes) || null,
    };
  }

  function computeAuditChanges(beforeSnapshot, afterSnapshot) {
    const changes = [];
    Object.keys(DEVIS_HISTORY_FIELD_LABELS).forEach((key) => {
      const before = normalizeDevisHistoryValue(beforeSnapshot?.[key]);
      const after = normalizeDevisHistoryValue(afterSnapshot?.[key]);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push({ field: key, label: DEVIS_HISTORY_FIELD_LABELS[key] || key, from: before, to: after });
      }
    });
    return changes;
  }

  function addHistoryEntry(devisId, eventType, changes) {
    database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
      .run(devisId, eventType, JSON.stringify(changes || []));
  }

  // ---- quote building (shared by create/update) ----
  function computeQuote(body, existing, property) {
    const optionMetaById = new Map(
      database.prepare('SELECT id, autoOptionType FROM options').all().map((opt) => [Number(opt.id), opt])
    );
    const selectedOptions = (body.selectedOptions || []).map((o) => ({
      optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
      unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
    })).filter((line) => !optionMetaById.get(Number(line.optionId))?.autoOptionType);
    const customOptions = (body.customOptions || []).map((line, index) => ({
      customKey: String(line.customKey || `custom_${index + 1}`),
      description: String(line.description || '').trim(),
      amount: Number(line.amount || 0), offered: Boolean(line.offered),
    })).filter((line) => line.description && Number(line.amount || 0) > 0);
    const selectedResources = (body.selectedResources || []).map((r) => ({
      resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined, offered: Boolean(r.offered),
    }));
    const lockedResourceLines = (body.selectedResources || []).map((r) => ({
      resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
      billedUnits: r.billedUnits != null ? Number(r.billedUnits) : Number(r.quantity || 1),
      priceType: r.priceType || 'per_stay', totalPrice: Number(r.totalPrice || 0), offered: Boolean(r.offered),
    })).filter((line) => Number(line.totalPrice || 0) === 0 && Number(line.unitPrice || 0) > 0);

    return calculateReservationQuote({
      db: database,
      propertyId: Number(body.propertyId || existing?.propertyId),
      startDate: body.startDate || existing?.startDate,
      endDate: body.endDate || existing?.endDate,
      checkInTime: body.checkInTime || existing?.checkInTime || property.defaultCheckIn || '15:00',
      checkOutTime: body.checkOutTime || existing?.checkOutTime || property.defaultCheckOut || '10:00',
      adults: Number(body.adults ?? existing?.adults ?? 1),
      children: Number(body.children ?? existing?.children ?? 0),
      teens: Number(body.teens ?? existing?.teens ?? 0),
      babies: Number(body.babies ?? existing?.babies ?? 0),
      discountPercent: Number(body.discountPercent ?? existing?.discountPercent ?? 0),
      selectedOptions, customOptions, selectedResources,
      extraGuestSurchargeOffered: Boolean(body.extraGuestSurchargeOffered),
      customPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
      offeredOptionIds: body.offeredOptionIds, lockedResourceLines,
      platform: body.platform || existing?.platform,
    });
  }

  // ---- persist lines (shared by create/update) — into the reservation_* children ----
  function persistLines(devisId, quote) {
    database.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(devisId);
    const insertOption = database.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const line of (quote.optionLines || []).filter((item) => !item.isCustom)) {
      insertOption.run(devisId, Number(line.optionId), Number(line.quantity || 1), roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0), line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
    }
    database.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(devisId);
    const insertCustomOption = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder) VALUES (?, ?, ?, ?, ?)');
    let customOrder = 0;
    for (const line of quote.optionLines || []) {
      if (!line.isCustom) continue;
      insertCustomOption.run(devisId, String(line.title || '').trim(), roundMoney(line.originalTotalPrice || line.totalPrice || 0), line.offered ? 1 : 0, customOrder);
      customOrder += 1;
    }
    database.prepare('DELETE FROM reservation_resources WHERE reservationId = ?').run(devisId);
    const insertResource = database.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const line of quote.resourceLines || []) {
      insertResource.run(devisId, Number(line.resourceId), Number(line.quantity || 1), roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0), line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
    }
    database.prepare('DELETE FROM reservation_nights WHERE reservationId = ?').run(devisId);
    const insertNight = database.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
    for (const night of quote.nightlyBreakdown || []) {
      insertNight.run(devisId, night.date, night.seasonLabel || 'Standard', night.pricingMode || 'fixed', roundMoney(night.price));
    }
  }

  // ---- public API ----
  function list({ propertyId, status, from, to } = {}) {
    let sql = `
      SELECT d.*, d.devisStatus AS status, c.firstName, c.lastName, p.name as propertyName
      FROM reservations d
      LEFT JOIN clients c ON d.clientId = c.id
      LEFT JOIN properties p ON d.propertyId = p.id
      WHERE d.kind = 'devis'`;
    const params = [];
    if (propertyId) { sql += ' AND d.propertyId = ?'; params.push(Number(propertyId)); }
    if (status) { sql += ' AND d.devisStatus = ?'; params.push(status); }
    if (from) { sql += ' AND d.endDate >= ?'; params.push(from); }
    if (to) { sql += ' AND d.startDate <= ?'; params.push(to); }
    sql += ' ORDER BY d.createdAt DESC';
    return database.prepare(sql).all(...params);
  }

  function findById(id) {
    const row = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(Number(id));
    return row ? enrichDevis(row) : null;
  }

  function getHistory(id) {
    const devis = database.prepare("SELECT id FROM reservations WHERE id = ? AND kind = 'devis'").get(Number(id));
    if (!devis) return null;
    return database.prepare('SELECT id, eventType, changedFields, createdAt FROM reservation_history WHERE reservationId = ? ORDER BY createdAt DESC').all(Number(id))
      .map((row) => {
        let changes = [];
        try { changes = JSON.parse(row.changedFields || '[]'); } catch { changes = []; }
        return { id: row.id, eventType: row.eventType, createdAt: row.createdAt, changes };
      });
  }

  function updateStatus(id, status) {
    const existing = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(Number(id));
    if (!existing) return { error: 'Devis non trouvé', status: 404 };
    const allowed = new Set(['draft', 'sent', 'accepted']);
    const next = String(status || '').trim();
    if (!allowed.has(next)) return { error: 'Statut invalide', status: 400 };
    if (existing.devisStatus === 'converted') return { error: 'Un devis converti ne peut plus changer de statut', status: 400 };

    const before = snapshotFromDb(Number(id));
    before.status = existing.devisStatus;
    database.prepare("UPDATE reservations SET devisStatus = ?, updatedAt = datetime('now') WHERE id = ? AND kind = 'devis'").run(next, Number(id));
    const after = snapshotFromDb(Number(id));
    const changes = computeAuditChanges(before, after);
    if (changes.length > 0) addHistoryEntry(Number(id), 'update', changes);
    return { ok: true, data: findById(id) };
  }

  function create(payload) {
    if (!payload.propertyId || !payload.clientId || !payload.startDate || !payload.endDate) {
      return { error: 'propertyId, clientId, startDate et endDate sont requis', status: 400 };
    }
    const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(Number(payload.propertyId));
    if (!property) return { error: 'Logement introuvable', status: 404 };

    const quote = computeQuote(payload, null, property);
    const devisNumber = database.generateDevisNumber();
    const tx = database.transaction(() => {
      const info = database.prepare(`
        INSERT INTO reservations (
          kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, totalPrice, touristTaxRate, touristTaxTotal,
          discountPercent, customPrice, finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes, validUntil
        ) VALUES ('devis', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        devisNumber, Number(payload.propertyId), Number(payload.clientId), payload.startDate, payload.endDate,
        Number(payload.adults || 1), Number(payload.children || 0), Number(payload.teens || 0), Number(payload.babies || 0),
        payload.singleBeds != null && payload.singleBeds !== '' ? Number(payload.singleBeds) : null,
        payload.doubleBeds != null && payload.doubleBeds !== '' ? Number(payload.doubleBeds) : null,
        payload.babyBeds != null && payload.babyBeds !== '' ? Number(payload.babyBeds) : null,
        payload.checkInTime || property.defaultCheckIn || '15:00', payload.checkOutTime || property.defaultCheckOut || '10:00',
        payload.platform || 'direct', roundMoney(quote.totalPrice), roundMoney(quote.touristTaxRate || 0), roundMoney(quote.touristTaxTotal || 0),
        Number(payload.discountPercent || 0),
        payload.customPrice !== undefined && payload.customPrice !== null && payload.customPrice !== '' ? Number(payload.customPrice) : null,
        roundMoney(quote.finalPrice), roundMoney(quote.depositAmount), quote.depositDueDate || null,
        roundMoney(quote.balanceAmount), quote.balanceDueDate || null,
        roundMoney(payload.cautionAmount != null ? payload.cautionAmount : (property.defaultCautionAmount || 0)),
        String(payload.notes || ''), payload.validUntil || null,
      );
      const devisId = info.lastInsertRowid;
      persistLines(devisId, quote);
      const afterSnapshot = snapshotFromDb(devisId);
      addHistoryEntry(devisId, 'create', computeAuditChanges({}, afterSnapshot));
      return devisId;
    });
    const devisId = tx();
    return { ok: true, status: 201, data: findById(devisId) };
  }

  function update(id, payload) {
    const numId = Number(id);
    const existing = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(numId);
    if (!existing) return { error: 'Devis non trouvé', status: 404 };
    const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(Number(payload.propertyId || existing.propertyId));
    if (!property) return { error: 'Logement introuvable', status: 404 };

    const quote = computeQuote(payload, existing, property);
    // Capture the audit baseline BEFORE persisting (fixes the former always-empty update history).
    const beforeSnapshot = snapshotFromDb(numId);
    const tx = database.transaction(() => {
      database.prepare(`
        UPDATE reservations SET
          propertyId = ?, clientId = ?, devisStatus = ?, startDate = ?, endDate = ?,
          adults = ?, children = ?, teens = ?, babies = ?, singleBeds = ?, doubleBeds = ?, babyBeds = ?,
          checkInTime = ?, checkOutTime = ?, platform = ?, totalPrice = ?, touristTaxRate = ?, touristTaxTotal = ?,
          discountPercent = ?, customPrice = ?, finalPrice = ?, depositAmount = ?, depositDueDate = ?,
          balanceAmount = ?, balanceDueDate = ?, cautionAmount = ?, notes = ?, validUntil = ?, updatedAt = datetime('now')
        WHERE id = ? AND kind = 'devis'
      `).run(
        Number(payload.propertyId || existing.propertyId), Number(payload.clientId || existing.clientId),
        payload.status || existing.devisStatus, payload.startDate || existing.startDate, payload.endDate || existing.endDate,
        Number(payload.adults ?? existing.adults), Number(payload.children ?? existing.children),
        Number(payload.teens ?? existing.teens), Number(payload.babies ?? existing.babies),
        payload.singleBeds != null && payload.singleBeds !== '' ? Number(payload.singleBeds) : null,
        payload.doubleBeds != null && payload.doubleBeds !== '' ? Number(payload.doubleBeds) : null,
        payload.babyBeds != null && payload.babyBeds !== '' ? Number(payload.babyBeds) : null,
        payload.checkInTime || existing.checkInTime, payload.checkOutTime || existing.checkOutTime,
        payload.platform || existing.platform, roundMoney(quote.totalPrice), roundMoney(quote.touristTaxRate || 0), roundMoney(quote.touristTaxTotal || 0),
        Number(payload.discountPercent ?? existing.discountPercent ?? 0),
        payload.customPrice !== undefined && payload.customPrice !== null && payload.customPrice !== '' ? Number(payload.customPrice) : (existing.customPrice == null ? null : Number(existing.customPrice)),
        roundMoney(quote.finalPrice), roundMoney(quote.depositAmount), quote.depositDueDate || null,
        roundMoney(quote.balanceAmount), quote.balanceDueDate || null,
        roundMoney(payload.cautionAmount ?? existing.cautionAmount ?? 0),
        String(payload.notes ?? existing.notes ?? ''),
        payload.validUntil !== undefined ? payload.validUntil : existing.validUntil,
        numId,
      );
      persistLines(numId, quote);
      const afterSnapshot = snapshotFromDb(numId);
      const changes = computeAuditChanges(beforeSnapshot, afterSnapshot);
      if (changes.length > 0) addHistoryEntry(numId, 'update', changes);
    });
    tx();
    return { ok: true, data: findById(numId) };
  }

  function remove(id) {
    const existing = database.prepare("SELECT id FROM reservations WHERE id = ? AND kind = 'devis'").get(Number(id));
    if (!existing) return { error: 'Devis non trouvé', status: 404 };
    database.prepare("DELETE FROM reservations WHERE id = ? AND kind = 'devis'").run(Number(id));
    return { ok: true, data: { success: true } };
  }

  // Copy a booking's line graph from one reservations row to another (used by both convert flows).
  function copyLineGraph(fromId, toId) {
    const insertOpt = database.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const o of database.prepare('SELECT * FROM reservation_options WHERE reservationId = ?').all(fromId)) {
      insertOpt.run(toId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice, o.offered ? 1 : 0);
    }
    const insertCustomOpt = database.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder) VALUES (?, ?, ?, ?, ?)');
    for (const o of database.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(fromId)) {
      insertCustomOpt.run(toId, o.description, o.amount, Number(o.offered || 0), o.sortOrder || 0);
    }
    const insertRsc = database.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of database.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(fromId)) {
      insertRsc.run(toId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice, r.offered ? 1 : 0);
    }
    const insertNight = database.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
    for (const n of database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(fromId)) {
      insertNight.run(toId, n.date, n.seasonLabel, n.pricingMode, n.price);
    }
  }

  function convertToReservation(id) {
    const numId = Number(id);
    const devisRow = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(numId);
    if (!devisRow) return { error: 'Devis non trouvé', status: 404 };
    if (devisRow.convertedReservationId) return { error: 'Ce devis a déjà été converti en réservation', status: 400 };
    const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(devisRow.propertyId);
    if (!property) return { error: 'Logement introuvable', status: 404 };

    const tx = database.transaction(() => {
      const info = database.prepare(`
        INSERT INTO reservations (
          kind, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform,
          totalPrice, touristTaxRate, touristTaxTotal, discountPercent, customPrice, finalPrice,
          depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid,
          cautionAmount, notes, sourceType
        ) VALUES ('reservation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 'manual')
      `).run(
        devisRow.propertyId, devisRow.clientId, devisRow.startDate, devisRow.endDate,
        devisRow.adults, devisRow.children, devisRow.teens, devisRow.babies,
        devisRow.singleBeds, devisRow.doubleBeds, devisRow.babyBeds, devisRow.checkInTime, devisRow.checkOutTime, devisRow.platform,
        devisRow.totalPrice, devisRow.touristTaxRate, devisRow.touristTaxTotal, devisRow.discountPercent, devisRow.customPrice, devisRow.finalPrice,
        devisRow.depositAmount, devisRow.depositDueDate, devisRow.balanceAmount, devisRow.balanceDueDate, devisRow.cautionAmount, devisRow.notes,
      );
      const reservationId = info.lastInsertRowid;
      copyLineGraph(numId, reservationId);

      database.prepare("UPDATE reservations SET devisStatus = 'converted', convertedReservationId = ?, updatedAt = datetime('now') WHERE id = ? AND kind = 'devis'").run(reservationId, numId);

      const insertHistory = database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, ?, ?, ?)');
      for (const entry of database.prepare('SELECT id, eventType, changedFields, createdAt FROM reservation_history WHERE reservationId = ? ORDER BY createdAt ASC').all(numId)) {
        insertHistory.run(reservationId, entry.eventType, entry.changedFields, entry.createdAt);
      }
      return reservationId;
    });
    const reservationId = tx();
    return { ok: true, data: { success: true, reservationId } };
  }

  function convertFromReservation(reservationId) {
    const numId = Number(reservationId);
    const reservation = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'reservation'").get(numId);
    if (!reservation) return { error: 'Réservation introuvable', status: 404 };

    const devisNumber = database.generateDevisNumber();
    const tx = database.transaction(() => {
      const info = database.prepare(`
        INSERT INTO reservations (
          kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, totalPrice, touristTaxRate, touristTaxTotal,
          discountPercent, customPrice, finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes
        ) VALUES ('devis', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        devisNumber, reservation.propertyId, reservation.clientId, reservation.startDate, reservation.endDate,
        reservation.adults, reservation.children, reservation.teens, reservation.babies,
        reservation.singleBeds, reservation.doubleBeds, reservation.babyBeds, reservation.checkInTime, reservation.checkOutTime, reservation.platform,
        reservation.totalPrice, reservation.touristTaxRate, reservation.touristTaxTotal, reservation.discountPercent, reservation.customPrice, reservation.finalPrice,
        reservation.depositAmount, reservation.depositDueDate, reservation.balanceAmount, reservation.balanceDueDate, reservation.cautionAmount || 0, reservation.notes,
      );
      const devisId = info.lastInsertRowid;
      copyLineGraph(numId, devisId);
      return devisId;
    });
    const devisId = tx();
    return { ok: true, status: 201, data: findById(devisId) };
  }

  return {
    enrichDevis,
    resolvePaymentSchedule,
    list,
    findById,
    getHistory,
    updateStatus,
    create,
    update,
    remove,
    convertToReservation,
    convertFromReservation,
  };
}

const defaultModel = createModel(db);
defaultModel.buildModel = createModel;

module.exports = defaultModel;
