import { vi } from 'vitest';
/**
 * Test-only helper: builds a complete mock value for ReservationFormContext so the section
 * components can be rendered in isolation. Not imported by production code.
 */
export function makeMockForm(overrides = {}) {
  return {
    clientId: null,
    adults: 2, children: 0, teens: 0, babies: 0,
    platform: 'direct', status: 'draft',
    singleBeds: '', doubleBeds: '', babyBeds: '',
    extraGuestSurchargeOffered: false,
    totalPrice: 100, customPrice: '', discountPercent: 0, finalPrice: 100,
    depositAmount: 0, depositDueDate: '', depositPaid: false,
    balanceAmount: 0, balanceDueDate: '', balancePaid: false,
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '',
    cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], customOptions: [], selectedResources: [],
    checkInTime: '15:00', checkOutTime: '10:00',
    startDate: '2026-06-01', endDate: '2026-06-05', propertyId: 1,
    ...overrides,
  };
}

export function makeMockContext(overrides = {}) {
  const { form: formOverrides, ...rest } = overrides;
  return {
    // shared styles
    formSectionCardSx: {}, lockedSectionSx: undefined, formSectionContentSx: {}, sectionGridSx: {},
    // core
    form: makeMockForm(formOverrides),
    updateForm: vi.fn(),
    // catalogs
    properties: [{ id: 1, name: 'Villa', label: 'Villa Test' }],
    propertyOptions: [{ id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' }],
    displayableResources: [{ id: 20, name: 'Vélo', price: 5, priceType: 'per_stay', available: 3 }],
    // stay
    selectedProp: 1,
    handleReservationPropertyChange: vi.fn(),
    miniCalendarStart: '2026-06-01', setMiniCalendarStart: vi.fn(), miniVisibleDays: 8,
    reservations: [],
    editingReservationId: null,
    handleMiniDateClick: vi.fn(), centerMiniCalendarOnRange: vi.fn(),
    arrivalMin: '2026-01-01', arrivalMax: '', departureMin: '2026-06-01', departureMax: '',
    handleManualDateInputChange: vi.fn(),
    datesUnavailableForProperty: false, datesUnavailableMessage: 'Dates indisponibles',
    minNightsState: { breached: false, required: 0, nights: 0 }, minNightsWarning: '',
    liveTimeConflictState: { arrivalMessage: '', departureMessage: '', message: '' },
    liveTimeConflictMessage: '',
    defaultCheckInTime: '15:00', defaultCheckOutTime: '10:00',
    isReservationLocked: false,
    // guests / beds
    maxAdultsAllowed: 6, maxBabiesAllowed: 2, maxSingleBeds: 4, maxDoubleBeds: 2,
    exceedsAdultsCapacity: false, exceedsChildrenCapacity: false, exceedsBabiesCapacity: false,
    exceedsTotalCapacity: false, exceedsSingleBedsLimit: false, exceedsDoubleBedsLimit: false,
    bedsCapacityMismatch: false,
    totalGuestsCount: 2, totalGuestsMax: 8, reservationBedCapacity: 0, requiredRegularBeds: 2,
    maxBabyBedsByRule: 2, remainingBabyBeds: 2,
    handleSuggestBeds: vi.fn(),
    // extras
    quantityPersons: 2, quantityNights: 4,
    toDisplayedQuantity: (q) => Number(q) || 0,
    toBaseQuantity: (q) => Number(q) || 0,
    getQuantityMultiplier: () => 1,
    setOptionEnabled: vi.fn(), setOptionQuantity: vi.fn(),
    setResourceEnabled: vi.fn(), setResourceQuantity: vi.fn(),
    addCustomOption: vi.fn(), updateCustomOption: vi.fn(), removeCustomOption: vi.fn(),
    // specs/bed-config-in-linen-card.md — added 2026-06-05. Default to "no bed-linen
    // option enabled" so existing tests keep the bed-inputs sub-block hidden in ExtrasSection
    // by default. Tests that exercise the bed-linen card override these explicitly.
    firstEnabledBedLinenOptionId: null, bedLinenOptionEnabled: false,
    // finance
    isDevisMode: false, reservationId: null,
    refreshToCurrentPricing: vi.fn(),
    accommodationBasePriceDisplay: '100.00', pricingQuote: null,
    ...rest,
  };
}
