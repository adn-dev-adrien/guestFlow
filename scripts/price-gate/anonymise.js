/**
 * Copy-by-allow-list of the rows a price needs (specs/pricing-components.md §3 rule 68).
 *
 * Pure over rows: `anonymise({ table: rows[] })` returns `{ table: rows[] }` holding ONLY the columns of
 * `ALLOW_LIST[table]`. A table or a column that is not named there is never copied, whatever the source
 * holds: that is the whole safety argument, so the list is explicit and reviewed by hand.
 *
 * What is never on the list: `clients` (a stay keeps its `clientId` as a bare id), `reservation_history`,
 * `email_*`, `guest_email_sends`, every free-text note column, every secret (encrypted settings, tokens,
 * keys, the userscript key). What is on it: ids, dates, times, counts, amounts, flags, property, platform,
 * prices, tariff rules, catalogue rows, installments, payments, refunds, VAT periods, non-secret settings.
 *
 * Three kinds of text survive on a copied row and are rewritten here:
 *   - the description of a custom line and the `custom:<label>` keys of the JSON columns that name it,
 *     mapped to `Line N` through one `Labeler` (the engine keys a custom line by its normalised label, so
 *     the same text must give the same placeholder wherever it appears);
 *   - the JSON columns, scrubbed of any other free text (`scrubJson`);
 *   - the guest identity of the intake tables (`scrubIntakeParsed`): « Guest », a number, and an
 *     identifier without `@` (the replay never creates a client, so it accepts it).
 */

