// The stay step follows the plan — specs/pricing/pricing-components.md rule 117, sas-arrival-total-server-side rule 25 (stabilisation loop t9, UI9-1).
//
// Once a preview answered, the « Séjour » step exists iff the plan asks a stay amount, and shows exactly that amount: a recap gesture that
// settles the stored solde removes the page (nothing shown, nothing sent), one that raises a stay the stored row left at 0 brings it in.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn(() => Promise.resolve({ ok: true, complementAmount: 0 })),
    commitDepartureSas: vi.fn(() => Promise.resolve({ ok: true })),
    getReservationWeatherAlerts: vi.fn(() => Promise.resolve({ configured: false, resolved: false, department: null, alerts: [] })),
  },
}));

const NOTHING = { applicable: false, total: 0 };
// What the plan asks for the stay, changed by each test between two previews (the gesture the server would judge).
let planned = null;
beforeEach(() => {
  vi.clearAllMocks();
  const base = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation(async (id, draft, options) => {
    const recap = await base(id, draft, options);
    const stayPayment = planned || NOTHING;
    const due = stayPayment.applicable ? stayPayment.total : 0;
    return { ...recap, stayDue: due, stayPayment, totalAtArrival: due + recap.arrivalComplementTotal };
  });
});

const load = (stayPayment) => api.getReservationSas.mockResolvedValue(sasPayload({
  cleaning: { included: true, price: 80 }, reservation: { cautionAmount: 0, options: [{ title: 'Bois', quantity: 1 }] }, stayPayment,
}));
// « Prestations réservées » asks no preview: the recap entered after it asks the plan again.
const OPTIONS = 'Prestations réservées';

test('UI9-1 a — stored 300 €, the plan settles it at the recap: no « Séjour » page any more, nothing shown, nothing sent', async () => {
  load(stayDue({ total: 300, balance: { amount: 300, applicable: true, settled: false, due: 300, owned: false, collectible: 300 } }));
  planned = stayDue({ total: 300 });
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Séjour à régler :');
  expect(await screen.findByText('300,00 €')).toBeInTheDocument();
  clickBtn('Suivant');
  await screen.findByText(OPTIONS);
  planned = NOTHING;
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/Séjour :/)).not.toBeInTheDocument();
  clickBtn('Précédent');
  await screen.findByText(OPTIONS);
  clickBtn('Précédent');
  await screen.findByText('Commencer');
  expect(screen.queryByText('Séjour à régler :')).not.toBeInTheDocument();
  clickBtn('Commencer');
  await screen.findByText(OPTIONS);
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect([payload.stayPaid, payload.displayedStayDue]).toEqual([undefined, undefined]);
});

test('UI9-1 b — nothing stored, the plan raises 300 € at the recap: the « Séjour » page comes in with that amount and the commit sends it', async () => {
  load({ ...NOTHING });
  planned = NOTHING;
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(OPTIONS);
  expect(screen.queryByText('Séjour à régler :')).not.toBeInTheDocument();
  planned = stayDue({ total: 300, balance: { amount: 300, applicable: true, settled: false, due: 300, owned: false, collectible: 300 } });
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  expect(await screen.findByText('Séjour : 300,00 €')).toBeInTheDocument();
  clickBtn('Précédent');
  await screen.findByText(OPTIONS);
  clickBtn('Précédent');
  await screen.findByText('Séjour à régler :');
  expect(await screen.findByText('300,00 €')).toBeInTheDocument();
  clickBtn('CB / Chèque');
  clickBtn('Suivant');
  await screen.findByText(OPTIONS);
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect([payload.stayPaid, payload.displayedStayDue]).toEqual([true, 300]);
});
