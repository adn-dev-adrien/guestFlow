/**
 * specs/booking-pace.md — the « Réservations à venir, à date » card renders the server's sentence, its
 * notice and pickup, switches metric through the API, and its tooltip / écart read like the mock-up.
 * Recharts draws nothing in jsdom, so the tooltip and the écart helper are rendered directly.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinancePace: vi.fn(), getFinancePaceMonth: vi.fn() },
}));

import api from '../../api';
import BookingPaceCard, { paceFormatters } from '../BookingPaceCard';
import { PaceTooltip, deltaText } from '../PaceMonthChart';

const month = (o) => ({
  month: '2026-10', label: 'octobre 2026', lastYearLabel: 'octobre 2025', tick: 'oct.',
  current: 3, sameTimeLastYear: 2, lastYearFinal: 4, comparable: true, delta: 1, deltaPct: 0.5,
  remaining: 1, reachedPct: 0.75, tone: 'success', ...o,
});

const payload = (o = {}) => ({
  asOf: '2026-09-30', metric: 'reservations', paceStart: '2024-09-02', comparableFrom: '2025-09-02',
  summary: {
    text: "Au 30 sept., 3 réservations pour les 12 prochains mois, contre 2 l'an dernier à la même date (+1).",
    change: 50, notice: null,
  },
  pickup: { last7: { current: 1, lastYear: 0 }, last30: { current: 2, lastYear: 3 } },
  months: [month()],
  ...o,
});

beforeEach(() => { vi.clearAllMocks(); });

test('rule 11 — the sentence, its badge and the pickup chips come from the server', async () => {
  api.getFinancePace.mockResolvedValue(payload());
  render(<BookingPaceCard propertyId="" refreshKey={0} />);
  expect(await screen.findByText(/contre 2 l'an dernier à la même date \(\+1\)/)).toBeInTheDocument();
  expect(screen.getByText('▲ +50 % vs N-1')).toBeInTheDocument();
  expect(screen.getByText('+1 réservation')).toBeInTheDocument();
  expect(screen.getByText(/l'an dernier \+3 réservations/)).toBeInTheDocument();
  expect(api.getFinancePace).toHaveBeenCalledWith({ propertyId: '', metric: 'reservations' });
});

test('rule 10 — before a year of history the notice replaces the badge', async () => {
  api.getFinancePace.mockResolvedValue(payload({
    summary: { text: 'Au 30 sept., 3 réservations pour les 12 prochains mois.', change: null, notice: "La comparaison à date s'affichera à partir du 13 avril 2027 : il faut un an de dates de réservation." },
    pickup: { last7: { current: 1, lastYear: null }, last30: { current: 2, lastYear: null } },
  }));
  render(<BookingPaceCard propertyId="2" refreshKey={0} />);
  expect(await screen.findByText(/à partir du 13 avril 2027/)).toBeInTheDocument();
  expect(screen.queryByText(/vs N-1/)).not.toBeInTheDocument();
  expect(screen.queryByText(/l'an dernier \+/)).not.toBeInTheDocument();
});

test('the metric toggle asks the server again', async () => {
  api.getFinancePace.mockResolvedValue(payload());
  render(<BookingPaceCard propertyId="" refreshKey={0} />);
  await screen.findByText(/contre 2 l'an dernier/);
  await userEvent.click(screen.getByRole('button', { name: 'Nuits' }));
  await waitFor(() => expect(api.getFinancePace).toHaveBeenLastCalledWith({ propertyId: '', metric: 'nights' }));
  expect(screen.getByText('Chaque nuit compte dans le mois où elle tombe.')).toBeInTheDocument();
});

test('a failed load shows an error with retry', async () => {
  api.getFinancePace.mockRejectedValue({ error: 'Mesure inconnue.' });
  render(<BookingPaceCard propertyId="" refreshKey={0} />);
  expect(await screen.findByText('Mesure inconnue.')).toBeInTheDocument();
});

test('rules 5-7 — the tooltip gives this year, last year at date and final, and the part reached', () => {
  const { formatValue } = paceFormatters('nights');
  render(<PaceTooltip active payload={[{ payload: month({ current: 18, sameTimeLastYear: 14, lastYearFinal: 21, remaining: 3, reachedPct: 0.857 }) }]} formatValue={formatValue} />);
  expect(screen.getByText('Octobre 2026')).toBeInTheDocument();
  expect(screen.getByText('À date : 18 nuits')).toBeInTheDocument();
  expect(screen.getByText('Octobre 2025 à la même date : 14 nuits')).toBeInTheDocument();
  expect(screen.getByText('Octobre 2025 au final : 21 nuits')).toBeInTheDocument();
  expect(screen.getByText("Déjà 86 % du final de l'an dernier · reste 3 nuits")).toBeInTheDocument();
});

test('rule 9 — a month without last year at date reads « inconnu » and « — », never 0', () => {
  const { formatValue, formatShort } = paceFormatters('reservations');
  const m = month({ sameTimeLastYear: null, comparable: false, delta: null, deltaPct: null, lastYearFinal: null, reachedPct: null, remaining: null });
  render(<PaceTooltip active payload={[{ payload: m }]} formatValue={formatValue} />);
  expect(screen.getByText('Octobre 2025 à la même date : inconnu')).toBeInTheDocument();
  expect(screen.queryByText(/au final/)).not.toBeInTheDocument();
  expect(deltaText(m, formatShort)).toBe('—');
  expect(deltaText(month({ delta: -1250 }), paceFormatters('revenue').formatShort)).toBe('▼ −1,3 k');
});
