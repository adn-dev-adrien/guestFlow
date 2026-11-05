// The added guests' row — specs/platform-added-guests-tourist-tax.md rule 12: same stay as its main
// row, its own « Déclarée » tick, which leaves the main row alone.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxExtraction: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const STAY = {
  reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont',
  startDate: '2026-06-20', endDate: '2026-06-22', lastNightDate: '2026-06-21', children: 0, nightsCount: 2, taxRate: 1.2,
};
const DATA = {
  month: '2026-06', from: '2026-06-01', toExclusive: '2026-07-01',
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 1, nightsCount: 2, adultNights: 6, taxAmount: 7.2, accommodationAmount: 500 }],
  reservations: [
    { ...STAY, touristTaxDeclaredAt: '2026-06-22 09:00:00', adults: 2, taxAmount: 4.8, accommodationAmount: 500 },
    { ...STAY, addedGuestsRow: true, touristTaxDeclaredAt: null, adults: 1, taxAmount: 2.4, accommodationAmount: 0 },
  ],
  totals: { reservationsCount: 1, rentedNights: 2, adultNights: 6, taxAmount: 7.2, accommodationAmount: 500 },
};

beforeEach(() => {
  api.getTouristTaxExtraction.mockReset().mockResolvedValue(DATA);
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});

const renderPage = () => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

test('the added row ticks alone, and the main row stays as it was', async () => {
  renderPage();
  const added = await screen.findByRole('checkbox', { name: /Jean Dupont · Complément de taxe de séjour/ });
  const main = screen.getByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  expect(main).toBeChecked();
  expect(added).not.toBeChecked();
  api.getTouristTaxExtraction.mockResolvedValue({
    ...DATA,
    reservations: [DATA.reservations[0], { ...DATA.reservations[1], touristTaxDeclaredAt: '2026-07-01 10:00:00' }],
  });
  fireEvent.click(added);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true, { addedGuests: true }));
  await waitFor(() => expect(added).toBeChecked());
  expect(main).toBeChecked();
});

// Rule 24 (R22-C2) — the server decides which rows exist: a tick can merge or split them.
test('rule 24: after a tick the page takes the rows the server answers, without a loading state', async () => {
  const merged = {
    ...DATA,
    reservations: [{ ...STAY, touristTaxDeclaredAt: null, adults: 3, taxAmount: 7.2, accommodationAmount: 500 }],
  };
  renderPage();
  const main = await screen.findByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  let answer;
  api.setTouristTaxDeclared.mockResolvedValue({ declaredAt: null });
  api.getTouristTaxExtraction.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  fireEvent.click(main);
  await waitFor(() => expect(api.getTouristTaxExtraction).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Chargement de l'extraction/)).not.toBeInTheDocument();
  expect(main).not.toBeChecked();
  answer(merged);
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Complément de taxe de séjour/ })).not.toBeInTheDocument());
});

test('rule 24: the answer of a month left behind is dropped', async () => {
  renderPage();
  const main = await screen.findByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  let oldAnswer;
  api.setTouristTaxDeclared.mockResolvedValue({ declaredAt: null });
  api.getTouristTaxExtraction.mockReturnValueOnce(new Promise((resolve) => { oldAnswer = resolve; }));
  fireEvent.click(main);
  await waitFor(() => expect(api.getTouristTaxExtraction).toHaveBeenCalledTimes(2));
  api.getTouristTaxExtraction.mockResolvedValueOnce({ ...DATA, reservations: [], byProperty: [] });
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  const options = await screen.findAllByRole('option');
  fireEvent.click(options.find((o) => o.getAttribute('aria-selected') !== 'true' && !o.getAttribute('aria-disabled')));
  await screen.findByText('Aucune réservation directe sur le mois sélectionné.');
  oldAnswer(DATA);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  expect(screen.getByText('Aucune réservation directe sur le mois sélectionné.')).toBeInTheDocument();
});

test('rule 24: a failed tick puts the box back, says why and reads the rows again', async () => {
  renderPage();
  const added = await screen.findByRole('checkbox', { name: /Complément de taxe de séjour/ });
  api.setTouristTaxDeclared.mockRejectedValue(new Error('Aucune ligne à déclarer.'));
  fireEvent.click(added);
  await waitFor(() => expect(api.getTouristTaxExtraction).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Complément de taxe de séjour/ })).not.toBeChecked());
  await screen.findByText('Aucune ligne à déclarer.');
});

test('rule 21: a gap with nobody added says so on the row and claims no adult', async () => {
  api.getTouristTaxExtraction.mockResolvedValue({
    ...DATA,
    reservations: [
      DATA.reservations[0],
      { ...DATA.reservations[1], noGuestAdded: true, adults: null, children: null, adultNights: 0, taxRate: null, taxAmount: 8.04 },
    ],
  });
  renderPage();
  await screen.findByRole('checkbox', { name: /Complément de taxe de séjour/ });
  expect(screen.getByText('Écart de taxe, aucun voyageur ajouté')).toBeInTheDocument();
  const row = screen.getByText('Écart de taxe, aucun voyageur ajouté').closest('tr');
  expect(row.textContent).toContain('—');
  expect(row.textContent).toContain('8,04');
});

test('rule 21: on a phone too the gap claims no adult', async () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  api.getTouristTaxExtraction.mockResolvedValue({
    ...DATA,
    reservations: [{ ...DATA.reservations[1], noGuestAdded: true, adults: null, children: null, adultNights: 0, taxRate: null, taxAmount: 8.04 }],
  });
  renderPage();
  const note = await screen.findByText('Écart de taxe, aucun voyageur ajouté');
  expect(note).toBeInTheDocument();
  expect(screen.queryByText(/\d ad\./)).not.toBeInTheDocument();
  expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  delete window.matchMedia;
});
