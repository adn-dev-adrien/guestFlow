// specs/pricing-components.md §3 rule 94 reading (stabilisation loop t16, S16-2, 2026-11-17) — one request body for every quote of the fiche
// (live preview, save-time quote, « Actualiser les tarifs », ledger re-quote): what one carries, all carry.
import { ficheQuoteBody, customOptionsPayload, selectedOptionsPayload, selectedResourcesPayload } from '../ficheQuoteBody';

const form = {
  startDate: '2026-12-01', endDate: '2026-12-04', checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: '1', babyBeds: '',
  extraGuestSurchargeOffered: false, discountPercent: 0, discountTarget: 'nights', customPrice: '', platform: 'Booking',
  platformCommissionAmount: '12', acompteCommissionAmount: '', platformGrossAmount: '300', platformTouristTaxAmount: '4', platformPayoutAmount: '280',
  depositPaid: true, balancePaid: false, complementPaid: false, depositAmount: 90, depositAmountOverride: '', complementAmountOverride: '15',
  balanceAmount: 210, depositDisabled: 0, touristTaxInComplement: true, autoOptionsInComplement: [5],
  selectedOptions: [{ optionId: 2, quantity: 1, inComplement: true }, { optionId: 9, quantity: 1 }],
  laterOptions: [{ lineId: 7, optionId: 2, quantity: 1, offered: false, inComplement: 0 }],
  customOptions: [{ customKey: '41', customOptionId: 41, description: ' Bois ', amount: 15, inComplement: false }, { customKey: 'x', description: '', amount: 5 }, { customKey: 'y', description: 'Zéro', amount: 0 }],
  selectedResources: [{ resourceId: 3, quantity: 1, unitPrice: 30, inComplement: null }, { resourceId: 4, quantity: 0 }],
};
const input = (extra = {}) => ({
  form, propertyId: '1', catalogue: [{ id: 9, autoEnabled: 1 }], offeredOptionIds: new Set([2]), lockedOptionUnits: { 2: 8 }, lockedResourceUnits: {},
  forceCurrentPricing: false, refreshTouristTax: false, reservationId: 7001, devisId: null, newDevisQuoteMarker: {}, unlockPast: false, ...extra,
});

test('the body carries every field the live preview sent, unlock included when the fiche is unlocked', () => {
  const body = ficheQuoteBody(input({ unlockPast: true }));
  expect(body).toMatchObject({
    propertyId: 1, babies: 1, babyBeds: 0, platformGrossAmount: '300', platformPayoutAmount: '280', platformTouristTaxAmount: '4',
    complementAmountOverride: 15, depositAmountOverride: null, offeredOptionIds: [2], lockedOptionUnits: { 2: 8 }, reservationId: 7001,
    touristTaxInComplement: 1, unlockPast: true,
  });
  expect(ficheQuoteBody(input())).not.toHaveProperty('unlockPast');
});

test('the overrides win (« Actualiser les tarifs »: current prices, no lock, no typed price)', () => {
  const body = ficheQuoteBody(input({ unlockPast: true }), { lockedOptionUnits: {}, forceCurrentPricing: true, customPrice: '' });
  expect(body).toMatchObject({ lockedOptionUnits: {}, forceCurrentPricing: true, customPrice: '', unlockPast: true });
});

test('the line payloads: engine-derived options left out, later lines appended, free lines without text or amount not sent, a typed one new', () => {
  expect(selectedOptionsPayload(form, [{ id: 9, autoEnabled: 1 }])).toEqual([
    { optionId: 2, quantity: 1, inComplement: 1 },
    { lineId: 7, optionId: 2, quantity: 1, offered: false, inComplement: 0 },
  ]);
  expect(customOptionsPayload(form.customOptions)).toEqual([
    { customKey: '41', customOptionId: 41, description: 'Bois', amount: 15, offered: false, inComplement: 0 },
  ]);
  // S16-3 b — a line typed on the fiche names no stored row: it is sent as a new line, never matched to a removed row by its text.
  expect(customOptionsPayload([{ customKey: 'custom_9', description: 'Bois', amount: 10 }])).toEqual([
    { customKey: 'custom_9', newLine: true, description: 'Bois', amount: 10, offered: false, inComplement: null },
  ]);
  expect(selectedResourcesPayload(form)).toEqual([{ resourceId: 3, quantity: 1, unitPrice: 30, offered: false, inComplement: null, sessions: [] }]);
});

test('a devis body names the devis, a new devis its marker, a new booking neither id', () => {
  expect(ficheQuoteBody(input({ reservationId: null, devisId: 12 }))).toMatchObject({ devisId: 12 });
  const fresh = ficheQuoteBody(input({ reservationId: null, newDevisQuoteMarker: { kind: 'devis' } }));
  expect(fresh.kind).toBe('devis');
  expect(fresh).not.toHaveProperty('reservationId');
  expect(fresh).not.toHaveProperty('devisId');
});
