// specs/ui-review-2026-10-19-operations.md rule 20 — the PDF no longer prints « (expiré) »: the fiche
// warns, and the chip of an expired quote is the save that re-stamps its validity.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';
import DevisValidityChip from '../DevisValidityChip';

const renderChip = (props) => render(<ThemeProvider theme={theme}><DevisValidityChip {...props} /></ThemeProvider>);

test('rule 20 — an expired quote reads « Périmé · prolonger », and clicking it saves', async () => {
  const onExtend = vi.fn();
  const user = userEvent.setup();
  renderChip({ validUntil: '2026-09-30', expired: true, onExtend });
  await user.click(screen.getByRole('button', { name: 'Périmé · prolonger' }));
  expect(onExtend).toHaveBeenCalledTimes(1);
});

test('rule 20 — on a phone it reads « Prolonger »; a valid quote keeps its date', () => {
  renderChip({ validUntil: '2026-09-30', expired: true, compact: true, onExtend: () => {} });
  expect(screen.getByText('Prolonger')).toBeInTheDocument();
  renderChip({ validUntil: '2026-12-31', expired: false, onExtend: () => {} });
  expect(screen.getByText('Valide jusqu\'au 31/12/2026')).toBeInTheDocument();
});
