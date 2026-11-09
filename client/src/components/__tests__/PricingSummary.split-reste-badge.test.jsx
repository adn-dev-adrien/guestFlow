// specs/mixed-method-payments.md rule 16 (audit R34-C-L3) — a solde paid with several methods that left a « Reste à
// percevoir » is not settled: the summary's badge reads the ledger's state, never the green « Solde payé ».
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import PricingSummary from '../PricingSummary';

const QUOTE = { finalPrice: 907.2, totalPrice: 907.2, touristTaxTotal: 0, depositAmount: 0, balanceAmount: 907.2, nightlyBreakdown: [] };
const FORM = { platform: 'direct', depositDisabled: true, depositAmount: 0, balanceAmount: 907.2, balancePaid: 1 };
const view = (ledgerRows) => render(
  <PricingSummary quote={QUOTE} form={FORM} offeredOptionIds={new Set()} onToggleExtraGuestOffered={vi.fn()} ledgerRows={ledgerRows} />,
);

test('rule 16 — a reste still due on the solde: « Perçu en partie », not « Solde payé »', () => {
  view([{ key: 'balance', stateLabel: 'Perçu en partie', split: { remainders: [{ targetKind: 'bucket', targetKey: 'balance', dueCents: 720 }] } }]);
  expect(screen.getByText('Perçu en partie')).toBeInTheDocument();
  expect(screen.queryByText('Solde payé')).toBeNull();
});

test('rule 16 — no reste: the solde reads « Solde payé » as before', () => {
  view([{ key: 'balance', stateLabel: 'Perçu le 08/11 · plusieurs moyens', split: { remainders: [] } }]);
  expect(screen.getByText('Solde payé')).toBeInTheDocument();
  view(null);
  expect(screen.getAllByText('Solde payé').length).toBe(2);
});
