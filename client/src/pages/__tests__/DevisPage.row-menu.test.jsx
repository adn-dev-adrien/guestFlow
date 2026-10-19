// specs/ui-review-2026-10-19-operations.md rules 5-8 — the quotes list: the server's total that never
// wraps, one « ⋯ » menu, the PDF icon visible from md (decision 7), one caption on a phone.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import { setViewport, resetViewport } from '../../components/__tests__/viewportFixture';

const { mockNavigate, mockConfirm } = vi.hoisted(() => ({ mockNavigate: vi.fn(), mockConfirm: vi.fn() }));
vi.mock('react-router', async () => ({
  __esModule: true,
  ...(await vi.importActual('react-router')),
  useNavigate: () => mockNavigate,
}));
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getDevis: vi.fn(), deleteDevis: vi.fn(), convertDevisToReservation: vi.fn(), getDevisPdfBlob: vi.fn() },
}));
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ confirm: mockConfirm, alert: vi.fn() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import api from '../../api';
import DevisPage from '../DevisPage';

const ROW = {
  id: 7, devisNumber: '2026-08-002', status: 'draft', firstName: 'Constance', lastName: 'Gay',
  propertyName: 'Gite', startDate: '2026-09-04', endDate: '2026-09-06',
  finalPrice: 1, touristTaxTotal: 1, totalTtc: 1117.4, originLabel: null,
};

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DevisPage /></ThemeProvider></MemoryRouter>,
);

beforeEach(() => {
  mockNavigate.mockReset();
  mockConfirm.mockReset().mockResolvedValue(false);
  api.getDevis.mockReset().mockResolvedValue([ROW]);
});
afterEach(resetViewport);

test('rule 5 — the amount is the server\'s totalTtc, on one line', async () => {
  setViewport(1280);
  renderPage();
  const amount = await screen.findByText(/1\s?117,40\s?€/);
  expect(getComputedStyle(amount).whiteSpace).toBe('nowrap');
  expect(screen.queryByText(/^2,00\s?€$/)).toBeNull();
});

test('rules 6-7 — from md: a PDF icon then « ⋯ », whose menu lists Modifier, Confirmer, Supprimer… last', async () => {
  setViewport(1280);
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Actions du devis 2026-08-002' }));
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((el) => el.textContent);
  expect(items).toEqual(['Modifier', 'Confirmer en réservation', 'Supprimer…']);
  await user.click(screen.getByRole('menuitem', { name: 'Supprimer…' }));
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(api.deleteDevis).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('rule 7 — on a phone the PDF lives in the menu; a converted quote has no « Confirmer »', async () => {
  setViewport(390);
  api.getDevis.mockResolvedValue([{ ...ROW, status: 'converted', convertedReservationId: 3 }]);
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Actions du devis 2026-08-002' }));
  expect(screen.queryByRole('button', { name: 'Télécharger le PDF' })).toBeNull();
  const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((el) => el.textContent);
  expect(items).toEqual(['Télécharger le PDF', 'Modifier', 'Supprimer…']);
});

test('rule 8 — the phone card reads « Logement · dates » with a real separator', async () => {
  setViewport(390);
  renderPage();
  const caption = await screen.findByText((_, el) => el?.tagName === 'SPAN' && /^Gite · 04\/09\/2026 → 06\/09\/2026$/.test(el.textContent));
  expect(caption).toBeInTheDocument();
});
