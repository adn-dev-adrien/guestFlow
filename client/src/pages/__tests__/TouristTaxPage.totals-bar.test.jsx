// specs/tourist-tax-report-v2.md §3 rules 20 and 21 — the sticky bar shows the server's totals as they are (the
// main figure « À reverser » with « reste … » or « tout est déclaré », the platforms' share apart); a tick is
// followed by a read of the report, so the bar moves by the server's figures, never by a sum made here.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 1, nightsCount: 2, taxAmount: 4.8 };
const FULL = {
  ...TOTALS, staysCount: 3, persons: 9, taxedPersons: 6, exemptPersons: 3, nights: 7, taxedPersonNights: 18, exemptPersonNights: 5,
  amount: 52.44, declaredAmount: 20, remainingAmount: 32.44, platformRemittedStaysCount: 2, platformRemittedAmount: 11.5,
};

beforeEach(() => {
  setPhone(false);
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW], { totals: FULL }));
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});
afterAll(() => setPhone(null));

const figure = (key) => within(screen.getByTestId(`total-${key}`));

test('rule 20: every total of the bar is the server figure, the platforms told apart', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  expect(figure('stays').getByText('3')).toBeInTheDocument();
  expect(figure('stays').getByText('+ 2 reversés par plateforme')).toBeInTheDocument();
  expect(figure('persons').getByText('9')).toBeInTheDocument();
  expect(figure('taxed').getByText('6 · 3')).toBeInTheDocument();
  expect(figure('nights').getByText('7')).toBeInTheDocument();
  expect(figure('personNights').getByText('18')).toBeInTheDocument();
  expect(figure('personNights').getByText('5 exonérées')).toBeInTheDocument();
  expect(figure('declared').getByText('20,00 €')).toBeInTheDocument();
  expect(figure('declared').getByText('11,50 € reversés par les plateformes')).toBeInTheDocument();
  expect(figure('amount').getByText('À reverser')).toBeInTheDocument();
  expect(figure('amount').getByText('52,44 €')).toBeInTheDocument();
  expect(figure('amount').getByText('reste 32,44 €')).toBeInTheDocument();
});

test('rule 20: everything declared says so', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf([ROW], { totals: { ...FULL, allDeclared: true, remainingAmount: 0 } }));
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  expect(figure('amount').getByText('tout est déclaré')).toBeInTheDocument();
});

test('rule 20: on a phone two figures, the rest behind « Détail des totaux »', async () => {
  setPhone(true);
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  expect(screen.getByTestId('total-stays')).toBeInTheDocument();
  expect(screen.getByTestId('total-amount')).toBeInTheDocument();
  expect(screen.queryByTestId('total-persons')).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Détail des totaux' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByTestId('total-persons')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Masquer le détail' })).toHaveAttribute('aria-expanded', 'true');
});

test('rule 21: a tick reads the report again and the bar takes the new totals', async () => {
  renderTaxPage();
  const box = await screen.findByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  api.getTouristTaxReport.mockResolvedValue(reportOf(
    [{ ...ROW, touristTaxDeclaredAt: '2026-07-01 10:00:00' }],
    { totals: { ...FULL, declaredAmount: 24.8, remainingAmount: 27.64 } },
  ));
  fireEvent.click(box);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true, { addedGuests: false }));
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(figure('declared').getByText('24,80 €')).toBeInTheDocument());
  expect(figure('amount').getByText('reste 27,64 €')).toBeInTheDocument();
  expect(api.getTouristTaxReport.mock.calls[1][0]).toEqual(api.getTouristTaxReport.mock.calls[0][0]);
});
