// specs/resource-booking-client-picker.md rules 1, 2, 6-9 — the « Client enregistré » list of a resource
// session: the server's groups in the server's order, a search on every typed word without accents, the
// empty answer, a new session day asking again, and an edited session keeping its client.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClientPicker: vi.fn(),
    getProperties: vi.fn().mockResolvedValue([]),
    previewResourceBooking: vi.fn().mockResolvedValue(null),
  },
}));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00',
  slotDuration: 30, minimumUsageMinutes: 60,
};

const option = (id, firstName, lastName, groupLabel, detail, searchText) => ({
  id, firstName, lastName, group: 'x', groupLabel, detail, searchText,
});
const OPTIONS = [
  option(1, 'Jean', 'Dupont', 'En séjour ou bientôt', 'La Granja · 10/11 → 14/11/2026', 'jean dupont jean@exemple.fr la granja'),
  option(2, 'Élodie', 'Marchand', 'En séjour ou bientôt', "L'Estiva · 15/11 → 17/11/2026", "elodie marchand l'estiva"),
  option(3, 'Hugo', 'Perrin', 'À venir', "L'Estiva · 24/04 → 28/04/2027", "hugo perrin l'estiva"),
  option(4, 'Paul', 'André', 'Passés', 'La Granja · 02/11 → 06/11/2026', 'paul andre la granja'),
];

beforeEach(() => {
  api.getClientPicker.mockReset();
  api.getClientPicker.mockResolvedValue({ referenceDay: '2099-02-13', options: OPTIONS });
});

function mount(props = {}) {
  render(
    <ResourceBookingDialog
      open resource={RESOURCE} booking={null} initialDate="2099-02-13"
      onClose={() => {}} onSave={vi.fn().mockResolvedValue({})} onDelete={() => {}} {...props}
    />,
  );
}

async function openPicker() {
  const registered = screen.getByRole('switch', { name: 'Client enregistré' });
  if (!registered.checked) fireEvent.click(registered);
  await waitFor(() => expect(api.getClientPicker).toHaveBeenCalled());
  const input = screen.getByRole('combobox', { name: 'Client *' });
  // Typing happens in a focused field: without focus MUI resets the text on the next render.
  input.focus();
  fireEvent.mouseDown(input);
  await screen.findByRole('listbox');
  return input;
}

const shownNames = () => within(screen.getByRole('listbox')).getAllByRole('option')
  .map((o) => o.textContent);

test('rules 1, 3 — the options come in the server order under their group headers, with their line', async () => {
  mount();
  await openPicker();
  expect(api.getClientPicker).toHaveBeenLastCalledWith('2099-02-13');
  const list = screen.getByRole('listbox');
  expect(within(list).getByText('En séjour ou bientôt · 2')).toBeInTheDocument();
  expect(within(list).getByText('À venir · 1')).toBeInTheDocument();
  expect(within(list).getByText('Passés · 1')).toBeInTheDocument();
  expect(shownNames()).toEqual([
    'Jean DupontLa Granja · 10/11 → 14/11/2026',
    "Élodie MarchandL'Estiva · 15/11 → 17/11/2026",
    "Hugo PerrinL'Estiva · 24/04 → 28/04/2027",
    'Paul AndréLa Granja · 02/11 → 06/11/2026',
  ]);
});

test('rules 6, 7 — every typed word must match, in any order, accents ignored; empty groups vanish', async () => {
  mount();
  const input = await openPicker();

  fireEvent.change(input, { target: { value: 'dupont jéan' } });
  expect(shownNames()).toEqual(['Jean DupontLa Granja · 10/11 → 14/11/2026']);

  fireEvent.change(input, { target: { value: 'ÉLODIE' } });
  expect(shownNames()).toEqual(["Élodie MarchandL'Estiva · 15/11 → 17/11/2026"]);

  fireEvent.change(input, { target: { value: 'granja' } });
  expect(shownNames().map((n) => n.split('La Granja')[0])).toEqual(['Jean Dupont', 'Paul André']);
  expect(within(screen.getByRole('listbox')).queryByText(/^À venir/)).toBeNull();
});

test('rule 8 — no match says so', async () => {
  mount();
  const input = await openPicker();
  fireEvent.change(input, { target: { value: 'zzz' } });
  expect(await screen.findByText('Aucun client trouvé')).toBeInTheDocument();
});

test('rule 2 — another session day asks the server again with that day', async () => {
  mount();
  await waitFor(() => expect(api.getClientPicker).toHaveBeenCalledWith('2099-02-13'));
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-03-01' } });
  await waitFor(() => expect(api.getClientPicker).toHaveBeenLastCalledWith('2099-03-01'));
});

test('rule 9 — an edited session opens with its client selected, even a past one', async () => {
  mount({
    booking: { id: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', clientId: 4, firstName: 'Paul', lastName: 'André', notes: '' },
  });
  await waitFor(() => expect(api.getClientPicker).toHaveBeenCalledWith('2099-02-13'));
  expect(screen.getByRole('combobox', { name: 'Client *' })).toHaveValue('Paul André');
});
