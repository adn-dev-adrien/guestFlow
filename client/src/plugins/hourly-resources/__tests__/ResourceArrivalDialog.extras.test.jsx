// specs/outside-booking-sas.md rules 11, 12, 35 — « Proposés à l'arrivée » in the mini SAS: a suggestion is added with one tap, the stepper stays inside its bounds, the server's refusal of a
// quantity is shown under its line and blocks « Valider l'arrivée », « Autre article » searches the articles sellable with no stay, a draft line is removed freely.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { visitPayload, fakeQuote } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getResourceVisit.mockResolvedValue(visitPayload());
  api.quoteResourceVisit.mockImplementation(fakeQuote());
});

const open = async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  return screen.findByRole('button', { name: /Bière locale/ });
};
const validate = () => screen.getByRole('button', { name: 'Valider l’arrivée' });

test('rule 35 — a suggestion is added with one tap: the quote is asked with the extra, its line and the new total come from the answer', async () => {
  fireEvent.click(await open());
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ extras: [{ articleRef: 'option:7', quantity: 1, offered: false }] }), expect.anything()));
  const list = await screen.findByRole('list', { name: 'Proposés à l’arrivée' });
  expect(await within(list).findByText('1 × 6,50 €')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('126,50'));
});

test('rule 12 — the same suggestion tapped twice is one line of quantity 2; « Retirer » drops an unsaved line', async () => {
  const chip = await open();
  fireEvent.click(chip);
  fireEvent.click(chip);
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ extras: [{ articleRef: 'option:7', quantity: 2, offered: false }] }), expect.anything()));
  expect(await screen.findByText('2 × 6,50 €')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('120,00'));
  expect(screen.getByText('Aucun article ajouté.')).toBeInTheDocument();
});

test('rule 12 — the stepper stops at the article\'s maximum; a quantity typed out of bounds is refused by the server under its line and blocks the commit', async () => {
  fireEvent.click(await open());
  const quantity = await screen.findByRole('textbox', { name: 'Quantité Bière locale' });
  fireEvent.change(quantity, { target: { value: '12' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Un de plus' })).toBeDisabled());
  fireEvent.change(quantity, { target: { value: '13' } });
  expect(await screen.findByText('Quantité : 1 à 12.')).toBeInTheDocument();
  await waitFor(() => expect(validate()).toBeDisabled());
  fireEvent.change(quantity, { target: { value: '3' } });
  await waitFor(() => expect(screen.queryByText('Quantité : 1 à 12.')).toBeNull());
  await waitFor(() => expect(validate()).toBeEnabled());
});

test('rule 12 — a quantity that is not a number is a hint, nothing is asked of the server', async () => {
  fireEvent.click(await open());
  const quantity = await screen.findByRole('textbox', { name: 'Quantité Bière locale' });
  const calls = api.quoteResourceVisit.mock.calls.length;
  fireEvent.change(quantity, { target: { value: '2x' } });
  expect(await screen.findByText('Quantité : un nombre entier.')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(api.quoteResourceVisit.mock.calls.length).toBe(calls);
});

test('rule 11 — « Autre article » searches the articles sellable with no stay, grouped by category, and adds the chosen one', async () => {
  api.searchResourceVisitArticles.mockImplementation(async (_id, q) => ({ articles: [
    { articleRef: 'option:9', label: 'Planche apéritive', unitCents: 1400, max: 10, category: 'Restauration' },
    { articleRef: 'option:8', label: 'Limonade', unitCents: 400, max: 12, category: 'Boissons' },
  ].filter((a) => a.label.toLowerCase().includes(q.toLowerCase())) }));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Autre article' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Chercher un article' }), { target: { value: 'plan' } });
  const hit = await screen.findByRole('button', { name: /Planche apéritive/ });
  expect(screen.getByText('Restauration')).toBeInTheDocument();
  fireEvent.click(hit);
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ extras: [{ articleRef: 'option:9', quantity: 1, offered: false }] }), expect.anything()));
  expect(api.searchResourceVisitArticles).toHaveBeenCalledWith(5, 'plan');
});

test('rule 21 — the commit carries the extras and the total the operator saw', async () => {
  api.commitResourceVisit.mockResolvedValue({ visit: visitPayload(), invoice: null });
  fireEvent.click(await open());
  await screen.findByText('1 × 6,50 €');
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Pas maintenant' }));
  fireEvent.click(validate());
  await waitFor(() => expect(api.commitResourceVisit).toHaveBeenCalled());
  const body = api.commitResourceVisit.mock.calls[0][1];
  expect(body.extras).toEqual([{ articleRef: 'option:7', quantity: 1, offered: false }]);
  expect(body.acceptedTotalCents).toBe(12650);
});
