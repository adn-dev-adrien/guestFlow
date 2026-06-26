import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

// specs/accounting-platform-commission-and-no-deposit.md §3.8 rule 21 + §7.3.
// The Acompte block is HIDDEN on non-direct platform reservations (replaced by a muted
// caption "Pas d'acompte (réservation plateforme — virement unique)"). Direct bookings
// keep the regular Acompte block.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <FinanceSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test("direct reservation: the Acompte block is rendered as usual", () => {
  renderFinance({ form: { platform: 'direct' } });
  // The Acompte heading sits in its own Grid column — present on direct.
  const acompteHeadings = screen.getAllByText('Acompte');
  expect(acompteHeadings.length).toBeGreaterThan(0);
  // The platform caption MUST NOT be present.
  expect(screen.queryByText(/Pas d'acompte/i)).not.toBeInTheDocument();
});

test("platform reservation (Airbnb): Acompte block is replaced by the no-deposit caption", () => {
  renderFinance({ form: { platform: 'Airbnb' } });
  // The caption is the user-facing signal that the platform has no deposit concept.
  expect(screen.getByText(/Pas d'acompte \(réservation plateforme — virement unique\)/i)).toBeInTheDocument();
});

test("platform reservation: the regular Acompte fields (échéance, montant) are NOT mounted", () => {
  renderFinance({ form: { platform: 'Gîtes de France' } });
  // The "Échéance acompte" field belongs to the direct-mode Acompte block; on a platform
  // reservation the whole block is gone so the input must not be in the DOM.
  expect(screen.queryByLabelText(/Échéance acompte/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Marquer acompte payé/i)).not.toBeInTheDocument();
});

test("platform reservation: the Solde block stays rendered (it's the single encaissement on platforms)", () => {
  renderFinance({ form: { platform: 'Booking', balanceAmount: 200 } });
  // The Solde block is unaffected — it just absorbs the whole pre-arrival amount on platforms.
  const soldeHeadings = screen.getAllByText('Solde');
  expect(soldeHeadings.length).toBeGreaterThan(0);
});

// specs/platform-deposit-toggle.md — a platform configured « Acompte = Oui » (the engine echoes
// `platformTakesDeposit` in the quote) shows the normal Acompte block, NOT the no-deposit caption.
test("platform « Acompte = Oui »: the Acompte block is shown (no no-deposit caption)", () => {
  renderFinance({
    form: { platform: 'Lodgify' },
    pricingQuote: { platformTakesDeposit: true, finalPrice: 300, totalStayPrice: 300 },
  });
  expect(screen.queryByText(/Pas d'acompte/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Échéance acompte/i)).toBeInTheDocument();
  expect(screen.getByText(/Marquer acompte payé/i)).toBeInTheDocument();
});

test("platform « Acompte = Non » (default): the no-deposit caption stays", () => {
  renderFinance({
    form: { platform: 'Lodgify' },
    pricingQuote: { platformTakesDeposit: false, finalPrice: 300, totalStayPrice: 300 },
  });
  expect(screen.getByText(/Pas d'acompte/i)).toBeInTheDocument();
});

test("case-insensitive Direct enum: 'Direct' / 'DIRECT' keep the regular Acompte block", () => {
  // The code path uses `String(form.platform || 'direct').toLowerCase() !== 'direct'` so any
  // casing variant of 'direct' should NOT trigger the platform caption.
  for (const directVariant of ['direct', 'Direct', 'DIRECT']) {
    const { unmount } = render(
      <ReservationFormProvider value={makeMockContext({ form: { platform: directVariant } })}>
        <FinanceSection />
      </ReservationFormProvider>
    );
    expect(screen.queryByText(/Pas d'acompte/i)).not.toBeInTheDocument();
    unmount();
  }
});

// specs/platform-per-echeance-commission.md (2026-06-22) — commission is entered per échéance: a
// « Commission solde (€) » field in the Solde block (= the former « Commission plateforme »). « Prix
// payé par le client » stays retired.
test('platform reservation: « Commission solde » is shown, « Prix payé par le client » is gone', () => {
  renderFinance({ form: { platform: 'Airbnb' } });
  expect(screen.getByLabelText('Commission solde (€)')).toBeInTheDocument();
  expect(screen.queryByLabelText('Prix payé par le client')).not.toBeInTheDocument();
});

test('direct reservation: no per-échéance commission fields', () => {
  renderFinance({ form: { platform: 'direct' } });
  expect(screen.queryByLabelText('Commission solde (€)')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Commission acompte (€)')).not.toBeInTheDocument();
});

// specs/platform-payment-entry.md + platform-per-echeance-commission.md — the « Paiement plateforme »
// block now holds the brut + virement (the commission moved to the per-échéance Acompte/Solde blocks);
// « Prix ajusté » stays hidden on platform.
test('platform: the brut + virement fields render (commission moved out) + « Prix ajusté » is hidden', () => {
  renderFinance({ form: { platform: 'Gîtes de France' } });
  expect(screen.getByLabelText('Montant total payé par le client')).toBeInTheDocument();
  expect(screen.getByLabelText('Virement reçu (contrôle)')).toBeInTheDocument();
  expect(screen.queryByLabelText('Commission plateforme')).not.toBeInTheDocument(); // moved to the Solde block
  expect(screen.queryByLabelText('Prix ajusté')).not.toBeInTheDocument();
});

test('direct: « Prix ajusté » is shown, no platform-payment block', () => {
  renderFinance({ form: { platform: 'direct' } });
  expect(screen.getByLabelText('Prix ajusté')).toBeInTheDocument();
  expect(screen.queryByLabelText('Montant total payé par le client')).not.toBeInTheDocument();
});

test('platform: ✓ chip when the net perçu matches the virement', () => {
  renderFinance({
    form: { platform: 'Gîtes de France', platformPayoutAmount: 626 },
    pricingQuote: { totalStayPrice: 687, finalPrice: 687, platformNetReceivedAmount: 626 },
  });
  expect(screen.getByText(/cohérent avec le virement/i)).toBeInTheDocument();
  expect(screen.queryByText(/écart/i)).not.toBeInTheDocument();
});

test('platform: ✗ écart chip when the net perçu differs from the virement', () => {
  renderFinance({
    form: { platform: 'Gîtes de France', platformPayoutAmount: 600 },
    pricingQuote: { totalStayPrice: 687, finalPrice: 687, platformNetReceivedAmount: 626 },
  });
  expect(screen.getByText(/écart : 26\.00€/i)).toBeInTheDocument();
});

// specs/platform-payment-calculer-button.md — « Calculer la commission » deduces the solde commission
// from the entered amounts (montant client − virement − commission acompte). On-demand only; editable.
test('« Calculer la commission »: disabled until both montant client + virement are filled', () => {
  renderFinance({ form: { platform: 'Gîtes de France', platformGrossAmount: 600 } }); // virement missing
  expect(screen.getByRole('button', { name: /Calculer la commission/i })).toBeDisabled();
});

test('« Calculer la commission »: fills Commission solde = montant client − virement (no acompte)', () => {
  const ctx = renderFinance({ form: { platform: 'Gîtes de France', platformGrossAmount: 600, platformPayoutAmount: 520 } });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 80 });
});

test('« Calculer la commission »: subtracts an already-entered acompte commission', () => {
  const ctx = renderFinance({ form: {
    platform: 'Lodgify', platformGrossAmount: 600, platformPayoutAmount: 520, acompteCommissionAmount: 10,
  } });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  // 600 − 520 − 10 = 70 ; the acompte commission itself is left untouched.
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 70 });
});

// specs/platform-commission-minus-offered-tax.md — when the platform COLLECTS the tourist tax AND
// remits it to the commune itself (« platform » case, touristTaxOfferedByPlatform), the brut includes
// that tax and the platform withholds it from the virement on top of its commission. The commission
// = montant client − virement − commission acompte − taxe ; otherwise the commission (and the figure
// booked in compta) is over-stated by the tourist tax.
test('« Calculer la commission »: subtracts the tourist tax when the platform collects + remits it to the commune', () => {
  const ctx = renderFinance({
    form: { platform: 'Airbnb', platformGrossAmount: 600, platformPayoutAmount: 520 },
    pricingQuote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 12 },
  });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  // 600 − 520 − 0 − 12 (tax → commune) = 68
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 68 });
});

test('« Calculer la commission »: does NOT subtract the tax when it is not offered (reversed / owner / direct)', () => {
  const ctx = renderFinance({
    form: { platform: 'Lodgify', platformGrossAmount: 600, platformPayoutAmount: 520 },
    pricingQuote: { touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 12 },
  });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 80 }); // 600 − 520, tax not subtracted
});

test('owner-collect platform, no commission: the on-arrival tax is excluded → no écart (regression)', () => {
  // specs/platform-payment-entry.md — for a platform that does NOT collect the tax (we charge it at
  // check-in → complement), the platform only settles the pre-arrival. With no commission entered, the
  // server returns platformNetReceivedAmount = null, so the client fallback must subtract the complement
  // (the 4.80 tax) from the total. Operator received the 200 pre-arrival → écart 0, NOT 4.80.
  renderFinance({
    form: { platform: 'Gîtes de France', platformPayoutAmount: 200 },
    pricingQuote: { totalStayPrice: 204.80, finalPrice: 200, complementAmount: 4.80, balanceAmount: 200, platformNetReceivedAmount: null },
  });
  expect(screen.getByText('200.00€')).toBeInTheDocument();           // net perçu = pre-arrival, tax excluded
  expect(screen.getByText(/cohérent avec le virement/i)).toBeInTheDocument();
  expect(screen.queryByText(/écart/i)).not.toBeInTheDocument();
});
