// specs/establishment-closures.md rule 18, past reading of 2026-11-02 (specs/reservations-backend-mvc.md rule 13) —
// a closure start moved before today − 5 years says « Date trop ancienne : 5 ans au plus. » under its field; the
// dialog neither previews nor saves it. A closure already stored before the window opens without it.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
import { NONE, media } from './establishmentClosuresFixtures';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays } from '../../utils/isoDay';

const TOO_OLD = 'Date trop ancienne : 5 ans au plus.';
const S = horizonStart();
const closureAt = (startDate, endDate) => ({ id: 5, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate, endDate });

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(false);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
  api.getClosureConflicts.mockResolvedValue(NONE);
});
afterEach(() => { window.matchMedia = orig; });

async function openClosure(closure) {
  api.getEstablishmentClosures.mockResolvedValue([closure]);
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  fireEvent.click(await screen.findByText('Travaux'));
  return screen.findByRole('dialog');
}

test('a closure starting on today − 5 years is previewed; moved a year earlier it is refused under the field, not previewed nor saved', async () => {
  const dialog = await openClosure(closureAt(S, addIsoDays(S, 30)));
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalledWith({ propertyId: 1, startDate: S, endDate: addIsoDays(S, 30) }));
  expect(within(dialog).queryByText(TOO_OLD)).toBeNull();
  const year = within(within(dialog).getByRole('group', { name: 'Début de fermeture' })).getByRole('spinbutton', { name: 'Année' });
  act(() => year.focus());
  fireEvent.keyDown(year, { key: 'ArrowDown' });
  expect(await within(dialog).findByText(TOO_OLD)).toBeInTheDocument();
  // The start picker keeps its calendar open after the keystroke, so the dialog's buttons are read hidden.
  expect(within(dialog).getByRole('button', { name: 'Enregistrer', hidden: true })).toBeDisabled();
  expect(api.getClosureConflicts).toHaveBeenCalledTimes(1);
  expect(api.updateEstablishmentClosure).not.toHaveBeenCalled();
});

test('a closure stored before the window opens without the message and can still be saved', async () => {
  const dialog = await openClosure(closureAt(addIsoDays(S, -40), addIsoDays(S, -10)));
  expect(within(dialog).queryByText(TOO_OLD)).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  expect(api.getClosureConflicts).not.toHaveBeenCalled();
});
