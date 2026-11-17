// specs/pricing-components.md rule 101 (reading 2026-11-17, loop t16 UI16-1) — the fiche on a stale or in-flight state: ONE state
// (re-read in flight or failed, a « Ventes du séjour » write before its re-read, a save in flight, a logement switch) that every
// write path reads. Table-driven: the bar entries and every handler outside the disabled+inert fieldset are enumerated from the
// page's source, so a new action without a policy row fails here. Each member must act on fresh data or be disabled with
// « Fiche à relire. »; the lock of a started stay never flips. Rule 94 (reading 2026-11-17, loop t16 UI16-2) — the admin unlock
// alone does not make the fiche dirty (§8).
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { vi } from 'vitest';
import { screen, waitFor, fireEvent, within, act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';

const PAGE_SRC = path.join(__dirname, '..', 'ReservationPage.jsx');

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
import theme from '../../theme';
import ReservationPage from '../ReservationPage';
import PricingSummary from '../../components/PricingSummary';
import { STAY, seedFiche, dayIn } from './reservationPageHarness';

const REASON = 'Fiche à relire.';
const FAILURES = [];
const PASSES = [];
const record = (ok, member, state, detail) => (ok ? PASSES : FAILURES).push({ member, state, detail });

// ─────────────────────────────── 1. ENUMERATION FROM THE SOURCE ───────────────────────────────
const SRC = fs.readFileSync(PAGE_SRC, 'utf8');
const LINES = SRC.split('\n');
const lineOf = (re, from = 0) => LINES.findIndex((l, i) => i >= from && re.test(l));
function arrayBlock(startRe) {
  const start = lineOf(startRe);
  const end = lineOf(/^ {2}\];\s*$/, start);
  return LINES.slice(start, end + 1);
}
// One bar entry = one top-level `...(` spread of the array literal (4-space indent).
function barEntries(block) {
  const chunks = [];
  block.forEach((l) => {
    if (/^ {4}\.\.\.\(/.test(l)) chunks.push([l]);
    else if (chunks.length) chunks[chunks.length - 1].push(l);
  });
  return chunks.map((chunk) => {
    const text = chunk.join('\n');
    const label = (text.match(/label: '([^']+)'/) || [])[1]
      || (text.match(/tooltip: (?:[\w.]+ \? )?'([^']+)'/) || [])[1]
      || (text.match(/<InputLabel>([^<]+)</) || [])[1]
      || (text.match(/aria-label="([^"]+)"/) || [])[1];
    return {
      label,
      held: /heldWhileRereading\(/.test(text) || /disabled=\{saveBlocked\}/.test(text),
      writesForm: /updateForm\(/.test(text) && !/handleDevisStatusChange/.test(text),
    };
  });
}
const BAR = [
  ...barEntries(arrayBlock(/const actionBarBefore = /)),
  ...barEntries(arrayBlock(/const actionBarAfter = /)),
];
// The policy table: what each bar entry must do while the fiche is not the server's. A new bar entry without a row fails.
const BAR_POLICY = {
  'Nouvelle note (encaissement en séjour)': 'held',
  'Créer un devis': 'held', // new fiche: carries `form` + `selectedProp` to the devis — mid-switch they disagree (rule 11)
  'Transformer en devis': 'held',
  'Envoyer un email': 'free', // writes no stay (UI15-1 status: kept active)
  Statut: 'held',
  'Langue du devis': 'free', // a typed field of the devis, kept by the switch's own setForm(prev => …)
  'Télécharger PDF': 'held',
  'Envoyer la demande de paiement': 'held',
  'Envoyer la demande de solde': 'held',
  'Annuler le séjour': 'held',
  Supprimer: 'held',
  'Supprimer le devis': 'held',
};

// Every JSX handler from the bar to the end of the render, inside / outside the disabled+inert fieldset.
const scanFrom = lineOf(/const actionBarBefore = /);
const fieldsetStart = lineOf(/component="fieldset"/);
const fieldsetEnd = lineOf(/<\/ReservationFormProvider>/, fieldsetStart) + 1;
const HANDLERS = [];
for (let i = scanFrom; i < LINES.length; i += 1) {
  const re = /\b(on[A-Z]\w*)=\{/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(LINES[i]))) {
    HANDLERS.push({ line: i + 1, prop: m[1], inside: i > fieldsetStart && i < fieldsetEnd, text: LINES[i].trim().slice(0, 140) });
  }
}
const OUTSIDE = HANDLERS.filter((h) => !h.inside);
// Policy for every handler OUTSIDE the fieldset (inert does not reach them).
const OUTSIDE_POLICY = [
  [/Select value=\{form.status/, 'held (FormControl disabled={saveBlocked})'],
  [/ToggleButtonGroup|onChange=\{\(e, next\) => \{ if \(next\) updateForm\(\{ pdfLanguage/, 'free (devis PDF language)'],
  [/PricingNotices .*actionDisabled=\{saveBlocked\}.*onAction/, 'held (actionDisabled={saveBlocked})'],
  [/onToggle(ExtraGuest|Option|CustomOption|Resource)Offered|onToggle\w*InComplement|onRefreshTouristTax/, 'held (PricingSummary heldReason while saveBlocked; §3 and §9)'],
  [/onBack=\{goBackToOrigin\}|onCancel=\{goBackToOrigin\}/, 'navigation (guarded when dirty)'],
  [/onSave=\{isClosedFiche/, 'held (saveDisabled includes saveBlocked)'],
  [/onReservationChanged/, 'server write + full reload (spinner)'],
  [/handleRestoreSuperseded/, 'closed fiche only (no panel, no quiet re-read)'],
  [/supersededByReservationId/, 'navigation'],
  [/onClick=\{unlockFiche\}/, 'admin view change (local; the baseline follows its quote, §8)'],
  [/onRetry=\{rereadFiche\}/, 'retry'],
  [/onToggle=\{toggleHistory\}/, 'view'],
  [/onClose=\{closeCreateClient\}|onSubmit=\{handleSaveClient\}/, 'client dialog (opened from inside the fieldset only)'],
  [/onStay=|onDiscard=/, 'leave dialog'],
  [/onSaveAndQuit=/, 'held (saveDisabledReason while saveBlocked)'],
  [/onClose=\{\(\) => setEmailSendOpen|onMoneyChanged=/, 'email dialog (no stay write)'],
  [/onClose=\{\(\) => setCancelDialogOpen|onConfirm=\{handleCancelReservation\}/, 'cancel dialog (opener held)'],
];
const policyOf = (h) => (OUTSIDE_POLICY.find(([re]) => re.test(h.text)) || [null, null])[1];

describe('1. enumeration from the source', () => {
  test('every bar entry has a policy row and holds when its row says so', () => {
    for (const entry of BAR) {
      const policy = BAR_POLICY[entry.label];
      expect(policy, `bar entry without policy: ${entry.label}`).toBeDefined();
      if (policy === 'held') record(entry.held, `bar « ${entry.label} » (static)`, 'saveBlocked', entry.held ? 'wrapped' : 'NOT wrapped by heldWhileRereading / saveBlocked');
    }
    expect(Object.keys(BAR_POLICY).sort()).toEqual([...new Set(BAR.map((e) => e.label))].sort());
  });

  test('every handler outside the fieldset has a policy row', () => {
    for (const h of OUTSIDE) expect(policyOf(h), `unclassified handler at :${h.line} ${h.text}`).toBeTruthy();
  });
});

// ─────────────────────────────── 2. FIXTURES AND DRIVERS ───────────────────────────────
const LINE = {
  ref: 'custom:7', kind: 'custom', label: 'Panier', quantity: 1, totalCents: 2500, sourceLabel: 'Fiche', status: 'dueAtDeparture',
  statusLabel: 'À payer au départ', collectAt: 'departure', momentLabel: 'Au départ', movable: true, moments: ['arrival', 'departure'],
  discountCents: 0, stayDiscountShareCents: 0,
};
const DETAIL = { lines: [LINE], totals: { dueCents: 2500 } };
const OPTION = { id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_stay', autoEnabled: 0, displayToClient: 1 };
const QUOTE = {
  optionLines: [{ optionId: 10, title: 'Petit-déjeuner', quantity: 1, offered: false, totalPrice: 10, originalTotalPrice: 10, inComplement: 0 }],
  resourceLines: [], balanceAmount: 210, touristTaxFrozen: true, touristTaxTotal: 5, touristTaxLabel: 'Taxe', totalPrice: 300,
};
const BASE = { ...STAY, notes: '', saleDetail: DETAIL, onlinePayment: { label: 'Paiement en ligne' }, options: [{ optionId: 10, quantity: 1, title: 'Petit-déjeuner', unitPrice: 10, totalPrice: 10 }] };
const STARTED = {
  ...BASE, startDate: dayIn(-1), endDate: dayIn(2),
  editLock: { locked: true, extrasEditable: true, extrasClosedReason: null, arrivalLines: {}, frozenCustomOptionIds: [] },
};
const FUTURE = { ...BASE };
const STAYS = { started: STARTED, 'not started': FUTURE };

function seed(stay) {
  seedFiche(api, stay);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', options: [OPTION], optionGroups: { ungrouped: [OPTION] }, resources: [] });
  api.getPlatforms.mockResolvedValue(['direct', 'booking']);
  api.calculatePrice.mockResolvedValue(QUOTE);
  api.patchExtraLine.mockResolvedValue({ saleDetail: { lines: [{ ...LINE, collectAt: 'arrival', momentLabel: 'À l’arrivée' }], totals: { dueCents: 2500 } } });
  api.previewMidStayNote.mockImplementation(async () => ({ items: [], total: 0 }));
}

let lastLocation = null;
function LocationProbe() { lastLocation = useLocation(); return null; }
function openAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <LocationProbe />
        <Routes>
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
          <Route path="*" element={<div>ailleurs</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}
const ctx = () => globalThis.__reservationForm;

async function moveTheLine() {
  fireEvent.click(screen.getByRole('button', { name: 'Moment de Panier' }));
  fireEvent.click(within(await screen.findByRole('menu')).getByText('À payer à l’arrivée'));
}

// Puts the open fiche in `state`; returns `finish()` that ends it (answer / retry).
async function enter(state, stay) {
  if (state === 're-read in flight') {
    let answer;
    api.getReservation.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(stay); }));
    await moveTheLine();
    // The fiche holds from the panel's write on; the re-read starts once the write is answered.
    await waitFor(() => expect(answer).toBeTypeOf('function'));
    expect(ctx().formReadOnly).toBe(true);
    return async () => { await act(async () => { answer(); }); };
  }
  if (state === 're-read failed') {
    api.getReservation.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    await moveTheLine();
    await screen.findByText('Fiche non relue après la vente.');
    return async () => {
      fireEvent.click(within(screen.getByText('Fiche non relue après la vente.').closest('[role="alert"]')).getByRole('button', { name: 'Réessayer' }));
    };
  }
  throw new Error(state);
}

const READ_STATES = ['re-read in flight', 're-read failed'];

// ─────────────────────────────── 3. BAR × STATE × STAY (desktop) + LOCK NEVER FLIPS ───────────────────────────────
beforeEach(() => { vi.clearAllMocks(); globalThis.__reservationForm = null; lastLocation = null; });

describe('2. bar actions while the fiche is re-read (desktop)', () => {
  for (const [stayName, stay] of Object.entries(STAYS)) {
    for (const state of READ_STATES) {
      test(`${stayName} stay · ${state}`, async () => {
        seed(stay);
        openAt(`/reservations/${STAY.id}`);
        await screen.findByText('Panier');
        await waitFor(() => expect(ctx()).toBeTruthy());
        const lockSeen = [ctx().isReservationLocked];
        const finish = await enter(state, stay);
        lockSeen.push(ctx().isReservationLocked);
        const present = BAR.filter((e) => e.label && screen.queryAllByRole('button', { name: new RegExp(`^${e.label.replace(/[()]/g, '\\$&')}( :|$)`) }).length);
        for (const entry of present) {
          if (BAR_POLICY[entry.label] !== 'held') continue;
          const held = screen.queryByRole('button', { name: `${entry.label} : ${REASON}` });
          record(Boolean(held && held.disabled), `bar « ${entry.label} »`, `${stayName}/${state}`, held ? (held.disabled ? 'disabled + reason' : 'reason but enabled') : 'no « Fiche à relire. »');
        }
        const unlock = screen.queryByRole('button', { name: 'Déverrouiller cette fiche' });
        if (stayName === 'started') record(Boolean(unlock), 'lock banner « Déverrouiller cette fiche »', `${stayName}/${state}`, unlock ? 'kept' : 'vanished');
        await finish();
        await waitFor(() => { lockSeen.push(ctx().isReservationLocked); expect(ctx().formReadOnly).toBe(false); });
        lockSeen.push(ctx().isReservationLocked);
        const flips = new Set(lockSeen).size > 1;
        record(!flips, 'lock never flips', `${stayName}/${state}`, JSON.stringify(lockSeen));
        expect(api.updateReservation).not.toHaveBeenCalled();
        expect(api.deleteReservation).not.toHaveBeenCalled();
      });
    }
  }
});

// ─────────────────────────────── 4. SUMMARY CONTROLS (outside the fieldset) × STATE ───────────────────────────────
const SUMMARY_CONTROLS = [
  { name: 'Offrir (option line)', find: () => screen.queryAllByRole('button', { name: 'Offrir' })[0] },
  { name: 'Recalculer la taxe de séjour', keptOnFreshData: true /* a request flag, re-applied by the read-back quote */, find: () => screen.queryAllByRole('button', { name: 'Recalculer la taxe de séjour' })[0] },
];
describe('3. pricing summary controls while the fiche is re-read', () => {
  for (const state of READ_STATES) {
    for (const control of SUMMARY_CONTROLS) {
      test(`${control.name} · ${state}`, async () => {
        seed(FUTURE);
        openAt(`/reservations/${STAY.id}`);
        await screen.findByText('Panier');
        await waitFor(() => expect(control.find()).toBeTruthy());
        const finish = await enter(state, FUTURE);
        const el = control.find();
        if (!el) { record(true, `summary « ${control.name} »`, state, 'not rendered'); return; }
        const quotesBefore = api.calculatePrice.mock.calls.length;
        const pristineBefore = ctx().fichePristine;
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        fireEvent.click(el);
        await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
        const lastBody = api.calculatePrice.mock.calls.at(-1)?.[0] || {};
        const moved = ctx().fichePristine !== pristineBefore || api.calculatePrice.mock.calls.length > quotesBefore;
        const shownOffered = screen.queryAllByRole('button', { name: '✓ Offert' }).length > 0;
        const askedRefresh = Boolean(lastBody.refreshTouristTax);
        const askedOffer = (lastBody.offeredOptionIds || []).includes(10);
        record(disabled || !moved || control.keptOnFreshData, `summary « ${control.name} »`, state,
          disabled ? 'disabled' : `enabled; click ${moved ? `taken on the stale form: a quote re-asked (+${api.calculatePrice.mock.calls.length - quotesBefore}, offeredOptionIds∋10=${askedOffer}, refreshTouristTax=${askedRefresh}), button now « ${shownOffered ? '✓ Offert' : 'Offrir'} »` : 'did nothing'}`);
        await finish();
        await waitFor(() => expect(ctx().formReadOnly).toBe(false));
        await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
        const after = api.calculatePrice.mock.calls.at(-1)?.[0] || {};
        const survived = control.name.startsWith('Offrir') ? (after.offeredOptionIds || []).includes(10) : Boolean(after.refreshTouristTax);
        // A disabled control took no click: there is nothing to keep once the fiche is read back.
        record(survived || disabled, `summary « ${control.name} » — fate of the click once the fiche is read back`, state,
          `${survived ? 'kept' : (disabled ? 'no click taken (disabled)' : 'DROPPED silently')} (last quote offeredOptionIds=${JSON.stringify(after.offeredOptionIds)}, refreshTouristTax=${Boolean(after.refreshTouristTax)}); fichePristine=${ctx().fichePristine}`);
      });
    }
  }
});

// ─────────────────────────────── 5. PHONE: « Plus d'actions » ───────────────────────────────
describe('4. phone overflow menu while the fiche is re-read', () => {
  for (const state of READ_STATES) {
    test(`started stay · ${state}`, async () => {
      const saved = window.matchMedia;
      window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      try {
        seed(STARTED);
        openAt(`/reservations/${STAY.id}`);
        await screen.findByText('Panier');
        await enter(state, STARTED);
        fireEvent.click(await screen.findByRole('button', { name: "Plus d'actions" }));
        const items = await screen.findAllByRole('menuitem');
        for (const item of items) {
          const entry = BAR.find((e) => e.label && item.textContent.startsWith(e.label) && !(e.label === 'Supprimer' && item.textContent.startsWith('Supprimer le')));
          if (!entry || BAR_POLICY[entry.label] !== 'held') continue;
          const ok = item.getAttribute('aria-disabled') === 'true' && item.textContent.includes(REASON);
          record(ok, `phone « ${entry.label} »`, `started/${state}`, ok ? 'aria-disabled + reason' : `aria-disabled=${item.getAttribute('aria-disabled')} text=${item.textContent}`);
        }
      } finally { window.matchMedia = saved; }
    });
  }
});

// ─────────────────────────────── 6. PANEL WRITE IN FLIGHT (before the re-read starts) ───────────────────────────────
describe('5. a « Ventes du séjour » write in flight', () => {
  test('a note typed while the panel writes survives the re-read, or the field is read-only', async () => {
    seed(FUTURE);
    openAt(`/reservations/${STAY.id}`);
    await screen.findByText('Panier');
    let release;
    api.patchExtraLine.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ saleDetail: DETAIL }); }));
    await moveTheLine();
    await waitFor(() => expect(release).toBeTypeOf('function'));
    const notes = screen.getByLabelText(/^Notes/i);
    const editable = !notes.disabled && !notes.closest('[inert]');
    fireEvent.change(notes, { target: { value: 'Arrivée tardive' } });
    const saveEnabled = !screen.getByRole('button', { name: 'Enregistrer' }).disabled;
    await act(async () => { release(); });
    await waitFor(() => expect(ctx().formReadOnly).toBe(false));
    const kept = screen.getByLabelText(/^Notes/i).value === 'Arrivée tardive';
    record(!editable || kept, 'form field typed during a panel write', 'panel write in flight',
      `field editable=${editable}, « Enregistrer » enabled meanwhile=${saveEnabled}, typed note after the re-read ${kept ? 'kept' : 'LOST silently'}`);
  });
});

// ─────────────────────────────── 7. SAVE IN FLIGHT ───────────────────────────────
describe('6. a save in flight', () => {
  test('bar save-first actions do not start a second save; the form takes no input', async () => {
    seed(FUTURE);
    openAt(`/reservations/${STAY.id}`);
    await screen.findByText('Panier');
    fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'Une' } });
    let release;
    api.updateReservation.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: STAY.id }); }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(1));
    const balance = screen.queryByRole('button', { name: /^Envoyer la demande de solde/ });
    const balanceEnabled = Boolean(balance && !balance.disabled);
    if (balanceEnabled) fireEvent.click(balance);
    await act(async () => { await new Promise((r) => { setTimeout(r, 200); }); });
    const saves = api.updateReservation.mock.calls.length;
    record(saves === 1, 'bar « Envoyer la demande de solde » during a save', 'save in flight',
      `enabled=${balanceEnabled}; PUT /reservations sent ${saves}×`);
    let ran = false;
    act(() => { ctx().saveThenRun(() => { ran = true; }); });
    await act(async () => { await new Promise((r) => { setTimeout(r, 200); }); });
    const saves2 = api.updateReservation.mock.calls.length;
    record(saves2 === saves, 'saveThenRun (« Nouvelle note », FinanceSection « + Nouvelle note », ledger mark on a dirty fiche) during a save', 'save in flight',
      `PUT /reservations sent ${saves2 - saves} more time(s) while the first is pending`);
    const notes = screen.getByLabelText(/^Notes/i);
    const editable = !notes.disabled && !notes.closest('[inert]');
    record(!editable, 'form fields during a save', 'save in flight', `Notes editable=${editable} (typed text is not in the PUT; the save then navigates away)`);
    await act(async () => { release(); });
  });
});

