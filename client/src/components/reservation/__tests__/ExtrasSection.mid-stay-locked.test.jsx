import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';

// specs/mid-stay-extras-on-locked-fiche.md §3.2 + §3.5 rules 15-16 — on a locked fiche the extras card
// comes back to life while the server says the window is open; lines sold at arrival stay frozen.

const OPTION = (id, title) => ({
  id, title, description: '', priceType: 'per_stay', price: 20, autoEnabled: 0, countsAsBedLinen: 0,
});

const LOCKED_SX = { opacity: 0.55, pointerEvents: 'none' };

function buildContext({ extrasWindowOpen, arrivalLines = {}, frozenCustomOptionIds = [5], handlers = {} }) {
  return {
    formSectionCardSx: {},
    lockedSectionSx: LOCKED_SX,
    formSectionContentSx: {},
    form: {
      selectedOptions: [
        { optionId: 1, quantity: 2, totalPrice: 40 },
        { optionId: 2, quantity: 1, totalPrice: 20 },
      ],
      customOptions: [
        { customKey: '5', customOptionId: 5, description: 'Bouteille de vin', amount: 15 },
        { customKey: '6', customOptionId: 6, description: 'Bière', amount: 3 },
        // Typed in this session with an arrival label: no persisted id, so never frozen.
        { customKey: 'custom_3', description: 'Bouteille de vin', amount: 15 },
      ],
      selectedResources: [{ resourceId: 30, quantity: 1, totalPrice: 12 }],
      autoOptionsInComplement: [],
      platform: 'direct',
      singleBeds: '',
      doubleBeds: '',
      babyBeds: '',
    },
    updateForm: () => {},
    propertyOptions: [OPTION(1, 'Ménage'), OPTION(2, 'Bois')],
    displayableResources: [{ id: 30, name: 'Vélo', price: 12, priceType: 'per_stay', available: 3 }],
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
    isReservationLocked: true,
    extrasWindowOpen,
    arrivalLines,
    frozenCustomOptionIds,
    setOptionInComplement: vi.fn(),
    setResourceInComplement: vi.fn(),
    setAutoOptionInComplement: vi.fn(),
    firstEnabledBedLinenOptionId: null,
    bedLinenForcedOptionIds: new Set(),
    ...handlers,
  };
}

const ARRIVAL_LINES = {
  'opt:1': { minQuantity: 2, frozen: true },
  'res:30': { minQuantity: 1, frozen: true },
  'custom:bouteille de vin': { minQuantity: 1, frozen: true },
};

function renderCard(context) {
  return render(
    <ReservationFormProvider value={context}>
      <ExtrasSection />
    </ReservationFormProvider>,
  );
}

const cardOf = (container) => container.querySelector('.MuiCard-root');
const optionCard = (title) => screen.getByText(title).closest('.MuiCard-root');

test('window open — the card is not greyed out; window closed — it is', () => {
  const open = renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  expect(getComputedStyle(cardOf(open.container)).pointerEvents).not.toBe('none');
  open.unmount();

  const closed = renderCard(buildContext({ extrasWindowOpen: false }));
  expect(getComputedStyle(cardOf(closed.container)).pointerEvents).toBe('none');
  expect(screen.getByRole('button', { name: 'Ajouter une ligne' })).toBeDisabled();
});

test('an option sold at arrival is captioned, its switch is ON and disabled, its quantity cannot go below the arrival one', () => {
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  const card = optionCard('Ménage');
  expect(within(card).getByText('Vendu à l\'arrivée')).toBeTruthy();
  const switches = within(card).getAllByRole('switch');
  expect(switches[0]).toBeChecked();
  expect(switches[0]).toBeDisabled();
  // Quantity 2 = the arrival floor 2: the stepper cannot go down, but can go up.
  expect(within(card).getByRole('button', { name: 'Diminuer' })).toBeDisabled();
  expect(within(card).getByRole('button', { name: 'Augmenter' })).toBeEnabled();
});

test('an option sold during the stay is a normal line: no caption, switch and stepper live', () => {
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  const card = optionCard('Bois');
  expect(within(card).queryByText('Vendu à l\'arrivée')).toBeNull();
  expect(within(card).getAllByRole('switch')[0]).toBeEnabled();
  expect(within(card).getByRole('button', { name: 'Augmenter' })).toBeEnabled();
});

test('a custom line sold at arrival cannot be removed, one sold during the stay can', () => {
  const removeCustomOption = vi.fn();
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES, handlers: { removeCustomOption } }));
  const wine = screen.getAllByDisplayValue('Bouteille de vin')[0].closest('.MuiCard-root');
  const beer = screen.getByDisplayValue('Bière').closest('.MuiCard-root');
  expect(within(wine).getByText('Vendu à l\'arrivée')).toBeTruthy();
  expect(within(wine).getByRole('button', { name: 'Supprimer' })).toBeDisabled();
  expect(within(wine).getByLabelText('Description')).toBeDisabled();
  expect(within(beer).queryByText('Vendu à l\'arrivée')).toBeNull();
  fireEvent.click(within(beer).getByRole('button', { name: 'Supprimer' }));
  expect(removeCustomOption).toHaveBeenCalledWith('6');
});

