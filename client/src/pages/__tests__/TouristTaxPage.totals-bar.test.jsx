// specs/tourist-tax-report-v2.md §3 rules 20, 21 and 56 — the bottom banner shows the server's totals as they are:
// « À reverser » (what remains) in large type with « sur … au total », « Déjà déclaré », what the platforms remit and its
// stays count, the other counts as pills; a tick is followed by a read of the report, so the banner moves by the server's
// figures, never by a sum made here.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

// date-literal-ok: display-only fixture dates, the page compares none of them with today
const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 1, nightsCount: 2, taxAmount: 4.8 };
const FULL = {
  ...TOTALS, staysCount: 3, persons: 9, taxedPersons: 6, exemptPersons: 3, nights: 7, taxedPersonNights: 18, exemptPersonNights: 5,
  amount: 52.44, declaredAmount: 20, remainingAmount: 32.44, platformRemittedStaysCount: 2, platformRemittedAmount: 11.5,
};

beforeEach(() => {
  setPhone(false);
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW], { totals: FULL }));
  // date-literal-ok: display-only fixture dates, the page compares none of them with today
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});
afterAll(() => setPhone(null));

const figure = (key) => within(screen.getByTestId(`total-${key}`));

test('rule 59: every figure of the banner is the server figure, the platforms told apart', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  expect(figure('amount').getByText('À reverser · juin 2026')).toBeInTheDocument();
  expect(figure('amount').getByText('32,44 €')).toBeInTheDocument();
  expect(figure('amount').getByText('sur 52,44 € au total')).toBeInTheDocument();
  expect(figure('declared').getByText('20,00 €')).toBeInTheDocument();
  expect(figure('platforms').getByText('11,50 €')).toBeInTheDocument();
  expect(figure('platforms').getByText('2 séjours')).toBeInTheDocument();
  expect(screen.getByTestId('total-stays')).toHaveTextContent('3 séjours');
  expect(screen.getByTestId('total-persons')).toHaveTextContent('9 personnes');
  expect(screen.getByTestId('total-taxed')).toHaveTextContent('6 taxées · 3 exonérées');
  expect(screen.getByTestId('total-personNights')).toHaveTextContent('18 nuitées taxées');
});

test('rule 59: everything declared says so', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf([ROW], { totals: { ...FULL, allDeclared: true, remainingAmount: 0 } }));
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  expect(figure('amount').getByText('tout est déclaré')).toBeInTheDocument();
});

test('rule 21: a tick reads the report again and the banner takes the new totals', async () => {
  renderTaxPage();
  const box = await screen.findByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  api.getTouristTaxReport.mockResolvedValue(reportOf(
    // date-literal-ok: display-only fixture dates, the page compares none of them with today
    [{ ...ROW, touristTaxDeclaredAt: '2026-07-01 10:00:00' }],
    { totals: { ...FULL, declaredAmount: 24.8, remainingAmount: 27.64 } },
  ));
  fireEvent.click(box);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true, { addedGuests: false }));
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(figure('declared').getByText('24,80 €')).toBeInTheDocument());
  expect(figure('amount').getByText('27,64 €')).toBeInTheDocument();
  expect(api.getTouristTaxReport.mock.calls[1][0]).toEqual(api.getTouristTaxReport.mock.calls[0][0]);
});
