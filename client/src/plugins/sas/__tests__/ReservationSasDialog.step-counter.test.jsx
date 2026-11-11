// specs/review-2026-10-18-reservations.md rule 3, amended by specs/ui-review-2026-10-19-operations.md
// rule 3 — the SAS reads « N sur M », and M never grows: a page an answer opens keeps the number of the
// question that opened it.
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

test('rule 3 — « N sur M », and an opened page keeps its question\'s number', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, bedLinenAlert: { type: 'missing' } },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  // intro, linen, recap — the linen items page is opened by « Pas OK » only.
  expect(screen.getByText('1 sur 3')).toBeInTheDocument();
  clickBtn('Commencer');
  expect(await screen.findByText('2 sur 3')).toBeInTheDocument();
  clickBtn('Pas OK');
  // The linen items page: same number, same total.
  expect(await screen.findByText('2 sur 3')).toBeInTheDocument();
  expect(screen.queryByText(/sur 4/)).toBeNull();
  clickBtn('Suivant');
  expect(await screen.findByText('3 sur 3')).toBeInTheDocument();
});

beforeEach(() => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});
