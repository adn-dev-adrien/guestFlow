// Shared fixtures of the gift-vouchers client suites: the server's payload shapes and a render wrapper.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

export const summary = (over = {}) => ({
  id: 1,
  number: 'BC-2026-0001',
  state: 'active',
  amountCents: 15000,
  balanceCents: 15000,
  issuedAt: '2026-11-10T09:00:00.000Z', // date-literal-ok: the server's value, rendered as sent
  expiresOn: '2028-05-10',
  cancelledAt: null,
  buyerEmail: 'marie@example.test',
  senderName: 'Marie',
  recipientName: 'Paul',
  source: 'manual',
  paymentMethod: 'card',
  mailSentAt: null,
  mailError: null,
  ...over,
});

export const detail = (over = {}) => ({
  ...summary(),
  message: 'Joyeux anniversaire',
  codeMasked: '···· ···· ···· 3NPC',
  canCancel: true,
  movements: [
    {
      id: 1, kind: 'issue', label: 'Émission', amountCents: 15000, date: '2026-11-10', actorName: 'Adrien', reservationId: null, note: null,
    },
  ],
  ...over,
});

export const PAYMENT_METHODS = [
  { value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'cheque', label: 'Chèque' },
];

export function renderWithShell(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DialogProvider>{ui}</DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
