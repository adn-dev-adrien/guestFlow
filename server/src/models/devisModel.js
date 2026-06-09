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
const propertyOptionDefaultsModel = require('./propertyOptionDefaultsModel');

// Helpers shared between create + convertFromReservation
// (specs/devis-pdf-and-tourist-tax-fixes.md §3).

/**
 * Merge property option defaults into a payload's `selectedOptions` array. Idempotent:
 * if a default option is already present in the payload, it's left untouched (no
 * duplicate). Implements §3.3 rule 11–13 — server-side enforcement of property
 * defaults so a UI bug or raw-API caller can't accidentally skip them.
 */
function mergePropertyDefaultsIntoPayload(payload, propertyId, defaultsModel) {
  const defaults = defaultsModel.listForProperty(propertyId);
  if (!defaults || defaults.length === 0) return payload;
  const existing = new Set((payload.selectedOptions || []).map((o) => Number(o.optionId)));
  const toAdd = defaults
    .filter((d) => !existing.has(Number(d.optionId)))
    .map((d) => ({ optionId: Number(d.optionId), quantity: 1 }));
  if (toAdd.length === 0) return payload;
  // Also propagate the `offered` flag — a default with offered=true means the line
  // is included in the price (no extra charge to the customer).
  const existingOfferedIds = new Set((payload.offeredOptionIds || []).map((id) => Number(id)));
  const newOfferedIds = defaults
    .filter((d) => d.offered && !existingOfferedIds.has(Number(d.optionId)))
    .map((d) => Number(d.optionId));
  return {
    ...payload,
    selectedOptions: [...(payload.selectedOptions || []), ...toAdd],
    offeredOptionIds: [...(payload.offeredOptionIds || []), ...newOfferedIds],
  };
}

/**
 * Today as `YYYY-MM-DD HH:MM:SS` matching SQLite's `datetime('now')` format. Used as
 * the explicit `createdAt` binding for INSERTs that should never end up with an empty
 * value (specs/devis-pdf-and-tourist-tax-fixes.md §3.1 rule 1).
 */
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Compute a devis `validUntil` per §3.2 rule 6:
 *   validUntil = MIN(createdAtIsoDate + quoteValidityDays, startDate - 2 days).
 * Both inputs are ISO `YYYY-MM-DD` strings; output same. Falls back to the un-capped
 * value if `startDate` isn't a valid ISO date.
 */
