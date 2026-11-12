// specs/arrival-departure-sas.md rule 31 (2026-11-12, manual trial of 4.0.0) — the caution page asks once: a caution
// deferred to the departure is never shown again before the recap, and « Non » says no caution is taken for the stay.
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

const payload = (reservation = {}) => sasPayload({ cleaning: { included: true, price: 0 }, reservation });

async function walkToRecap() {
  for (let i = 0; i < 12 && !screen.queryByRole('button', { name: 'Valider et terminer' }); i += 1) {
    const footer = document.querySelector('.MuiDialogActions-root');
    const buttons = footer.querySelectorAll('button');
    buttons[buttons.length - 1].click();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Caution à percevoir/)).toBeNull();
  }
  await screen.findByRole('button', { name: 'Valider et terminer' });
}

test('a caution deferred to the departure is not asked again before the recap', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/Caution à percevoir/);
  clickBtn('Reporter au départ');
  await walkToRecap();
  expect(screen.queryByText(/Caution à percevoir/)).toBeNull();
  expect(screen.getByText('Caution non perçue : reportée au départ.')).toBeInTheDocument();
});

test('« Non » is a red answer, says no caution is taken, and is sent as the waiver (not as a receipt)', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/Caution à percevoir/);
  expect(screen.getByRole('button', { name: 'Non' }).className).toMatch(/colorError/);
  clickBtn('Non');
  await walkToRecap();
  expect(screen.getByText('Aucune caution pour ce séjour.')).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await vi.waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalled());
  const [, body] = api.commitArrivalSas.mock.calls[0];
  expect(body.cautionReceived).toBe(false);
  expect(body.cautionWaived).toBe(true);
});

test('a stay already answered « Non » reopens on that answer, with the property amount shown', async () => {
  api.getReservationSas.mockResolvedValue(payload({
    // date-literal-ok: fixture field, nothing compares it with today
    cautionAmount: 0, cautionWaived: 1, propertyDefaultCautionAmount: 500, arrivalSasDoneAt: '2026-11-10 10:00:00',
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/Caution à percevoir/);
  expect(screen.getByText('Aucune caution pour ce séjour')).toBeInTheDocument();
  expect(screen.getByText(/500,00/)).toBeInTheDocument();
});
