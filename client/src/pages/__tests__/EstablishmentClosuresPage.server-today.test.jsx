// specs/establishment-closures.md rule 18 + specs/reservations-backend-mvc.md rule 13, second reading (review of PR
// #938, F8) — the closure dialog judges the window from the server's day (`GET /api/today`), not the device's.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
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
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const TOO_OLD = 'Date trop ancienne : 5 ans au plus.';
const S = horizonStart(localIsoToday());

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(false);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
  api.getClosureConflicts.mockResolvedValue(NONE);
});
afterEach(() => { window.matchMedia = orig; });

// The server's day is set far enough ahead that a start moved by one day, whichever way the day field wraps, lies
// inside the device's window and before the server's.
test('a start inside the device\'s window but before the server\'s is refused under its field', async () => {
  api.getToday.mockResolvedValue({ today: addIsoDays(localIsoToday(), 400) });
  api.getEstablishmentClosures.mockResolvedValue([{ id: 5, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate: addIsoDays(S, 40), endDate: addIsoDays(S, 60) }]);
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.click(await screen.findByText('Travaux'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByText(TOO_OLD)).toBeNull();
  const day = within(within(dialog).getByRole('group', { name: 'Début de fermeture' })).getByRole('spinbutton', { name: 'Jour' });
  act(() => day.focus());
  fireEvent.keyDown(day, { key: 'ArrowUp' });
  expect(await within(dialog).findByText(TOO_OLD)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Enregistrer', hidden: true })).toBeDisabled();
});
