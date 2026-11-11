// specs/ui-review-2026-10-19-operations.md rule 20 — the PDF no longer prints « (expiré) »: the fiche
// warns, and only an expired quote still open offers « prolonger », announced before it is done.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';
import DevisValidityChip from '../DevisValidityChip';
import DevisExtensionSummary from '../DevisExtensionSummary';

const wrap = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

test('rule 20 — an expired open quote reads « Périmé · prolonger », and clicking it asks to extend', async () => {
  const onExtend = vi.fn();
  const user = userEvent.setup();
  wrap(<DevisValidityChip validUntil="2026-09-30" expired extendable onExtend={onExtend} />);
  await user.click(screen.getByRole('button', { name: 'Périmé · prolonger' }));
  expect(onExtend).toHaveBeenCalledTimes(1);
});

test('rule 20 — a converted quote has no chip; an accepted expired one a plain « Périmé »', () => {
  const { container } = wrap(<DevisValidityChip validUntil="2026-09-30" expired converted onExtend={() => {}} />);
  expect(container).toBeEmptyDOMElement();
  wrap(<DevisValidityChip validUntil="2026-09-30" expired extendable={false} onExtend={() => {}} />);
  expect(screen.getByText('Périmé')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('rule 20 — on a phone it reads « Prolonger »; a valid quote keeps its date', () => {
  wrap(<DevisValidityChip validUntil="2026-09-30" expired extendable compact onExtend={() => {}} />);
  expect(screen.getByText('Prolonger')).toBeInTheDocument();
  wrap(<DevisValidityChip validUntil="2026-12-31" expired={false} onExtend={() => {}} />);
  expect(screen.getByText('Valide jusqu\'au 31/12/2026')).toBeInTheDocument();
});

test('rule 20 — the confirmation shows the new validity, the total and the schedule before and after', () => {
  wrap(
    <DevisExtensionSummary
      unsavedChanges
      preview={{
        validUntil: '2026-11-03',
        current: { totalTtc: 535, schedule: [{ label: 'Acompte', amount: 157.61, dueDate: '2026-09-01' }, { label: 'Solde', amount: 377.39, dueDate: '2027-03-13' }] },
        next: { totalTtc: 560, schedule: [{ label: 'Paiement intégral', amount: 560, dueDate: '2026-11-03' }] },
      }}
    />,
  );
  expect(screen.getByText(/Valable jusqu'au 03\/11\/2026/)).toBeInTheDocument();
  expect(screen.getByText('Après prolongation')).toBeInTheDocument();
  expect(screen.getByText(/Paiement intégral/)).toHaveTextContent(/560,00\s?€ avant le 03\/11\/2026/);
  expect(screen.getByText(/Solde/)).toHaveTextContent(/377,39/);
  expect(screen.getByText(/non enregistrées/)).toBeInTheDocument();
});
