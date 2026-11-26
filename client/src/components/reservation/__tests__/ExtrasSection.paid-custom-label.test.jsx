// specs/pricing/pricing-components.md §3 rule 123 (stabilisation loop t11, S11-1) — a free line a note or a collected platform complement paid is
// keyed by its label: the server refuses its renaming (409 LINE_PAID_RENAMED) and names it in `editLock.paidCustomOptionIds`, so the fiche
// greys its description, before the stay as during it. The unpaid line beside it stays editable.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';

function buildContext({ paidCustomOptionIds }) {
  return {
    formSectionCardSx: {},
    lockedSectionSx: undefined,
    formSectionContentSx: {},
    form: {
      selectedOptions: [],
      customOptions: [
        { customKey: '5', customOptionId: 5, description: 'Ménage', amount: 20 },
        { customKey: '6', customOptionId: 6, description: 'Bois', amount: 12 },
      ],
      selectedResources: [],
      autoOptionsInComplement: [],
      platform: 'direct',
      singleBeds: '',
      doubleBeds: '',
      babyBeds: '',
    },
    updateForm: () => {},
    propertyOptions: [],
    displayableResources: [],
    quantityPersons: 2,
    quantityNights: 2,
    toDisplayedQuantity: (q) => q,
    toBaseQuantity: (q) => q,
    getQuantityMultiplier: () => 1,
    setOptionEnabled: vi.fn(),
    setOptionQuantity: vi.fn(),
    setResourceEnabled: vi.fn(),
    setResourceQuantity: vi.fn(),
    addCustomOption: vi.fn(),
    updateCustomOption: vi.fn(),
    removeCustomOption: vi.fn(),
    isReservationLocked: false,
    extrasWindowOpen: false,
    arrivalLines: {},
    frozenCustomOptionIds: [],
    paidCustomOptionIds,
    setOptionInComplement: vi.fn(),
    setResourceInComplement: vi.fn(),
    setAutoOptionInComplement: vi.fn(),
    firstEnabledBedLinenOptionId: null,
    bedLinenForcedOptionIds: new Set(),
  };
}

const renderCard = (context) => render(
  <ReservationFormProvider value={context}>
    <ExtrasSection />
  </ReservationFormProvider>,
);

test('a paid free line: its description is disabled and captioned; the unpaid one stays editable', () => {
  renderCard(buildContext({ paidCustomOptionIds: [5] }));
  expect(screen.getByDisplayValue('Ménage')).toBeDisabled();
  expect(screen.getByDisplayValue('Bois')).toBeEnabled();
  expect(screen.getAllByText('Déjà payée : libellé figé')).toHaveLength(1);
});

test('no paid line named by the server: every description is editable, no caption', () => {
  renderCard(buildContext({ paidCustomOptionIds: [] }));
  expect(screen.getByDisplayValue('Ménage')).toBeEnabled();
  expect(screen.queryByText('Déjà payée : libellé figé')).toBeNull();
});
