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
    updateForm: jest.fn(),
    // catalogs
    properties: [{ id: 1, name: 'Villa', label: 'Villa Test' }],
    propertyOptions: [{ id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' }],
    displayableResources: [{ id: 20, name: 'Vélo', price: 5, priceType: 'per_stay', available: 3 }],
    // stay
    selectedProp: 1,
    handleReservationPropertyChange: jest.fn(),
    miniCalendarStart: '2026-06-01', setMiniCalendarStart: jest.fn(), miniVisibleDays: 8,
    reservations: [],
    editingReservationId: null,
    handleMiniDateClick: jest.fn(), centerMiniCalendarOnRange: jest.fn(),
    arrivalMin: '2026-01-01', arrivalMax: '', departureMin: '2026-06-01', departureMax: '',
    handleManualDateInputChange: jest.fn(),
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
    handleSuggestBeds: jest.fn(),
    // extras
    quantityPersons: 2, quantityNights: 4,
    toDisplayedQuantity: (q) => Number(q) || 0,
    toBaseQuantity: (q) => Number(q) || 0,
    getQuantityMultiplier: () => 1,
    setOptionEnabled: jest.fn(), setOptionQuantity: jest.fn(),
    setResourceEnabled: jest.fn(), setResourceQuantity: jest.fn(),
    addCustomOption: jest.fn(), updateCustomOption: jest.fn(), removeCustomOption: jest.fn(),
    // finance
    isDevisMode: false, reservationId: null,
    refreshToCurrentPricing: jest.fn(),
    accommodationBasePriceDisplay: '100.00', pricingQuote: null,
    ...rest,
  };
}
