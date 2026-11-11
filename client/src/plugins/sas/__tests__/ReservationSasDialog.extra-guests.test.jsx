// Guests added after a platform booking — specs/platform-extra-guest-complement.md §3.5 rule 17.
//
// The arrival recap shows the server-stored line, never edits the composition, and can offer it.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

// Every plugin active — the Solio configuration these tests describe (specs/plugins-phase-0-foundation.md).
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // specs/sas-arrival-total-server-side.md — the recap renders what the server previews.
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

const ADDED_GUEST = {
  platform: 'Booking', adults: 5, cautionAmount: 0,
  complementAmount: 40, extraGuestComplementSurcharge: 40, extraGuestComplementCount: 1, extraGuestSurchargeOffered: 0,
};

async function openRecap(reservation) {
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation, cleaning: { included: true, price: null } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
}

test('the added guests are listed in the arrival recap and counted in its total', async () => {
  await openRecap(ADDED_GUEST);
  expect(screen.getByText(/Voyageurs ajoutés · 1 pers\./)).toBeInTheDocument();
  expect(screen.getByText(/Total : 40,00 €/)).toBeInTheDocument();
});

test('offering the added guests drops them from the total and sends their ref', async () => {
  await openRecap(ADDED_GUEST);
  clickBtn('Offrir');
  expect(await screen.findByText(/Total : 0,00 €/)).toBeInTheDocument(); // rule 19 — the money follows the server
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].offeredExtras).toEqual([{ kind: 'extraGuests', id: 0 }]);
});

test('already offered on the fiche → reopens as « ✓ Offert », undoable', async () => {
  await openRecap({ ...ADDED_GUEST, complementAmount: 0, extraGuestSurchargeOffered: 1 });
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  // Nothing owed at the door reads as the « Rien à percevoir » badge (ui-review-2026-10-19-operations rule 4).
  expect(screen.getByText('Rien à percevoir')).toBeInTheDocument();
  clickBtn('✓ Offert');
  expect(await screen.findByText(/Total : 40,00 €/)).toBeInTheDocument();
});
