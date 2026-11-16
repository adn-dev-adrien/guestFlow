// specs/sas-offer-complement-lines.md §4.3 and specs/pricing-components.md rules 85, 106 (stabilisation loop t6, S6-3) — the arrival SAS reopens the
// offered complement lines by the keys the server serves (`arrivalSeed`), a later line of an article named by its own line. Before, the
// dialog seeded `option:<id>` for every offered line, which the commit read as the article's FIRST line: two lines of one article, the
// second offered, came back with the first one offered and the second billed again.
import { screen, waitFor } from '@testing-library/react';
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
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

const line = (lineId, offered) => ({
  lineId, optionId: 12, title: 'Balade', inComplement: 1, offered,
  totalPrice: offered ? 0 : 45, originalTotalPrice: 45, unitPrice: 45, billedUnits: 1, quantity: 1,
});

async function commitUntouched(options) {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0, complementAmount: 45, options },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getAllByRole('button', { name: '✓ Offert' })).toHaveLength(1);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  return api.commitArrivalSas.mock.calls[0][1].offered;
}

test('two lines of one article, the SECOND offered: the commit keeps exactly that line offered', async () => {
  expect(await commitUntouched([line(804, 0), line(805, 1)])).toEqual([{ kind: 'option', id: 12, lineId: 805 }]);
});

test('two lines of one article, the FIRST offered: the commit names the article (its first line), the second stays billed', async () => {
  expect(await commitUntouched([line(804, 1), line(805, 0)])).toEqual([{ kind: 'option', id: 12 }]);
});
