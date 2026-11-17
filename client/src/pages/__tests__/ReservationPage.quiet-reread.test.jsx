// specs/pricing-components.md rule 101 (readings 2026-11-16, loop t3 UI3-1..UI3-3) — the quiet re-read after a write of
// « Ventes du séjour »: every field is inert while it is in flight, MUI selects included (a div the fieldset does not disable);
// the summary keeps the last quote until the new one lands; a failed re-read keeps the page, read-only, with « Réessayer ».
// Reading 2026-11-16 (loop t4 UI4-2): read-only after a failed re-read covers the mini-planning days too.
// Reading 2026-11-17 (loop t13 UI13-1): every save refuses during the re-read — the bar's save-first actions
// (« Nouvelle note », « Envoyer la demande de solde ») share handleSaveReservation with « Enregistrer ».
// Reading 2026-11-17 (loop t14 UI14-1/UI14-2): those bar actions are disabled while the save refuses, and a refused save keeps
// « Nouvelle note » open (nothing recorded) instead of closing it as if paid.
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
import { STAY, seedFiche, openPage, dayIn } from './reservationPageHarness';

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

const STARTED = {
  ...FICHE, startDate: dayIn(-1), endDate: dayIn(2), onlinePayment: { label: 'Paiement en ligne' },
  endOfStayComplementDetail: JSON.stringify([{ label: 'Panier', amount: 25, source: 'midStayExtra', key: 'custom:7' }]),
};
const NOTE = 'Nouvelle note (encaissement en séjour)';
const BALANCE = 'Envoyer la demande de solde';
const blocked = (name) => `${name} : Fiche à relire.`;

function startedStay() {
  seedFiche(api, STARTED);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], balanceAmount: 210 });
  api.previewMidStayNote.mockImplementation(async (body) => ({ items: [], total: (body.checkedKeys || []).length ? 25 : 0 }));
}

for (const how of ['failed', 'in flight']) {
  test(`the bar's save-first actions are disabled, with the reason, while the re-read is ${how}`, async () => {
    startedStay();
    openPage();
    await screen.findByText('Panier');
    expect(await screen.findByRole('button', { name: BALANCE })).toBeEnabled();
    expect(screen.getByRole('button', { name: NOTE })).toBeEnabled();
    let answer;
    if (how === 'failed') api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    else api.getReservation.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(STARTED); }));
    await moveTheLine();
    if (how === 'failed') await screen.findByText('Fiche non relue après la vente.');
    expect(await screen.findByRole('button', { name: blocked(NOTE) })).toBeDisabled();
    expect(screen.getByRole('button', { name: blocked(BALANCE) })).toBeDisabled();
    if (how === 'failed') {
      fireEvent.click(within(screen.getByText('Fiche non relue après la vente.').closest('[role="alert"]')).getByRole('button', { name: 'Réessayer' }));
    } else {
      await act(async () => { answer(); });
    }
    expect(await screen.findByRole('button', { name: NOTE })).toBeEnabled();
    expect(screen.getByRole('button', { name: BALANCE })).toBeEnabled();
    expect(api.updateReservation).not.toHaveBeenCalled();
  });
}

test('a refused save keeps « Nouvelle note » open: nothing settled, nothing drawn as paid', async () => {
  startedStay();
  api.updateReservation.mockRejectedValue(new Error('Refusé.'));
  openPage();
  await screen.findByText('Panier');
  fireEvent.click(await screen.findByRole('button', { name: NOTE }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  const pay = within(dialog).getByRole('button', { name: 'CB / Chèque' });
  await waitFor(() => expect(pay).toBeEnabled());
  await act(async () => { fireEvent.click(pay); });
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalled());
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600); }); });
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByRole('button', { name: 'CB / Chèque' })).toBeEnabled();
  expect(api.markPayment).not.toHaveBeenCalled();
});

test('phone: in « Plus d\'actions » the save-first items are disabled with the reason beneath during a failed re-read', async () => {
  const saved = window.matchMedia;
  window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    startedStay();
    openPage();
    await screen.findByText('Panier');
    api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    await moveTheLine();
    await screen.findByText('Fiche non relue après la vente.');
    fireEvent.click(await screen.findByRole('button', { name: "Plus d'actions" }));
    const items = (await screen.findAllByRole('menuitem')).filter((el) => [NOTE, BALANCE].some((name) => el.textContent.includes(name)));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(within(item).getByText('Fiche à relire.')).toBeInTheDocument();
    }
    fireEvent.click(items[0]);
    expect(api.updateReservation).not.toHaveBeenCalled();
    expect(api.sendBalanceRequestEmail).not.toHaveBeenCalled();
  } finally { window.matchMedia = saved; }
});
