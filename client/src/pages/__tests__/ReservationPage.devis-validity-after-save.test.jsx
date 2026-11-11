// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 7 reading R32-RES-M1 (2026-11-09, audit R32-C-L1) — the devis fiche's
// « Valide jusqu'au » chip follows the validity the server resolves: the live quote's while the edit is unsaved, the
// PUT's once saved. It used to keep the date read at load until a reload, also « Périmé · prolonger » on a quote the
// save had just re-issued.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';
import { displayDate } from '../../utils/formatters';

vi.setConfig({ testTimeout: 30000 });

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
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }),
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

const TODAY = localIsoToday();
const D = (n) => addIsoDays(TODAY, n);
const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: D(42), endDate: D(45), status: 'sent', validUntil: D(15),
  expired: false, extendable: false, adults: 2, platform: 'direct', notes: '', updatedAt: 'v1',
  options: [], resources: [], customOptions: [],
};
const chip = (iso) => `Valide jusqu'au ${displayDate(iso)}`;

async function openDevis(devis, liveValidUntil) {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], validUntil: liveValidUntil });
  api.getDevisById.mockResolvedValue(devis);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByLabelText(/^Notes/i);
}

async function save() {
  fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
}

beforeEach(() => { vi.clearAllMocks(); });

test('R32-C-L1 — the chip shows the live quote\'s date before the save, and the PUT\'s after it', async () => {
  await openDevis(DEVIS, D(8));
  expect(await screen.findByText(chip(D(8)))).toBeInTheDocument();
  api.updateDevis.mockResolvedValue({ ...DEVIS, validUntil: D(8) });
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  await save();
  expect(await screen.findByText(chip(D(8)))).toBeInTheDocument();
  expect(screen.queryByText(chip(D(15)))).not.toBeInTheDocument();
});

test('R32-C-L1 — an expired quote the save re-issued drops « Périmé · prolonger » and is re-read', async () => {
  await openDevis({ ...DEVIS, validUntil: D(-3), expired: true, extendable: true }, D(15));
  expect(await screen.findByText('Périmé · prolonger')).toBeInTheDocument();
  expect(api.getDevisById).toHaveBeenCalledTimes(1);
  const reissued = { ...DEVIS, validUntil: D(15), expired: false, extendable: false };
  api.updateDevis.mockResolvedValue(reissued);
  api.getDevisById.mockResolvedValue(reissued);
  await save();
  expect(await screen.findByText(chip(D(15)))).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Périmé · prolonger')).not.toBeInTheDocument());
  await waitFor(() => expect(api.getDevisById).toHaveBeenCalledTimes(2));
});
