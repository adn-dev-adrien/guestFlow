/**
 * SalePaymentLink — the validity of a minted link (specs/sas/outside-booking-sas.md rules 40-42, 48; round-1 finding UI-15): « valable jusqu’au … » prints the server's
 * Europe/Paris `expiresLabel` as is, never the browser's reading of `expiresAt`. The reception's payload hides the address (`email: null`) but says `hasEmail`.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import SalePaymentLink from '../SalePaymentLink';

const handlers = () => ({ onMint: vi.fn(), onSendEmail: vi.fn(), onWithdraw: vi.fn() });
// date-literal-ok: a payload input the component prints as served, never compared with a clock
const OPEN = { id: 3, url: 'https://pay.exemple.fr/l/abc', amountCents: 1300, expiresAt: '2026-11-16T13:30:00.000Z', expiresLabel: '16/11 à 14:30' };

test('the validity is the server\'s label, whatever the browser\'s zone makes of expiresAt', () => {
  render(<SalePaymentLink link={{ available: true, reason: null, email: 'a@exemple.fr', open: { ...OPEN, expiresAt: '2000-01-01T00:00:00.000Z' } }} {...handlers()} />);
  expect(screen.getByText('Lien · 13,00 € · valable jusqu’au 16/11 à 14:30')).toBeInTheDocument();
});

test('no label from the server: the line stops at the amount', () => {
  render(<SalePaymentLink link={{ available: true, reason: null, email: 'a@exemple.fr', open: { ...OPEN, expiresLabel: null } }} {...handlers()} />);
  expect(screen.getByText('Lien · 13,00 €')).toBeInTheDocument();
});

test('the reception sees no address but « Envoyer par e-mail » stays offered when the server says one is known', () => {
  render(<SalePaymentLink link={{ available: true, reason: null, email: null, hasEmail: true, open: OPEN }} {...handlers()} />);
  expect(screen.getByRole('button', { name: 'Envoyer par e-mail' })).toBeEnabled();
});
