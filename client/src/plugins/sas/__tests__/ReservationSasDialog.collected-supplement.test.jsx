// specs/arrival-departure-sas.md rule 35 (2026-11-12) — on a collected complement the recap says what the commit adds to the
// end-of-stay complement, it does not ask to collect it by hand; nothing announced when the run adds nothing.
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

const walk = async (supplement) => {
  api.getReservationSas.mockResolvedValue(sasPayload({ cleaning: { included: true, price: 0 }, reservation: { cautionReceived: 1, complementPaid: 1, complementAmount: 30 } }));
  const fake = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation(async (...args) => ({ ...(await fake(...args)), supplementOutsideComplement: supplement }));
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

beforeEach(() => { vi.clearAllMocks(); });

test('the supplement is said as added to the end-of-stay complement, never asked by hand', async () => {
  await walk(35);
  expect(await screen.findByText(/Ajouté au complément de fin de séjour : 35,00/)).toBeInTheDocument();
  expect(screen.queryByText(/encaisser le supplément/)).toBeNull();
});

test('nothing added: nothing announced', async () => {
  await walk(0);
  expect(screen.queryByText(/Ajouté au complément de fin de séjour/)).toBeNull();
});