// ─────────────────────────────── 8. LOGEMENT SWITCH IN FLIGHT (new fiche) ───────────────────────────────
describe('7. a logement switch in flight', () => {
  function seedNew() {
    api.getToday.mockResolvedValue({ today: dayIn(0) });
    api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }]);
    api.getProperty.mockImplementation(async (id) => ({ id, name: id === 1 ? 'Granja' : 'Estiva', options: [{ ...OPTION, id: id === 1 ? 10 : 20 }], resources: [] }));
    api.getClients.mockResolvedValue([]);
    api.getReservations.mockResolvedValue([]);
    api.getOccupiedDates.mockResolvedValue([]);
    api.getPropertyOptionDefaults.mockResolvedValue([]);
    api.getWelcomePack.mockResolvedValue({ lines: [] });
    api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], totalPrice: 0 });
    api.getResourcesAvailability.mockResolvedValue([]);
    api.getBabyBedAvailability.mockResolvedValue({ totalQuantity: 0, reserved: 0, available: 0 });
  }
  async function midSwitch() {
    seedNew();
    openAt(`/reservations/new?propertyId=1&startDate=${dayIn(30)}&endDate=${dayIn(33)}`);
    await waitFor(() => expect(ctx()?.propertyOptions?.length).toBe(1));
    await waitFor(() => expect(ctx().formReadOnly).toBe(false));
    act(() => { ctx().setOptionEnabled(10, true); });
    await waitFor(() => expect(ctx().form.selectedOptions.map((o) => o.optionId)).toContain(10));
    let release;
    api.getReservations.mockImplementation(() => new Promise((resolve) => { release = () => resolve([]); }));
    act(() => { ctx().handleReservationPropertyChange(2); });
    await waitFor(() => expect(ctx().formReadOnly).toBe(true));
    await waitFor(() => expect(Number(ctx().selectedProp)).toBe(2));
    return () => act(async () => { release(); });
  }

  test('« Créer un devis » mid-switch', async () => {
    const release = await midSwitch();
    const btn = screen.queryByRole('button', { name: /^Créer un devis/ });
    const enabled = Boolean(btn && !btn.disabled);
    if (enabled) fireEvent.click(btn);
    const prefill = lastLocation?.state?.prefillDevis;
    record(!enabled, 'bar « Créer un devis »', 'logement switch in flight',
      enabled ? `enabled; navigated to ${lastLocation?.pathname}${lastLocation?.search} with propertyId=${prefill?.propertyId}, form.propertyId=${prefill?.form?.propertyId}, selectedOptions=${JSON.stringify((prefill?.form?.selectedOptions || []).map((o) => o.optionId))} (half-switched: selectedProp 2, form.propertyId 1, logement 1's option cleared, logement 2's defaults not applied yet)` : 'held');
    await release();
  });

  test('« Enregistrer et quitter » of the leave dialog mid-switch (existing stay)', async () => {
    seed(FUTURE);
    api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }]);
    openAt(`/reservations/${STAY.id}`);
    await screen.findByText('Panier');
    let releaseOcc;
    api.getReservations.mockImplementation(() => new Promise((resolve) => { releaseOcc = () => resolve([]); }));
    act(() => { ctx().handleReservationPropertyChange(2); });
    await waitFor(() => expect(ctx().formReadOnly).toBe(true));
    await waitFor(() => expect(Number(ctx().selectedProp)).toBe(2));
    const release = () => act(async () => { releaseOcc(); });
    let asked;
    act(() => { asked = window.__guestflowBeforeNavigate && window.__guestflowBeforeNavigate('/planning'); });
    const dialog = asked ? await screen.findByRole('dialog') : null;
    if (!dialog) { record(true, 'leave dialog « Enregistrer et quitter »', 'logement switch in flight', 'no dialog (fiche clean)'); await release(); return; }
    const save = within(dialog).getByRole('button', { name: 'Enregistrer et quitter' });
    const enabled = !save.disabled;
    fireEvent.click(save);
    await act(async () => { await new Promise((r) => { setTimeout(r, 200); }); });
    const said = dialogs.alert.mock.calls.length > 0 || within(dialog).queryAllByText(REASON).length > 0;
    const left = lastLocation?.pathname === '/planning';
    record(!enabled || said, 'leave dialog « Enregistrer et quitter »', 'logement switch in flight',
      `enabled=${enabled}; click → createReservation ${api.createReservation.mock.calls.length}×, left=${left}, message shown=${Boolean(said)} (silent no-op)`);
    await release();
  });

  test('summary « Offrir » mid-switch (existing stay)', async () => {
    seed(FUTURE);
    api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }]);
    openAt(`/reservations/${STAY.id}`);
    await screen.findByText('Panier');
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Offrir' }).length).toBeGreaterThan(0));
    let release;
    api.getReservations.mockImplementation(() => new Promise((resolve) => { release = () => resolve([]); }));
    act(() => { ctx().handleReservationPropertyChange(2); });
    await waitFor(() => expect(ctx().formReadOnly).toBe(true));
    const btn = screen.queryAllByRole('button', { name: 'Offrir' })[0];
    const enabled = Boolean(btn && !btn.disabled);
    record(!enabled, 'summary « Offrir »', 'logement switch in flight', enabled ? 'enabled (the switch then clears the offered set: the click is lost)' : 'held or gone');
    await act(async () => { release(); });
  });
});

