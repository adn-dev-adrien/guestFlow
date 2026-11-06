// specs/tourist-tax-report-v2.md §3 rules 22, 30, 34 and 49 (and reviews V1-4, V2-7) (reviews R1-10, R1-11, R5's register note) — the day of a
// tick as the server reads it, a long channel tag kept within its card, and the register's nights outside the window.
import { vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

// date-literal-ok: display-only fixture dates, the page compares none of them with today
const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 };
afterEach(() => setPhone(null));

test('rule 30: the « Déclarée le » tooltip reads the server day of the tick', async () => {
  setPhone(false);
  api.getTouristTaxReport.mockResolvedValue(reportOf([
    // date-literal-ok: a stamp and its server day, display only
    { ...ROW, touristTaxDeclaredAt: '2026-07-31 22:30:00', touristTaxDeclaredOn: '2026-08-01' },
  ]));
  renderTaxPage();
  const box = await screen.findByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  fireEvent.mouseOver(box);
  expect(await screen.findByText('Déclarée le 01/08/2026')).toBeInTheDocument();
});

test('rule 22 (V1-4): on a card, the tag wraps under the name rather than being cut; only wider than the card is it cut', async () => {
  setPhone(true);
  const label = 'Centrale de réservation départementale des Hautes-Pyrénées';
  api.getTouristTaxReport.mockResolvedValue(reportOf([{ ...ROW, key: '9-platform', remittedBy: 'platform', platformLabel: label, declarable: false }]));
  renderTaxPage();
  const tag = await screen.findByText(`reversée par ${label}`);
  const holder = tag.closest('.MuiChip-root').parentElement;
  expect(holder).not.toHaveStyle({ maxWidth: '50%' });
  expect(holder).toHaveStyle({ maxWidth: '100%', minWidth: '0px' });
  expect(holder.parentElement).toHaveStyle({ flexWrap: 'wrap' });
});

test('rule 34: the register marks the nights outside the window and says why, once', async () => {
  setPhone(false);
  api.getTouristTaxReport.mockResolvedValue(reportOf([ROW], {
    nights: [
      // date-literal-ok: display-only fixture dates
      { date: '2026-05-31', staysCount: 1, persons: 2, taxedPersons: 2, exemptPersons: 0, taxAmount: 2.4, outsideWindow: true },
      // date-literal-ok: display-only fixture dates
      { date: '2026-06-01', staysCount: 1, persons: 2, taxedPersons: 2, exemptPersons: 0, taxAmount: 2.4, outsideWindow: false },
    ],
    columns: { percentageBase: false, nightsOutsideWindow: true },
  }));
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  expect(await screen.findByText(/Nuit hors période d’un séjour rattaché/)).toBeInTheDocument();
  const outside = screen.getByText(/31\/05\/2026 \*/).closest('tr');
  expect(outside).toHaveAttribute('data-outside-window', 'true');
  expect(within(screen.getByText(/01\/06\/2026/).closest('tr')).queryByText(/\*/)).toBeNull();
});

test('rule 34: no night outside the window, no note', async () => {
  setPhone(false);
  api.getTouristTaxReport.mockResolvedValue(reportOf([ROW], { columns: { percentageBase: false, nightsOutsideWindow: false } }));
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  await screen.findByText(/Registre par nuit/);
  expect(screen.queryByText(/Nuit hors période/)).toBeNull();
});

test('rule 49 (V2-7): in the table, a platform\'s tag is not capped and wraps rather than being cut', async () => {
  setPhone(false);
  const label = 'Gîtes de France';
  api.getTouristTaxReport.mockResolvedValue(reportOf([{ ...ROW, key: '9-platform', remittedBy: 'platform', platformLabel: label, declarable: false }]));
  renderTaxPage();
  const tag = await screen.findByText(`reversée par ${label}`);
  expect(tag.closest('tr')).not.toBeNull();
  expect(tag.closest('.MuiChip-root').parentElement).not.toHaveStyle({ maxWidth: '160px' });
  expect(tag).toHaveStyle({ whiteSpace: 'normal' });
});
