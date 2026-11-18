// specs/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t22 UI22-1), specs/outside-booking-sas.md rule 54 (reading 2026-11-18,
// loop t22) — when a server answer (or « Réessayer », or the operator's own action that the answer completes) removes, disables or hides
// the control holding the focus, the focus stays in the sale dialog, never on the document body. Every file that draws a FocusKeeper is
// enumerated from the code and needs at least one row here: a row focuses the control the answer takes away, lets the answer come, and
// checks where the focus is. The « Facture » block runs through every outcome of a second answer while its address field holds the focus.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import ResourceArrivalDialog from '../../plugins/hourly-resources/ResourceArrivalDialog';
import ResourceBookingDialog from '../../plugins/hourly-resources/ResourceBookingDialog';
import BookingInvoiceBlock from '../../plugins/hourly-resources/BookingInvoiceBlock';
import StandaloneSaleDialog from '../StandaloneSaleDialog';
import SuggestedArticlesStep from '../SuggestedArticlesStep';
import StaySalesSection from '../StaySalesSection';
import SalePaymentLink from '../SalePaymentLink';
import DialogProvider from '../DialogProvider';
import PlatformPenaltyDialog from '../reservation/PlatformPenaltyDialog';
import SplitSharesDialog from '../../plugins/online-payment/SplitSharesDialog';
import LinkTransactionDialog from '../../plugins/online-payment/LinkTransactionDialog';
import { ficheCreditsPayload, previewPayload } from '../../plugins/online-payment/__tests__/reconciliationFixtures';
import { localIsoDate } from '../../plugins/hourly-resources/localDate';
import { visitPayload, fakeQuote } from '../../plugins/hourly-resources/__tests__/arrivalVisitFixtures';
import { sasPayload, stayDue, renderDialog, clickBtn } from '../../plugins/sas/__tests__/sasFixtures';
import { recapFor } from '../../plugins/sas/__tests__/sasPreviewFake';

vi.mock('../../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    getOccupiedSlots: vi.fn(),
    getClientPicker: vi.fn(),
    getProperties: vi.fn(),
    previewResourceBooking: vi.fn(),
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(),
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
    listPlatformPenalties: vi.fn(),
    previewPlatformPenalty: vi.fn(),
    declarePlatformPenalty: vi.fn(),
    previewReconciliationAllocation: vi.fn(),
    getReconciliationFicheCredits: vi.fn(),
    getReconciliationCandidates: vi.fn(),
  },
}));

const SRC = path.resolve(__dirname, '..', '..');
function sourcesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourcesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}
const KEEPERS = sourcesOf(SRC)
  .filter((file) => /<FocusKeeper\b/.test(fs.readFileSync(file, 'utf8')))
  .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
  .sort();

let release = null;
let held = null;
const hold = () => { held = new Promise((resolve) => { release = resolve; }); };
const offBody = async () => {
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(document.activeElement).not.toBeNull();
};
const streetField = () => screen.getByRole('textbox', { name: 'Adresse' });
const invoiceBox = () => screen.getByRole('checkbox', { name: /Créer la facture dans Qonto/ });

const OUTCOMES = [
  { name: 'accepted', invoiceable: { ok: true, code: null, reason: null }, stays: true },
  { name: 'refused (caption)', invoiceable: { ok: false, code: 'TARIFF_CHANGED', reason: 'Le tarif a changé : facture à établir dans Qonto.', silent: false } },
  { name: 'silent refusal', invoiceable: { ok: false, code: 'ISSUER_UNAVAILABLE', reason: 'Qonto non connecté.', silent: true } },
  { name: '« Caisse interne »', invoiceable: { ok: false, code: 'INTERNAL_CASH', reason: 'Caisse interne.', silent: false } },
];

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };
const CATALOGUE = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];

