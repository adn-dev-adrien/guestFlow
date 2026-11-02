// specs/establishment-closures.md rule 18, reading of 2026-11-02 (specs/reservations-backend-mvc.md rule 13) — a
// closure date moved past today + 5 years says « Date trop lointaine : 5 ans au plus. » under its field; the dialog
// neither previews nor saves it. A closure already stored past the horizon (a tariff recipe's) opens without it.
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
import { horizonEnd } from '../../utils/dateHorizon';
import { addIsoDays } from '../../utils/isoDay';

const TOO_FAR = 'Date trop lointaine : 5 ans au plus.';
const H = horizonEnd();
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

test('a reopening on the horizon is previewed; moved a year later it is refused under the field, not previewed nor saved', async () => {
  const dialog = await openClosure(closureAt(addIsoDays(H, -30), H));
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalledWith({ propertyId: 1, startDate: addIsoDays(H, -30), endDate: H }));
  expect(within(dialog).queryByText(TOO_FAR)).toBeNull();
  const year = within(within(dialog).getByRole('group', { name: 'Réouverture' })).getByRole('spinbutton', { name: 'Année' });
  act(() => year.focus());
  fireEvent.keyDown(year, { key: 'ArrowUp' });
  expect(await within(dialog).findByText(TOO_FAR)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(api.getClosureConflicts).toHaveBeenCalledTimes(1);
  expect(api.updateEstablishmentClosure).not.toHaveBeenCalled();
});

test('a closure stored past the horizon opens without the message and can still be saved', async () => {
  const dialog = await openClosure(closureAt(addIsoDays(H, 10), addIsoDays(H, 40)));
  expect(within(dialog).queryByText(TOO_FAR)).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  expect(api.getClosureConflicts).not.toHaveBeenCalled();
});
