// specs/non-card-option-served-persons.md rules 8, 9, 19, 20, 26 — « Qté » of a non-card option is the
// number of people or of nights, turns red when the party or the stay moved, and offers the new value.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import OptionRow from '../OptionRow';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const PER_PERSON = { id: 30, title: 'Repas', price: 8, priceType: 'per_person', autoEnabled: 0 };
const PER_PERSON_NIGHT = { id: 31, title: 'Panier', price: 8, priceType: 'per_person_per_night', autoEnabled: 0 };
const PER_NIGHT = { id: 32, title: 'Bois', price: 5, priceType: 'per_night', autoEnabled: 0 };
const ALERT = { optionId: 30, title: 'Repas', kind: 'persons', typed: 3, reference: 4, current: 5, label: 'Saisi pour 4 personnes, groupe : 5', applyLabel: 'Appliquer 5 personnes' };

function renderRow(opt, line, overrides = {}) {
  const ctx = makeMockContext({
    propertyOptions: [opt],
    quantityPersons: 5,
    quantityNights: 3,
    form: { selectedOptions: [{ optionId: opt.id, quantity: 1, totalPrice: 0, ...line }], customOptions: [], selectedResources: [] },
    ...overrides,
  });
  render(<ReservationFormProvider value={ctx}><OptionRow opt={opt} /></ReservationFormProvider>);
  return ctx;
}

const commit = (value) => {
  const input = screen.getByLabelText('Qté');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

test('rule 8 — pre-filled with the party when nobody typed', () => {
  renderRow(PER_PERSON, {});
  expect(screen.getByLabelText('Qté').value).toBe('5');
});

test('rule 8 — shows the typed number and carries what is typed, unconverted', () => {
  const ctx = renderRow(PER_PERSON, { cardPersons: 3 });
  expect(screen.getByLabelText('Qté').value).toBe('3');
  commit('2');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(30, 'persons', 2);
});

test('rule 9 — per person per night: people, with the nights as a hint', () => {
  renderRow(PER_PERSON_NIGHT, {});
  expect(screen.getByLabelText('Qté').value).toBe('5');
  expect(screen.getByText('× 3 nuits')).toBeTruthy();
});

test('rule 19 — per night: pre-filled with the stay, and a typed number is carried as nights', () => {
  const ctx = renderRow(PER_NIGHT, {});
  expect(screen.getByLabelText('Qté').value).toBe('3');
  commit('2');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(32, 'nights', 2);
});

test('rule 18 — a line that drifted reads as what it bills', () => {
  renderRow(PER_PERSON, { quantity: 1.1, servedPersons: 12.1 });
  expect(screen.getByLabelText('Qté').value).toBe('12.1');
});

test('rule 20 — no alert: no red and no circular arrows', () => {
  renderRow(PER_PERSON, { cardPersons: 3 });
  expect(screen.getByLabelText('Qté').getAttribute('aria-invalid')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Appliquer 5 personnes' })).toBeNull();
});

test('rules 20, 26 — an alert turns the field red, says why, and the arrows apply the new value', () => {
  const ctx = renderRow(PER_PERSON, { cardPersons: 3 }, { pricingQuote: { typedCountAlerts: [ALERT] } });
  expect(screen.getByLabelText('Qté').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('Saisi pour 4 personnes, groupe : 5')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer 5 personnes' }));
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(30, 'persons', 5);
});

test('rule 20 — the « Personnes servies » of a card option turns red too', () => {
  const card = { ...PER_PERSON, showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: ['19:30'] };
  const ctx = renderRow(card, { cardPersons: 3, cardOccurrences: [] }, { pricingQuote: { typedCountAlerts: [ALERT] } });
  expect(screen.getByLabelText('Personnes servies').getAttribute('aria-invalid')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer 5 personnes' }));
  expect(ctx.setOptionCardPersons).toHaveBeenCalledWith(30, 5);
});
