// specs/pricing-components.md §3 rules 32 and 85, PR C mock M3 — on the arrival recap the departure sales of the stay can be collected now:
// the line API moves each line to the arrival, then the SAS payload and the recap are read again.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    patchExtraLine: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const staySales = (refs) => ({
  title: 'Ventes du séjour — au départ',
  lines: refs.map((ref, i) => ({ ref, label: `Vente ${i + 1}`, totalCents: 800, statusLabel: 'À payer au départ', sourceLabel: 'Fiche', block: 'due' })),
  groups: [],
  totalCents: 800 * refs.length,
  dueCents: 800 * refs.length,
});

const walk = async () => {
  api.getReservationSas
    .mockResolvedValueOnce(sasPayload({ cleaning: { included: true, price: 0 }, reservation: { cautionReceived: 1 }, staySales: staySales(['option:1', 'option:2']) }))
    .mockResolvedValue(sasPayload({ cleaning: { included: true, price: 0 }, reservation: { cautionReceived: 1 }, staySales: staySales(['option:2']) }));
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  for (let i = 0; i < 12 && !screen.queryByRole('button', { name: 'Valider et terminer' }); i += 1) {
    const buttons = document.querySelectorAll('.MuiDialogActions-root button');
    buttons[buttons.length - 1].click();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }
  await screen.findByRole('button', { name: 'Valider et terminer' });
};

beforeEach(() => { vi.clearAllMocks(); api.patchExtraLine.mockResolvedValue({ saleDetail: {} }); });

test('« Percevoir maintenant » moves the line to the arrival, then the SAS and the recap are read again', async () => {
  await walk();
  const previews = api.previewArrivalSas.mock.calls.length;
  await userEvent.click(screen.getAllByRole('button', { name: 'Percevoir maintenant' })[0]);
  await waitFor(() => expect(api.patchExtraLine).toHaveBeenCalledWith(expect.anything(), 'option:1', { collectAt: 'arrival' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Percevoir maintenant' })).toHaveLength(1));
  await waitFor(() => expect(api.previewArrivalSas.mock.calls.length).toBeGreaterThan(previews));
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeInTheDocument();
});

test('« Tout percevoir maintenant » moves every line, and a refusal of the server is shown without leaving the page', async () => {
  await walk();
  api.patchExtraLine.mockRejectedValueOnce(new Error('Ce moment n’est plus possible pour ce séjour.'));
  await userEvent.click(screen.getByRole('button', { name: 'Tout percevoir maintenant' }));
  await waitFor(() => expect(api.patchExtraLine).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Ce moment n’est plus possible pour ce séjour.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeInTheDocument();
});
