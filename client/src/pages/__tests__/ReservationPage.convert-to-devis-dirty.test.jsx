// specs/payment-link-lifecycle.md rule 46, reading of 2026-11-01 (audit R12-C1: show before refusing) — the devis
// « Transformer en devis » creates is built from the stored stay, not from the typed values: while the fiche holds
// unsaved changes the action is disabled with « Enregistrer d'abord les modifications. » (the tooltip on a wider
// screen, the reason beneath the item in the phone's « Plus d'actions » menu), nothing is sent and the fiche stays.
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
  api.createDevisFromReservation.mockReset().mockResolvedValue({ id: 900 });
  dialogs.alert.mockReset().mockResolvedValue(undefined);
  dialogs.confirm.mockReset().mockResolvedValue(true);
});

test('a dirty fiche disables the action with the reason: no confirm, no devis, the fiche stays', async () => {
  openFiche();
  await screen.findByRole('button', { name: 'Transformer en devis' });
  await typeNote('typed draft');
  const button = await screen.findByRole('button', { name: `Transformer en devis : ${REASON}` });
  expect(button).toBeDisabled();
  fireEvent.mouseOver(button.parentElement);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  fireEvent.click(button);
  expect(dialogs.confirm).not.toHaveBeenCalled();
  expect(api.createDevisFromReservation).not.toHaveBeenCalled();
  expect(screen.getByTestId('where')).toHaveTextContent('/reservations/41');
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed draft');
});

test('undoing the typed change gives the action back', async () => {
  openFiche();
  await screen.findByRole('button', { name: 'Transformer en devis' });
  await typeNote('typed draft');
  await screen.findByRole('button', { name: `Transformer en devis : ${REASON}` });
  await typeNote('');
  const button = await screen.findByRole('button', { name: 'Transformer en devis' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/reservations/new?mode=devis&devisId=900'));
});

test('the stay\'s own lock outranks the unsaved changes: saving would not lift it', async () => {
  const locked = 'Séjour déjà payé : devis non créé.';
  openFiche({ ...FICHE, convertToDevisLockedReason: locked });
  await screen.findByRole('button', { name: `Transformer en devis : ${locked}` });
  await typeNote('typed draft');
  expect(screen.getByRole('button', { name: `Transformer en devis : ${locked}` })).toBeDisabled();
});

test('phone: the « Plus d\'actions » item prints the reason beneath, disabled', async () => {
  const saved = window.matchMedia;
  window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    openFiche();
    await typeNote('typed draft');
    fireEvent.click(await screen.findByRole('button', { name: "Plus d'actions" }));
    const item = (await screen.findAllByRole('menuitem')).find((el) => el.textContent.includes('Transformer en devis'));
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).getByText(REASON)).toBeInTheDocument();
    fireEvent.click(item);
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(api.createDevisFromReservation).not.toHaveBeenCalled();
  } finally { window.matchMedia = saved; }
});
