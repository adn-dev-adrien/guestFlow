// specs/pricing-components.md rule 101 (readings 2026-11-16, loop t3 UI3-1..UI3-3) — the quiet re-read after a write of
// « Ventes du séjour »: every field is inert while it is in flight, MUI selects included (a div the fieldset does not disable);
// the summary keeps the last quote until the new one lands; a failed re-read keeps the page, read-only, with « Réessayer ».
// Reading 2026-11-16 (loop t4 UI4-2): read-only after a failed re-read covers the mini-planning days too.
// Reading 2026-11-17 (loop t13 UI13-1): every save refuses during the re-read — the bar's save-first actions
// (« Nouvelle note », « Envoyer la demande de solde ») share handleSaveReservation with « Enregistrer ».
import { vi } from 'vitest';
import { screen, waitFor, fireEvent, within, act } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }));

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));
vi.mock('../../components/reservation/FinanceSection', async (importOriginal) => {
  const original = await importOriginal();
  const { useReservationForm } = await import('../../components/reservation/ReservationFormContext');
  const FinanceSection = original.default;
  return {
    ...original,
    __esModule: true,
    default: function FinanceSectionProbe(props) {
      globalThis.__reservationForm = useReservationForm();
      return <FinanceSection {...props} />;
    },
  };
});

import api from '../../api';
import { STAY, seedFiche, openPage } from './reservationPageHarness';

const LINE = {
  ref: 'custom:7', kind: 'custom', label: 'Panier', quantity: 1, totalCents: 2500, sourceLabel: 'Fiche', status: 'dueAtDeparture',
  statusLabel: 'À payer au départ', collectAt: 'departure', momentLabel: 'Au départ', movable: true, moments: ['arrival', 'departure'],
  discountCents: 0, stayDiscountShareCents: 0,
};
const DETAIL = { lines: [LINE], totals: { dueCents: 2500 } };
const FICHE = { ...STAY, notes: '', saleDetail: DETAIL };
const NOTICE = { code: 'commissionAboveRate', text: 'Commission au-dessus du taux de la plateforme.' };

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, FICHE);
  api.getPlatforms.mockResolvedValue(['direct', 'booking']);
  api.patchExtraLine.mockResolvedValue({ saleDetail: { lines: [{ ...LINE, collectAt: 'arrival', momentLabel: 'À l’arrivée' }], totals: { dueCents: 2500 } } });
});

async function moveTheLine() {
  fireEvent.click(screen.getByRole('button', { name: 'Moment de Panier' }));
  fireEvent.click(within(await screen.findByRole('menu')).getByText('À payer à l’arrivée'));
}

test('while the re-read is in flight the selects are disabled and refuse to open', async () => {
  openPage();
  await screen.findByText('Panier');
  let answer;
  api.getReservation.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(FICHE); }));
  await moveTheLine();
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  for (const name of [/^Plateforme/, /^Logement/, /^Heure d'arrivée/, /^Heure de départ/]) {
    const combo = screen.getByRole('combobox', { name });
    expect(combo).toHaveAttribute('aria-disabled', 'true');
    fireEvent.mouseDown(combo);
    expect(screen.queryByRole('listbox')).toBeNull();
  }
  await act(async () => { answer(); });
  await waitFor(() => expect(screen.getByLabelText(/^Notes/i)).toBeEnabled());
  expect(screen.getByRole('combobox', { name: /^Plateforme/ })).not.toHaveAttribute('aria-disabled');
});

test('a select cannot change between the form landing and the end of the re-read', async () => {
  openPage();
  await screen.findByText('Panier');
  let release;
  api.getResourcesAvailability.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
  await moveTheLine();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const combo = screen.getByRole('combobox', { name: /^Plateforme/ });
  const before = combo.textContent;
  fireEvent.mouseDown(combo);
  expect(screen.queryByRole('listbox')).toBeNull();
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByLabelText(/^Notes/i)).toBeEnabled());
  expect(screen.getByRole('combobox', { name: /^Plateforme/ }).textContent).toBe(before);
});

test('the summary keeps the last quote through the re-read, and the quote is asked again after it', async () => {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], notices: [NOTICE] });
  openPage();
  await screen.findByText(NOTICE.text);
  const quotesBefore = api.calculatePrice.mock.calls.length;
  let answer;
  api.getReservation.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(FICHE); }));
  await moveTheLine();
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  expect(screen.getByText(NOTICE.text)).toBeInTheDocument();
  await act(async () => { answer(); });
  await waitFor(() => expect(api.calculatePrice.mock.calls.length).toBeGreaterThan(quotesBefore));
  expect(screen.getByText(NOTICE.text)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText(/^Notes/i)).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('a failed re-read keeps the page read-only with « Réessayer », and the retry brings the form back', async () => {
  openPage();
  await screen.findByText('Panier');
  api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
  await moveTheLine();
  const alert = await screen.findByText('Fiche non relue après la vente.');
  expect(screen.queryByText('Impossible de charger la réservation.')).toBeNull();
  expect(screen.getByText('Panier')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Notes/i)).toBeDisabled();
  expect(screen.getByRole('combobox', { name: /^Plateforme/ })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  const loads = api.getReservation.mock.calls.length;
  fireEvent.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBe(loads + 1));
  await waitFor(() => expect(screen.getByLabelText(/^Notes/i)).toBeEnabled());
  expect(screen.queryByText('Fiche non relue après la vente.')).toBeNull();
});

test('after a failed re-read a mini-planning day does not move the dates', async () => {
  openPage();
  await screen.findByText('Panier');
  const arrival = screen.getByLabelText("Date d'arrivée");
  const before = arrival.value;
  api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
  await moveTheLine();
  await screen.findByText('Fiche non relue après la vente.');
  const days = screen.getAllByTitle('Disponible');
  expect(days.length).toBeGreaterThan(0);
  fireEvent.click(days[0]);
  fireEvent.click(days[days.length - 1]);
  expect(screen.getByLabelText("Date d'arrivée").value).toBe(before);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

for (const how of ['failed', 'in flight']) {
  test(`a save-first action saves nothing while the re-read is ${how}`, async () => {
    openPage();
    await screen.findByText('Panier');
    if (how === 'failed') api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    else api.getReservation.mockImplementationOnce(() => new Promise(() => {}));
    await moveTheLine();
    if (how === 'failed') await screen.findByText('Fiche non relue après la vente.');
    await waitFor(() => expect(globalThis.__reservationForm.formReadOnly).toBe(true));
    const action = vi.fn();
    let saved;
    await act(async () => { saved = await globalThis.__reservationForm.saveThenRun(action); });
    expect(saved).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(api.updateReservation).not.toHaveBeenCalled();
  });
}
