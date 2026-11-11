// specs/arrival-departure-sas.md rule 12 (2026-10-27 spec review) — the arrival recap states the
// caution either way: « perçue » after « Caution perçue », « non perçue : reportée au départ » after
// « Reporter au départ ». The deferred case used to show nothing.
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
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

const payload = () => sasPayload({ cleaning: { included: true, price: 0 } });

test('a caution deferred is said on the recap', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/Caution à percevoir/);
  clickBtn('Reporter au départ');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText('Caution non perçue : reportée au départ.')).toBeInTheDocument();
  expect(screen.queryByText('Caution marquée comme perçue.')).toBeNull();
});

test('a caution collected keeps its own line, never the deferred one', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/Caution à percevoir/);
  clickBtn('Caution perçue');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText('Caution marquée comme perçue.')).toBeInTheDocument();
  expect(screen.queryByText(/reportée au départ/)).toBeNull();
});
