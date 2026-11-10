// specs/payment-schedule-and-cancellation.md §6 (audit R44-C-L2) — « Annuler le séjour » and « Supprimer » on a fiche
// holding unsaved changes: the cancel replaced the fiche and lost the typed edits, or the leave guard then offered
// « Enregistrer et quitter » on a stay that was cancelled (409) or deleted (500). Both are held with « Enregistrer
// d'abord les modifications. », focusable and inert, as « Transformer en devis » (#918); a clean fiche offers them.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const REASON = "Enregistrer d'abord les modifications.";
// date-literal-ok: a far-future stay, so no date rule of the fiche ever locks it
const FICHE = {
  id: 41, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '209900041', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], ledger: { rows: [], closing: null, remaining: 0 },
};

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname}{location.search}</span>;
}

function openFiche(fiche = FICHE) {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(fiche);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/41']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/reservations/:reservationId" element={<><ReservationPage /><Where /></>} />
          <Route path="/reservations/new" element={<Where />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function typeNote(value) {
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value } });
}

beforeEach(() => {
  api.cancelReservation.mockReset().mockResolvedValue({ ok: true, indemnityAmount: 0 });
  api.deleteReservation.mockReset().mockResolvedValue({});
  api.getCancellationPreview.mockReset().mockResolvedValue({ cancellationReason: 'manual', retainedDepositAmount: 0, indemnityAmount: 0, writtenOffBalance: 0 });
  dialogs.alert.mockReset().mockResolvedValue(undefined);
  dialogs.confirm.mockReset().mockResolvedValue(true);
});

function expectFocusableAndInert(button) {
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(button).toHaveFocus();
}

for (const action of ['Annuler le séjour', 'Supprimer']) {
  test(`a dirty fiche holds « ${action} » with the reason: focusable, nothing opened, nothing sent, the edit kept`, async () => {
    openFiche();
    await screen.findByRole('button', { name: action });
    await typeNote('typed draft');
    const button = await screen.findByRole('button', { name: `${action} : ${REASON}` });
    fireEvent.mouseOver(button.parentElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
    expectFocusableAndInert(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(api.cancelReservation).not.toHaveBeenCalled();
    expect(api.deleteReservation).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/reservations/41');
    expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed draft');
  });
}

test('undoing the typed change gives « Annuler le séjour » back', async () => {
  openFiche();
  await screen.findByRole('button', { name: 'Annuler le séjour' });
  await typeNote('typed draft');
  await screen.findByRole('button', { name: `Annuler le séjour : ${REASON}` });
  await typeNote('');
  const button = await screen.findByRole('button', { name: 'Annuler le séjour' });
  expect(button).not.toHaveAttribute('aria-disabled');
  fireEvent.click(button);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('phone: the « Plus d\'actions » items print the reason beneath, disabled', async () => {
  const saved = window.matchMedia;
  window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    openFiche();
    await typeNote('typed draft');
    fireEvent.click(await screen.findByRole('button', { name: "Plus d'actions" }));
    const items = await screen.findAllByRole('menuitem');
    for (const action of ['Annuler le séjour', 'Supprimer']) {
      const item = items.find((el) => el.textContent.startsWith(action));
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(within(item).getByText(REASON)).toBeInTheDocument();
    }
    expect(api.deleteReservation).not.toHaveBeenCalled();
  } finally { window.matchMedia = saved; }
});
