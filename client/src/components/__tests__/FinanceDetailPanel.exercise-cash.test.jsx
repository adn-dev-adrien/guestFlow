// specs/mobile-dashboard-exercise-cash.md rules 16-17 — « Reste à encaisser » and « Encaissé » list one line per payment,
// grouped by month with the month's subtotal, the late group first; a line opens the fiche.
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import FinanceDetailPanel from '../FinanceDetailPanel';

const row = (over) => ({ reservationId: 1, kind: 'balance', label: 'Solde', clientName: 'Jean Dupont', propertyName: 'Gîte', platform: 'direct', amount: 100, late: false, ...over });
// date-literal-ok: a server payload the component renders as given; nothing compares it with today
const LATE = row({ reservationId: 7, date: '2026-09-15', dateLabel: '15 sept. 2026', label: 'Versement Airbnb', clientName: 'Sophie Bernard', amount: 425, late: true });
// date-literal-ok: a server payload the component renders as given; nothing compares it with today
const DEC = row({ reservationId: 8, date: '2026-12-02', dateLabel: '2 déc. 2026', label: 'Échéance 2/3', clientName: 'Luc Martin', amount: 150 });
// date-literal-ok: a server payload the component renders as given; nothing compares it with today
const DEC_2 = row({ reservationId: 9, date: '2026-12-20', dateLabel: '20 déc. 2026', label: 'Complément d\'arrivée', clientName: 'Éva Roy', amount: 20 });
const TO_COLLECT = {
  groups: [
    { key: 'late', label: 'En retard', total: 425, rows: [LATE] },
    { key: '2026-12', label: 'Décembre 2026', total: 170, rows: [DEC, DEC_2] },
  ],
  rows: [LATE, DEC, DEC_2],
  totals: { amount: 595, payments: 3 },
};
const COLLECTED = {
  groups: [
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    { key: '2026-11', label: 'Novembre 2026', total: 150, rows: [row({ reservationId: 3, date: '2026-11-01', dateLabel: '1 nov. 2026', clientName: 'Zoé', amount: 150 })] },
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    { key: '2026-09', label: 'Septembre 2026', total: 60, rows: [row({ reservationId: 4, date: '2026-09-02', dateLabel: '2 sept. 2026', clientName: 'Paul', label: 'Acompte', amount: 100 }), row({ reservationId: 4, date: '2026-09-03', dateLabel: '3 sept. 2026', clientName: 'Paul', label: 'Remboursement', amount: -40 })] },
  ],
  rows: [],
  totals: { amount: 210, count: 3 },
};
COLLECTED.rows = COLLECTED.groups.flatMap((g) => g.rows);

const renderPanel = (tile, data, over = {}) => render(
  <ThemeProvider theme={theme}>
    <FinanceDetailPanel
      id="d" tile={tile} data={data} loading={false} error={false} onRetry={() => {}} windowLabel="Exercice 2026"
      staysScope="window" onStaysScopeChange={() => {}} onClose={() => {}} onOpenReservation={() => {}}
      onSettleOverdue={() => {}} onSelectProperty={() => {}} {...over}
    />
  </ThemeProvider>,
);

test('« Reste à encaisser » shows the late group first, then the months, each with its subtotal', () => {
  renderPanel('toCollect', TO_COLLECT);
  const sections = screen.getAllByRole('region').filter((r) => r.tagName === 'SECTION');
  expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['En retard', 'Décembre 2026']);
  expect(sections[0]).toHaveTextContent('425,00');
  expect(sections[1]).toHaveTextContent('170,00');
  const lines = within(sections[1]).getAllByRole('button');
  expect(lines[0]).toHaveTextContent('2 déc. 2026');
  expect(lines[0]).toHaveTextContent('Luc Martin');
  expect(lines[0]).toHaveTextContent('Échéance 2/3');
  expect(lines[1]).toHaveTextContent('20 déc. 2026');
});

test('« Reste à encaisser » ends on the total, equal to the tile', () => {
  renderPanel('toCollect', TO_COLLECT);
  expect(screen.getByText('Total à encaisser · 3 paiements').parentElement).toHaveTextContent('595,00');
  expect(screen.getByRole('region', { name: 'Reste à encaisser' })).toBeInTheDocument();
});

test('a line opens the fiche and ticks nothing', () => {
  const onOpenReservation = vi.fn();
  renderPanel('toCollect', TO_COLLECT, { onOpenReservation });
  fireEvent.click(screen.getByRole('button', { name: /Versement Airbnb de Sophie Bernard/ }));
  expect(onOpenReservation).toHaveBeenCalledWith(7);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('a late line is flagged as late', () => {
  renderPanel('toCollect', TO_COLLECT);
  expect(within(screen.getByRole('region', { name: 'En retard', hidden: false })).getAllByText(/en retard/i).length).toBeGreaterThan(0);
});

test('« Encaissé » lists the months most recent first with subtotals, a refund in red, and its total', () => {
  renderPanel('collected', COLLECTED);
  const sections = screen.getAllByRole('region').filter((r) => r.tagName === 'SECTION');
  expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Novembre 2026', 'Septembre 2026']);
  expect(sections[1]).toHaveTextContent('60,00');
  expect(within(sections[1]).getByRole('button', { name: /Remboursement de Paul/ })).toHaveTextContent('-40,00');
  expect(screen.getByText('Total encaissé · 3 paiements').parentElement).toHaveTextContent('210,00');
});

test('nothing left to collect says so', () => {
  renderPanel('toCollect', { groups: [], rows: [], totals: { amount: 0, payments: 0 } });
  expect(screen.getByText('Tout est encaissé pour les séjours de la période.')).toBeInTheDocument();
});

test('« À recevoir maintenant » sits after « En retard » and before the months, its lines not flagged late', () => {
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  const NOW = row({ reservationId: 5, date: '2026-05-01', dateLabel: '1 mai 2026', label: 'Acompte', clientName: 'Nina', amount: 90, dueNow: true });
  const data = { ...TO_COLLECT, groups: [TO_COLLECT.groups[0], { key: 'dueNow', label: 'À recevoir maintenant', total: 90, rows: [NOW] }, TO_COLLECT.groups[1]], rows: [LATE, NOW, DEC, DEC_2], totals: { amount: 685, payments: 4 } };
  renderPanel('toCollect', data);
  const sections = screen.getAllByRole('region').filter((r) => r.tagName === 'SECTION');
  expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['En retard', 'À recevoir maintenant', 'Décembre 2026']);
  expect(within(sections[1]).queryByText(/en retard/i)).toBeNull();
});
