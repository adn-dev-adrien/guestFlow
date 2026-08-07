import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/complement-buckets-by-moment.md — le panneau range chaque montant sous le MOMENT où il est
// encaissé. Il ne décide de rien : le serveur envoie `quote.complementSplit`, on vérifie qu'il est
// rendu tel quel (et que l'ancien libellé « perçu en fin de séjour » sur la ligne d'arrivée a disparu).

const FORM = {
  startDate: '2026-08-01', endDate: '2026-08-15', finalPrice: 1200, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 1200, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0, depositDisabled: false,
};

const QUOTE = {
  finalPrice: 1200, totalStayPrice: 1200, nights: 14, optionLines: [], resourceLines: [],
  touristTaxTotal: 0, touristTaxOriginalTotal: 0,
};

function renderSummary(quote, form = FORM) {
  return render(
    <PricingSummary
      quote={{ ...QUOTE, ...quote }}
      form={{ ...FORM, ...form }}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={1200}
      accommodationDiscountedPriceDisplay={'1200.00'}
    />
  );
}

test('séjour en cours, complément non encaissé : il est rangé en fin de séjour, pas à l’arrivée', () => {
  renderSummary(
    // Le serveur a déjà déplacé les 40 € : arrival = 0.
    { complementAmount: 40, complementSplit: { arrival: 0, duringStay: 0, endOfStay: 40 }, endOfStayComplementTotal: 40 },
    { complementDeferredToCheckout: true, complementPaid: false },
  );

  expect(screen.getByText('dont complément de fin de séjour')).toBeInTheDocument();
  expect(screen.queryByText("dont complément d'arrivée")).not.toBeInTheDocument();
  // L'ancien libellé de contournement ne doit plus exister nulle part.
  expect(screen.queryByText('dont complément perçu en fin de séjour')).not.toBeInTheDocument();
  expect(screen.queryByText('dont complément à percevoir sur place')).not.toBeInTheDocument();
});

test('avant l’arrivée : tout reste sous le complément d’arrivée', () => {
  renderSummary(
    { complementAmount: 40, complementSplit: { arrival: 40, duringStay: 0, endOfStay: 0 } },
    { complementPaid: false },
  );

  expect(screen.getByText("dont complément d'arrivée")).toBeInTheDocument();
  expect(screen.queryByText('dont complément de fin de séjour')).not.toBeInTheDocument();
});

test('les trois moments cohabitent, chacun avec son montant', () => {
  renderSummary({
    complementAmount: 24,
    complementSplit: { arrival: 24, duringStay: 17, endOfStay: 6.5 },
    endOfStayComplementTotal: 6.5,
    midStaySettledTotal: 17,
  }, { complementPaid: true });

  expect(screen.getByText("dont complément d'arrivée")).toBeInTheDocument();
  expect(screen.getByText('dont complément durant le séjour')).toBeInTheDocument();
  expect(screen.getByText('dont complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText('24,00 €')).toBeInTheDocument();
  expect(screen.getByText('17,00 €')).toBeInTheDocument();
  expect(screen.getByText('6,50 €')).toBeInTheDocument();
});

test('sans `complementSplit` (ancien payload) : repli sur le compléments d’arrivée, sans planter', () => {
  renderSummary({ complementAmount: 40 }, { complementPaid: false });
  expect(screen.getByText("dont complément d'arrivée")).toBeInTheDocument();
});
