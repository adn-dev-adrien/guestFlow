import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { renderFinance as renderLedger, dueRow, naRow, editable, ledgerOf } from './ledgerFixtures';

// specs/accounting-platform-commission-and-no-deposit.md §3.8 rule 21 + §7.3 — a platform without
// acompte reads « Sans objet » on the acompte row (the server's words, specs/reservation-payment-ledger.md
// rule 6); its statement fields (brut, per-échéance commissions — specs/platform-per-echeance-commission.md,
// specs/platform-payment-entry.md) open from the payout row's amount (ledger rule 25).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), computePlatformCommission: vi.fn() } }));
import api from '../../../api';

const payoutRow = (label = 'Versement Gîtes de France', extra = {}) => dueRow('balance', label, 687, {
  stateLabel: 'Attendu le 22/10', action: { kind: 'mark', label: 'Marquer reçu', payout: { expected: 626 } },
  amountEdit: editable('statement'), ...extra,
});
const PLATFORM_LEDGER = ledgerOf([naRow('deposit', 'Acompte', 'Sans objet · Gîtes de France encaisse en une fois'), payoutRow()]);

function renderFinance(overrides = {}) {
  const platform = overrides.form && overrides.form.platform;
  const direct = !platform || String(platform).toLowerCase() === 'direct';
  return renderLedger({ ledger: direct ? ledgerOf([dueRow('deposit', 'Acompte', 90), dueRow('balance', 'Solde', 217.2)]) : PLATFORM_LEDGER, ...overrides }).ctx;
}

const openStatement = () => fireEvent.click(within(document.querySelector('[data-row="balance"]')).getByRole('button', { name: /Modifier le montant/ }));

// specs/booking-extranet-intake.md §4.1 — the commission is computed by the server; the button only
// sends the figures and writes back what it answers, applied with the statement on « Valider ».
async function calculate(ctx) {
  api.computePlatformCommission.mockResolvedValueOnce({ commission: 123.45 });
  openStatement();
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  await waitFor(() => expect(api.computePlatformCommission).toHaveBeenCalledWith({
    gross: ctx.form.platformGrossAmount,
    payout: ctx.form.platformPayoutAmount,
    touristTax: ctx.form.platformTouristTaxAmount ?? '',
    acompteCommission: ctx.form.acompteCommissionAmount ?? '',
  }));
  await waitFor(() => expect(screen.getByLabelText('Commission solde (€)')).toHaveValue('123,45'));
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformCommissionAmount: 123.45 }));
}

beforeEach(() => { vi.clearAllMocks(); });

test('rule 21 — direct reservation: the acompte is a normal row', () => {
  renderFinance({ form: { platform: 'direct' } });
  expect(within(document.querySelector('[data-row="deposit"]')).getByText('Acompte')).toBeInTheDocument();
  expect(screen.queryByText(/Sans objet/i)).not.toBeInTheDocument();
});

test('rule 21 — platform reservation: the acompte row says « Sans objet », with no action and no input', () => {
  renderFinance({ form: { platform: 'GitesDeFrance' } });
  const row = document.querySelector('[data-row="deposit"]');
  expect(within(row).getByText('Sans objet · Gîtes de France encaisse en une fois')).toBeInTheDocument();
  expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Échéance acompte/i)).not.toBeInTheDocument();
});

