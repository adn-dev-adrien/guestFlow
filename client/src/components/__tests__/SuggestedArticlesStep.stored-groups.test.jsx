// specs/outside-booking-sas.md rule 12 (AV-9) — an article stored on several lines reads under one title with its total, each line by its own label.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import SuggestedArticlesStep from '../SuggestedArticlesStep';

const line = (id, over) => ({ id, ref: `extra:${id}`, label: 'Bière locale — 3', detail: null, totalCents: 650, catalogueCents: 650, offered: false, status: 'open', statusLabel: '', ...over });

test('two lines of the same article sit under one title and its total; a single line stays plain', () => {
  render(
    <SuggestedArticlesStep
      suggestions={[]}
      storedLines={[line(1, { groupLabel: '1 × 6,50 €' }), line(2, { totalCents: 1300, groupLabel: '2 × 6,50 €' }), line(3, { label: 'Eau', totalCents: 200 })]}
      storedGroups={[{ id: 'g1', title: 'Bière locale — 3', totalCents: 1950, refs: ['extra:1', 'extra:2'] }]}
      onStoredOffer={() => {}}
    />,
  );
  const list = screen.getByRole('list', { name: 'Proposés à l’arrivée' });
  expect(within(list).getAllByText('Bière locale — 3')).toHaveLength(1);
  expect(within(list).getByText(/19,50/)).toBeInTheDocument();
  expect(within(list).getByText('1 × 6,50 €')).toBeInTheDocument();
  expect(within(list).getByText('2 × 6,50 €')).toBeInTheDocument();
  expect(within(list).getByText('Eau')).toBeInTheDocument();
});

test('without groups every stored line keeps its own label', () => {
  render(<SuggestedArticlesStep suggestions={[]} storedLines={[line(1, {}), line(2, { label: 'Eau' })]} onStoredOffer={() => {}} />);
  expect(screen.getByText('Bière locale — 3')).toBeInTheDocument();
  expect(screen.getByText('Eau')).toBeInTheDocument();
});
