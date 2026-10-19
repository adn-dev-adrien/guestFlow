// specs/ui-review-2026-10-19-operations.md rules 23-24 and 26 — the quotes list opens from the keyboard (the
// number is a link), and the reservation page's mini planning names its two arrows.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import { setViewport, resetViewport } from '../../components/__tests__/viewportFixture';
import { valueUnder } from '../../components/__tests__/mediaRulesFixture';
import MiniPlanningStrip from '../../components/MiniPlanningStrip';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getDevis: vi.fn(), deleteDevis: vi.fn(), convertDevisToReservation: vi.fn(), getDevisPdfBlob: vi.fn() },
}));
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ confirm: vi.fn(), alert: vi.fn() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import api from '../../api';
import DevisPage from '../DevisPage';

const ROWS = [
  { id: 7, devisNumber: '2026-08-002', status: 'draft', firstName: 'Constance', lastName: 'Gay', propertyName: 'Gite', startDate: '2026-09-04', endDate: '2026-09-06', totalTtc: 1117.4 },
  { id: 8, devisNumber: '2026-08-003', status: 'converted', convertedReservationId: 41, firstName: 'Léa', lastName: 'Roux', propertyName: 'Gite', startDate: '2026-10-04', endDate: '2026-10-06', totalTtc: 500 },
];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/devis']}>
    <ThemeProvider theme={theme}>
      <Routes>
        <Route path="/devis" element={<DevisPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </ThemeProvider>
  </MemoryRouter>,
);

beforeEach(() => { api.getDevis.mockReset().mockResolvedValue(ROWS); });
afterEach(resetViewport);

test.each([1280, 390])('rule 23: at %i px the quote number is a link Entrée opens', async (width) => {
  setViewport(width);
  const user = userEvent.setup();
  renderPage();
  const link = await screen.findByRole('link', { name: 'Ouvrir le devis 2026-08-002' });
  expect(link).toHaveAttribute('href', '/reservations/new?mode=devis&devisId=7');
  link.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByTestId('where')).toHaveTextContent('/reservations/new?mode=devis&devisId=7');
});

test('rule 26: on a phone the quote-number link is a 44 px touch target', async () => {
  setViewport(390);
  renderPage();
  const link = await screen.findByRole('link', { name: 'Ouvrir le devis 2026-08-002' });
  expect(valueUnder(link, 'min-height', 'min-width:0px')).toBe('44px');
});

test('rule 23: a converted quote links to its reservation', async () => {
  setViewport(1280);
  renderPage();
  expect(await screen.findByRole('link', { name: 'Ouvrir le devis 2026-08-003' })).toHaveAttribute('href', '/reservations/41');
});

test('rule 24: the mini planning arrows say which way they move', async () => {
  const user = userEvent.setup();
  const setStart = vi.fn();
  render(<ThemeProvider theme={theme}><MiniPlanningStrip miniCalendarStart="2026-10-19" setMiniCalendarStart={setStart} /></ThemeProvider>);
  await user.click(screen.getByRole('button', { name: 'Jour précédent' }));
  expect(setStart).toHaveBeenLastCalledWith('2026-10-18');
  await user.click(screen.getByRole('button', { name: 'Jour suivant' }));
  expect(setStart).toHaveBeenLastCalledWith('2026-10-20');
});
