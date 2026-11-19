// Loop t25 verifier (specs/reconciliation-assisted-matching.md rule 24; plugins-phase-1-sdk rule 54 reading of 2026-11-19) — an amount
// being typed with its decimal separator last (« 30, ») is that whole amount: the preview is asked for it and its figures stay, with no
// « Montant invalide » and no « — » for that keystroke.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DialogProvider from '../../DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { listPlatformPenalties: vi.fn(), previewPlatformPenalty: vi.fn(), declarePlatformPenalty: vi.fn() },
}));
import api from '../../../api';
import PlatformPenaltyDialog from '../PlatformPenaltyDialog';

const figures = (amount) => ({
  valid: true, needsChoice: false, warnings: [], errors: [],
  before: { payout: 570.02, commission: 229.98, netReceived: 570.02 }, after: { payout: 570.02, commission: Math.round((229.98 - amount) * 100) / 100, netReceived: 570.02 },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listPlatformPenalties.mockResolvedValue({ items: [], suggestions: [] });
  api.previewPlatformPenalty.mockImplementation(async (id, body) => figures(body.amount));
});

test.each([['30,', 30], ['30.', 30], ['100,', 100], ['30,5', 30.5]])('« %s » is %s: asked, figures shown, no refusal', async (typed, amount) => {
  render(<DialogProvider><PlatformPenaltyDialog open onClose={vi.fn()} reservationId={7} source="fiche" onDone={vi.fn()} initialAmount={3} /></DialogProvider>);
  await screen.findByText(/Commission 229,98 € → 226,98 €/);
  fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: typed } });
  expect(screen.queryByText(/Montant invalide/)).toBeNull();
  await waitFor(() => expect(api.previewPlatformPenalty).toHaveBeenLastCalledWith(7, expect.objectContaining({ amount })));
  expect(await screen.findByText(/^Commission 229,98 € → /)).toBeInTheDocument();
});