// ─────────────────────────────── 9. ADMIN UNLOCK (fix review of S15-1: the unlock now re-asks the quote) ───────────────────────────────
describe('8. « Déverrouiller cette fiche » on a started stay whose unlocked routing differs', () => {
  test('unlocking alone does not make the fiche dirty, nor hold « Supprimer » / « Annuler le séjour »', async () => {
    seed(STARTED);
    api.calculatePrice.mockImplementation(async (body) => ({ ...QUOTE, balanceAmount: body.unlockPast ? 195 : 210 }));
    openAt(`/reservations/${STAY.id}`);
    await screen.findByText('Panier');
    await waitFor(() => expect(ctx().fichePristine).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Déverrouiller cette fiche' }));
    await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => b.unlockPast)).toBe(true));
    await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
    const del = screen.getByRole('button', { name: /^Supprimer/ });
    const cancel = screen.getByRole('button', { name: /^Annuler le séjour/ });
    const names = [del, cancel].map((b) => `${b.getAttribute('aria-label') || b.textContent} disabled=${b.disabled} ariaDisabled=${b.getAttribute('aria-disabled')}`);
    record(ctx().fichePristine === true, 'admin unlock → quote re-asked with unlockPast', 'unlocked',
      `fichePristine=${ctx().fichePristine}, « Enregistrer » ${screen.getByRole('button', { name: 'Enregistrer' }).disabled ? 'disabled' : 'ENABLED'}; ${names.join(' | ')}`);
  });
});