// One row per file drawing a FocusKeeper (at least one each).
const ROWS = [
  ...OUTCOMES.map((outcome) => ({
    file: 'plugins/hourly-resources/ResourceArrivalDialog.jsx',
    name: `the address holds the focus when the second « Facture » answer is ${outcome.name}`,
    run: async () => {
      const quote = fakeQuote();
      let paymentAnswers = 0;
      api.getResourceVisit.mockResolvedValue(visitPayload());
      api.quoteResourceVisit.mockImplementation(async (id, body) => {
        if (!body.payment) return quote(id, body);
        paymentAnswers += 1;
        if (paymentAnswers > 1) await held;
        return { ...(await quote(id, body)), invoiceable: paymentAnswers > 1 ? outcome.invoiceable : { ok: true, code: null, reason: null } };
      });
      render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
      await screen.findByText('Sa séance');
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
      // A new draft asks a new answer; the latest one stays drawn meanwhile, so the address can be typed into.
      fireEvent.click(screen.getByRole('button', { name: /Limonade/ }));
      await waitFor(() => expect(paymentAnswers).toBe(2));
      streetField().focus();
      fireEvent.change(streetField(), { target: { value: '12 rue' } });
      expect(document.activeElement).toBe(streetField());
      await act(async () => { release(); });
      if (outcome.stays) {
        expect(document.activeElement).toBe(streetField());
        return;
      }
      await offBody();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    },
  })),
  {
    file: 'plugins/hourly-resources/ResourceBookingDialog.jsx',
    name: 'the address holds the focus when a refusal answers the next draft',
    run: async () => {
      let paymentAnswers = 0;
      api.getOccupiedSlots.mockResolvedValue({ occupiedSlots: [] });
      api.getClientPicker.mockResolvedValue({ options: [] });
      api.getProperties.mockResolvedValue([]);
      api.previewResourceBooking.mockImplementation(async (draft) => {
        if (!draft.payment) return PRICE;
        paymentAnswers += 1;
        if (paymentAnswers > 1) await held;
        return { ...PRICE, invoiceable: paymentAnswers > 1 ? OUTCOMES[1].invoiceable : OUTCOMES[0].invoiceable };
      });
      render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
      fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
      fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Plus 15 minutes' }));
      await waitFor(() => expect(paymentAnswers).toBe(2));
      streetField().focus();
      await act(async () => { release(); });
      await screen.findByText(OUTCOMES[1].invoiceable.reason);
      await offBody();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    },
  },
  ...OUTCOMES.slice(1).map((outcome) => ({
    file: 'plugins/hourly-resources/BookingInvoiceBlock.jsx',
    name: `the block alone: the address holds the focus and the answer is ${outcome.name}`,
    run: async () => {
      const props = {
        qontoReady: true, offered: true, checked: true, onCheck: () => {}, billing: { street: '', postcode: '', city: '' }, onBilling: () => {}, showAddress: true, reserve: true,
      };
      const { rerender } = render(<BookingInvoiceBlock {...props} />);
      streetField().focus();
      const answered = {
        ...props,
        offered: false,
        internalCash: outcome.invoiceable.code === 'INTERNAL_CASH',
        reason: outcome.invoiceable.silent || outcome.invoiceable.code === 'INTERNAL_CASH' ? null : outcome.invoiceable.reason,
      };
      await act(async () => { rerender(<BookingInvoiceBlock {...answered} />); });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('invoice-block')));
    },
  })),
  {
    file: 'components/StandaloneSaleDialog.jsx',
    name: '« Réessayer » of a failed quote goes with the failure',
    run: async () => {
      api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: CATALOGUE });
      api.quoteStandaloneSale.mockRejectedValueOnce(Object.assign(new Error('Service indisponible'), { status: 503 }));
      render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
      const retry = await screen.findByRole('button', { name: 'Réessayer' });
      api.quoteStandaloneSale.mockResolvedValue({
        document: { lines: [{ id: null, ref: 'draft:0', kind: 'extra', label: 'Bière locale', detail: '1 × 6,50 €', quantity: 1, unitCents: 650, totalCents: 650, catalogueCents: 650, offered: false, status: 'due', statusLabel: 'À payer' }], totals: { totalCents: 650, paidCents: 0, remainingCents: 650, refundOwedCents: 0 }, vatByRate: [{ rate: 20, vatCents: 108 }] },
        customer: { clientId: 1, label: 'Passage', kind: 'passage' }, refusals: [], quoted: true, paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
      });
      retry.focus();
      await act(async () => { fireEvent.click(retry); });
      await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50 €'));
      await offBody();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    },
  },
  {
    file: 'components/SuggestedArticlesStep.jsx',
    name: '« Retirer » goes with its line',
    run: async () => {
      const draft = [{ articleRef: 'option:7', label: 'Bière locale', quantity: 1, max: 12, offered: false }];
      const props = { suggestions: [], draft, draftLines: [null], onAdd: () => {}, onDraftChange: () => {}, onDraftRemove: () => {} };
      const { rerender } = render(<SuggestedArticlesStep {...props} />);
      const remove = screen.getByRole('button', { name: 'Retirer' });
      remove.focus();
      await act(async () => { rerender(<SuggestedArticlesStep {...props} draft={[]} draftLines={[]} />); });
      await waitFor(() => expect(document.activeElement.tagName).toBe('SECTION'));
      expect(document.activeElement).toHaveAttribute('data-focus-anchor');
    },
  },
  {
    file: 'components/StaySalesSection.jsx',
    name: '« Percevoir maintenant » goes when its line is collected',
    run: async () => {
      const line = { ref: 'a', label: 'Bois', totalCents: 1200, status: 'due', statusLabel: 'À payer', block: 'due' };
      const section = { title: 'Ventes du séjour', lines: [line, { ...line, ref: 'b', label: 'Glace' }], groups: [], totalCents: 2400, dueCents: 2400 };
      const onCollectNow = vi.fn(() => Promise.resolve());
      const { rerender } = render(<StaySalesSection section={section} onCollectNow={onCollectNow} />);
      const collect = screen.getAllByRole('button', { name: 'Percevoir maintenant' })[0];
      collect.focus();
      await act(async () => { fireEvent.click(collect); });
      const paid = { ...section, lines: [{ ...line, block: 'paid', status: 'paid', statusLabel: 'Payée' }, section.lines[1]], dueCents: 1200 };
      await act(async () => { rerender(<StaySalesSection section={paid} onCollectNow={onCollectNow} />); });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Ventes du séjour' })));
    },
  },
  {
    file: 'components/SalePaymentLink.jsx',
    name: 'the minted link replaces « Créer le lien »',
    run: async () => {
      const link = { available: true, reason: null, email: null, open: null };
      const { rerender } = render(<SalePaymentLink link={link} onMint={() => {}} onSendEmail={() => {}} onWithdraw={() => {}} />);
      const mint = screen.getAllByRole('button')[0];
      mint.focus();
      const open = { id: 9, url: 'https://pay.example/x', amountCents: 650, expiresLabel: 'demain' };
      await act(async () => { rerender(<SalePaymentLink link={{ ...link, open }} onMint={() => {}} onSendEmail={() => {}} onWithdraw={() => {}} />); });
      await offBody();
      expect(within(document.body).getByText('https://pay.example/x').closest('[data-focus-anchor]').contains(document.activeElement)).toBe(true);
    },
  },
  {
    file: 'plugins/sas/ReservationSasDialog.jsx',
    name: '« Réessayer » of the stay page goes with the failure',
    run: async () => {
      const payload = sasPayload({ reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 80 }, stayPayment: stayDue() });
      api.getReservationWeatherAlerts.mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] });
      api.getReservationSas.mockResolvedValue(payload);
      api.previewArrivalSas.mockRejectedValue(Object.assign(new Error('Service indisponible'), { status: 503 }));
      renderDialog({ mode: 'arrival' });
      await screen.findByText('Commencer');
      clickBtn('Commencer');
      const retry = await screen.findByRole('button', { name: 'Réessayer' });
      api.previewArrivalSas.mockImplementation(async (id, draft) => recapFor(payload, draft));
      retry.focus();
      await act(async () => { fireEvent.click(retry); });
      await screen.findByText('480,00 €');
      await offBody();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    },
  },
  // Loop t23 (verifier of S23-1) — the preview dialogs of the books: their « Réessayer » goes once the new answer lands; the focus stays in
  // the dialog's content, never on the page or the dialog's root.
  ...[
    {
      file: 'components/reservation/PlatformPenaltyDialog.jsx',
      name: '« Réessayer » of a failed penalty preview goes with the failure',
      mock: () => {
        api.listPlatformPenalties.mockResolvedValue({ items: [], suggestions: [] });
        api.previewPlatformPenalty.mockRejectedValueOnce(Object.assign(new Error('Service indisponible'), { status: 503 }));
        api.previewPlatformPenalty.mockResolvedValue({ valid: true, needsChoice: false, warnings: [], errors: [], before: { payout: 570.02, commission: 229.98, netReceived: 570.02 }, after: { payout: 610.02, commission: 189.98, netReceived: 570.02 } });
      },
      render: () => render(<DialogProvider><PlatformPenaltyDialog open onClose={() => {}} reservationId={7} source="fiche" onDone={() => {}} initialAmount={40} /></DialogProvider>),
      after: () => screen.findByText(/Commission 229,98 € → 189,98 €/),
    },
    {
      file: 'plugins/online-payment/SplitSharesDialog.jsx',
      name: '« Réessayer » of a failed share check goes with the failure',
      mock: () => {
        api.previewReconciliationAllocation.mockRejectedValueOnce(Object.assign(new Error('Service indisponible'), { status: 503 }));
        api.previewReconciliationAllocation.mockResolvedValue(previewPayload({ valid: false, errors: [{ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: 'Il manque 9,00 €.' }] }));
      },
      render: () => render(<SplitSharesDialog open onClose={() => {}} onSubmit={() => {}} proposal={{ id: 'p', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' }, pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 }] }} labels={{ '7|balance': 'Séjour 7' }} />),
      after: () => screen.findByText('Il manque 9,00 €.'),
    },
    {
      file: 'plugins/online-payment/LinkTransactionDialog.jsx',
      name: '« Réessayer » of a failed allocation preview goes with the failure',
      mock: () => {
        api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
        api.previewReconciliationAllocation.mockRejectedValueOnce(Object.assign(new Error('Service indisponible'), { status: 503 }));
        api.previewReconciliationAllocation.mockResolvedValue(previewPayload());
      },
      render: async () => { render(<LinkTransactionDialog open onClose={() => {}} onSubmit={() => {}} reservationId={7} />); fireEvent.click((await screen.findAllByRole('checkbox'))[0]); },
      after: () => screen.findByText('1 virement · 300,00 €'),
    },
  ].map((row) => ({
    file: row.file,
    name: row.name,
    run: async () => {
      row.mock();
      await row.render();
      const retry = await screen.findByRole('button', { name: 'Réessayer' });
      retry.focus();
      await act(async () => { fireEvent.click(retry); });
      await row.after();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull());
      await offBody();
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(dialog);
    },
  })),
];

beforeEach(() => {
  vi.clearAllMocks();
  hold();
});

// A page whose region is proven in its own subject suite (a page needs its own heavy harness): the suite named must exist and check
// that the focus never falls to the body when the control holding it goes. Loop t24 S24-3: the fiche's failed live quote.
const KEPT_ELSEWHERE = {
  'pages/ReservationPage.jsx': 'pages/__tests__/ReservationPage.live-quote-failure.test.jsx',
};

test('every file that draws a FocusKeeper has its rows', () => {
  expect(KEEPERS).toEqual([...new Set([...ROWS.map((row) => row.file), ...Object.keys(KEPT_ELSEWHERE)])].sort());
  Object.values(KEPT_ELSEWHERE).forEach((suite) => {
    expect(fs.readFileSync(path.join(SRC, suite), 'utf8')).toMatch(/document\.activeElement\)\.not\.toBe\(document\.body\)/);
  });
});

test.each(ROWS.map((row) => [`${row.file}: ${row.name}`, row]))('%s', async (_, row) => {
  await row.run();
});