function computeValidUntil({ createdAtIsoDate, startDateIso, quoteValidityDays }) {
  // Honour `quoteValidityDays = 0` as a deliberate "same day" choice (spec §3 edge case).
  // Only fall back to 30 when the input is non-finite (undefined / null / NaN).
  const rawDays = Number(quoteValidityDays);
  const days = Number.isFinite(rawDays) ? Math.max(0, rawDays) : 30;
  const raw = addDaysToIsoDate(createdAtIsoDate, days);
  if (!raw) return null;
  if (startDateIso && /^\d{4}-\d{2}-\d{2}$/.test(startDateIso)) {
    const cap = addDaysToIsoDate(startDateIso, -2);
    if (cap && raw > cap) return cap;
  }
  return raw;
}

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
  // Whether the `reservations` table carries the bilingual-PDF language column at model build
  // time. Pre-existing test DBs that build their own minimal schema may omit it — when absent
  // the SQL drops the column ref so those tests keep passing. Production / dev DBs always have
  // it (the column migration runs at boot in `database.js`).
  const HAS_PDF_LANGUAGE_COL = (() => {
    try {
      return database.prepare("PRAGMA table_info(reservations)").all().some((c) => c.name === 'pdfLanguage');
    } catch { return false; }
  })();
  // The bilingual translation columns might be absent in minimal test schemas — drop them from
  // the enrich SELECT so the join still works. Production / dev DBs always have them.
  const HAS_OPTION_TITLE_EN = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'titleEn'); }
    catch { return false; }
  })();
  const HAS_RESOURCE_NAME_EN = (() => {
    try { return database.prepare("PRAGMA table_info(resources)").all().some((c) => c.name === 'nameEn'); }
    catch { return false; }
  })();

  // ---- settings access ----
  // Read `quoteValidityDays` from the SAME database handle the model was given so tests can
  // override it on their isolated DBs (the prod-bound `settingsModel.read()` would otherwise
  // ignore the test-DB row). Returns 30 as the documented fallback.
  function readQuoteValidityDays() {
    try {
      const row = database.prepare('SELECT quoteValidityDays FROM app_settings WHERE id = 1').get();
      const days = Number(row && row.quoteValidityDays);
      return Number.isFinite(days) && days > 0 ? days : 30;
    } catch { return 30; }
  }

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
    // 2026-06-06 — surface `titleEn` so the PDF renderer can swap to the English option name
    // when the devis carries pdfLanguage='en' (specs/devis-english-language.md §3 rule 6).
    // The `titleEn` ref is conditional on the column existing so minimal test schemas still parse.
    const options = database.prepare(`
      SELECT ro.*, o.title${HAS_OPTION_TITLE_EN ? ', o.titleEn' : ''}, o.priceType as optionPriceType, o.autoOptionType, o.autoFullNightThreshold,
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
    // 2026-06-06 — surface `nameEn` for the EN PDF (specs/devis-english-language.md §3 rule 7).
    const resources = database.prepare(`
      SELECT rr.*, r.name${HAS_RESOURCE_NAME_EN ? ', r.nameEn' : ''}, r.priceType as resourcePriceType,
        COALESCE(NULLIF(rr.totalPrice, 0), NULLIF(round(COALESCE(rr.unitPrice, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2), 0),
          round(COALESCE(r.price, 0) * COALESCE(rr.billedUnits, rr.quantity, 0), 2)) as originalTotalPrice,
        rr.offered as offered
      FROM reservation_resources rr JOIN resources r ON rr.resourceId = r.id WHERE rr.reservationId = ?
    `).all(row.id);
    const nights = database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(row.id);
    const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId);
    const property = database.prepare('SELECT id, name, defaultCheckIn AS checkInTime, defaultCheckOut AS checkOutTime, defaultCautionAmount, depositPercent, depositDaysBefore, balanceDaysBefore FROM properties WHERE id = ?').get(row.propertyId);
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
  function list({ propertyId, status, from, to, requestOrigin } = {}) {
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
    // Origin filter (specs/public-api.md follow-up): 'public' = booking requests submitted via the
    // WordPress public API; 'internal' = everything else (NULL requestOrigin). Only applied when set.
    if (requestOrigin === 'public') { sql += " AND d.requestOrigin = 'public'"; }
    else if (requestOrigin === 'internal') { sql += " AND (d.requestOrigin IS NULL OR d.requestOrigin != 'public')"; }
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

    // Server-side enforcement of property option defaults (specs/devis-pdf-and-tourist-tax-fixes.md §3.3
    // rules 11–13). Idempotent: if the client already shipped the default optionId we leave it alone.
    const defaultsModel = propertyOptionDefaultsModel.buildModel(database);
    const payloadWithDefaults = mergePropertyDefaultsIntoPayload(payload, Number(payload.propertyId), defaultsModel);

    const quote = computeQuote(payloadWithDefaults, null, property);
    const devisNumber = database.generateDevisNumber();

    // §3.1 + §3.2 — bind `createdAt` + `validUntil` explicitly. `validUntil` =
    // MIN(createdAt + quoteValidityDays, startDate - 2 days). The operator's optional
    // `payload.validUntil` override wins (rare; the form doesn't expose it today).
    const createdAt = sqliteNow();
    const createdAtDate = createdAt.slice(0, 10);
    const quoteValidityDays = readQuoteValidityDays();
    const validUntil = payload.validUntil
      || computeValidUntil({ createdAtIsoDate: createdAtDate, startDateIso: payloadWithDefaults.startDate, quoteValidityDays })
      || null;

    const tx = database.transaction(() => {
      // Bilingual PDF (specs/devis-english-language.md §3 rule 1): default 'fr', accept 'en'.
      const insertedPdfLanguage = ['fr', 'en'].includes(String(payloadWithDefaults.pdfLanguage || '').toLowerCase())
        ? String(payloadWithDefaults.pdfLanguage).toLowerCase() : 'fr';
      const insertSql = HAS_PDF_LANGUAGE_COL
        ? `INSERT INTO reservations (
            kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
            singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, totalPrice, touristTaxRate, touristTaxTotal,
            discountPercent, customPrice, finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes, validUntil, createdAt, pdfLanguage
          ) VALUES ('devis', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO reservations (
            kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
            singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, totalPrice, touristTaxRate, touristTaxTotal,
            discountPercent, customPrice, finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes, validUntil, createdAt
          ) VALUES ('devis', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const insertParams = [
        devisNumber, Number(payloadWithDefaults.propertyId), Number(payloadWithDefaults.clientId), payloadWithDefaults.startDate, payloadWithDefaults.endDate,
        Number(payloadWithDefaults.adults || 1), Number(payloadWithDefaults.children || 0), Number(payloadWithDefaults.teens || 0), Number(payloadWithDefaults.babies || 0),
        payloadWithDefaults.singleBeds != null && payloadWithDefaults.singleBeds !== '' ? Number(payloadWithDefaults.singleBeds) : null,
        payloadWithDefaults.doubleBeds != null && payloadWithDefaults.doubleBeds !== '' ? Number(payloadWithDefaults.doubleBeds) : null,
        payloadWithDefaults.babyBeds != null && payloadWithDefaults.babyBeds !== '' ? Number(payloadWithDefaults.babyBeds) : null,
        payloadWithDefaults.checkInTime || property.defaultCheckIn || '15:00', payloadWithDefaults.checkOutTime || property.defaultCheckOut || '10:00',
        payloadWithDefaults.platform || 'direct', roundMoney(quote.totalPrice), roundMoney(quote.touristTaxRate || 0), roundMoney(quote.touristTaxTotal || 0),
        Number(payloadWithDefaults.discountPercent || 0),
        payloadWithDefaults.customPrice !== undefined && payloadWithDefaults.customPrice !== null && payloadWithDefaults.customPrice !== '' ? Number(payloadWithDefaults.customPrice) : null,
        roundMoney(quote.finalPrice), roundMoney(quote.depositAmount), quote.depositDueDate || null,
        roundMoney(quote.balanceAmount), quote.balanceDueDate || null,
        roundMoney(payloadWithDefaults.cautionAmount != null ? payloadWithDefaults.cautionAmount : (property.defaultCautionAmount || 0)),
        String(payloadWithDefaults.notes || ''), validUntil, createdAt,
      ];
      if (HAS_PDF_LANGUAGE_COL) insertParams.push(insertedPdfLanguage);
      const info = database.prepare(insertSql).run(...insertParams);
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
    // §3.2 rule 7 — backfill `validUntil` when the existing row has an empty value and
    // the payload doesn't override. This silently rescues legacy devis (NULL validUntil
    // in the prod-copy DB) on the first edit without needing a data migration.
    const resolvedValidUntil = (() => {
      if (payload.validUntil !== undefined && payload.validUntil !== null) return payload.validUntil;
      if (existing.validUntil) return existing.validUntil;
      const createdAtIsoDate = String(existing.createdAt || sqliteNow()).slice(0, 10);
      const startDateIso = payload.startDate || existing.startDate;
      const quoteValidityDays = readQuoteValidityDays();
      return computeValidUntil({ createdAtIsoDate, startDateIso, quoteValidityDays }) || null;
    })();

    const tx = database.transaction(() => {
      // pdfLanguage (specs/devis-english-language.md §3 rule 1): preserve existing when not in
      // payload; coerce a malformed value back to existing rather than 'fr' (no silent reset).
      const nextPdfLanguage = (() => {
        if (payload.pdfLanguage === undefined || payload.pdfLanguage === null) {
          return existing.pdfLanguage || 'fr';
        }
        const v = String(payload.pdfLanguage).toLowerCase();
        return ['fr', 'en'].includes(v) ? v : (existing.pdfLanguage || 'fr');
      })();
      const updateSql = HAS_PDF_LANGUAGE_COL
        ? `UPDATE reservations SET
            propertyId = ?, clientId = ?, devisStatus = ?, startDate = ?, endDate = ?,
            adults = ?, children = ?, teens = ?, babies = ?, singleBeds = ?, doubleBeds = ?, babyBeds = ?,
            checkInTime = ?, checkOutTime = ?, platform = ?, totalPrice = ?, touristTaxRate = ?, touristTaxTotal = ?,
            discountPercent = ?, customPrice = ?, finalPrice = ?, depositAmount = ?, depositDueDate = ?,
            balanceAmount = ?, balanceDueDate = ?, cautionAmount = ?, notes = ?, validUntil = ?, pdfLanguage = ?, updatedAt = datetime('now')
          WHERE id = ? AND kind = 'devis'`
        : `UPDATE reservations SET
            propertyId = ?, clientId = ?, devisStatus = ?, startDate = ?, endDate = ?,
            adults = ?, children = ?, teens = ?, babies = ?, singleBeds = ?, doubleBeds = ?, babyBeds = ?,
            checkInTime = ?, checkOutTime = ?, platform = ?, totalPrice = ?, touristTaxRate = ?, touristTaxTotal = ?,
            discountPercent = ?, customPrice = ?, finalPrice = ?, depositAmount = ?, depositDueDate = ?,
            balanceAmount = ?, balanceDueDate = ?, cautionAmount = ?, notes = ?, validUntil = ?, updatedAt = datetime('now')
          WHERE id = ? AND kind = 'devis'`;
      const updateParams = [
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
        resolvedValidUntil,
      ];
      if (HAS_PDF_LANGUAGE_COL) updateParams.push(nextPdfLanguage);
      updateParams.push(numId);
      database.prepare(updateSql).run(...updateParams);
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

    // §3.1 + §3.2 — populate createdAt + validUntil on the new devis row (rules 2 + 8).
    const createdAt = sqliteNow();
    const createdAtDate = createdAt.slice(0, 10);
    const quoteValidityDays = readQuoteValidityDays();
    const validUntil = computeValidUntil({ createdAtIsoDate: createdAtDate, startDateIso: reservation.startDate, quoteValidityDays }) || null;

    const tx = database.transaction(() => {
      const info = database.prepare(`
        INSERT INTO reservations (
          kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, children, teens, babies,
          singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform, totalPrice, touristTaxRate, touristTaxTotal,
          discountPercent, customPrice, finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes, validUntil, createdAt
        ) VALUES ('devis', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        devisNumber, reservation.propertyId, reservation.clientId, reservation.startDate, reservation.endDate,
        reservation.adults, reservation.children, reservation.teens, reservation.babies,
        reservation.singleBeds, reservation.doubleBeds, reservation.babyBeds, reservation.checkInTime, reservation.checkOutTime, reservation.platform,
        reservation.totalPrice, reservation.touristTaxRate, reservation.touristTaxTotal, reservation.discountPercent, reservation.customPrice, reservation.finalPrice,
        reservation.depositAmount, reservation.depositDueDate, reservation.balanceAmount, reservation.balanceDueDate, reservation.cautionAmount || 0, reservation.notes,
        validUntil, createdAt,
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
// Pure-function helpers exported for direct unit testing
// (specs/devis-pdf-and-tourist-tax-fixes.md §7.1).
defaultModel.__test = { computeValidUntil, sqliteNow, mergePropertyDefaultsIntoPayload };

module.exports = defaultModel;
