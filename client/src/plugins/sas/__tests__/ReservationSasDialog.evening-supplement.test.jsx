// The evening supplement in the arrival recap — specs/hourly-resource-quantity-and-sas-scheduling.md
// §3.6 rules 26, 32, through the step the hourly-resources plugin contributes
// (specs/plugins-phase-3c-hourly-resources.md rules 6–7, 12, 27).
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 20 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
    getResourceFreeSlots: vi.fn(),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

const LABEL = 'Bain nordique — supplément soirée';

// A re-opened SAS: the bath's two hours are placed, one in the evening, and the previous commit
// billed its supplement as a SAS line.
function reopened({ hoursSold = 2, applicable = false } = {}) {
  return {
    ...sasPayload({
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
    }),
    pluginData: { 'hourly-resources': {
      applicable,
      resources: [{
        resourceId: 2, name: 'Bain nordique', hoursSold, hoursPlaced: 2, hoursRemaining: hoursSold - 2,
        slotDuration: 60, minimumUsageMinutes: 60, days: [],
        sessions: [
          { date: '2026-07-10', start: '17:00', end: '18:00', supplement: 0 },
          { date: '2026-07-10', start: '20:00', end: '21:00', supplement: 20 },
        ],
        supplement: 20, supplementLabel: LABEL,
      }],
    } },
  };
}

async function reachRecap() {
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  for (let i = 0; i < 6 && screen.queryAllByText(/Récapitulatif —/).length === 0; i += 1) {
    clickBtn('Suivant');
  }
  await screen.findByText(/Récapitulatif —/);
}

test('rule 32: a re-opened SAS shows the supplement once and never sends it back', async () => {
  api.getReservationSas.mockResolvedValue(reopened());
  renderDialog({ mode: 'arrival' });
  await reachRecap();

  expect(screen.getAllByText(new RegExp(LABEL))).toHaveLength(1);
  expect(screen.getByText(/Total : 20,00 €/)).toBeInTheDocument();

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.complementItems).toEqual([]);
  expect(arg.pluginSteps).toEqual({}, 'the step did not run: the stored hours stay as they are');
});

test('rule 26: a re-opened step sends every block, the placed ones included, and the hours left', async () => {
  api.getResourceFreeSlots.mockResolvedValue({ days: [], supplement: 20 });
  api.getReservationSas.mockResolvedValue(reopened({ hoursSold: 3, applicable: true }));
  renderDialog({ mode: 'arrival' });
  await reachRecap();

  expect(screen.getByText('Bain nordique : 1 h non planifiée.')).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].pluginSteps).toEqual({
    resourceScheduling: {
      blocks: [
        { resourceId: 2, date: '2026-07-10', start: '17:00', end: '18:00' },
        { resourceId: 2, date: '2026-07-10', start: '20:00', end: '21:00' },
      ],
      resourceIds: [2],
    },
  });
});
