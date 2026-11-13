// specs/pricing-components.md §3 rules 14, 23 and 32, PR C mock M3 — the departure recap lists what the stay already collected on its sold lines under
// « Déjà payé »; offering one goes through the line API, asks to confirm what is owed back (409 OVERPAID), and reads the SAS payload again.
//
// One file per subject (CLAUDE.md §9). The departure scaffolding mirrors ReservationSasDialog.departure-preview.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { departureRecapFor } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    patchExtraLine: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const paidSales = (over = {}) => ({
  title: 'Déjà payé',
  lines: [{ ref: 'option:8', label: 'Bière locale', totalCents: 1300, statusLabel: 'Payée', sourceLabel: 'SAS', block: 'paid' }],
  groups: [],
  totalCents: 1300,
  dueCents: 0,
  refundOwedCents: 0,
  ...over,
});
const withSales = (staySales) => sasPayload({
  reservation: { cautionAmount: 0 },
  cleaning: { included: false, price: 80 },
  linenItems: [{ id: 4, label: 'Serviette', price: 6.5, category: 'bath' }],
  repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 }],
  staySales,
});

const paidRegion = async () => within(await screen.findByRole('region', { name: 'Déjà payé' }));

async function openRecap() {
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText(/Total à percevoir : 80,00 €/);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewDepartureSas.mockImplementation((id, draft) => Promise.resolve(departureRecapFor(withSales(null), draft)));
});

test('the recap lists the paid lines under « Déjà payé »', async () => {
  api.getReservationSas.mockResolvedValue(withSales(paidSales()));
  await openRecap();
  const region = await paidRegion();
  expect(region.getByText(/Bière locale/)).toBeTruthy();
  expect(region.getByRole('button', { name: 'Offrir' })).toBeTruthy();
});

test('an offer refused as OVERPAID asks to confirm, then offers with force and reads the SAS payload again', async () => {
  const first = withSales(paidSales());
  const after = withSales({ ...paidSales({ refundOwedCents: 1300 }), lines: [] });
  api.getReservationSas.mockResolvedValueOnce(first).mockResolvedValue(after);
  api.patchExtraLine.mockRejectedValueOnce(Object.assign(new Error('Trop-perçu'), { code: 'OVERPAID', overpaymentTtc: 13 })).mockResolvedValue({});
  await openRecap();
  await userEvent.click((await paidRegion()).getByRole('button', { name: 'Offrir' }));
  await userEvent.click(await screen.findByRole('button', { name: /Offrir · 13,00\s€ à rembourser/ }));
  expect(api.patchExtraLine).toHaveBeenLastCalledWith(expect.anything(), 'option:8', { offered: true, forceOverpayment: true });
  await waitFor(() => expect(screen.getByText(/À rembourser \(depuis la fiche\) : 13,00\s€/)).toBeTruthy());
});
