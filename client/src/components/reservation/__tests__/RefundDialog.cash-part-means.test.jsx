import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/pricing/pricing-components.md rule 112 (loop t8 UI8-4) — l'annonce « payés en espèces : rendus en caisse interne » ne vaut que tant que
// le moyen reste « Caisse interne » : un autre moyen la retire, y revenir la remet.

vi.mock('../../../api', () => ({ __esModule: true, default: {} }));

const LINES = [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 60 }];
const CASH = { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] };

test('changer de moyen retire l’annonce de la part espèces ; revenir en caisse interne la remet', async () => {
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={360} overpaymentTtc={60} overpaymentLines={LINES} cashPart={CASH} onSubmit={vi.fn()} />);
  expect(screen.getByText(/payés en espèces/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: /Virement/ }));
  expect(screen.queryByText(/payés en espèces/)).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: /Caisse interne/ }));
  expect(screen.getByText(/payés en espèces/)).toBeInTheDocument();
});
