/**
 * SuggestedArticlesStep — the generic « Proposés à l'arrivée » step (specs/outside-booking-sas.md rule 35): it renders any `suggestions` payload and tells its parent what the operator did,
 * with no resource, stay or drink wording of its own; the server's refusal of a quantity shows under its line; the stepper keeps to the bounds it is given.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SuggestedArticlesStep from '../SuggestedArticlesStep';

const SUGGESTIONS = [
  { articleRef: 'option:1', label: 'Cookie maison', unitCents: 350, max: 6 },
  { articleRef: 'option:2', label: 'Visite guidée', unitCents: 1200, max: 20 },
];
const props = (over = {}) => ({
  suggestions: SUGGESTIONS, draft: [], draftLines: [], storedLines: [], refusals: [],
  onAdd: vi.fn(), onDraftChange: vi.fn(), onDraftRemove: vi.fn(), onStoredOffer: vi.fn(), onStoredRemove: vi.fn(), ...over,
});

test('rule 35 — any suggestions payload is rendered as chips with their unit price; a tap hands the article to the parent', () => {
  const p = props();
  render(<SuggestedArticlesStep {...p} />);
  expect(screen.getByRole('button', { name: /Cookie maison/ })).toHaveTextContent('3,50 €');
  fireEvent.click(screen.getByRole('button', { name: /Visite guidée/ }));
  expect(p.onAdd).toHaveBeenCalledWith(SUGGESTIONS[1]);
});

test('rule 35 — the step knows no resource, stay, drink or plugin: no such wording is drawn around the payload', () => {
  const { container } = render(<SuggestedArticlesStep {...props({ search: async () => [] })} />);
  expect(container.textContent).not.toMatch(/bain|séjour|boisson|ressource|logement|plugin/i);
  expect(screen.getByText('Proposés à l’arrivée')).toBeInTheDocument();
});

test('rule 35 — the title and the empty message are the only words of the step; a title can be given', () => {
  render(<SuggestedArticlesStep {...props({ title: 'À proposer' })} />);
  expect(screen.getByText('À proposer')).toBeInTheDocument();
  expect(screen.getByText('Aucun article ajouté.')).toBeInTheDocument();
});

test('rule 12 — a draft line shows the server\'s figures and its refusal under it; the stepper is bounded by the article\'s max; « Offrir » and « Retirer » go to the parent', () => {
  const p = props({
    draft: [{ articleRef: 'option:1', label: 'Cookie maison', quantity: 6, max: 6, offered: false }, { articleRef: 'option:2', label: 'Visite guidée', quantity: 40, max: 20, offered: false }],
    draftLines: [{ detail: '6 × 3,50 €', totalCents: 2100, catalogueCents: 2100 }, null],
    refusals: [{ field: 'option:2', code: 'QUANTITY_OUT_OF_BOUNDS', error: 'Quantité : 1 à 20.' }],
  });
  render(<SuggestedArticlesStep {...p} />);
  const rows = screen.getAllByRole('listitem');
  expect(within(rows[0]).getByText('6 × 3,50 €')).toBeInTheDocument();
  expect(within(rows[0]).getByText('21,00 €')).toBeInTheDocument();
  expect(within(rows[0]).getByRole('button', { name: 'Un de plus' })).toBeDisabled();
  expect(within(rows[1]).getByText('Quantité : 1 à 20.')).toBeInTheDocument();
  expect(within(rows[1]).getByRole('textbox', { name: 'Quantité Visite guidée' })).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(within(rows[0]).getByRole('button', { name: 'Un de moins' }));
  expect(p.onDraftChange).toHaveBeenCalledWith(0, { quantity: 5 });
  fireEvent.click(within(rows[0]).getByRole('button', { name: 'Offrir' }));
  expect(p.onDraftChange).toHaveBeenCalledWith(0, { offered: true });
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Retirer' }));
  expect(p.onDraftRemove).toHaveBeenCalledWith(1);
});

test('rule 13 — a stored line keeps its status and its catalogue value struck when offered; « Retirer » is hidden when the parent gives no onStoredRemove, and a cancelled line has no action', () => {
  const stored = [
    { id: 4, label: 'Cookie maison', detail: '2 × 3,50 €', totalCents: 0, catalogueCents: 700, offered: true, status: 'offered', statusLabel: 'Offerte' },
    { id: 5, label: 'Visite guidée', detail: '1 × 12,00 €', totalCents: 1200, catalogueCents: 1200, offered: false, status: 'cancelled', statusLabel: 'Annulée' },
  ];
  const p = props({ storedLines: stored, onStoredRemove: undefined });
  render(<SuggestedArticlesStep {...p} />);
  const rows = screen.getAllByRole('listitem');
  expect(within(rows[0]).getByText('7,00 €', { selector: 'del' })).toBeInTheDocument();
  expect(within(rows[0]).getByRole('button', { name: 'Offert' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull();
  expect(within(rows[1]).queryByRole('button')).toBeNull();
  fireEvent.click(within(rows[0]).getByRole('button', { name: 'Offert' }));
  expect(p.onStoredOffer).toHaveBeenCalledWith(stored[0], false);
});

test('rule 11 — « Autre article » runs the parent\'s search, groups the answer by category and adds the chosen article; a failing search says so', async () => {
  const search = vi.fn().mockResolvedValue([
    { articleRef: 'option:9', label: 'Planche', unitCents: 1400, max: 10, category: 'Restauration' },
    { articleRef: 'option:3', label: 'Thé', unitCents: 300, max: 10, category: 'Boissons' },
  ]);
  const p = props({ search });
  render(<SuggestedArticlesStep {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Autre article' }));
  expect(await screen.findByText('Restauration')).toBeInTheDocument();
  expect(screen.getByText('Boissons')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Thé/ }));
  expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({ articleRef: 'option:3' }));
  expect(screen.queryByRole('textbox', { name: 'Chercher un article' })).toBeNull();
  search.mockRejectedValue(new Error('x'));
  fireEvent.click(screen.getByRole('button', { name: 'Autre article' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Recherche impossible.'));
});

test('a read-only step lets nothing be tapped', () => {
  render(<SuggestedArticlesStep {...props({ disabled: true, search: async () => [] })} />);
  expect(screen.getByRole('button', { name: /Cookie maison/ })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Autre article' })).toBeDisabled();
});
