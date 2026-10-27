// Shared fixtures of the FinanceSection suites (specs/reservation-payment-ledger.md): server-shaped
// ledger rows, so each suite renders the ledger the way the server sends it, and a render helper.
import React from 'react';
import { render } from '@testing-library/react';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };

export function dueRow(key, label, amount, extra = {}) {
  return {
    key, label, amount, state: 'due', tone: 'due', stateLabel: 'À percevoir avant le 26/10',
    action: { kind: 'mark', label: 'Marquer perçu' }, amountEdit: NONE, detail: null, ...extra,
  };
}

export function paidRow(key, label, amount, extra = {}) {
  return {
    key, label, amount, state: 'paid', tone: 'done', stateLabel: 'Perçu le 12/10',
    action: { kind: 'undo', label: 'Annuler', confirm: `Annuler la perception du ${label.toLowerCase()} du 12/10 ? L'écriture comptable correspondante disparaît.` },
    amountEdit: NONE, detail: null, ...extra,
  };
}

export function naRow(key, label, stateLabel) {
  return { key, label, amount: null, state: 'na', tone: 'muted', stateLabel, action: null, amountEdit: NONE, detail: null };
}

export const editable = (mode, extra = {}) => ({ editable: true, mode, min: null, max: null, reason: null, ...extra });

export function ledgerOf(rows, closing = { label: 'Reste à percevoir', amount: 100 }) {
  return { rows, closing, remaining: closing.amount || 0 };
}

export function renderFinance(overrides = {}) {
  const ctx = makeMockContext(overrides);
  const utils = render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return { ctx, ...utils };
}
