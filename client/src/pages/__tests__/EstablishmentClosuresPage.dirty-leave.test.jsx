// specs/payment-link-lifecycle.md rules 40, 41 and 49 (reading of 2026-11-01, review of #917) — on a phone « Ouvrir »
// in the closure dialog opens the stay in place: a closure being typed asks before it is left (« Rester sur la page »
// keeps it, « Quitter sans enregistrer » opens the stay, « Enregistrer et quitter » saves then opens it); an unchanged
// dialog leaves at once.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEstablishmentClosures: vi.fn(),
    getProperties: vi.fn(),
    getClosureConflicts: vi.fn(),
    updateEstablishmentClosure: vi.fn(),
    createEstablishmentClosure: vi.fn(),
  },
}));

import api from '../../api';
import EstablishmentClosuresPage from '../EstablishmentClosuresPage';
import { CLOSURE, NONE, media } from './establishmentClosuresFixtures';

const RESA = { id: 7, label: '22341 · Cy Test', detail: 'Gîte', url: '/reservations/7' };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(true);
  api.getEstablishmentClosures.mockResolvedValue([CLOSURE]);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
  api.getClosureConflicts.mockResolvedValue({ ...NONE, reservations: [RESA] });
  api.updateEstablishmentClosure.mockResolvedValue({});
});
afterEach(() => { window.matchMedia = orig; delete window.__guestflowBeforeNavigate; });

async function openClosure({ edit } = {}) {
  render(
    <MemoryRouter initialEntries={['/fermetures']}>
      <DialogProvider>
        <Where />
        <Routes>
          <Route path="/fermetures" element={<EstablishmentClosuresPage />} />
          <Route path="/reservations/:id" element={<div>stay page</div>} />
        </Routes>
      </DialogProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText('Travaux'));
  const dialog = await screen.findByRole('dialog');
  if (edit) fireEvent.change(within(dialog).getByLabelText('Libellé'), { target: { value: edit } });
  return dialog;
}

const ouvrir = (dialog) => within(dialog).findByRole('link', { name: `Ouvrir : ${RESA.label}` });

test('phone: « Ouvrir » on a typed closure asks first; « Rester sur la page » keeps it', async () => {
  const dialog = await openClosure({ edit: 'Travaux toiture' });
  fireEvent.click(await ouvrir(dialog));
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(screen.getByTestId('where').textContent).toBe('/fermetures');
  fireEvent.click(screen.getByRole('button', { name: 'Rester sur la page' }));
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  expect(within(screen.getByRole('dialog')).getByLabelText('Libellé')).toHaveValue('Travaux toiture');
  expect(screen.getByTestId('where').textContent).toBe('/fermetures');
});

test('phone: « Quitter sans enregistrer » opens the stay, nothing saved', async () => {
  const dialog = await openClosure({ edit: 'Travaux toiture' });
  fireEvent.click(await ouvrir(dialog));
  fireEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/reservations/7'));
  expect(api.updateEstablishmentClosure).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('phone: « Enregistrer et quitter » saves the closure, then opens the stay', async () => {
  const dialog = await openClosure({ edit: 'Travaux toiture' });
  fireEvent.click(await ouvrir(dialog));
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/reservations/7'));
  expect(api.updateEstablishmentClosure).toHaveBeenCalledWith(CLOSURE.id, expect.objectContaining({ label: 'Travaux toiture' }));
});

test('phone: « Enregistrer et quitter » refused keeps the dialog and its refusal', async () => {
  api.updateEstablishmentClosure.mockRejectedValue(Object.assign(new Error('x'), {
    code: 'RESERVATION_OVERLAP', error: 'Réservation sur ces dates : fermeture impossible.', reservations: [RESA],
  }));
  const dialog = await openClosure({ edit: 'Travaux toiture' });
  fireEvent.click(await ouvrir(dialog));
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
  await waitFor(() => expect(api.updateEstablishmentClosure).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  expect(screen.getByTestId('where').textContent).toBe('/fermetures');
  expect(within(screen.getByRole('dialog')).getByLabelText('Libellé')).toHaveValue('Travaux toiture');
});

test('phone: an unchanged closure leaves at once', async () => {
  const dialog = await openClosure();
  fireEvent.click(await ouvrir(dialog));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/reservations/7'));
  expect(screen.queryByText('Modifications non enregistrées')).toBeNull();
});
