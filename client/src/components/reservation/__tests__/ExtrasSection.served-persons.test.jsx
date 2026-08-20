import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/card-option-served-persons.md §3.2 — « Personnes servies » on a per-person card option: a
// meal or a breakfast is not always taken by the whole table (the children often skip it). The field
// takes the place of the « Qté » field, which a card option deliberately hides (its moments ARE the
// quantity).

const MEAL = {
  id: 16, title: 'Le repas des trappeurs', price: 25, priceType: 'per_person_per_night',
  showsPlanningCard: 1, cardRepeat: 'multiple_per_day', planningCardTimes: ['19:30'],
};
const GROUP_MEAL = {
  id: 17, title: 'Table d\'hôtes', price: 30, priceType: 'per_stay',
  showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: ['19:30'],
};
const CLEANING = { id: 1, title: 'Ménage', price: 80, priceType: 'per_stay' };

const OCCURRENCES = [
  { date: '2026-06-02', time: '19:30', slot: 0, checked: true },
  { date: '2026-06-03', time: '19:30', slot: 0, checked: false },
];

function renderExtras({ options, selectedOptions }) {
  const ctx = makeMockContext({
    propertyOptions: options,
    displayableResources: [],
    form: { selectedOptions, customOptions: [], selectedResources: [] },
  });
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>,
  );
  return ctx;
}

test('a per-person card option shows the served-persons field, defaulted to the party', () => {
  renderExtras({
    options: [MEAL],
    selectedOptions: [{ optionId: 16, quantity: 1, totalPrice: 50, cardOccurrences: OCCURRENCES }],
  });

  const field = screen.getByLabelText('Personnes servies');
  expect(field).toHaveValue('2');                       // quantityPersons of the mock context
  expect(screen.getByText(/Par défaut toute la tablée/)).toBeInTheDocument();
  expect(screen.getByText(/\(1 × 2 pers\. servies\)/)).toBeInTheDocument();
  // The card option keeps hiding the « Qté » field — the moments are the quantity.
  expect(screen.queryByLabelText('Qté')).not.toBeInTheDocument();
});

test('a stored count drives the field and the billed quantity', () => {
  renderExtras({
    options: [MEAL],
    selectedOptions: [{ optionId: 16, quantity: 1, totalPrice: 25, cardPersons: 1, cardOccurrences: OCCURRENCES }],
  });

  expect(screen.getByLabelText('Personnes servies')).toHaveValue('1');
  expect(screen.getByText(/Quantité/)).toHaveTextContent('Quantité : 1 (1 × 1 pers. servies)');
});

test('lowering the field reports the intent to the form', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras({
    options: [MEAL],
    selectedOptions: [{ optionId: 16, quantity: 1, totalPrice: 50, cardOccurrences: OCCURRENCES }],
  });

  await user.click(screen.getByRole('button', { name: 'Diminuer' }));
  expect(ctx.setOptionCardPersons).toHaveBeenCalledWith(16, 1);
});

test('the field stops at the capacity of the logement', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras({
    options: [MEAL],
    selectedOptions: [{ optionId: 16, quantity: 1, totalPrice: 50, cardPersons: 6, cardOccurrences: OCCURRENCES }],
  });

  // maxGuestsAllowed = 6 in the mock context: « Augmenter » can go no further.
  expect(screen.getByRole('button', { name: 'Augmenter' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Diminuer' }));
  expect(ctx.setOptionCardPersons).toHaveBeenCalledWith(16, 5);
});

test('a fixed-price card option has no served-persons field — the covers do not bite', () => {
  renderExtras({
    options: [GROUP_MEAL],
    selectedOptions: [{ optionId: 17, quantity: 1, totalPrice: 30, cardOccurrences: OCCURRENCES }],
  });

  expect(screen.queryByLabelText('Personnes servies')).not.toBeInTheDocument();
  expect(screen.getByText(/Quantité/)).toHaveTextContent('Quantité : 1');
});

test('a plain option keeps its « Qté » field and gains nothing', () => {
  renderExtras({
    options: [CLEANING],
    selectedOptions: [{ optionId: 1, quantity: 1, totalPrice: 80 }],
  });

  expect(screen.getByLabelText('Qté')).toBeInTheDocument();
  expect(screen.queryByLabelText('Personnes servies')).not.toBeInTheDocument();
});
