/**
 * SuggestedArticlesStep — the worst realistic data (specs/outside-booking-sas.md rule 35, break-ui pass of C38): a 120-character label with an unbreakable word, an emoji-first label,
 * a quantity of 99, a quantity of exactly 1, no suggestion at all, a thousand-line search answer. Nothing is cut, nothing crashes, the controls stay reachable.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import SuggestedArticlesStep from '../SuggestedArticlesStep';

const LONG = `Planche de charcuteries et fromages de l’Ardèche — grande portion à partager entre amis ${'x'.repeat(24)}`;
const handlers = () => ({ onAdd: vi.fn(), onDraftChange: vi.fn(), onDraftRemove: vi.fn(), onStoredOffer: vi.fn(), onStoredRemove: vi.fn() });

test('a very long label and an emoji-first label are drawn whole, wrapped, with their controls', () => {
  const draft = [
    { articleRef: 'option:1', label: LONG, quantity: 99, max: 99, offered: false },
    { articleRef: 'option:2', label: '🍺 Bière blonde artisanale', quantity: 1, max: 12, offered: false },
  ];
  render(<SuggestedArticlesStep suggestions={[{ articleRef: 'option:1', label: LONG, unitCents: 123456, max: 99 }]} draft={draft} draftLines={[{ detail: '99 × 1 234,56 €', totalCents: 12222144, catalogueCents: 12222144 }, null]} {...handlers()} />);
  const rows = screen.getAllByRole('listitem');
  expect(within(rows[0]).getByText(LONG)).toBeInTheDocument();
  expect(within(rows[0]).getByText('122 221,44 €')).toBeInTheDocument();
  expect(within(rows[0]).getByRole('button', { name: 'Un de plus' })).toBeDisabled();
  expect(within(rows[1]).getByText('🍺 Bière blonde artisanale')).toBeInTheDocument();
  expect(within(rows[1]).getByRole('button', { name: 'Un de moins' })).toBeDisabled();
  expect(getComputedStyle(within(rows[0]).getByText(LONG)).overflowWrap).toBe('anywhere');
});

test('no suggestion and no search leaves only the empty message; a thousand search results are all listed without crashing', async () => {
  const { unmount } = render(<SuggestedArticlesStep suggestions={[]} {...handlers()} />);
  expect(screen.getByText('Aucun article ajouté.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  unmount();
  const many = Array.from({ length: 1000 }, (_, i) => ({ articleRef: `option:${i + 1}`, label: `Article ${i + 1}`, unitCents: 100, max: 9, category: i % 2 ? 'Boissons' : 'Repas' }));
  render(<SuggestedArticlesStep suggestions={[]} search={async () => many} {...handlers()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Autre article' }));
  expect(await screen.findByRole('button', { name: /Article 1000/ })).toBeInTheDocument();
});
