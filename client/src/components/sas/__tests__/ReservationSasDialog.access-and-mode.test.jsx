// Who may open the SAS, and which end of the stay it reads — specs/reception-role-checkin-only.md, reception-sas-today-only.md, sas-departure-mode-param.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

// Mock the API the dialog consumes.
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    // Weather alerts (specs/checkin-weather-alerts.md) — fired in the background on arrival open.
    // Default to "no alert" so the wizard flow under test is unchanged.
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

// specs/reception-role-checkin-only.md §3.4 — the reception role runs the SAS but has no reservation
// sheet access, so the header « Fiche » link is hidden when canOpenReservation is false.
test('canOpenReservation gates the « Fiche » link (shown by default, hidden for reception)', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload());
  const { unmount } = renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  expect(screen.getByRole('button', { name: 'Fiche' })).toBeInTheDocument();
  unmount();

  api.getReservationSas.mockResolvedValue(sasPayload());
  renderDialog({ mode: 'arrival', canOpenReservation: false });
  await screen.findByText('Commencer');
  expect(screen.queryByRole('button', { name: 'Fiche' })).not.toBeInTheDocument();
});

// specs/reception-sas-today-only.md §3.3 rule 13 — reception reaches a locked SAS only via a deep-link
// (Dashboard row / push); the dialog then renders a locked panel instead of the wizard. `receptionLock`
// is resolved server-side and is null for an admin.
test('reception lock: a « done » arrival renders the locked panel, no wizard', async () => {
  api.getReservationSas.mockResolvedValue({
    ...sasPayload({ reservation: { cautionReceived: 1, startDate: '2026-08-04', arrivalSasDoneAt: '2026-08-04 15:12:00' } }),
    receptionLock: { arrival: 'done', departure: null },
  });
  renderDialog({ mode: 'arrival' });

  await screen.findByText(/Ce check-in a déjà été validé le 04\/08\/2026\. Sa modification est réservée à l'administrateur\./);
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  expect(screen.queryByText('Commencer')).toBeNull();
  expect(screen.queryByText(/Étape 1\//)).toBeNull();
});

test('reception lock: a « past » arrival names the arrival day, not a commit date', async () => {
  api.getReservationSas.mockResolvedValue({
    ...sasPayload({ reservation: { cautionReceived: 1, startDate: '2026-07-30' } }),
    receptionLock: { arrival: 'past', departure: null },
  });
  renderDialog({ mode: 'arrival' });

  await screen.findByText(/Ce check-in datait du 30\/07\/2026\. Seuls les check-in du jour sont modifiables/);
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
});

test('reception lock: a « future » departure points at the departure day', async () => {
  api.getReservationSas.mockResolvedValue({
    ...sasPayload({ reservation: { cautionReceived: 1, endDate: '2026-08-09' } }),
    receptionLock: { arrival: null, departure: 'future' },
  });
  renderDialog({ mode: 'departure' });

  await screen.findByText(/Ce check-out n'est possible que le 09\/08\/2026, le jour du départ\./);
  expect(screen.queryByText('Commencer')).toBeNull();
});

test('reception lock: an unlocked SAS runs the normal wizard', async () => {
  api.getReservationSas.mockResolvedValue({
    ...sasPayload({ reservation: { cautionReceived: 1 } }),
    receptionLock: { arrival: null, departure: null },
  });
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull();
});

test('reception lock: a 403 SAS_LOCKED at commit surfaces the French message', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: 80 },
  }));
  const apiError = new Error('SAS_LOCKED');
  apiError.error = 'SAS_LOCKED';
  apiError.reason = 'done';
  apiError.status = 403;
  api.commitArrivalSas.mockRejectedValueOnce(apiError);
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  // Surfaced twice on purpose: inline in the dialog + as the app-wide toast.
  const shown = await screen.findAllByText(/Ce check-in a déjà été validé\. Sa modification est réservée à l'administrateur\./);
  expect(shown.length).toBeGreaterThan(0);
});

// ---- the read carries the end of the stay (specs/sas-departure-mode-param.md) ----

test('the SAS read tells the server which end it is', async () => {
  // Without it the check-out SAS got the check-in answer to « le ménage est-il déjà vendu ? », asked a
  // question it could never bill, and announced 80 € the commit threw away.
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionAmount: 0 } }));
  const { unmount } = renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  expect(api.getReservationSas).toHaveBeenCalledWith(1, 'departure');
  unmount();

  api.getReservationSas.mockClear();
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  expect(api.getReservationSas).toHaveBeenCalledWith(1, 'arrival');
});
