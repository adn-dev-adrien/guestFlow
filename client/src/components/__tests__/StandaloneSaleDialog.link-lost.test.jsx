/**
 * StandaloneSaleDialog — specs/pricing/pricing-components.md rule 53 (UI-8): when the quote stops offering the link after « Envoyer un lien » was chosen (provider no longer ready),
 * the sale falls back to « Encaisser maintenant »: the tender lines drawn are the ones sent, never a sale saved with nothing collected and no link.
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
  },
}));

import api from '../../api';
import StandaloneSaleDialog from '../StandaloneSaleDialog';

const CATALOGUE = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];
const READY = { available: true, reason: null, email: 'a@exemple.fr', open: null };
const NO_LINK = { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null };
const quote = (extras, link) => {
  const total = extras.reduce((sum, e) => sum + e.quantity * 650, 0);
  return {
    document: {
      lines: extras.map((e, i) => ({ id: null, ref: `draft:${i}`, kind: 'extra', label: 'Bière locale', detail: null, quantity: e.quantity, totalCents: e.quantity * 650, catalogueCents: e.quantity * 650, offered: false, status: 'due', statusLabel: 'À payer' })),
      totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 },
      vatByRate: [],
    },
    customer: { clientId: 1, label: 'Passage', kind: 'passage' },
    refusals: [],
    quoted: true,
    paymentLink: link,
  };
};

test('a link mode that is no longer offered collects the tender lines shown', async () => {
  let link = READY;
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: CATALOGUE });
  api.quoteStandaloneSale.mockImplementation(async (body) => quote(body.lines, link));
  api.sellStandaloneSale.mockResolvedValue({ document: { document: { id: 1 } }, sale: { id: 1, clientLabel: 'Passage', lines: [], totalCents: 1300, remainingCents: 0, statusLabel: 'Payée', tone: 'paid' }, paymentLink: NO_LINK });
  render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Envoyer un lien' }));
  link = NO_LINK;
  fireEvent.click(screen.getByRole('button', { name: /Bière locale/ }));
  const save = await screen.findByRole('button', { name: /encaisser 13,00/ });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.sellStandaloneSale).toHaveBeenCalled());
  expect(api.sellStandaloneSale.mock.calls[0][0].payment.tenders).toEqual([{ method: 'card', amountCents: 1300, internal: false }]);
});
