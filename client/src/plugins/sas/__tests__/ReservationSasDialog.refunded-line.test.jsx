// specs/pricing-components.md rule 108 (stabilisation loop t7, D7-1) — an offered paid line whose money a refund gave back cannot be put back:
// the recap line the server marks `offerLocked` stays offered on the recap with no « ✓ Offert » toggle; another offered line keeps its toggle.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

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
  const fake = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation(async (id, draft) => {
    const recap = await fake(id, draft);
    return { ...recap, lines: recap.lines.map((l) => (l.label === 'Balade' ? { ...l, offerLocked: true } : l)) };
  });
});

test('the refunded line reads offered with no toggle; the other offered line keeps « ✓ Offert »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      complementAmount: 0,
      options: [
        { lineId: 805, optionId: 12, title: 'Balade', inComplement: 1, offered: 1, totalPrice: 0, originalTotalPrice: 45, unitPrice: 45, billedUnits: 1, quantity: 1 },
        { lineId: 806, optionId: 13, title: 'Vélo', inComplement: 1, offered: 1, totalPrice: 0, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1 },
      ],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  await screen.findByText(/Balade/);
  expect(screen.getAllByRole('button', { name: '✓ Offert' })).toHaveLength(1);
  expect(screen.getAllByText('0 €')).toHaveLength(2);
});
