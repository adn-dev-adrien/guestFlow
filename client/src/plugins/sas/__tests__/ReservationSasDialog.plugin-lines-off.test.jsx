// A line a plugin billed, re-opened while that plugin is off — specs/plugins-phase-3c-hourly-resources.md
// rule 8 (decision P10): the server keeps it as stored, so the recap shows it as it is, in the total,
// without « Offrir », and the commit never sends it back.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => id !== 'hourly-resources' }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 20 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const LABEL = 'Bain nordique — supplément soirée';

test('rule 8: the supplement billed before stays in the recap, fixed, and is not sent back', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    cleaning: { included: true, price: null },
    reservation: {
      cautionAmount: 0,
      arrivalSasDoneAt: '2026-07-10 16:30:00',
      complementAmount: 20,
      options: [{
        isCustom: 1, customOptionId: 9, title: LABEL, description: LABEL, unitPrice: 20, totalPrice: 20,
        sasArrivalOrigin: 1, sasLineKey: 'hourly-resources:evening:2', inComplement: 1, offered: 0,
      }],
    },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  for (let i = 0; i < 6 && screen.queryAllByText(/Récapitulatif —/).length === 0; i += 1) clickBtn('Suivant');
  await screen.findByText(/Récapitulatif —/);

  expect(screen.getByText(`+ ${LABEL} : 20,00 €`)).toBeInTheDocument();
  expect(screen.getByText(/Total : 20,00 €/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offrir' })).toBeNull();

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].complementItems).toEqual([]);
});
