import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import MidStayNoteRow from '../MidStayNoteRow';

// specs/guest-app.md rule 113 a (stabilisation loop t6, A6-2) — a note paid online is neither adjusted nor put back to the departure: the
// server serves the lock (`midStayNoteLocks`), the row draws neither « Modifier la note » nor « Reporter au départ » and shows the reason.

const NOTE = {
  id: 4, paidDate: '2026-08-06', paidCash: 0, total: 12, method: 'card', lines: [{ label: 'Bière', amount: 12, key: 'opt:9' }],
};
const REASON = 'Payée en ligne : offrir la ligne, puis rembourser.';

test('note verrouillée par le serveur : ni ✎ ni « Reporter au départ », la raison en légende', () => {
  render(<MidStayNoteRow note={NOTE} lockedReason={REASON} onCancel={vi.fn()} onAdjust={vi.fn()} />);
  expect(screen.getByText('06/08 — 12,00 € — CB')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Modifier la note/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Reporter au départ/i })).not.toBeInTheDocument();
  expect(screen.getByText(REASON)).toBeInTheDocument();
});

test('sans verrou servi, la même note garde ses actions (la règle est celle du serveur, pas du client)', () => {
  render(<MidStayNoteRow note={NOTE} onCancel={vi.fn()} onAdjust={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Modifier la note/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Reporter au départ/i })).toBeInTheDocument();
  expect(screen.queryByText(REASON)).not.toBeInTheDocument();
});