const ALLOW_LIST = Object.freeze({
  app_settings: ['id', 'createdAt', 'updatedAt', 'quoteValidityDays', 'vatRate', 'defaultCommissionAccountNumber', 'vatRateCommission',
    'fiscalYearEndMonth', 'cancellationCompensationAccount', 'vatRateCancellationCompensation', 'poolSeasonStart', 'poolSeasonEnd',
    'vatFranchiseThreshold', 'vatFranchiseThresholdSetAt', 'guestSequenceStartDate'],
  properties: ['id', 'name', 'maxBabies', 'singleBeds', 'doubleBeds', 'depositPercent', 'balanceDaysBefore', 'defaultCheckIn', 'defaultCheckOut',
    'cleaningHours', 'defaultCautionAmount', 'touristTaxPerDayPerPerson', 'createdAt', 'updatedAt', 'touristTaxMode', 'touristTaxPercentage',
    'touristTaxFixedAmount', 'touristTaxDepartmentPercentage', 'basePriceIncludedGuests', 'extraGuestPrice', 'nameArticle', 'depositEnabled',
    'tariffRecipeId', 'tariffRecipeVersion', 'extraGuestPriceUnit', 'welcomePackCost', 'maxGuests', 'depositDueDays', 'cancelAfterBalanceDueDays',
    'platformCleaningFees', 'nameArticleConfirmed', 'cleaningIncluded', 'towelsProvided', 'bedLinenProvided', 'poolSeasonStart', 'poolSeasonEnd'],
  platforms: ['id', 'name', 'commissionAccountNumber', 'hasVatOnCommission', 'commissionPercent', 'collectsTouristTax', 'touristTaxRemittedByPlatform',
    'platformTakesDeposit', 'payoutDueDays', 'countsAsDirect', 'forbidsGuestChores'],
  pricing_rules: ['id', 'propertyId', 'label', 'pricePerNight', 'pricingMode', 'progressiveTiers', 'dateRanges', 'color', 'startDate', 'endDate', 'minNights',
    'seasonKey', 'seasonRank', 'netTargetPerNight', 'extraGuestPrice', 'extraGuestNetTarget', 'maxNights', 'changeoverArrival', 'changeoverDeparture',
    'extraGuestTiers'],
  options: ['id', 'title', 'priceType', 'price', 'createdAt', 'autoOptionType', 'autoEnabled', 'autoPricingMode', 'autoFullNightThreshold',
    'optionProgressiveTiers', 'countsAsBedLinen', 'countsAsBathroomLinen', 'linenIncludesSingle', 'linenIncludesDouble', 'linenIncludesBaby',
    'towelLargePerPerson', 'towelMediumPerPerson', 'towelSmallPerPerson', 'breakfastTime', 'archivedAt', 'showsPlanningCard', 'cardRepeat',
    'planningCardDate', 'planningCardTimes', 'scopeMigratedV2', 'countsAsBathMat', 'displayToClient', 'breakfastNotifyLeadMinutes', 'category',
    'seedKey', 'alwaysVisible', 'isCancellationInsurance'],
  resources: ['id', 'name', 'quantity', 'price', 'priceType', 'propertyId', 'createdAt', 'updatedAt', 'isComplex', 'slotDuration', 'openTime', 'closeTime',
    'closedDays', 'openDays', 'turnoverMinutes', 'minimumUsageMinutes', 'showsPlanningCard', 'hourlyEveningStart', 'hourlyEveningRate',
    'hourlyExternalDayRate', 'hourlyExternalEveningRate', 'heatUpMinutes', 'heatRetentionMinutes'],
  property_options: ['propertyId', 'optionId'],
  property_option_prices: ['propertyId', 'optionId', 'price', 'freeUnits'],
  property_option_defaults: ['propertyId', 'optionId', 'offered'],
  property_option_bath_mats: ['propertyId', 'optionId', 'quantity'],
  property_resource_prices: ['propertyId', 'resourceId', 'price', 'freeMinutes'],
  resource_properties: ['resourceId', 'propertyId'],
  linen_priced_items: ['id', 'label', 'price', 'category', 'sortOrder'],
  repair_amounts: ['id', 'repairKey', 'label', 'price', 'sortOrder'],
  establishment_closures: ['id', 'propertyId', 'startDate', 'endDate', 'createdAt', 'updatedAt'],
  school_holidays: ['id', 'label', 'zoneA_start', 'zoneA_end', 'zoneB_start', 'zoneB_end', 'zoneC_start', 'zoneC_end', 'externalRef', 'isLocked'],
  vat_periods: ['id', 'regime', 'rate', 'legalMention', 'basis', 'effectiveFrom', 'createdAt', 'movedFrom', 'repriced'],
  reservations: ['id', 'propertyId', 'clientId', 'startDate', 'endDate', 'adults', 'children', 'teens', 'babies', 'singleBeds', 'doubleBeds', 'babyBeds',
    'checkInTime', 'checkOutTime', 'platform', 'totalPrice', 'discountPercent', 'finalPrice', 'depositAmount', 'depositDueDate', 'depositPaid',
    'balanceAmount', 'balanceDueDate', 'balancePaid', 'createdAt', 'updatedAt', 'cautionAmount', 'cautionReceived', 'cautionReceivedDate',
    'cautionReturned', 'cautionReturnedDate', 'sourceType', 'icalSyncLocked', 'checkInDone', 'checkOutDone', 'blocksPreviousNight', 'blocksNextNight',
    'touristTaxRate', 'touristTaxTotal', 'customPrice', 'extraGuestSurchargeOffered', 'depositPaidDate', 'balancePaidDate', 'complementAmount',
    'complementPaid', 'complementPaidDate', 'clientGrossAmount', 'kind', 'devisNumber', 'devisStatus', 'validUntil', 'convertedReservationId',
    'depositDisabled', 'touristTaxInComplement', 'accommodationAcompteContribTtc', 'accommodationSoldeContribTtc', 'touristTaxAcompteContribTtc',
    'touristTaxSoldeContribTtc', 'breakfastTime', 'depositAmountOverride', 'endOfStayComplementAmount', 'endOfStayComplementPaid',
    'endOfStayComplementPaidDate', 'endOfStayComplementDetail', 'arrivalSasDoneAt', 'departureSasDoneAt', 'complementPaidCash',
    'endOfStayComplementPaidCash', 'reservationNumber', 'platformCommissionAmount', 'platformGrossAmount', 'platformPayoutAmount',
    'acompteCommissionAmount', 'touristTaxDeclaredAt', 'complementDeferredToCheckout', 'arrivalExtrasBaseline',
    'tariffSnapshot', 'cancelledAt', 'cancelledBy', 'complementAmountOverride', 'endOfStayComplementAmountOverride',
    'complementAllocation', 'depositPaidCash', 'balancePaidCash', 'depositPaidAtArrival', 'balancePaidAtArrival', 'arrivalPaymentGroup',
    'complementPaidAtArrival', 'arrivalPaymentReduction', 'arrivalPaymentTip', 'endOfStayComplementPaidAtDeparture', 'touristTaxFrozenAt',
    'touristTaxFrozenBaseHt', 'touristTaxFrozenOccupants', 'touristTaxFrozenUnitAmount', 'platformTouristTaxAmount', 'platformPaidGuests',
    'extraGuestComplementSurcharge', 'extraGuestComplementCount', 'platformPaidAdults', 'touristTaxAddedGuestsAmount',
    'touristTaxAddedGuestsDeclaredAt', 'complementCollectedTax', 'complementPaidSplit', 'removedLineContribs', 'supersededAt',
    'supersededByReservationId', 'installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsTarget', 'installmentsLastPaidDate',
    'splitOffBooksAmount', 'splitWaivedAmount', 'splitWaivedCashAmount', 'splitShortfallDue', 'platformPenaltyAmount', 'platformPaidOccupants',
    'touristTaxAddedGuestsAdults', 'touristTaxDeclaredWithAddedAmount', 'vatPeriodId'],
  reservation_options: ['reservationId', 'optionId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement',
    'acompteContribTtc', 'soldeContribTtc', 'cardOccurrences', 'sasArrivalOrigin', 'cardPersons', 'cardNights'],
  reservation_custom_options: ['id', 'reservationId', 'description', 'amount', 'offered', 'sortOrder', 'createdAt', 'updatedAt', 'inComplement',
    'acompteContribTtc', 'soldeContribTtc', 'sasArrivalOrigin', 'sasLineKey', 'quantity'],
  reservation_resources: ['reservationId', 'resourceId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement',
    'acompteContribTtc', 'soldeContribTtc', 'sessions'],
  reservation_nights: ['reservationId', 'date', 'seasonLabel', 'pricingMode', 'price'],
  reservation_installments: ['id', 'reservationId', 'number', 'dueDate', 'amountCents', 'paid', 'paidDate', 'paidMethod', 'requestedAt', 'dateEdited',
    'amountEdited', 'addedCents', 'createdAt', 'paidSplit'],
  reservation_refunds: ['id', 'reservationId', 'refundDate', 'method', 'totalTtc', 'createdAt', 'afterCancellation'],
  reservation_refund_lines: ['id', 'refundId', 'lineKey', 'label', 'bucket', 'quantity', 'unitPrice', 'amountTtc', 'vatRate'],
  reservation_platform_penalties: ['id', 'reservationId', 'amountCents', 'penaltyDate', 'source', 'payoutAdjustedFrom', 'payoutAdjustedTo',
    'commissionAdjustedFrom', 'commissionAdjustedTo', 'createdAt'],
  payment_links: ['id', 'reservationId', 'type', 'amountCents', 'currency', 'status', 'createdAt', 'paidAt', 'expiresAt', 'installmentId',
    'takenByReservationId', 'withdrawnAt'],
  payment_settlements: ['id', 'reservationId', 'targetKind', 'targetKey', 'paidDate', 'dueCents', 'shortfallCents', 'shortfallKind', 'parts', 'createdAt',
    'updatedAt'],
  payment_tenders: ['id', 'settlementId', 'position', 'method', 'amountCents', 'internal'],
  cancellation_compensations: ['id', 'reservationId', 'propertyId', 'propertyName', 'platform', 'startDate', 'endDate', 'cancelledStayAmount',
    'expectedAmount', 'expectedDate', 'receivedAmount', 'receivedDate', 'status', 'origin', 'createdAt', 'updatedAt'],
  plugin_settings: ['plugin_id', 'key', 'value', 'updated_at'],
  plugins: ['id', 'enabled', 'version'],
  booking_intakes: ['id', 'resId', 'hotelId', 'reservationId', 'status', 'parsed', 'guestMessagePending', 'dismissedAt', 'createdAt'],
  airbnb_intakes: ['id', 'messageId', 'receivedAt', 'confirmationCode', 'parsed', 'status', 'reservationId', 'appliedAt', 'dismissedAt', 'createdAt'],
  gdf_intakes: ['id', 'messageId', 'receivedAt', 'dossierNumber', 'parsed', 'status', 'reservationId', 'appliedAt', 'dismissedAt', 'createdAt'],
});

