// specs/tourist-tax-declared-checkbox.md rule 8 (D16) — the server's `declarable` flag: disabled with its caption while the stay
// is not paid and over, a stored tick can always go, a refusal from a stale tab reverts with the server's reason.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';
import { reportOf } from './touristTaxReportFixtures';

// The legacy-shaped fixtures below, sent as the report payload (specs/tourist-tax-report-v2.md §4.3).
const asReport = (d) => reportOf(d.reservations);

const CAPTION = 'Déclarable une fois le séjour payé et terminé.';
// The page opens on the month before this one: the fixtures live there, whatever today is.
const first = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
const MONTH = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
const STORED_TICK = `${MONTH}-01 09:00:00`;
const STAY = {
  reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont', startDate: `${MONTH}-20`, endDate: `${MONTH}-22`,
  lastNightDate: `${MONTH}-21`, children: 0, nightsCount: 2, taxRate: 1.2, adults: 2, taxAmount: 4.8, accommodationAmount: 500, touristTaxDeclaredAt: null,
};
const dataOf = (...rows) => ({
  month: MONTH, from: `${MONTH}-01`, toExclusive: `${MONTH}-28`,
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 1, nightsCount: 2, adultNights: 4, taxAmount: 4.8, accommodationAmount: 500 }],
  reservations: rows,
  totals: { reservationsCount: 1, rentedNights: 2, adultNights: 4, taxAmount: 4.8, accommodationAmount: 500 },
});
const renderPage = () => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);
const setPhone = (phone) => {
  window.matchMedia = (query) => ({
    matches: phone && query.includes('max-width'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
};

beforeEach(() => {
  setPhone(false);
  api.getTouristTaxReport.mockReset();
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: STORED_TICK });
});
afterAll(() => { delete window.matchMedia; });

test('not declarable: disabled, with the caption', async () => {
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf({ ...STAY, declarable: false })));
  renderPage();
  const box = await screen.findByRole('checkbox', { name: /Déclarée — Jean Dupont/ });
  expect(box).toBeDisabled();
  expect(screen.getByText(CAPTION)).toBeInTheDocument();
});

test('not declarable, on a phone: disabled with the caption too', async () => {
  setPhone(true);
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf({ ...STAY, declarable: false })));
  renderPage();
  expect(await screen.findByRole('checkbox', { name: /Déclarée — Jean Dupont/ })).toBeDisabled();
  expect(screen.getByText(CAPTION)).toBeInTheDocument();
});

test('declarable: enabled, no caption, the tick goes', async () => {
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf({ ...STAY, declarable: true })));
  renderPage();
  const box = await screen.findByRole('checkbox', { name: /Déclarée — Jean Dupont/ });
  expect(box).toBeEnabled();
  expect(screen.queryByText(CAPTION)).toBeNull();
  fireEvent.click(box);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true, { addedGuests: false }));
});

test('a stored tick on a stay no longer declarable can still go, with no caption', async () => {
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf({ ...STAY, declarable: false, touristTaxDeclaredAt: STORED_TICK })));
  api.setTouristTaxDeclared.mockResolvedValue({ declaredAt: null });
  renderPage();
  const box = await screen.findByRole('checkbox', { name: /Déclarée — Jean Dupont/ });
  expect(box).toBeEnabled();
  expect(screen.queryByText(CAPTION)).toBeNull();
  fireEvent.click(box);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, false, { addedGuests: false }));
});

test('the row of its own follows its own flag, beside a declared main row', async () => {
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf(
    { ...STAY, declarable: false, touristTaxDeclaredAt: STORED_TICK },
    { ...STAY, addedGuestsRow: true, declarable: false, adults: 1, taxAmount: 2.4, accommodationAmount: 0 },
  )));
  renderPage();
  const boxes = await screen.findAllByRole('checkbox');
  expect(boxes[0]).toBeEnabled();
  expect(boxes[1]).toBeDisabled();
  expect(within(boxes[1].closest('tr')).getByText(CAPTION)).toBeInTheDocument();
});

test('a tick refused by the server (stale tab) reverts and says why', async () => {
  api.getTouristTaxReport.mockResolvedValue(asReport(dataOf({ ...STAY, declarable: true })));
  api.setTouristTaxDeclared.mockRejectedValue(new Error(CAPTION));
  renderPage();
  const box = await screen.findByRole('checkbox', { name: /Déclarée — Jean Dupont/ });
  fireEvent.click(box);
  await screen.findByText(CAPTION);
  await waitFor(() => expect(box).not.toBeChecked());
});
