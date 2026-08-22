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
const { roundMoney } = require('../utils/devisHelpers');
const { resolveDepositDueDate, resolveBalanceDueDate } = require('../utils/paymentSchedule');
const { buildHistoryRows } = require('../utils/reservationAudit');
const { buildHistoryNameContext } = require('./historyNamesModel');
const { assignReservationNumberIfMissing } = require('../utils/reservationNumber');
const propertyOptionDefaultsModel = require('./propertyOptionDefaultsModel');
const bookingLinesModel = require('./bookingLinesModel');
const { isDevisExpired, computeValidUntil } = require('../utils/devisValidity');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

// Helpers shared between create + convertFromReservation
// (specs/devis-pdf-and-tourist-tax-fixes.md §3).

// Property default-options merge — shared with the public live quote so preview == devis (the function
// moved to utils/propertyDefaultOptions; re-exported via __test for the existing devis tests).
const { mergePropertyDefaultsIntoPayload, carriedOfferedDefaultsToRestore } = require('../utils/propertyDefaultOptions');

/**
 * Today as `YYYY-MM-DD HH:MM:SS` matching SQLite's `datetime('now')` format. Used as
 * the explicit `createdAt` binding for INSERTs that should never end up with an empty
 * value (specs/devis-pdf-and-tourist-tax-fixes.md §3.1 rule 1).
 */
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// A JSON column read back as text → the array the client expects. Anything unparseable reads empty.
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
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
  // Internal-only options (specs/laundry-bath-mat.md §3 rule 11) are excluded from the devis (a
  // client document). Guarded so minimal schemas without the column keep every option.
  const HAS_OPTION_DISPLAY_TO_CLIENT = (() => {
    try { return database.prepare("PRAGMA table_info(options)").all().some((c) => c.name === 'displayToClient'); }
    catch { return false; }
  })();
  // Columns a devis row shares with a reservation row but never used to write
  // (specs/devis-extras-parity-and-price-lock.md §3 rules 8-11). Probed once so a minimal test
  // schema silently drops what it doesn't have instead of throwing on the INSERT.
  const RESERVATION_COLUMNS = (() => {
    try { return new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name)); }
    catch { return new Set(); }
  })();
  const hasReservationColumn = (name) => RESERVATION_COLUMNS.has(name);
  // The lines of a devis live in the `reservation_*` children, written by the same store as a
  // reservation's — the whole point of §4.1.
  const bookingLines = bookingLinesModel.buildModel(database);

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
    // The acompte/solde SPLIT belongs to the pricing engine (specs/tourist-tax-on-solde.md rule 1: the
    // acompte is computed on the accommodation alone, the whole tourist tax rides on the solde), and
    // `create`/`update` already store what it decided. Re-deriving it here from the tax-INCLUSIVE total
    // made the devis screen and its PDF show an acompte a tax-share ABOVE the stored row, the guest's
    // email and the Qonto payment page — and above what the same stay owes once converted into a
    // reservation (specs/payment-link-quote-parity.md §3.2).
    // A legacy row with no stored split at all (NULL — never 0, which is a legitimate « no acompte »
    // on a last-minute stay) keeps the historic derivation rather than displaying nothing.
    const hasStoredSplit = row.depositAmount != null && row.balanceAmount != null;
    const depositAmount = hasStoredSplit
      ? roundMoney(Number(row.depositAmount))
      : roundMoney(totalStayPrice * (depositPercent / 100));
    const balanceAmount = hasStoredSplit
      ? roundMoney(Number(row.balanceAmount))
      : roundMoney(totalStayPrice - depositAmount);
    // specs/payment-schedule-and-cancellation.md §3.1 rule 5 — a devis promises its dates until its
    // validity date: that IS its acompte deadline. The solde keeps the stay-relative derivation,
    // clamped so it can never fall before the day the quote was issued.
    const depositDueDate = resolveDepositDueDate({
      kind: 'devis', hasDeposit: depositAmount > 0, validUntil: row.validUntil,
    });
    const balanceDueDate = resolveBalanceDueDate({
      hasBalance: balanceAmount > 0,
      startDate: row.startDate,
      bookingDate: row.createdAt,
      balanceDaysBefore: property?.balanceDaysBefore,
      // specs/deposit-blocks-the-dates.md rule 7 — a direct devis with no acompte owes a single payment,
      // due on its validity date; the fiche and its PDF must read the same date as the engine.
      dueOnValidUntil: depositAmount === 0 && isDirectChannel(row.platform),
      validUntil: row.validUntil,
    });
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
      FROM reservation_options ro JOIN options o ON ro.optionId = o.id
      WHERE ro.reservationId = ?${HAS_OPTION_DISPLAY_TO_CLIENT ? ' AND COALESCE(o.displayToClient, 1) != 0' : ''}
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
    // The scheduled occurrences and the hourly sessions are stored as JSON strings; the fiche wants
    // arrays — same contract as `GET /reservations/:id`, so the shared hydrator can read either
    // payload (specs/devis-extras-parity-and-price-lock.md §4.3).
    for (const opt of options) opt.cardOccurrences = parseJsonArray(opt.cardOccurrences);
    for (const resource of resources) resource.sessions = parseJsonArray(resource.sessions);
    const nights = database.prepare('SELECT * FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(row.id);
    const client = database.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId);
    const property = database.prepare('SELECT id, name, defaultCheckIn AS checkInTime, defaultCheckOut AS checkOutTime, defaultCautionAmount, depositPercent, balanceDaysBefore FROM properties WHERE id = ?').get(row.propertyId);
    const schedule = resolvePaymentSchedule(row, property);
    // Validity state, decided here so the fiche only renders it (specs/devis-extras-parity-and-price-lock.md
    // §3 rule 16). `validUntil` is resolved rather than echoed: a legacy row stored NULL, and the
    // operator still deserves to see the date their quote would carry.
    const today = sqliteNow().slice(0, 10);
    const resolvedValidUntil = row.validUntil || computeValidUntil({
      createdAtIsoDate: String(row.createdAt || sqliteNow()).slice(0, 10),
      startDateIso: row.startDate,
      quoteValidityDays: readQuoteValidityDays(),
    }) || null;
    const expired = isDevisExpired(row.validUntil, today);
    return {
      ...row,
      status: row.devisStatus,
      validUntil: resolvedValidUntil,
      expired,
      // While the quote holds, its prices are frozen exactly like a saved reservation's (rule 13).
      pricingLocked: !expired,
      ...schedule,
      options: [...options, ...customOptions],
      resources,
      nights,
      client,
      property,
    };
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
  // `existing` is the stored devis row when updating, null on create. A stored devis that has NOT
  // expired keeps the prices it was issued at — same lock, same engine inputs as a saved reservation
  // (specs/devis-extras-parity-and-price-lock.md §3 rule 13). An expired one — or one the operator
  // explicitly refreshed via « Actualiser les tarifs » — is re-quoted at today's tariffs (rule 14).
  function resolveLockedPricing(body, existing) {
    if (!existing || !existing.id) return {};
    if (body.refreshPricingToCurrent) return {};
    if (isDevisExpired(existing.validUntil, sqliteNow().slice(0, 10))) return {};
    // Changing the logement or the stay range invalidates the snapshot: those lines priced something
    // else. Mirrors `isExistingReservationPricingLocked` on the fiche.
    const samePlacement = Number(body.propertyId || existing.propertyId) === Number(existing.propertyId)
      && (body.startDate || existing.startDate) === existing.startDate
      && (body.endDate || existing.endDate) === existing.endDate;
    if (!samePlacement) return {};
    return bookingLines.getPricingSnapshot(Number(existing.id));
  }

  function computeQuote(body, existing, property) {
    // Read autoOptionType + autoEnabled so we drop ONLY engine-managed auto-options (the engine
    // re-adds those from the chosen check-in/out times). Options that merely carry an autoOptionType
    // label but are NOT auto-enabled — breakfast, bed/bathroom linen offered as normal add-ons, incl.
    // property option defaults — must be honoured when explicitly selected. Previously the blanket
    // `?.autoOptionType` filter dropped them, so site visitors lost them on the devis
    // (specs/site-booking-notifications.md §1). `SELECT *` stays resilient to partial/test schemas
    // that lack the autoEnabled column (→ undefined → treated as not engine-managed → kept).
    const optionMetaById = new Map(
      database.prepare('SELECT * FROM options').all().map((opt) => [Number(opt.id), opt])
    );
    const isEngineManagedAuto = (optionId) => {
      const meta = optionMetaById.get(Number(optionId));
      return Boolean(meta && meta.autoOptionType && Number(meta.autoEnabled || 0) === 1);
    };
    // `cardOccurrences` and `sessions` are what the fiche schedules — the checked mornings of a
    // planning-card option, the booked hours of an hourly resource. Dropping them here is what used
    // to make the engine treat those lines as « not taken » and return nothing at all, so the option
    // and its price vanished from the devis (specs/devis-extras-parity-and-price-lock.md §1 root
    // cause 2). They are forwarded verbatim, exactly like the reservation controller does.
    // On a devis an unflagged line stays OUT of the Complément — whatever the platform. A quote shows
    // the guest one total, not a payment plan, so the engine's « non-direct platform ⇒ everything in
    // Complément » default (specs/force-extras-complement-on-platform.md §3) is neutralised by pinning
    // 0; an explicit operator flag still wins and is carried into the reservation at conversion
    // (specs/devis-extras-parity-and-price-lock.md §3 rules 17-18).
    const routing = (value) => (value != null ? value : 0);
    const selectedOptions = (body.selectedOptions || []).map((o) => ({
      optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
      unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
      ...(o.cardOccurrences !== undefined ? { cardOccurrences: o.cardOccurrences } : {}),
      // Served persons of a card option (specs/card-option-served-persons.md §3.2 rule 10): same
      // reason as the moments — dropping it would re-bill the whole party on every recompute.
      ...(o.cardPersons !== undefined ? { cardPersons: o.cardPersons } : {}),
      inComplement: routing(o.inComplement),
    })).filter((line) => !isEngineManagedAuto(line.optionId));
    const customOptions = (body.customOptions || []).map((line, index) => ({
      customKey: String(line.customKey || `custom_${index + 1}`),
      description: String(line.description || '').trim(),
      amount: Number(line.amount || 0), offered: Boolean(line.offered),
      inComplement: routing(line.inComplement),
    })).filter((line) => line.description && Number(line.amount || 0) > 0);
    const selectedResources = (body.selectedResources || []).map((r) => ({
      resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined, offered: Boolean(r.offered),
      ...(Array.isArray(r.sessions) ? { sessions: r.sessions } : {}),
      inComplement: routing(r.inComplement),
    }));
    const payloadResourceLines = (body.selectedResources || []).map((r) => ({
      resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
      billedUnits: r.billedUnits != null ? Number(r.billedUnits) : Number(r.quantity || 1),
      priceType: r.priceType || 'per_stay', totalPrice: Number(r.totalPrice || 0), offered: Boolean(r.offered),
    })).filter((line) => Number(line.totalPrice || 0) === 0 && Number(line.unitPrice || 0) > 0);
    // The stored snapshot wins when the devis is still valid; otherwise the payload's own
    // zero-priced resource lines keep their historic role (a caller-supplied unit price).
    const locked = resolveLockedPricing(body, existing);
    const lockedResourceLines = locked.lockedResourceLines || payloadResourceLines;

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
      // specs/baby-bed-supplement.md — the cots drive their own derived line. `bookingId` is the
      // devis being edited (absent on creation), so a quote sent before the supplement existed keeps
      // the total the guest was shown.
      babyBeds: Number(body.babyBeds ?? existing?.babyBeds ?? 0),
      bookingId: existing?.id != null ? Number(existing.id) : undefined,
      discountPercent: Number(body.discountPercent ?? existing?.discountPercent ?? 0),
      selectedOptions, customOptions, selectedResources,
      extraGuestSurchargeOffered: Boolean(body.extraGuestSurchargeOffered),
      customPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
      offeredOptionIds: body.offeredOptionIds, lockedResourceLines,
      lockedOptionLines: locked.lockedOptionLines,
      lockedNightlyBreakdown: locked.lockedNightlyBreakdown,
      // The tariff the devis was quoted under (tariff-recipes rule 12bis) — replayed while the quote
      // holds, dropped once it expires so the new recipe applies.
      lockedTariff: locked.lockedTariff,
      platform: body.platform || existing?.platform,
      touristTaxInComplement: body.touristTaxInComplement,
      // Public/site devis: bill planning-card options by quantity (unschedulable on the site) —
      // specs/public-planning-options.md. Admin devis leave this falsy (occurrence-based).
      planningCardAsQuantity: Boolean(body.planningCardAsQuantity),
      // specs/payment-schedule-and-cancellation.md §3.1 — a quote's acompte is due by its validity
      // date; its solde stays stay-relative, clamped to the day the quote was issued.
      kind: 'devis',
      // A creation has no stored validity date yet — `create` computes it only after this call — so it
      // is derived here with the same rule. Without it the engine falls back to the clamped derivation
      // and a last-minute quote comes out due on its issue day while the document says it stands until
      // its validity date (specs/deposit-blocks-the-dates.md rule 7).
      validUntil: body.validUntil || existing?.validUntil || computeValidUntil({
        createdAtIsoDate: String(existing?.createdAt || sqliteNow()).slice(0, 10),
        startDateIso: body.startDate || existing?.startDate,
        quoteValidityDays: readQuoteValidityDays(),
      }) || null,
      // A devis being CREATED has no `createdAt` yet, but it is being booked today — and the engine has
      // no clock. Passing null used to persist a schedule computed as if the booking day were unknown:
      // a solde deadline free to land in the past, and (specs/deposit-blocks-the-dates.md rule 5) an
      // acompte on a stay too close to collect one, contradicting the fiche's own live recompute.
      bookingDate: existing?.createdAt || getTodayIsoDate(),
    });
  }

  // ---- replay the quote of a PERSISTED devis (specs/devis-pdf-total-parity.md §3.1) ----
  // The engine input rebuilt from the stored devis graph, in the exact shape `create`/`update` send.
  // Every field matters: dropping `offeredOptionIds` re-bills an offered option AND loses the
  // `includedInRate` deduction on the tourist-tax base — which is how the PDF used to print a total
  // 60 € above its own lines (§1). Routed through `computeQuote`, so the price lock and the
  // engine-managed auto-option filtering come for free.
  function engineInputFromPersistedDevis(full) {
    const lines = full.options || [];
    const catalogLines = lines.filter((line) => !line.isCustom);
    return {
      propertyId: full.propertyId,
      startDate: full.startDate, endDate: full.endDate,
      checkInTime: full.checkInTime, checkOutTime: full.checkOutTime,
      adults: full.adults, children: full.children, teens: full.teens, babies: full.babies,
      discountPercent: full.discountPercent,
      customPrice: full.customPrice != null && full.customPrice !== '' ? Number(full.customPrice) : undefined,
      selectedOptions: catalogLines.map((line) => ({
        optionId: Number(line.optionId), quantity: Number(line.quantity || 1),
        unitPrice: line.unitPrice != null ? Number(line.unitPrice) : undefined,
        cardOccurrences: line.cardOccurrences, cardPersons: line.cardPersons,
        inComplement: line.inComplement,
      })),
      customOptions: lines.filter((line) => line.isCustom).map((line) => ({
        customKey: String(line.customOptionId || line.title || ''),
        description: line.description || line.title || '',
        // `totalPrice` is zeroed on an offered line — the engine wants the real amount + the flag.
        amount: Number(line.originalTotalPrice ?? line.unitPrice ?? 0),
        offered: Boolean(line.offered), inComplement: line.inComplement,
      })),
      selectedResources: (full.resources || []).map((line) => ({
        resourceId: Number(line.resourceId), quantity: Number(line.quantity || 1),
        unitPrice: line.unitPrice != null ? Number(line.unitPrice) : undefined,
        offered: Boolean(line.offered), sessions: line.sessions, inComplement: line.inComplement,
      })),
      offeredOptionIds: catalogLines
        .filter((line) => Number(line.offered || 0) === 1)
        .map((line) => Number(line.optionId)),
      extraGuestSurchargeOffered: Boolean(full.extraGuestSurchargeOffered),
      touristTaxInComplement: full.touristTaxInComplement,
      platform: full.platform,
      // A public (site) devis bills planning-card options by quantity — replay it or the lines drift.
      planningCardAsQuantity: full.requestOrigin === 'public',
    };
  }

  // The quote a persisted devis is worth today, replayed from its own sold state. THE way to re-run
  // the engine on a stored devis: any other caller rebuilding its own input drifts from what the
  // fiche shows. Returns null when the devis (or its property) is gone or the engine refuses — the
  // caller then falls back to the stored row rather than serving a half-computed quote.
  function recomputeQuote(id) {
    const existing = database.prepare("SELECT * FROM reservations WHERE id = ? AND kind = 'devis'").get(Number(id));
    if (!existing) return null;
    const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(Number(existing.propertyId));
    if (!property) return null;
    try {
      const quote = computeQuote(engineInputFromPersistedDevis(enrichDevis(existing)), existing, property);
      return quote && quote.error ? null : quote;
    } catch { return null; }
  }

  // ---- persist lines (shared by create/update) — into the reservation_* children ----
  // Same store as a reservation's, so a devis line keeps everything a reservation line keeps:
  // scheduled occurrences, hourly sessions, Complément routing (§4.1). Amounts are rounded here,
  // where the engine's raw figures enter storage.
  function persistLines(devisId, quote) {
    const optionLines = (quote.optionLines || []).map((line) => ({
      ...line,
      quantity: Number(line.quantity || 1),
      unitPrice: roundMoney(line.unitPrice),
      billedUnits: roundMoney(line.billedUnits || 0),
      totalPrice: roundMoney(line.totalPrice),
      originalTotalPrice: roundMoney(line.originalTotalPrice || line.totalPrice || 0),
    }));
    bookingLines.replaceOptions(devisId, optionLines);
    bookingLines.replaceCustomOptions(devisId, optionLines);
    bookingLines.replaceResources(devisId, (quote.resourceLines || []).map((line) => ({
      ...line,
      quantity: Number(line.quantity || 1),
      unitPrice: roundMoney(line.unitPrice),
      billedUnits: roundMoney(line.billedUnits || 0),
      totalPrice: roundMoney(line.totalPrice),
    })));
    bookingLines.replaceNights(devisId, (quote.nightlyBreakdown || []).map((night) => ({
      ...night,
      price: roundMoney(night.price),
    })));
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
    const names = buildHistoryNameContext(database);
    return database.prepare('SELECT id, eventType, changedFields, createdAt FROM reservation_history WHERE reservationId = ? ORDER BY createdAt DESC').all(Number(id))
      .map((row) => {
        let stored = [];
        try { stored = JSON.parse(row.changedFields || '[]'); } catch { stored = []; }
        const { changes, derived } = buildHistoryRows(stored, names);
        return { id: row.id, eventType: row.eventType, createdAt: row.createdAt, changes, derived };
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
      // Column → value, filtered by what the schema actually has (minimal test schemas drop what
      // they lack instead of throwing). Everything below the divider is a column a reservation row
      // has always written and a devis row never did — specs/devis-extras-parity-and-price-lock.md
      // §3 rules 8-11.
      const columns = {
        kind: 'devis',
        devisNumber,
        devisStatus: 'draft',
        propertyId: Number(payloadWithDefaults.propertyId),
        clientId: Number(payloadWithDefaults.clientId),
        startDate: payloadWithDefaults.startDate,
        endDate: payloadWithDefaults.endDate,
        adults: Number(payloadWithDefaults.adults || 1),
        children: Number(payloadWithDefaults.children || 0),
        teens: Number(payloadWithDefaults.teens || 0),
        babies: Number(payloadWithDefaults.babies || 0),
        singleBeds: payloadWithDefaults.singleBeds != null && payloadWithDefaults.singleBeds !== '' ? Number(payloadWithDefaults.singleBeds) : null,
        doubleBeds: payloadWithDefaults.doubleBeds != null && payloadWithDefaults.doubleBeds !== '' ? Number(payloadWithDefaults.doubleBeds) : null,
        babyBeds: payloadWithDefaults.babyBeds != null && payloadWithDefaults.babyBeds !== '' ? Number(payloadWithDefaults.babyBeds) : null,
        checkInTime: payloadWithDefaults.checkInTime || property.defaultCheckIn || '15:00',
        checkOutTime: payloadWithDefaults.checkOutTime || property.defaultCheckOut || '10:00',
        platform: payloadWithDefaults.platform || 'direct',
        totalPrice: roundMoney(quote.totalPrice),
        touristTaxRate: roundMoney(quote.touristTaxRate || 0),
        touristTaxTotal: roundMoney(quote.touristTaxTotal || 0),
        discountPercent: Number(payloadWithDefaults.discountPercent || 0),
        customPrice: payloadWithDefaults.customPrice !== undefined && payloadWithDefaults.customPrice !== null && payloadWithDefaults.customPrice !== '' ? Number(payloadWithDefaults.customPrice) : null,
        finalPrice: roundMoney(quote.finalPrice),
        depositAmount: roundMoney(quote.depositAmount),
        depositDueDate: quote.depositDueDate || null,
        balanceAmount: roundMoney(quote.balanceAmount),
        balanceDueDate: quote.balanceDueDate || null,
        cautionAmount: roundMoney(payloadWithDefaults.cautionAmount != null ? payloadWithDefaults.cautionAmount : (property.defaultCautionAmount || 0)),
        notes: String(payloadWithDefaults.notes || ''),
        validUntil,
        createdAt,
        pdfLanguage: insertedPdfLanguage,
        // ── parity with a reservation row ──
        breakfastTime: payloadWithDefaults.breakfastTime || null,
        extraGuestSurchargeOffered: payloadWithDefaults.extraGuestSurchargeOffered ? 1 : 0,
        touristTaxInComplement: payloadWithDefaults.touristTaxInComplement ? 1 : 0,
        // The tariff this devis is quoted under — replayed for as long as it stays valid (rule 13).
        tariffSnapshot: quote.tariffSnapshot ? JSON.stringify(quote.tariffSnapshot) : null,
      };
      const names = Object.keys(columns).filter(hasReservationColumn);
      const info = database
        .prepare(`INSERT INTO reservations (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
        .run(...names.map((name) => columns[name]));
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

    // specs/tourist-tax-included-services-deduction.md rules 4-5 — a service included in the rate
    // cannot be dropped from a devis any more than from a reservation: the fiche locks its Switch ON
    // and the model makes it a guarantee, so the quoted tourist tax never depends on a keystroke.
    // Bounded by what the devis ALREADY carries — nothing is ever added to an existing devis.
    const restoredIncludedOptionIds = carriedOfferedDefaultsToRestore({
      propertyId: Number(payload.propertyId || existing.propertyId),
      carriedOptionIds: database
        .prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?')
        .all(numId)
        .map((r) => Number(r.optionId)),
      submittedOptionIds: (payload.selectedOptions || []).map((o) => Number(o.optionId)),
      defaultsModel: propertyOptionDefaultsModel.buildModel(database),
    });
    const payloadWithIncluded = restoredIncludedOptionIds.length === 0 ? payload : {
      ...payload,
      selectedOptions: [
        ...(payload.selectedOptions || []),
        ...restoredIncludedOptionIds.map((optionId) => ({ optionId, quantity: 1 })),
      ],
      offeredOptionIds: Array.from(new Set([
        ...((payload.offeredOptionIds || []).map((optId) => Number(optId))),
        ...restoredIncludedOptionIds,
      ])),
    };

    const quote = computeQuote(payloadWithIncluded, existing, property);
    // Capture the audit baseline BEFORE persisting (fixes the former always-empty update history).
    const beforeSnapshot = snapshotFromDb(numId);
    // §3.2 rule 7 — backfill `validUntil` when the existing row has an empty value and the payload
    // doesn't override. This silently rescues legacy devis (NULL validUntil) on the first edit
    // without needing a data migration. specs/devis-extras-parity-and-price-lock.md §3 rule 14: a
    // devis that had EXPIRED is re-priced by `computeQuote`, so saving it re-issues a validity
    // window from today — the quote the operator just refreshed is a quote they can send again.
    const resolvedValidUntil = (() => {
      if (payload.validUntil !== undefined && payload.validUntil !== null) return payload.validUntil;
      const quoteValidityDays = readQuoteValidityDays();
      const startDateIso = payload.startDate || existing.startDate;
      const today = sqliteNow().slice(0, 10);
      if (existing.validUntil && !isDevisExpired(existing.validUntil, today)) return existing.validUntil;
      const createdAtIsoDate = existing.validUntil ? today : String(existing.createdAt || sqliteNow()).slice(0, 10);
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
      // Column → value, same dynamic shape as `create` above: the schema decides which ones exist,
      // and the four parity columns (breakfastTime, extraGuestSurchargeOffered,
      // touristTaxInComplement, tariffSnapshot) are written like a reservation's
      // (specs/devis-extras-parity-and-price-lock.md §3 rules 8-11).
      const columns = {
        propertyId: Number(payload.propertyId || existing.propertyId),
        clientId: Number(payload.clientId || existing.clientId),
        devisStatus: payload.status || existing.devisStatus,
        startDate: payload.startDate || existing.startDate,
        endDate: payload.endDate || existing.endDate,
        adults: Number(payload.adults ?? existing.adults),
        children: Number(payload.children ?? existing.children),
        teens: Number(payload.teens ?? existing.teens),
        babies: Number(payload.babies ?? existing.babies),
        singleBeds: payload.singleBeds != null && payload.singleBeds !== '' ? Number(payload.singleBeds) : null,
        doubleBeds: payload.doubleBeds != null && payload.doubleBeds !== '' ? Number(payload.doubleBeds) : null,
        babyBeds: payload.babyBeds != null && payload.babyBeds !== '' ? Number(payload.babyBeds) : null,
        checkInTime: payload.checkInTime || existing.checkInTime,
        checkOutTime: payload.checkOutTime || existing.checkOutTime,
        platform: payload.platform || existing.platform,
        totalPrice: roundMoney(quote.totalPrice),
        touristTaxRate: roundMoney(quote.touristTaxRate || 0),
        touristTaxTotal: roundMoney(quote.touristTaxTotal || 0),
        discountPercent: Number(payload.discountPercent ?? existing.discountPercent ?? 0),
        customPrice: payload.customPrice !== undefined && payload.customPrice !== null && payload.customPrice !== ''
          ? Number(payload.customPrice)
          : (existing.customPrice == null ? null : Number(existing.customPrice)),
        finalPrice: roundMoney(quote.finalPrice),
        depositAmount: roundMoney(quote.depositAmount),
        depositDueDate: quote.depositDueDate || null,
        balanceAmount: roundMoney(quote.balanceAmount),
        balanceDueDate: quote.balanceDueDate || null,
        cautionAmount: roundMoney(payload.cautionAmount ?? existing.cautionAmount ?? 0),
        notes: String(payload.notes ?? existing.notes ?? ''),
        validUntil: resolvedValidUntil,
        pdfLanguage: nextPdfLanguage,
        // ── parity with a reservation row ──
        breakfastTime: payload.breakfastTime !== undefined ? (payload.breakfastTime || null) : (existing.breakfastTime || null),
        extraGuestSurchargeOffered: (payload.extraGuestSurchargeOffered !== undefined
          ? payload.extraGuestSurchargeOffered : existing.extraGuestSurchargeOffered) ? 1 : 0,
        touristTaxInComplement: (payload.touristTaxInComplement !== undefined
          ? payload.touristTaxInComplement : existing.touristTaxInComplement) ? 1 : 0,
        // Written once, at creation, and replayed by every later save — except when the quote had
        // expired and was just re-priced, where the fresh snapshot IS the new promise.
        tariffSnapshot: quote.tariffSnapshot ? JSON.stringify(quote.tariffSnapshot) : (existing.tariffSnapshot || null),
      };
      const names = Object.keys(columns).filter(hasReservationColumn);
      database
        .prepare(`UPDATE reservations SET ${names.map((n) => `${n} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ? AND kind = 'devis'`)
        .run(...names.map((name) => columns[name]), numId);
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
  // Delegated to the shared store so what was quoted is what gets booked, column for column:
  // scheduled occurrences, hourly sessions and Complément routing included
  // (specs/devis-extras-parity-and-price-lock.md §3 rules 19-20).
  function copyLineGraph(fromId, toId) {
    bookingLines.copyLineGraph(fromId, toId);
  }

  // The row-level fields a conversion must carry across, when the target schema has them. They are
  // NOT part of the historic INSERT lists: a converted devis used to arrive with no breakfast time,
  // no offered extra-guest surcharge and no tariff snapshot (§3 rule 19).
  function carryOverColumns(sourceRow, targetId, extra = {}) {
    const values = {
      breakfastTime: sourceRow.breakfastTime || null,
      extraGuestSurchargeOffered: sourceRow.extraGuestSurchargeOffered ? 1 : 0,
      touristTaxInComplement: sourceRow.touristTaxInComplement ? 1 : 0,
      tariffSnapshot: sourceRow.tariffSnapshot || null,
      ...extra,
    };
    const names = Object.keys(values).filter(hasReservationColumn);
    if (names.length === 0) return;
    database
      .prepare(`UPDATE reservations SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
      .run(...names.map((name) => values[name]), targetId);
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
      // The guest already told us how they read and when they want breakfast — the reservation must
      // not ask again (§3 rule 19). `pdfLanguage` becomes the reservation's `emailLanguage`: the
      // operator picked EN for the quote, the automatic emails follow.
      carryOverColumns(devisRow, reservationId, {
        emailLanguage: String(devisRow.pdfLanguage || 'fr').toLowerCase() === 'en' ? 'en' : 'fr',
      });
      // Newly-real reservation → give it a number (specs/reservation-number-and-search.md §3 rule 5).
      assignReservationNumberIfMissing(database, reservationId);

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
      // Symmetric to the devis → réservation direction: the quote inherits what the fiche holds,
      // including the tariff the stay is priced under.
      carryOverColumns(reservation, devisId, {
        pdfLanguage: String(reservation.emailLanguage || 'fr').toLowerCase() === 'en' ? 'en' : 'fr',
      });
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
    recomputeQuote,
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