const INTAKE_TABLES = Object.freeze(['booking_intakes', 'airbnb_intakes', 'gdf_intakes']);

// The settings rows that carry no secret and that a price or an intake reads. Anything else in
// `plugin_settings` (tokens, keys, mailbox, calendar ids) is not copied.
const PLUGIN_SETTINGS_KEPT = Object.freeze(['booking-intake.hotelIds', 'gites-de-france-intake.giteNumbers', 'sas.extinguisherCheck']);

const ROW_FILTERS = Object.freeze({
  plugin_settings: (row) => PLUGIN_SETTINGS_KEPT.includes(`${row.plugin_id}.${row.key}`),
});

const JSON_COLUMNS = Object.freeze({
  reservations: ['endOfStayComplementDetail', 'arrivalExtrasBaseline', 'tariffSnapshot', 'complementAllocation',
    'complementPaidSplit', 'removedLineContribs', 'arrivalPaymentGroup'],
  reservation_resources: ['sessions'],
  reservation_installments: ['paidSplit'],
  payment_settlements: ['parts'],
});

const normalise = (text) => String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');

/** One placeholder per normalised text, numbered in order of first sight. */
function makeLabeler() {
  const seen = new Map();
  return {
    label(text) {
      const key = normalise(text);
      if (!key) return '';
      if (!seen.has(key)) seen.set(key, `Line ${seen.size + 1}`);
      return seen.get(key);
    },
  };
}

const TEXT_KEYS = new Set(['description', 'label', 'title', 'name', 'text', 'note', 'notes', 'reason', 'message', 'detail']);
const CUSTOM_KEY = /^custom:(.+)$/;

