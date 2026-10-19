// specs/reservation-payment-ledger.md — LedgerList renders the server's rows verbatim (rules 1, 3-6),
// one action per row at most, the closing line (rule 5), and the two-line layout under 600 px (§6).
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import LedgerList from '../LedgerList';
import { formatCurrency } from '../../utils/formatters';

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const ROWS = [
  { key: 'deposit', label: 'Acompte', amount: 252, state: 'paid', tone: 'done', stateLabel: 'Perçu le 12/08 · lien de paiement',
    action: { kind: 'undo', label: 'Annuler' }, amountEdit: { editable: false, mode: 'paid', reason: 'Acompte perçu le 12/08.' } },
  { key: 'balance', label: 'Solde', amount: 614.4, state: 'late', tone: 'late', stateLabel: 'En retard depuis le 22/06',
    action: { kind: 'mark', label: 'Marquer perçu' }, amountEdit: { editable: true, mode: 'split', min: 26.4, max: 866.4, reason: null } },
  { key: 'caution', label: 'Caution', amount: null, state: 'na', tone: 'muted', stateLabel: 'Sans objet', action: null, amountEdit: NONE },
];

function renderList(props = {}) {
  const onAction = vi.fn();
  const onAmountClick = vi.fn();
  render(
    <LedgerList
      rows={ROWS}
      closing={{ label: 'Reste à percevoir', amount: 614.4 }}
      formatAmount={formatCurrency}
      onAction={onAction}
      onAmountClick={onAmountClick}
      {...props}
    />,
  );
  return { onAction, onAmountClick };
}

test('rules 1, 3, 4 — each row prints the server\'s label, amount and state, in the server\'s order', () => {
  renderList();
  const keys = [...document.querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row'));
  expect(keys).toEqual(['deposit', 'balance', 'caution']);
  const balance = document.querySelector('[data-row="balance"]');
  expect(within(balance).getByText('Solde')).toBeInTheDocument();
  expect(within(balance).getByText('En retard depuis le 22/06')).toBeInTheDocument();
  expect(within(balance).getByRole('button', { name: /Modifier le montant : Solde/ })).toHaveTextContent('614,40');
});

test('rule 3 — one action per row, at most; a not-applicable row has none (rule 6)', () => {
  const { onAction } = renderList();
  const deposit = document.querySelector('[data-row="deposit"]');
  expect(within(deposit).getAllByRole('button').map((b) => b.textContent)).toEqual(['252,00 €', 'Annuler']);
  const caution = document.querySelector('[data-row="caution"]');
  expect(within(caution).queryByRole('button')).toBeNull();
  expect(within(caution).getByText('—')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Marquer perçu' }));
  expect(onAction).toHaveBeenCalledWith(ROWS[1]);
});

test('rule 15 — an editable amount is a « Modifier » affordance; a locked one says it is fixed', () => {
  const { onAmountClick } = renderList();
  fireEvent.click(screen.getByRole('button', { name: /Montant figé : Acompte/ }));
  expect(onAmountClick).toHaveBeenCalledWith(ROWS[0]);
});

test('rule 5 — the closing line: « Reste à percevoir » and its amount, or « Tout est perçu »', () => {
  renderList();
  const closing = screen.getByTestId('ledger-closing');
  expect(within(closing).getByText('Reste à percevoir')).toBeInTheDocument();
  expect(within(closing).getByText('614,40 €')).toBeInTheDocument();
});

test('rule 5 — settled: « Tout est perçu » without an amount', () => {
  renderList({ closing: { label: 'Tout est perçu', amount: null } });
  const closing = screen.getByTestId('ledger-closing');
  expect(closing).toHaveTextContent('Tout est perçu');
  expect(within(closing).queryByText(/€/)).toBeNull();
});

test('read-only: no action, no amount affordance', () => {
  renderList({ readOnly: true });
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('an open row shows its panel in place of its action', () => {
  renderList({ openKey: 'balance', renderPanel: (row) => <div>panel {row.key}</div> });
  expect(screen.getByText('panel balance')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Marquer perçu' })).toBeNull();
});

test('§6 xs layout — two lines under 600 px (label + amount, then state + action); one line wider', () => {
  renderList();
  const grid = document.querySelector('[data-row="balance"] > div');
  const style = window.getComputedStyle(grid);
  expect(style.display).toBe('grid');
  expect(style.gridTemplateAreas.replace(/\s+/g, ' ')).toContain('"label amount" "state action"');
});
