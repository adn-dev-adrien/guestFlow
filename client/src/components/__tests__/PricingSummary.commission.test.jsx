import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/platform-offered-tax-passthrough-and-cascade.md — the bottom of the summary is a running
// cascade: « Total du séjour » (gross = hébergement + toutes options/ressources + taxe) → deduct the
// tax the platform remits to the commune (offered) + the on-site compléments → « Montant soumis à
// commission » → − commission → « Versement plateforme » → + compléments → « Total perçu sur le
// séjour ». All figures engine-authoritative.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'airbnb', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 200, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0, depositDisabled: false,
};

function renderSummary(quote, form = FORM) {
  return render(
    <PricingSummary
      quote={quote}
      form={form}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay={'200.00'}
    />
  );
}

const QUOTE = { finalPrice: 250, totalStayPrice: 250, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0, touristTaxOriginalTotal: 0 };

test('full cascade: offered tax + complement + commission', () => {
  // gross 274.60 (finalPrice 265 + tax 9.60) − taxe 9.60 (→ commune) − compléments 15 = 250 (soumis à
  // commission) ; − 30 commission = 220 (versement) ; + 15 compléments = 235 (total perçu).
  renderSummary({
    ...QUOTE, finalPrice: 265, touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 9.60,
    complementAmount: 15, preArrivalAmount: 250, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 220, sejourNetTotal: 235,
  });
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  expect(screen.getByText('274,60 €')).toBeInTheDocument();           // gross
  expect(screen.getByText('Taxe de séjour (plateforme)')).toBeInTheDocument();
  expect(screen.getByText('− 9,60 €')).toBeInTheDocument();           // tax → commune
  // Deducted as one « perçu sur place » block, added back per complement (arrival / end-of-stay)
  // — specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 15.
  expect(screen.getByText('Compléments (perçus sur place)')).toBeInTheDocument();
  expect(screen.getByText('− 15,00 €')).toBeInTheDocument();
  expect(screen.getByText("Complément d'arrivée (perçu sur place)")).toBeInTheDocument();
  expect(screen.getByText('+ 15,00 €')).toBeInTheDocument();
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getByText('250,00 €')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 30,00 €')).toBeInTheDocument();
  expect(screen.getByText('Versement plateforme')).toBeInTheDocument();
  expect(screen.getByText('220,00 €')).toBeInTheDocument();
  expect(screen.getByText('Total perçu sur le séjour')).toBeInTheDocument();
  expect(screen.getByText('235,00 €')).toBeInTheDocument();
  // The old #302 labels are gone.
  expect(screen.queryByText('Versement Plateforme')).toBeNull(); // capital P (the old label)
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});

test('offered tax, no complement → « − Taxe de séjour (plateforme) » then « Montant soumis à commission »', () => {
  renderSummary({
    ...QUOTE, finalPrice: 200, touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 4.80,
    complementAmount: 0, preArrivalAmount: 195.20, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 165.20, sejourNetTotal: 165.20,
  });
  expect(screen.getByText('204,80 €')).toBeInTheDocument();           // gross = 200 + 4.80
  expect(screen.getByText('Taxe de séjour (plateforme)')).toBeInTheDocument();
  expect(screen.getByText('− 4,80 €')).toBeInTheDocument();
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getByText('195,20 €')).toBeInTheDocument();
  expect(screen.queryByText('Compléments (perçus sur place)')).toBeNull(); // no complement
});

// specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 15 — le complément de fin de séjour
// (ménage/linge du SAS + prestations vendues en cours de séjour) est perçu sur place comme celui
// d'arrivée : il se déduit du montant soumis à commission et revient dans le total perçu.
test('complément de fin de séjour : sa propre ligne, déduite puis rajoutée au total perçu', () => {
  // 250 finalPrice (dont 12 vendus en cours de séjour) + 60 de ménage facturé au départ = 310 brut.
  renderSummary({
    ...QUOTE, finalPrice: 250, complementAmount: 15, endOfStayComplementTotal: 72, midStayExtrasTotal: 12,
    preArrivalAmount: 223, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 193, sejourNetTotal: 280,
  });
  expect(screen.getByText('310,00 €')).toBeInTheDocument();            // 250 + 60 (part SAS)
  expect(screen.getByText('− 87,00 €')).toBeInTheDocument();           // 15 + 72 perçus sur place
  expect(screen.getByText("Complément d'arrivée (perçu sur place)")).toBeInTheDocument();
  expect(screen.getByText('+ 15,00 €')).toBeInTheDocument();
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText('+ 72,00 €')).toBeInTheDocument();
  expect(screen.getByText('280,00 €')).toBeInTheDocument();            // total perçu
});

