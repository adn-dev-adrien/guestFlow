import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/pricing-components.md rule 112 (loop t7 B7-3) — un trop-perçu fait d'une note en espèces ET d'une note par carte : la fenêtre
// s'ouvre sur la part espèces en « Caisse interne » (ses lignes, telles que le serveur les envoie) et dit ce qui reste à rembourser ensuite.

vi.mock('../../../api', () => ({ __esModule: true, default: {} }));

const LINES = [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 60 }];
const CASH = { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] };

test('la part espèces est proposée en caisse interne, le reste annoncé', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={360} overpaymentTtc={60} overpaymentLines={LINES} cashPart={CASH} onSubmit={onSubmit} />);
  expect(screen.getByText(/payés en espèces : rendus en caisse interne\. Reste 30,00\s€ à rembourser ensuite\./)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  const payload = onSubmit.mock.calls[0][0];
  expect(payload.method).toBe('internal');
  expect(payload.lines).toEqual([{ label: 'Trop-perçu', bucket: 'options', amountTtc: 30 }]);
  expect(payload).toMatchObject({ fromOverpayment: true, overpaymentTtc: 60 });
});

test('sans part espèces : rien n’est annoncé, la fenêtre s’ouvre sur tout le trop-perçu', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={360} overpaymentTtc={60} overpaymentLines={LINES} onSubmit={onSubmit} />);
  expect(screen.queryByText(/payés en espèces/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit.mock.calls[0][0].method).toBe('transfer');
  expect(onSubmit.mock.calls[0][0].lines).toEqual([{ label: 'Trop-perçu', bucket: 'options', amountTtc: 60 }]);
});