function scrubValue(value, labeler, ownKey = '') {
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, labeler, ownKey));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const custom = CUSTOM_KEY.exec(key);
      const newKey = custom ? `custom:${normalise(labeler.label(custom[1]))}` : key;
      out[newKey] = scrubValue(inner, labeler, key);
    }
    return out;
  }
  if (typeof value === 'string') {
    const custom = CUSTOM_KEY.exec(value);
    if (custom) return `custom:${normalise(labeler.label(custom[1]))}`;
    if (TEXT_KEYS.has(ownKey)) return labeler.label(value);
  }
  return value;
}

/** A JSON column, free text replaced. A value that does not parse is dropped rather than copied. */
function scrubJson(text, labeler) {
  if (text == null || text === '') return text;
  try {
    return JSON.stringify(scrubValue(JSON.parse(text), labeler));
  } catch {
    return null;
  }
}

const IDENTITY = {
  email: (n) => `guest${n}.invalid`,
  first: () => 'Guest',
  last: (n) => String(n),
  name: (n) => String(n),
};
const DROPPED_KEY = /phone|mobile|tel$|address|street|city|postal|zip|country|nationality/i;
const TEXT_ONLY_KEY = /message|request|comment|note|remark/i;
const LINK_KEY = /url|link/i;
const IDENTITY_FIELDS = /^(first|last)?name$|^e-?mail$|phone|mobile|address/i;

function scrubIntakeValue(value, n, ownKey = '') {
  if (Array.isArray(value)) {
    if (TEXT_ONLY_KEY.test(ownKey)) return [];
    return value.map((item) => scrubIntakeValue(item, n, ownKey));
  }
  if (value && typeof value === 'object') {
    const out = {};
    const isDifference = typeof value.field === 'string' && IDENTITY_FIELDS.test(value.field);
    for (const [key, inner] of Object.entries(value)) {
      if (DROPPED_KEY.test(key)) continue;
      if (isDifference && (key === 'from' || key === 'to')) { out[key] = inner == null ? null : 'Guest'; continue; }
      out[key] = scrubIntakeValue(inner, n, key);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (/^e-?mail$|[a-z]E-?mail$/.test(ownKey)) return IDENTITY.email(n);
    if (/^first/i.test(ownKey)) return IDENTITY.first(n);
    if (/^last/i.test(ownKey) || /^name$/i.test(ownKey)) return IDENTITY.last(n);
    if (TEXT_ONLY_KEY.test(ownKey)) return '';
    if (LINK_KEY.test(ownKey)) return null;
    if (/title/i.test(ownKey)) return 'Listing';
  }
  return value;
}

/** The parsed JSON of an intake with the guest replaced: « Guest », a number, an identifier without `@`. */
function scrubIntakeParsed(text, n) {
  if (text == null || text === '') return text;
  try {
    return JSON.stringify(scrubIntakeValue(JSON.parse(text), n));
  } catch {
    return null;
  }
}

const ROW_TRANSFORMS = Object.freeze({
  reservation_custom_options: (row, ctx) => ({ ...row, description: ctx.labeler.label(row.description) }),
  reservation_refund_lines: (row) => ({ ...row, label: row.lineKey }),
  booking_intakes: (row) => ({ ...row, parsed: scrubIntakeParsed(row.parsed, row.id) }),
  airbnb_intakes: (row) => ({ ...row, messageId: `message-${row.id}`, parsed: scrubIntakeParsed(row.parsed, row.id) }),
  gdf_intakes: (row) => ({ ...row, messageId: `message-${row.id}`, parsed: scrubIntakeParsed(row.parsed, row.id) }),
});

/**
 * @param {Record<string, object[]>} tables rows as read from the source, any columns
 * @param {{ allowList?: Record<string, string[]> }} [options]
 * @returns {Record<string, object[]>} only the allow-listed tables and columns, text scrubbed
 */
function anonymise(tables, { allowList = ALLOW_LIST } = {}) {
  const labeler = makeLabeler();
  const out = {};
  for (const table of Object.keys(allowList)) {
    if (!Object.prototype.hasOwnProperty.call(tables, table)) continue;
    const columns = allowList[table];
    const jsonColumns = (JSON_COLUMNS[table] || []).filter((column) => columns.includes(column));
    const keep = ROW_FILTERS[table] || (() => true);
    out[table] = tables[table].filter(keep).map((row) => {
      const copy = {};
      for (const column of columns) {
        if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
        copy[column] = jsonColumns.includes(column) ? scrubJson(row[column], labeler) : row[column];
      }
      const transform = ROW_TRANSFORMS[table];
      return transform ? transform(copy, { labeler }) : copy;
    });
  }
  return out;
}

module.exports = { anonymise, ALLOW_LIST, INTAKE_TABLES, PLUGIN_SETTINGS_KEPT, JSON_COLUMNS, makeLabeler, scrubJson, scrubIntakeParsed };
