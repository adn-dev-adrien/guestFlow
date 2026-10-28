import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ReconciliationLine from '../ReconciliationLine';
import { gap } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rule 24 — a platform credit below the expected payout offers
// « Déclarer une pénalité de … » with the gap the server computed.

test('rule 24 — the action carries the server\'s gap and opens the penalty dialog through the callback', () => {
  const item = gap({ declarePenalty: { amountCents: 4000, amount: 40 } });
  const onDeclarePenalty = vi.fn();
  render(<ReconciliationLine item={item} onConfirm={vi.fn()} onDiscard={vi.fn()} onUndo={vi.fn()} onDeclarePenalty={onDeclarePenalty} />);
  fireEvent.click(screen.getByRole('button', { name: /Déclarer une pénalité de 40,00 €/ }));
  expect(onDeclarePenalty).toHaveBeenCalledWith(item);
});

test('rule 24 — no action when the server offers none', () => {
  render(<ReconciliationLine item={gap({ declarePenalty: null })} onConfirm={vi.fn()} onDiscard={vi.fn()} onUndo={vi.fn()} onDeclarePenalty={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Déclarer une pénalité/ })).toBeNull();
});