test('a resource sold at arrival is frozen the same way', () => {
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  const card = screen.getByText('Vélo').closest('.MuiCard-root');
  expect(within(card).getByText('Vendu à l\'arrivée')).toBeTruthy();
  expect(within(card).getAllByRole('switch')[0]).toBeDisabled();
});

test('« Forcer en complément » is disabled on every line inside the window', () => {
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  const routing = screen.getAllByRole('switch', { name: 'Forcer en complément' });
  expect(routing.length).toBeGreaterThanOrEqual(6);
  routing.forEach((toggle) => expect(toggle).toBeDisabled());
});

test('C1 — a new line typed with an arrival label is not frozen: freezing goes by persisted id', () => {
  renderCard(buildContext({ extrasWindowOpen: true, arrivalLines: ARRIVAL_LINES }));
  const typed = screen.getAllByDisplayValue('Bouteille de vin')[1].closest('.MuiCard-root');
  expect(within(typed).queryByText('Vendu à l\'arrivée')).toBeNull();
  expect(within(typed).getByRole('button', { name: 'Supprimer' })).toBeEnabled();
  expect(within(typed).getByLabelText('Description')).toBeEnabled();
});

test('C5 — an offered line is captioned « Offerte », an arrival one « Vendu à l\'arrivée »', () => {
  renderCard(buildContext({
    extrasWindowOpen: true,
    arrivalLines: { ...ARRIVAL_LINES, 'opt:2': { minQuantity: 1, frozen: true, reason: 'offered' }, 'opt:1': { minQuantity: 2, frozen: true, reason: 'arrival' } },
  }));
  expect(within(optionCard('Bois')).getByText('Offerte')).toBeTruthy();
  expect(within(optionCard('Ménage')).getByText('Vendu à l\'arrivée')).toBeTruthy();
});

test('C6 — the floor shown in the quantity field is a whole number, never « 2.01 »', () => {
  const context = buildContext({ extrasWindowOpen: true, arrivalLines: { 'opt:1': { minQuantity: 2, frozen: true, reason: 'arrival' } } });
  context.toDisplayedQuantity = (q) => q + 0.01;
  context.form.selectedOptions[0].quantity = 2;
  renderCard(context);
  const field = within(optionCard('Ménage')).getAllByRole('textbox')[0];
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: '1' } });
  fireEvent.blur(field);
  expect(context.setOptionQuantity).toHaveBeenCalledWith(1, 3);
});

const CARD_OPTION = {
  id: 7, title: 'Petit-déjeuner', description: '', priceType: 'per_person', price: 10, autoEnabled: 0, countsAsBedLinen: 0, showsPlanningCard: 1,
};

function cardContext() {
  const context = buildContext({
    extrasWindowOpen: true,
    arrivalLines: {
      'opt:7': {
        minQuantity: 1, frozen: true, reason: 'arrival', lockedOccurrences: [{ date: '2026-06-02', time: '09:00' }],
      },
    },
  });
  context.propertyOptions = [CARD_OPTION];
  context.form.startDate = '2026-06-01';
  context.form.endDate = '2026-06-04';
  context.form.selectedOptions = [{
    optionId: 7,
    quantity: 1,
    totalPrice: 20,
    cardOccurrences: [
      { date: '2026-06-02', time: '09:00', slot: 0, checked: true },
      { date: '2026-06-03', time: '09:00', slot: 0, checked: false },
    ],
  }];
  context.form.customOptions = [];
  context.form.selectedResources = [];
  context.displayableResources = [];
  context.setOptionCardOccurrences = vi.fn();
  context.setOptionCardPersons = vi.fn();
  return context;
}

test('C2 — « Personnes servies » is disabled on a card option sold at arrival', () => {
  renderCard(cardContext());
  const field = screen.getByLabelText('Personnes servies');
  expect(field).toBeDisabled();
});

test('C4 — a moment checked at load cannot be unchecked, a new one can be checked', () => {
  const context = cardContext();
  renderCard(context);
  const chips = [...document.querySelectorAll('.MuiChip-root')].filter((c) => c.textContent === '09:00');
  expect(chips).toHaveLength(2);
  fireEvent.click(chips[0]);
  expect(context.setOptionCardOccurrences).not.toHaveBeenCalled();
  fireEvent.click(chips[1]);
  expect(context.setOptionCardOccurrences).toHaveBeenCalledTimes(1);
});
