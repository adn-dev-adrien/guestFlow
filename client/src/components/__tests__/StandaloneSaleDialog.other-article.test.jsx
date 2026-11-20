/**
 * StandaloneSaleDialog — « Autre article » on the counter (specs/outside-booking-sas.md rule 11, end-review verification V-1): the search renders the
 * server's `groups` and the chosen article joins the draft. The flat `articles` list stays the dialog's catalogue; the search never reads it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
    mintStandaloneSaleLink: vi.fn(),
    withdrawStandaloneSaleLink: vi.fn(),
    emailStandaloneSaleLink: vi.fn(),
  },
}));

import api from '../../api';
import StandaloneSaleDialog from '../StandaloneSaleDialog';

const BEER = { articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' };
const BOARD = { articleRef: 'option:9', label: 'Planche apéritive', unitCents: 1400, max: 6, category: 'Restauration' };
const NO_LINK = { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuggestedArticlesCatalogue.mockImplementation(async ({ q }) => (q
    ? { articles: [BOARD], groups: [{ category: 'Restauration', articles: [BOARD] }] }
    : { articles: [BEER, BOARD], groups: [{ category: 'Boissons', articles: [BEER] }, { category: 'Restauration', articles: [BOARD] }] }));
  api.quoteStandaloneSale.mockImplementation(async (body) => ({
    document: {
      lines: body.lines.map((l, i) => ({ id: null, ref: `draft:${i}`, kind: 'extra', label: BOARD.label, detail: '1 × 14,00 €', quantity: l.quantity, unitCents: 1400, totalCents: 1400, catalogueCents: 1400, offered: false, status: 'due', statusLabel: 'À payer' })),
      totals: { totalCents: 1400, paidCents: 0, remainingCents: 1400, refundOwedCents: 0 },
      vatByRate: [],
    },
    customer: { clientId: 1, label: 'Passage', kind: 'passage' }, refusals: [], quoted: true, paymentLink: NO_LINK,
  }));
});

test('V-1 — « Autre article » renders the grouped answer and adds the chosen article to the sale', async () => {
  render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Autre article' }));
  fireEvent.change(screen.getByLabelText('Chercher un article'), { target: { value: 'planche' } });
  await waitFor(() => expect(api.getSuggestedArticlesCatalogue).toHaveBeenCalledWith({ q: 'planche' }));
  expect(await screen.findByText('Restauration')).toBeInTheDocument();
  const found = await screen.findAllByRole('button', { name: /Planche apéritive/ });
  fireEvent.click(found[found.length - 1]);
  await waitFor(() => expect(api.quoteStandaloneSale).toHaveBeenLastCalledWith(expect.objectContaining({ lines: [{ articleRef: 'option:9', quantity: 1, offered: false }] }), expect.anything()));
});