// ─────────────────────────────── 10. EVERY CONTROL OF THE PRICING SUMMARY (desktop column and phone sheet) ───────────────────────────────
// Enumerated from PricingSummary's source: each `onClick` is a display toggle (`setShow…`), a ComplementChip (reads the held
// context) or a control carrying `disabled={held}`. Then rendered with every kind of line, held and not held.
const SUMMARY_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'PricingSummary.jsx'), 'utf8').split('\n');
describe('9. every control of the pricing summary reads heldReason', () => {
  test('static: each onClick of the summary is a display toggle or is held', () => {
    const sites = SUMMARY_SRC.map((l, i) => ({ l, i })).filter(({ l }) => /\bonClick=/.test(l));
    expect(sites.length).toBeGreaterThanOrEqual(8);
    for (const { l, i } of sites) {
      // The element that carries this onClick: the nearest opening tag above it, up to its closing `>` or `/>`.
      let open = i;
      while (open > 0 && !/<[A-Z]\w*/.test(SUMMARY_SRC[open])) open -= 1;
      let close = i;
      while (close < SUMMARY_SRC.length - 1 && !/^\s*\/?>/.test(SUMMARY_SRC[close]) && !/\/>\s*\)?\}?\s*$/.test(SUMMARY_SRC[close])) close += 1;
      const element = SUMMARY_SRC.slice(open, close + 1).join('\n');
      const kind = /setShow\w+/.test(l) ? 'display'
        : (/<ComplementChip/.test(element) || /clickable \?/.test(l)) ? 'chip (HeldContext)'
          : /disabled=\{held\}/.test(element) ? 'held' : null;
      record(Boolean(kind), `summary source :${i + 1}`, 'saveBlocked', kind || `NOT held: ${l.trim()}`);
    }
  });

  const SUMMARY_QUOTE = {
    nights: 2, nightlyBreakdown: [], totalPrice: 600, finalPrice: 720,
    includedGuests: 2, extraGuestCount: 1, extraGuestUnitPrice: 20, extraGuestPriceUnit: 'per_night',
    extraGuestSurchargeOriginal: 40, extraGuestSurcharge: 40, extraGuestInBrutCount: 0, extraGuestInBrutSurcharge: 0,
    extraGuestComplementCount: 1, extraGuestComplementOriginal: 40, extraGuestComplementSurcharge: 40, platformPaidGuests: 2,
    optionLines: [{ optionId: 10, title: 'Petit-déjeuner', quantity: 1, offered: false, totalPrice: 10, originalTotalPrice: 10, inComplement: 0 }],
    resourceLines: [{ resourceId: 5, name: 'Bain', quantity: 1, totalPrice: 30, originalTotalPrice: 30, inComplement: 1 }],
    touristTaxTotal: 5, touristTaxLabel: 'Taxe', touristTaxFrozen: true,
  };
  const handlers = () => ({
    onToggleExtraGuestOffered: vi.fn(), onToggleOptionOffered: vi.fn(), onToggleCustomOptionOffered: vi.fn(), onToggleResourceOffered: vi.fn(),
    onToggleOptionInComplement: vi.fn(), onToggleCustomOptionInComplement: vi.fn(), onToggleResourceInComplement: vi.fn(),
    onToggleTouristTaxInComplement: vi.fn(), onRefreshTouristTax: vi.fn(),
  });
  const clickEveryControl = () => {
    const controls = [
      ...screen.queryAllByRole('button', { name: /^(Offrir|✓ Offert)$/ }),
      ...screen.queryAllByRole('button', { name: 'Recalculer la taxe de séjour' }),
      ...screen.queryAllByText(/^\+? ?compl\.$/),
    ];
    controls.forEach((el) => fireEvent.click(el));
    return controls.length;
  };
  for (const held of [false, true]) {
    test(`rendered ${held ? 'held' : 'free'}: ${held ? 'no control reaches the page, the reason reads' : 'every control reaches the page'}`, () => {
      const h = handlers();
      render(
        <ThemeProvider theme={theme}>
          <PricingSummary
            quote={SUMMARY_QUOTE} form={{}} offeredOptionIds={new Set()} isTouristTaxFrozen
            propertyOptions={[OPTION]} availableResources={[{ id: 5, name: 'Bain' }]}
            heldReason={held ? REASON : null} {...h}
          />
        </ThemeProvider>,
      );
      const clicked = clickEveryControl();
      const reached = Object.entries(h).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name);
      expect(clicked).toBeGreaterThanOrEqual(6);
      if (held) {
        record(reached.length === 0, 'summary controls (rendered)', 'held', reached.length ? `reached: ${reached.join(', ')}` : `${clicked} controls, none reached`);
        expect(screen.getByText(REASON)).toBeInTheDocument();
      } else {
        expect(reached.sort()).toEqual(['onRefreshTouristTax', 'onToggleExtraGuestOffered', 'onToggleOptionInComplement', 'onToggleOptionOffered', 'onToggleResourceInComplement', 'onToggleResourceOffered', 'onToggleTouristTaxInComplement']);
      }
    });
  }
});

// ─────────────────────────────── VERDICT ───────────────────────────────
test('INVARIANT — every member acts on fresh data or is held with « Fiche à relire. », and the lock never flips', () => {
  // 60 member × state checks at the time of loop t16; fewer would mean a section stopped finding its members.
  expect(PASSES.length + FAILURES.length).toBeGreaterThanOrEqual(60);
  expect(FAILURES.map((f) => `[${f.state}] ${f.member}: ${f.detail}`)).toEqual([]);
});