test('direct : le complément de fin de séjour apparaît sous le total du séjour', () => {
  renderSummary(
    { ...QUOTE, finalPrice: 200, complementAmount: 0, endOfStayComplementTotal: 12, midStayExtrasTotal: 12, sejourNetTotal: 212 },
    { ...FORM, platform: 'direct' },
  );
  expect(screen.getByText('dont complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText('12,00 €')).toBeInTheDocument();
});

test('platform with commission, no tax/complement → no deduction sub-lines, just Versement + Total perçu', () => {
  renderSummary({
    ...QUOTE, finalPrice: 250, touristTaxOriginalTotal: 0, complementAmount: 0, preArrivalAmount: 250,
    acompteCommissionAmount: 9, platformCommissionAmount: 21, totalPlatformCommission: 30, platformNetReceivedAmount: 220, sejourNetTotal: 220,
  });
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  // No tax / complement deduction → no « Montant soumis à commission » intermediate line.
  expect(screen.queryByText('Montant soumis à commission')).toBeNull();
  expect(screen.queryByText('Taxe de séjour (plateforme)')).toBeNull();
  expect(screen.getByText('Commission acompte')).toBeInTheDocument();
  expect(screen.getByText('− 9,00 €')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 21,00 €')).toBeInTheDocument();
  expect(screen.getByText('Versement plateforme')).toBeInTheDocument();
  expect(screen.getByText('Total perçu sur le séjour')).toBeInTheDocument();
});

test('non-offered platform → NO « Taxe de séjour (plateforme) » deduction line', () => {
  renderSummary({
    ...QUOTE, finalPrice: 250, touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 12, touristTaxTotal: 12,
    complementAmount: 0, preArrivalAmount: 262, platformCommissionAmount: 30, totalPlatformCommission: 30, platformNetReceivedAmount: 232, sejourNetTotal: 232,
  });
  expect(screen.queryByText('Taxe de séjour (plateforme)')).toBeNull();
  expect(screen.queryByText('− 12,00 €')).toBeNull();
});

// specs/platform-per-echeance-commission.md — the Acompte / Solde lines show the GROSS the guest pays
// (the stored amount), under the labels « Montant acompte/solde payé par le client ». The commission +
// net « Versement plateforme » live in the cascade above. Resolved 2026-07-16 (Damien Nicolet): a
// « payé par le client » figure must NOT have the commission silently subtracted.
test('Acompte / Solde lines show the client-paid GROSS under the « payé par le client » labels', () => {
  render(
    <PricingSummary
      quote={{ ...QUOTE, finalPrice: 200, totalStayPrice: 200, acompteCommissionAmount: 3.41, platformCommissionAmount: 2.61, totalPlatformCommission: 6.02, platformNetReceivedAmount: 193.98 }}
      form={{ ...FORM, depositAmount: 60, balanceAmount: 140 }}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()} propertyOptions={[]} availableResources={[]}
      parsedTotalPrice={200} accommodationDiscountedPriceDisplay={'200.00'}
    />
  );
  expect(screen.getByText('Montant acompte payé par le client')).toBeInTheDocument();
  expect(screen.getByText('Montant solde payé par le client')).toBeInTheDocument();
  expect(screen.getByText('60,00 €')).toBeInTheDocument();   // acompte GROSS (not 56,59)
  expect(screen.getByText('140,00 €')).toBeInTheDocument();  // solde GROSS (not 137,39)
  // The old net-of-commission captions are gone (commission shown in the cascade instead).
  expect(screen.queryByText(/net de la commission acompte/i)).toBeNull();
  expect(screen.queryByText(/net de la commission solde/i)).toBeNull();
});

// Damien Nicolet regression (2026-07-16): the entered deposit/balance is the client-paid GROSS, shown
// as-is under the « payé par le client » label. Guest pays 126,38 per échéance (= Adrien's 122,97 net
// take + 3,41 Lodgify commission) → both lines show 126,38. Locks the reported prod scenario.
test('Acompte / Solde show the client-paid gross — Damien Nicolet BRUT case', () => {
  render(
    <PricingSummary
      quote={{ ...QUOTE, finalPrice: 252.76, totalStayPrice: 252.76, acompteCommissionAmount: 3.41, platformCommissionAmount: 3.41, totalPlatformCommission: 6.82, platformNetReceivedAmount: 245.94 }}
      form={{ ...FORM, depositAmount: 126.38, balanceAmount: 126.38 }}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()} propertyOptions={[]} availableResources={[]}
      parsedTotalPrice={252.76} accommodationDiscountedPriceDisplay={'252.76'}
    />
  );
  // Both échéances show the client-paid gross 126,38 (the 122,97 net take is the « Versement »).
  expect(screen.getAllByText('126,38 €').length).toBeGreaterThanOrEqual(2);
});

// Direct reservations keep the plain « Acompte » / « Solde » labels (no commission, no gross/net gap).
test('Direct reservation keeps the plain Acompte / Solde labels', () => {
  render(
    <PricingSummary
      quote={{ ...QUOTE, finalPrice: 200, totalStayPrice: 200 }}
      form={{ ...FORM, platform: 'direct', depositAmount: 60, balanceAmount: 140 }}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()} propertyOptions={[]} availableResources={[]}
      parsedTotalPrice={200} accommodationDiscountedPriceDisplay={'200.00'}
    />
  );
  expect(screen.getByText('Acompte')).toBeInTheDocument();
  expect(screen.getByText('Solde')).toBeInTheDocument();
  expect(screen.queryByText('Montant acompte payé par le client')).toBeNull();
});

