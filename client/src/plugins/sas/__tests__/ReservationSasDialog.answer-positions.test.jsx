// specs/arrival-departure-sas.md rule 28, rule 14.bis (2026-10-27 audit) — on the departure SAS « Oui » jumped
// sides: right and filled on the keys page, LEFT on « Des serviettes ou des draps sont-ils
// manquants ? » (where « Non » was the filled answer). Every yes/no page now reads « Non | Oui », the
// positive answer filled and last, so the thumb never has to re-read the labels.
import { screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
});

const answers = () => within(document.querySelector('.MuiDialogActions-root'))
  .getAllByRole('button')
  .map((b) => b.textContent)
  .filter((t) => t === 'Oui' || t === 'Non');

test('every departure yes/no page reads « Non | Oui »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },
    extinguisherCheck: true,
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  expect(answers()).toEqual(['Non', 'Oui']);
  clickBtn('Oui');

  await screen.findByText(/Clés du logement récupérées/);
  expect(answers()).toEqual(['Non', 'Oui']);
  clickBtn('Oui');

  await screen.findByText(/bon état/i);
  expect(answers()).toEqual(['Non', 'Oui']);
});
