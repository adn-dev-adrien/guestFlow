import { vi } from 'vitest';
import { midStayNoteAccess, countMidStayNotes } from '../../utils/midStayNoteAccess';
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
    maxGuestsAllowed: 6, maxBabiesAllowed: 2, maxSingleBeds: 4, maxDoubleBeds: 2,
    exceedsGuestsCapacity: false, exceedsBabiesCapacity: false,
    exceedsSingleBedsLimit: false, exceedsDoubleBedsLimit: false,
    bedsCapacityMismatch: false,
    guestsCount: 2, reservationBedCapacity: 0, requiredRegularBeds: 2,
    maxBabyBedsByRule: 2, remainingBabyBeds: 2,
    handleSuggestBeds: vi.fn(),
    // extras
    quantityPersons: 2, quantityNights: 4,
    toDisplayedQuantity: (q) => Number(q) || 0,
    toBaseQuantity: (q) => Number(q) || 0,
    getQuantityMultiplier: () => 1,
    setOptionEnabled: vi.fn(), setOptionQuantity: vi.fn(),
    setResourceEnabled: vi.fn(), setResourceQuantity: vi.fn(),
    // Card options (specs/option-planning-card.md §3.2 + card-option-served-persons.md §3.2): the
    // occurrence grid and how many people each of its moments serves.
    setOptionCardOccurrences: vi.fn(), setOptionCardPersons: vi.fn(),
    setResourceSessions: vi.fn(),
    addCustomOption: vi.fn(), updateCustomOption: vi.fn(), removeCustomOption: vi.fn(),
    // specs/bed-config-in-linen-card.md — added 2026-06-05. Default to "no bed-linen
    // option enabled" so existing tests keep the bed-inputs sub-block hidden in ExtrasSection
    // by default. Tests that exercise the bed-linen card override these explicitly.
    firstEnabledBedLinenOptionId: null, bedLinenOptionEnabled: false,
    bedLinenForcedOptionIds: new Set(),
    // finance
    isDevisMode: false, reservationId: null,
    refreshToCurrentPricing: vi.fn(),
    accommodationBasePriceDisplay: '100.00', pricingQuote: null,
    // specs/mid-stay-notes.md — the « Encaissements en séjour » block delegates the save + reload
    // to the page; the mocks let the block be exercised in isolation.
    saveThenRun: vi.fn((action) => (typeof action === 'function' ? action() : undefined)),
    reloadReservationFinance: vi.fn(),
    midStayNoteOpen: false,
    setMidStayNoteOpen: vi.fn(),
    // DERIVED, not hardcoded: the access rule is owned by the page and shared with the sticky action
    // bar. Computing it here from the mocked form keeps the block's tests exercising the real rule
    // (stay started / future / already settled) instead of a stub that could drift from it.
    midStayNote: midStayNoteAccess({
      editingReservationId: rest.editingReservationId ?? null,
      isDevisMode: rest.isDevisMode ?? false,
      startDate: (formOverrides && formOverrides.startDate) || '2026-06-01',
      notesCount: countMidStayNotes(formOverrides && formOverrides.midStaySettledNotes),
      endOfStaySettled: Boolean(formOverrides && (formOverrides.endOfStayComplementPaid || formOverrides.endOfStayComplementPaidCash)),
      today: new Date().toISOString().slice(0, 10),
    }),
    // specs/reservation-refunds.md — server-owned register; empty by default, overridden by the
    // tests that exercise the « Remboursements » block.
    refunds: [],
    refundableLines: [],
    refundTotals: { book: 0, withCash: 0 },
    refundCollectedTtc: 0,
    refundDialogOpen: false,
    setRefundDialogOpen: vi.fn(),
    createRefund: vi.fn(),
    deleteRefund: vi.fn(),
    ...rest,
  };
}
