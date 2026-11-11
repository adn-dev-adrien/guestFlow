// specs/accounting-synthesis.md §3 rules 25, 26 and 30 — the four figures of the synthesis as the server sends them:
// definition, secondary line, source, pill against last year; one notice when there is none; the regime's mention
// instead of a VAT figure; the tourist tax's reason on a cut month.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingSynthesisTab from '../AccountingSynthesisTab';
import { synthesisPayload, NOT_COMPARABLE } from './synthesisFixtures';

const renderTab = (data) => render(
  <ThemeProvider theme={theme}><MemoryRouter>
    <AccountingSynthesisTab data={data} canOpenReservation onOpenEntriesMonth={() => {}} />
  </MemoryRouter></ThemeProvider>,
);
const tile = (label) => screen.getAllByTestId('kpi-tile').find((t) => within(t).queryByText(label));

test('rule 25 — each tile: value, secondary line, definition and the pill « ↑ +21,3 % (N-1 : …) »', () => {
  renderTab(synthesisPayload());
  expect(screen.getAllByTestId('kpi-tile')).toHaveLength(4);
  const revenue = tile('CA HT');
  expect(revenue).toHaveTextContent(/18\s450,30\s€/);
  expect(revenue).toHaveTextContent(/TTC : 20\s295\s€/);
  expect(revenue).toHaveTextContent(/↑\s?\+21,3\s%/);
  expect(revenue).toHaveTextContent(/N-1 : 15\s211\s€/);
  expect(within(revenue).getByRole('button', { name: 'Définition : CA HT' })).toBeInTheDocument();
  expect(tile('Encaissé')).toHaveTextContent('96 paiements');
  expect(tile('Taxe de séjour')).toHaveTextContent('41 séjours');
  expect(tile('TVA à déclarer')).toHaveTextContent(/dont 10 % : 1\s741\s€/);
});

test('rule 30 — every tile says what it is computed on', () => {
  renderTab(synthesisPayload());
  expect(tile('CA HT')).toHaveTextContent('Sur les montants des séjours');
  expect(tile('Taxe de séjour')).toHaveTextContent('Sur les montants des séjours');
  expect(tile('Encaissé')).toHaveTextContent('Sur les encaissements');
  expect(tile('TVA à déclarer')).toHaveTextContent('Sur les encaissements');
});

test('rule 26 — no comparable year: every pill reads « — vs N-1 » and one notice gives the server\'s sentence', () => {
  const data = synthesisPayload({ comparison: NOT_COMPARABLE });
  Object.values(data.kpis).forEach((k) => { k.yoy = null; });
  renderTab(data);
  expect(screen.getAllByText('— vs N-1')).toHaveLength(4);
  expect(screen.getAllByText(NOT_COMPARABLE.notice)).toHaveLength(1);
});

test('rule 26 — a partial comparison shows its note once; a complete one shows none', () => {
  const partial = synthesisPayload({ comparison: { ...synthesisPayload().comparison, complete: false, notice: 'Comparaison sur 2 mois sur 3 : un mois en cours se compare une fois terminé.' } });
  const { unmount } = renderTab(partial);
  expect(screen.getByText(/Comparaison sur 2 mois sur 3/)).toBeInTheDocument();
  unmount();
  renderTab(synthesisPayload());
  expect(screen.queryByText(/Comparaison sur/)).toBeNull();
});

test('rule 25 — outside the VAT the tile names the regime, with no figure and no pill', () => {
  const data = synthesisPayload();
  data.kpis.vat = { ...data.kpis.vat, amount: null, yoy: null, notSubject: { regime: 'not_subject', mention: 'art_293_b', label: 'Franchise en base de TVA' } };
  renderTab(data);
  const vat = tile('TVA à déclarer');
  expect(vat).toHaveTextContent('Franchise en base de TVA');
  expect(within(vat).queryByText('— vs N-1')).toBeNull();
  expect(vat).not.toHaveTextContent('€');
  expect(screen.getByText('Franchise en base de TVA : aucune TVA à déclarer.')).toBeInTheDocument();
});

test('rule 25 — a cut month: the tourist tax tile gives its reason, no pill', () => {
  const data = synthesisPayload();
  data.kpis.touristTax = { ...data.kpis.touristTax, amount: null, stays: null, yoy: null, reason: 'La taxe de séjour se déclare par mois entiers.' };
  renderTab(data);
  const tax = tile('Taxe de séjour');
  expect(tax).toHaveTextContent('—');
  expect(tax).toHaveTextContent('La taxe de séjour se déclare par mois entiers.');
  expect(within(tax).queryByText('— vs N-1')).toBeNull();
});