test('direct reservation → a single « Total du séjour », no platform cascade', () => {
  renderSummary(
    { ...QUOTE, finalPrice: 250, touristTaxTotal: 10, touristTaxOriginalTotal: 10, complementAmount: 0, sejourNetTotal: 260 },
    { ...FORM, platform: 'direct' }
  );
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  expect(screen.getByText('260,00 €')).toBeInTheDocument(); // 250 + 10 tax
  expect(screen.queryByText('Montant soumis à commission')).toBeNull();
  expect(screen.queryByText('Versement plateforme')).toBeNull();
  expect(screen.queryByText('Total perçu sur le séjour')).toBeNull();
});

// specs/mid-stay-notes.md §3.5 rule 19 — les encaissements en séjour se déduisent du montant soumis
// à commission comme les compléments, et reviennent sur leur propre ligne dans le total perçu.
test('encaissements en séjour : ligne dédiée dans la cascade', () => {
  renderSummary({
    ...QUOTE, finalPrice: 250, complementAmount: 15,
    endOfStayComplementTotal: 12, midStayRemainingTotal: 12, midStaySettledTotal: 30,
    preArrivalAmount: 205, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 175, sejourNetTotal: 232,
  });
  expect(screen.getByText('− 57,00 €')).toBeInTheDocument();          // 15 + 12 + 30 perçus sur place
  expect(screen.getByText('Encaissements en séjour')).toBeInTheDocument();
  expect(screen.getByText('+ 30,00 €')).toBeInTheDocument();
  expect(screen.getByText('232,00 €')).toBeInTheDocument();
});

test('direct : « dont encaissements en séjour » sous le total du séjour', () => {
  renderSummary(
    {
      ...QUOTE, finalPrice: 200, complementAmount: 0, endOfStayComplementTotal: 0,
      midStayRemainingTotal: 0, midStaySettledTotal: 18, sejourNetTotal: 200,
    },
    { ...FORM, platform: 'direct' },
  );
  expect(screen.getByText('dont encaissements en séjour')).toBeInTheDocument();
  expect(screen.getByText('18,00 €')).toBeInTheDocument();
});
