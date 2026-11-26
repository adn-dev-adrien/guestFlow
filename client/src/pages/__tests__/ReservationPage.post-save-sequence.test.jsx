// specs/pricing/pricing-components.md §3 rule 94 reading (stabilisation loop t17, S17-1, 2026-11-18 — the sale reviewer's `t17-devis-adopt` probe
// made permanent). Every save that keeps the fiche open runs ONE post-save sequence (`settleSavedFiche`): the clean baseline becomes what
// was saved, THEN the stored ids and labels are adopted on the form and on that baseline. A repeated free label is stored « Bois (2) »: the
// fiche shows it and stays clean, on a stay (the re-read answers the stored lines) and on a devis (the save answers them).
import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

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
  useAppDialogs: () => ({ alert: vi.fn(async () => {}), confirm: vi.fn(async () => true), prompt: vi.fn() }),
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
import { STAY, arrivalField, dayIn, openPage, seedFiche } from './reservationPageHarness';

const echo = (body) => ({
  optionLines: (body.customOptions || []).map((c) => ({ isCustom: 1, customKey: c.customKey, title: c.description, totalPrice: c.amount, originalTotalPrice: c.amount })),
  resourceLines: [], balanceAmount: 210, finalPrice: 300, validUntil: dayIn(15),
});
// The server: a save rewrites the free lines in posted order, numbering a repeated label (rule 94), under new row ids.
const storedOf = (lines) => {
  const seen = new Map();
  return (lines || []).map((c, i) => {
    const k = c.description.toLowerCase();
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    const title = n === 1 ? c.description : `${c.description} (${n})`;
    return { isCustom: 1, customOptionId: 700 + i, title, description: title, quantity: 1, unitPrice: c.amount, totalPrice: c.amount, originalTotalPrice: c.amount, offered: 0, inComplement: 0 };
  });
};

const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: dayIn(42), endDate: dayIn(45), status: 'sent', validUntil: dayIn(15),
  expired: false, extendable: false, adults: 2, platform: 'direct', notes: '', updatedAt: 'v1', options: [], resources: [], customOptions: [],
};
const FICHE = { ...STAY, depositPaid: 1, onlinePayment: { label: 'Qonto' } };

// Every save branch of `saveReservationOnce` that keeps the fiche open and hands it stored lines. (A creation navigates to the stored
// record, which loads its lines: no adoption there.)
const BRANCHES = {
  devis: {
    saveName: 'Enregistrer le devis',
    open: async () => {
      seedFiche(api);
      api.calculatePrice.mockImplementation(async (body) => echo(body));
      api.getDevisById.mockResolvedValue(DEVIS);
      api.updateDevis.mockImplementation(async (_id, body) => ({ ...DEVIS, updatedAt: 'v2', options: storedOf(body.customOptions) }));
      render(
        <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
          <ThemeProvider theme={theme}>
            <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
          </ThemeProvider>
        </MemoryRouter>,
      );
      await screen.findByLabelText(/^Notes/i);
    },
    save: async () => {
      const button = await screen.findByRole('button', { name: 'Enregistrer le devis' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
    },
  },
  stay: {
    saveName: 'Enregistrer',
    open: async () => {
      seedFiche(api, FICHE);
      let stored = [];
      api.calculatePrice.mockImplementation(async (body) => echo(body));
      api.updateReservation.mockImplementation(async (_id, body) => { stored = storedOf(body.customOptions); return { id: STAY.id }; });
      api.getReservation.mockImplementation(async () => ({ ...FICHE, options: stored }));
      api.sendBalanceRequestEmail.mockResolvedValue({ amountCents: 21000, recipientEmail: 'guest@example.test' });
      openPage();
      await arrivalField(FICHE.startDate);
    },
    save: async () => {
      const button = await screen.findByRole('button', { name: 'Envoyer la demande de solde' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(1));
    },
  },
};

const LABELS = {
  'one typed « Bois »': { typed: [['Bois', 15]], shown: ['Bois'] },
  'two typed « Bois »': { typed: [['Bois', 15], ['Bois', 10]], shown: ['Bois', 'Bois (2)'] },
};

async function typeLine(description, amount) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter une ligne' }));
  const fields = await screen.findAllByLabelText('Description');
  const field = fields[fields.length - 1];
  fireEvent.change(field, { target: { value: description } });
  const price = within(field.closest('.MuiCardContent-root')).getByLabelText(/Prix/);
  fireEvent.change(price, { target: { value: String(amount) } });
  fireEvent.blur(price);
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => (b.customOptions || []).some((c) => c.description === description && c.amount === amount))).toBe(true));
}

beforeEach(() => { vi.clearAllMocks(); });

for (const [branch, b] of Object.entries(BRANCHES)) {
  for (const [name, l] of Object.entries(LABELS)) {
    test(`S17-1 — ${branch} × ${name}: after the save the fiche shows the stored labels and is clean`, async () => {
      await b.open();
      for (const [description, amount] of l.typed) await typeLine(description, amount);
      await b.save();
      await waitFor(() => expect(screen.getAllByLabelText('Description').map((f) => f.value)).toEqual(l.shown));
      await new Promise((r) => setTimeout(r, 600));
      expect(screen.getByRole('button', { name: b.saveName })).toBeDisabled();
    });
  }
}