test('platform reservation: the payout row is the single encaissement, « Marquer reçu »', () => {
  renderFinance({ form: { platform: 'GitesDeFrance' } });
  expect(screen.getByText('Versement Gîtes de France')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer reçu' })).toBeInTheDocument();
});

// specs/platform-deposit-toggle.md — « Acompte = Oui »: the commission of the acompte is a statement field.
test('platform « Acompte = Oui »: the statement editor offers the acompte commission', () => {
  renderFinance({ form: { platform: 'Lodgify' }, pricingQuote: { platformTakesDeposit: true } });
  openStatement();
  expect(screen.getByLabelText('Commission acompte (€)')).toBeInTheDocument();
});

test('platform « Acompte = Non »: no acompte commission field', () => {
  renderFinance({ form: { platform: 'Airbnb' }, pricingQuote: { platformTakesDeposit: false } });
  openStatement();
  expect(screen.queryByLabelText('Commission acompte (€)')).not.toBeInTheDocument();
});

test('« Commission solde » is a statement field, « Prix payé par le client » is gone', () => {
  renderFinance({ form: { platform: 'Airbnb' } });
  openStatement();
  expect(screen.getByLabelText('Commission solde (€)')).toBeInTheDocument();
  expect(screen.queryByLabelText('Prix payé par le client')).not.toBeInTheDocument();
});

test('direct reservation: no statement fields, « Prix ajusté » is shown', () => {
  renderFinance({ form: { platform: 'direct' } });
  expect(screen.queryByLabelText('Commission solde (€)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Prix ajusté')).toBeInTheDocument();
});

test('platform: the brut is a statement field and « Prix ajusté » is hidden', () => {
  renderFinance({ form: { platform: 'GitesDeFrance' } });
  openStatement();
  expect(screen.getByLabelText('Montant total payé par le client')).toBeInTheDocument();
  expect(screen.queryByLabelText('Prix ajusté')).not.toBeInTheDocument();
});

test('« Annuler » leaves the fiche as it was', () => {
  const ctx = renderFinance({ form: { platform: 'GitesDeFrance' } });
  openStatement();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(ctx.updateForm).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Commission solde (€)')).not.toBeInTheDocument();
});

test('the reconciliation chip comes from the server, on the payout row', () => {
  renderLedger({
    form: { platform: 'GitesDeFrance' },
    ledger: ledgerOf([payoutRow('Versement Gîtes de France', { detail: { reconciliation: { tone: 'warning', label: 'écart : 26,00 €' } } })]),
  });
  expect(screen.getByText('écart : 26,00 €')).toBeInTheDocument();
});

// specs/platform-payment-calculer-button.md — « Calculer la commission » on demand, from the statement.
test('« Calculer la commission »: disabled until the montant client is filled', () => {
  renderFinance({ form: { platform: 'GitesDeFrance', platformPayoutAmount: 520 } });
  openStatement();
  expect(screen.getByRole('button', { name: /Calculer la commission/i })).toBeDisabled();
});

test('« Calculer la commission »: sends montant client and virement to the server', async () => {
  const ctx = renderFinance({ form: { platform: 'GitesDeFrance', platformGrossAmount: 600, platformPayoutAmount: 520 } });
  await calculate(ctx);
});

test('« Calculer la commission »: sends an already-entered acompte commission', async () => {
  const ctx = renderFinance({ form: { platform: 'Lodgify', platformGrossAmount: 600, platformPayoutAmount: 520, acompteCommissionAmount: 10 } });
  await calculate(ctx);
});

// specs/platform-brut-excludes-offered-tourist-tax.md rule 3 — the engine's tax estimate is never sent.
test('« Calculer la commission »: the engine\'s tax estimate is never sent (platform collects and remits)', async () => {
  const ctx = renderFinance({
    form: { platform: 'Airbnb', platformGrossAmount: 600, platformPayoutAmount: 520 },
    pricingQuote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 12 },
  });
  await calculate(ctx);
});

test('the Grimaud case: 733 facturé and 668 viré go to the server', async () => {
  const ctx = renderFinance({
    form: { platform: 'GitesDeFrance', platformGrossAmount: 733, platformPayoutAmount: 668 },
    pricingQuote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.4 },
  });
  await calculate(ctx);
});

// Rule 7 — which number to copy off the statement depends on the platform's tax mode.
test('brut field: the platform collects + remits the tax → « Total séjour facturé », hors taxe', () => {
  renderFinance({ form: { platform: 'GitesDeFrance' }, pricingQuote: { touristTaxOfferedByPlatform: true } });
  openStatement();
  expect(screen.getByLabelText('Total séjour facturé par la plateforme')).toBeInTheDocument();
  expect(screen.getByText(/hors taxe de séjour et hors frais de dossier/i)).toBeInTheDocument();
});

test('brut field: the platform reverses the tax to us → « Montant total payé », taxe comprise', () => {
  renderFinance({ form: { platform: 'Lodgify' }, pricingQuote: { touristTaxReversedByPlatform: true } });
  openStatement();
  expect(screen.getByLabelText('Montant total payé par le client')).toBeInTheDocument();
  expect(screen.getByText(/la plateforme la reverse avec le virement/i)).toBeInTheDocument();
});
