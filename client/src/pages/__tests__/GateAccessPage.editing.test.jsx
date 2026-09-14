// specs/gate-access-portier.md §3.4 — creating and editing an access, with the refusals shown while typing
// (specs/guest-gate-access-maquettes.html) and Portier's own refusal when it still says no.
import { vi, beforeEach, test, expect } from 'vitest';
import React from 'react';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPortierAccesses: vi.fn(),
    portierAccessAction: vi.fn(),
    deletePortierAccess: vi.fn(),
    getPortierAccessEvents: vi.fn(),
    getPortierBranding: vi.fn(),
    setPortierBrandingSource: vi.fn(),
    createPortierAccess: vi.fn(),
    updatePortierAccess: vi.fn(),
  },
}));

import api from '../../api';
import { LIST, STAY, renderGateAccessPage } from './gateAccessPageFixtures';
import { GATE_ACCESS_MESSAGES } from '../../utils/gateAccessValidation';

beforeEach(() => {
  vi.clearAllMocks();
  api.getPortierAccesses.mockResolvedValue(LIST);
});

const setValue = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

test('creation refuses while typing: no name, an end before the start, two overlapping windows', async () => {
  const user = userEvent.setup();
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(screen.getByRole('button', { name: 'Nouvel accès' }));

  const create = screen.getByRole('button', { name: "Créer l'accès" });
  expect(screen.getByText(GATE_ACCESS_MESSAGES.labelRequired)).toBeInTheDocument();
  expect(create).toBeDisabled();

  await user.type(screen.getByLabelText('Pour qui'), 'Les Martin (cousins)');
  expect(screen.queryByText(GATE_ACCESS_MESSAGES.labelRequired)).not.toBeInTheDocument();
  expect(create).toBeEnabled();

  await user.click(screen.getByLabelText('Sur une plage de dates'));
  expect(screen.getByText(GATE_ACCESS_MESSAGES.rangeMissing)).toBeInTheDocument();
  setValue('Du — date', '2026-09-27');
  setValue('Au — date', '2026-09-20');
  expect(screen.getByText(GATE_ACCESS_MESSAGES.rangeOrder)).toBeInTheDocument();
  expect(create).toBeDisabled();
  setValue('Au — date', '2026-09-28');
  expect(screen.queryByText(GATE_ACCESS_MESSAGES.rangeOrder)).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Ajouter une plage' }));
  await user.click(screen.getByRole('button', { name: 'Ajouter une plage' }));
  expect(screen.getByText(GATE_ACCESS_MESSAGES.windowsOverlap)).toBeInTheDocument();
  expect(create).toBeDisabled();
  setValue('Plage 2 — début', '20:00');
  setValue('Plage 2 — fin', '22:00');
  expect(create).toBeEnabled();
});

test('creation sends the name, the wall-clock range and the windows', async () => {
  const user = userEvent.setup();
  api.createPortierAccess.mockResolvedValue({ access: {} });
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(screen.getByRole('button', { name: 'Nouvel accès' }));
  await user.type(screen.getByLabelText('Pour qui'), 'Paul (voisin)');
  await user.click(screen.getByRole('button', { name: 'Ajouter une plage' }));
  await user.click(screen.getByRole('button', { name: "Créer l'accès" }));

  await waitFor(() => expect(api.createPortierAccess).toHaveBeenCalledWith({
    label: 'Paul (voisin)', validFrom: null, validUntil: null, timeWindows: [{ from: '08:00', until: '20:00' }],
  }));
  await waitFor(() => expect(screen.queryByRole('button', { name: "Créer l'accès" })).not.toBeInTheDocument());
});

test('a stay access: « Prolonger jusqu’au » before the end of the stay is refused while typing', async () => {
  const user = userEvent.setup();
  api.updatePortierAccess.mockResolvedValue({ access: STAY });
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(within(screen.getByText(STAY.label).closest('tr')).getByRole('button', { name: 'Modifier' }));

  expect(screen.getByText(/Séjour : du 12\/09 à 16:00 au 14\/09 à 11:00/)).toBeInTheDocument();
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  setValue("Prolonger jusqu'au (facultatif) — date", '2026-09-14');
  setValue("Prolonger jusqu'au (facultatif) — heure", '10:00');
  expect(screen.getByText(GATE_ACCESS_MESSAGES.extendNotAfter)).toBeInTheDocument();
  expect(save).toBeDisabled();

  setValue("Prolonger jusqu'au (facultatif) — date", '2026-09-15');
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => expect(api.updatePortierAccess).toHaveBeenCalledWith(STAY.id, {
    earlyFrom: '', extendedUntil: '2026-09-15T10:00', timeWindows: [],
  }));
});

test('a date alone takes 11:00, as in the maquette', async () => {
  const user = userEvent.setup();
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(within(screen.getByText(STAY.label).closest('tr')).getByRole('button', { name: 'Modifier' }));
  setValue('Ouvrir dès (facultatif) — date', '2026-09-12');
  expect(screen.getByLabelText('Ouvrir dès (facultatif) — heure')).toHaveValue('11:00');
});

test('Portier still refuses (422): its sentence is shown in the editor', async () => {
  const user = userEvent.setup();
  api.updatePortierAccess.mockRejectedValue(Object.assign(new Error("Une ouverture anticipée doit précéder l'arrivée."), { status: 422 }));
  renderGateAccessPage();
  await screen.findByText(STAY.label);
  await user.click(within(screen.getByText(STAY.label).closest('tr')).getByRole('button', { name: 'Modifier' }));
  setValue('Ouvrir dès (facultatif) — date', '2026-09-11');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText("Une ouverture anticipée doit précéder l'arrivée.")).toBeInTheDocument();
});
