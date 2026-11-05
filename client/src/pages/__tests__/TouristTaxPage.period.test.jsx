// specs/tourist-tax-report-v2.md §3 rules 17, 19 and 25 — the page reads the report for the selection on screen: the
// period (Mois · Trimestre · Année · Personnalisée, options from the server), the logement and the declaration
// status go to the server as they are; a custom window is judged here with the server's own message and day; a
// selection the server refuses keeps the last result on screen and says why.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { reportOf, renderTaxPage } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), getToday: vi.fn() },
}));

import api from '../../api';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 1, nightsCount: 2, taxAmount: 4.8 };

beforeEach(() => {
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW]));
  api.getToday.mockReset().mockResolvedValue({ today: '2026-07-05' }); // date-literal-ok: the server's day, mocked
});

const lastQuery = () => api.getTouristTaxReport.mock.calls.at(-1)[0];
const pick = async (label, option) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

test('rule 17: the page opens on the previous month, as a month', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  const first = api.getTouristTaxReport.mock.calls[0][0];
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  expect(first).toEqual({ period: 'month', month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, propertyId: '', declaration: '' });
  expect(screen.getByRole('button', { name: 'Mois' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Séjours · juin 2026/)).toBeInTheDocument();
});

test('rule 17: a quarter and a year are picked from the server options', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
  await waitFor(() => expect(lastQuery()).toEqual({ period: 'quarter', quarter: '2026-Q3', propertyId: '', declaration: '' }));
  await screen.findByText('Jean Dupont');
  await pick('Trimestre', 'T2 2026 (avr.–juin)');
  await waitFor(() => expect(lastQuery()).toMatchObject({ period: 'quarter', quarter: '2026-Q2' }));
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Année' }));
  await waitFor(() => expect(lastQuery()).toEqual({ period: 'year', year: '2026', propertyId: '', declaration: '' }));
});

test('rule 25: the logement and the declaration status go to the server', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  await pick('Logement', 'Estiva');
  await waitFor(() => expect(lastQuery()).toMatchObject({ propertyId: '2' }));
  await screen.findByText('Jean Dupont');
  await pick('Déclaration', 'À déclarer');
  await waitFor(() => expect(lastQuery()).toMatchObject({ propertyId: '2', declaration: 'todo' }));
});

test('rule 19: a custom window opens on the window shown; a reversed one is refused here and nothing is read', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Personnalisée' }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ period: 'custom', from: '2026-06-01', to: '2026-06-30' }));
  await screen.findByText('Jean Dupont');
  const calls = api.getTouristTaxReport.mock.calls.length;
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-05-01' } });
  expect(await screen.findByText('La date de début doit précéder la date de fin.')).toBeInTheDocument();
  expect(api.getTouristTaxReport.mock.calls.length).toBe(calls);
  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
});

test('rule 19: the custom window is judged from the server day, not the device one', async () => {
  api.getToday.mockResolvedValue({ today: '2040-01-10' });
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Personnalisée' }));
  await screen.findByText('Jean Dupont');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2044-06-01' } });
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2044-06-30' } });
  await waitFor(() => expect(lastQuery()).toMatchObject({ period: 'custom', from: '2044-06-01', to: '2044-06-30' }));
  expect(screen.queryByText(/Date trop lointaine/)).toBeNull();
});

test('rule 19: a selection the server refuses keeps the last result and says why', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  api.getTouristTaxReport.mockRejectedValueOnce(Object.assign(new Error('Les mois futurs ne sont pas autorisés.'), { status: 400 }));
  await pick('Mois', 'juillet 2026');
  expect(await screen.findByRole('alert')).toHaveTextContent('Les mois futurs ne sont pas autorisés.');
  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  expect(within(screen.getByTestId('sticky-totals-bar')).getByText('4,80 €')).toBeInTheDocument();
});

test('a first read that fails offers a retry', async () => {
  api.getTouristTaxReport.mockRejectedValueOnce(new Error('Connexion au serveur impossible.'));
  renderTaxPage();
  expect(await screen.findByText("Impossible de charger l'extraction.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
});
