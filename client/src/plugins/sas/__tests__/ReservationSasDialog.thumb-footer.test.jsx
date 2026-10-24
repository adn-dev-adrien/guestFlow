// specs/ui-review-2026-10-19-operations.md rules 1, 2 and 4 — the SAS answered with the thumb: the
// primary answer last (at the bottom on a phone), the alternative neutral, « Rien à percevoir ».
import { screen, within, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // specs/sas-arrival-total-server-side.md — the recap renders what the server previews.
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
});

const footerButtons = () => {
  const footer = document.querySelector('.MuiDialogActions-root');
  return within(footer).getAllByRole('button');
};

test('rules 1-2 — caution: « Reporter au départ » neutral on top, « Caution perçue » filled last', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ cleaning: { included: true, price: null } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByRole('button', { name: 'Caution perçue' });
  const [first, last] = footerButtons();
  expect(first).toHaveTextContent('Reporter au départ');
  expect(last).toHaveTextContent('Caution perçue');
  expect(last.className).toMatch(/MuiButton-contained /);
  expect(last.className).toMatch(/MuiButton-colorPrimary/);
  // Deferring is never red.
  expect(first.className).not.toMatch(/colorError/);
  expect(screen.queryByRole('button', { name: 'Reporté' })).toBeNull();
  // The footer stacks in reading order on a phone: the primary lands at the bottom.
  const footer = first.closest('.MuiDialogActions-root');
  expect(getComputedStyle(footer).flexDirection).not.toBe('column-reverse');
});

test('rule 1 — an upsell keeps « Non merci » as the filled answer, last', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionReceived: 1 } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByRole('button', { name: 'Ajouter le ménage' });
  const buttons = footerButtons();
  expect(buttons.map((b) => b.textContent)).toEqual(['Ajouter le ménage', 'Non merci']);
});

test('rule 2 — « Dégât / litige » is the one red answer, outlined; « Rendue » is filled and last', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, cautionReturned: 0 },
    cleaning: { included: true, price: null },
    extinguisherCheck: false,
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');
  await screen.findByRole('button', { name: 'Oui' });
  clickBtn('Oui');
  await screen.findByRole('button', { name: 'Rendue' });
  const [bad, good] = footerButtons();
  expect(bad).toHaveTextContent('Dégât / litige');
  expect(bad.className).toMatch(/MuiButton-outlined /);
  expect(bad.className).toMatch(/MuiButton-colorError/);
  expect(good).toHaveTextContent('Rendue');
});

test('rule 4 — a recap with nothing to collect says « Rien à percevoir », no « Total : 0,00 € »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByRole('button', { name: 'Valider et terminer' });
  expect(screen.getByText('Rien à percevoir')).toBeInTheDocument();
  expect(screen.queryByText(/Total : 0,00/)).toBeNull();
});

test('rule 4 — a departure with nothing billed says « Rien à percevoir »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },
    extinguisherCheck: false,
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');
  await screen.findByRole('button', { name: 'Oui' });
  clickBtn('Oui');
  await screen.findByRole('button', { name: 'Valider et terminer' });
  expect(screen.getByText('Rien à percevoir')).toBeInTheDocument();
});

test('rule 4 — a caution deferred to the departure keeps the badge away', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ cleaning: { included: true, price: null } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByRole('button', { name: 'Reporter au départ' });
  clickBtn('Reporter au départ');
  // Walk the remaining pages with the primary (last) answer, the deferred caution reminder included.
  for (let i = 0; i < 10 && !screen.queryByRole('button', { name: 'Valider et terminer' }); i += 1) {
    const buttons = footerButtons();
    fireEvent.click(buttons[buttons.length - 1]);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }
  await screen.findByRole('button', { name: 'Valider et terminer' });
  expect(screen.queryByText('Rien à percevoir')).toBeNull();
});

test('rule 4 — a stay still owed at departure (server: nothingToCollect false) gets no badge', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },
    extinguisherCheck: false,
    nothingToCollect: false,
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');
  await screen.findByRole('button', { name: 'Oui' });
  clickBtn('Oui');
  await screen.findByRole('button', { name: 'Valider et terminer' });
  expect(screen.queryByText('Rien à percevoir')).toBeNull();
});
