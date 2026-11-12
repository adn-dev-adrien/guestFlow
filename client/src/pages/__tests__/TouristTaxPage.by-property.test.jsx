// specs/tourist-tax-report-v2.md rules 56-59 (mock specs/tourist-tax-by-property-maquette.html) — the tax is declared per
// logement: a section for each, its card then its own table ending with « Total {logement} »; « Marquer {logement} déclaré »
// is one server call; « Exporter {logement} » is the export filtered on it. Every figure is the server's `byProperty`.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), declareTouristTaxProperty: vi.fn(), downloadTouristTaxReportCsv: vi.fn(),
  },
}));

import api from '../../api';

// date-literal-ok: display-only fixture dates, the page compares none of them with today
const ROWS = [
  // date-literal-ok: display-only fixture dates, the page compares none of them with today
  { reservationId: 1, propertyId: 1, propertyName: 'Granja', reservationName: 'Alice Un', startDate: '2026-06-02', endDate: '2026-06-04', adults: 2, nightsCount: 2, taxAmount: 4.8 },
  // date-literal-ok: display-only fixture dates, the page compares none of them with today
  { reservationId: 2, propertyId: 2, propertyName: 'Estiva', reservationName: 'Bob Deux', startDate: '2026-06-10', endDate: '2026-06-11', adults: 2, nightsCount: 1, taxAmount: 2.4 },
  // date-literal-ok: display-only fixture dates, the page compares none of them with today
  { reservationId: 3, propertyId: 2, propertyName: 'Estiva', reservationName: 'Cléo Trois', startDate: '2026-06-12', endDate: '2026-06-14', adults: 3, nightsCount: 2, taxAmount: 7, touristTaxDeclaredAt: '2026-07-01 10:00:00' },
  // date-literal-ok: display-only fixture dates, the page compares none of them with today
  { reservationId: 4, propertyId: 2, propertyName: 'Estiva', reservationName: 'Dan Quatre', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, nightsCount: 2, taxAmount: 3, remittedBy: 'platform', platformLabel: 'Airbnb', declarable: false, key: '4-platform' },
];
const BLOCK = (propertyId, propertyName, over) => ({ ...TOTALS, propertyId, propertyName, ...over });
const BY_PROPERTY = [
  BLOCK(1, 'Granja', { staysCount: 1, amount: 4.8, declaredAmount: 0, remainingAmount: 4.8, nights: 2, persons: 2, taxedPersons: 2, taxedPersonNights: 4, toDeclareRowsCount: 1 }),
  BLOCK(2, 'Estiva', {
    staysCount: 2, amount: 9.4, declaredAmount: 7, remainingAmount: 2.4, nights: 3, persons: 5, taxedPersons: 5, taxedPersonNights: 8, toDeclareRowsCount: 1,
    platformRemittedStaysCount: 1, platformRemittedAmount: 3,
  }),
];
const report = () => reportOf(ROWS, { byProperty: BY_PROPERTY, totals: { ...TOTALS, amount: 14.2, declaredAmount: 7, remainingAmount: 7.2 } });

beforeEach(() => {
  setPhone(false);
  api.getTouristTaxReport.mockReset().mockResolvedValue(report());
  api.declareTouristTaxProperty.mockReset().mockResolvedValue({ ok: true, declaredCount: 1 });
  api.downloadTouristTaxReportCsv.mockReset().mockResolvedValue();
});
afterAll(() => setPhone(null));

const section = (name) => screen.getByRole('region', { name });

test('rule 58: a section for each logement — its card, then its own table with its own total row', async () => {
  renderTaxPage();
  await screen.findByText('Alice Un');
  const granja = section('Granja');
  expect(within(granja).getByTestId('property-total-1')).toHaveTextContent('4,80 €');
  const estiva = section('Estiva');
  expect(within(estiva).getByTestId('property-total-2')).toHaveTextContent('9,40 €');
  expect(within(estiva).getByText(/reste/)).toHaveTextContent('2,40 €');
  expect(within(estiva).getByText(/1 séjour reversé par la plateforme \(3,00 €\)/)).toBeInTheDocument();
  // one table per logement: each holds only its own stays
  const tables = screen.getAllByRole('table');
  expect(tables).toHaveLength(2);
  expect(within(tables[0]).getByText('Alice Un')).toBeInTheDocument();
  expect(within(tables[0]).queryByText('Bob Deux')).toBeNull();
  expect(within(tables[1]).getByText('Bob Deux')).toBeInTheDocument();
  expect(within(tables[1]).getByText('Total Estiva').closest('tr')).toHaveTextContent('9,40 €');
  // a platform's stay stays listed, greyed, with no tick
  expect(within(tables[1]).getByText('Dan Quatre').closest('tr')).toHaveAttribute('data-remitted-by', 'platform');
});

test('rule 57: « Marquer {logement} déclaré » is one call for that logement, then the report is read again', async () => {
  renderTaxPage();
  await screen.findByText('Alice Un');
  fireEvent.click(within(section('Estiva')).getByRole('button', { name: 'Marquer Estiva déclaré' }));
  await waitFor(() => expect(api.declareTouristTaxProperty).toHaveBeenCalledTimes(1));
  const [propertyId, params] = api.declareTouristTaxProperty.mock.calls[0];
  expect(propertyId).toBe(2);
  expect(params).not.toHaveProperty('propertyId');
  expect(params).toMatchObject({ period: 'month' });
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledTimes(2));
});

test('rule 57: nothing left to declare → the button is off, and « tout est déclaré » is said', async () => {
  const done = BLOCK(1, 'Granja', { staysCount: 1, amount: 4.8, declaredAmount: 4.8, remainingAmount: 0, allDeclared: true, toDeclareRowsCount: 0 });
  api.getTouristTaxReport.mockResolvedValue(reportOf([ROWS[0]], { byProperty: [done], totals: { ...TOTALS, amount: 4.8, declaredAmount: 4.8, remainingAmount: 0, allDeclared: true } }));
  renderTaxPage();
  await screen.findByText('Alice Un');
  expect(within(section('Granja')).getByRole('button', { name: 'Marquer Granja déclaré' })).toBeDisabled();
  expect(within(section('Granja')).getByText('✓ tout est déclaré')).toBeInTheDocument();
});

test('rule 57: « Exporter {logement} » is the export of the window filtered on that logement', async () => {
  renderTaxPage();
  await screen.findByText('Alice Un');
  fireEvent.click(within(section('Granja')).getByRole('button', { name: 'Exporter Granja' }));
  await waitFor(() => expect(api.downloadTouristTaxReportCsv).toHaveBeenCalledTimes(1));
  expect(api.downloadTouristTaxReportCsv.mock.calls[0][0]).toMatchObject({ propertyId: '1' });
});

test('rule 58: on a phone each table is a list of rows (tick, name, dates · platform · nuits, amount), with its total', async () => {
  setPhone(true);
  renderTaxPage();
  await screen.findByText('Alice Un');
  expect(screen.queryByRole('table')).toBeNull();
  const row = screen.getByText('Alice Un').closest('[role="button"]');
  expect(row).toHaveTextContent('2 nuits');
  expect(row).toHaveTextContent('4,80 €');
  expect(screen.getByText('Total Estiva').parentElement).toHaveTextContent('9,40 €');
});
