// specs/finance-dashboard-redesign.md rule 15, reading of 2026-11-06 (audit R26 finding 3) — before the check-out, a row
// whose only due is the end-of-stay complement carries the server's `settleAllReason`: « Tout solder » is drawn closed and
// says « Après le départ. » (tooltip on desktop, caption on a phone); a row with something to tick keeps it open.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import OperationalPaymentsTable from '../OperationalPaymentsTable';

const base = {
  id: 1, clientName: 'Camille', propertyName: 'Le Gîte', startDate: '2026-11-05', endDate: '2026-11-08', platform: 'direct',
  depositAmount: 0, depositDisabled: 1, balanceAmount: 300, balancePaid: 1, complementAmount: 20, complementPaid: 1,
  endOfStayComplementAmount: 25, endOfStayComplementPaid: 0, remainingToPay: 25, totalSejour: 345,
};
const waiting = { ...base, settleAllFields: [], settleAllReason: 'Après le départ.' };
const open = { ...base, id: 2, balancePaid: 0, settleAllFields: ['balancePaid'] };

function draw(rows, onSettleAll = () => {}) {
  render(
    <ThemeProvider theme={theme}>
      <OperationalPaymentsTable rows={rows} interactive showEndOfStayComplement onSettleAll={onSettleAll} onTogglePayment={() => {}} onOpenReservation={() => {}} />
    </ThemeProvider>,
  );
}

const phone = () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
};
afterEach(() => { delete window.matchMedia; });

test('desktop: the waiting row is closed with the reason, the other one settles', () => {
  const onSettleAll = vi.fn();
  draw([waiting, open], onSettleAll);
  const [closed, active] = screen.getAllByRole('button', { name: 'Tout solder' });
  expect(closed).toBeDisabled();
  expect(closed.closest('span').getAttribute('aria-label')).toBe('Après le départ.');
  expect(active).not.toBeDisabled();
  fireEvent.click(active);
  expect(onSettleAll).toHaveBeenCalledWith(open);
});

test('phone: the card says it under the closed button', () => {
  phone();
  draw([waiting]);
  expect(screen.getByRole('button', { name: 'Tout solder' })).toBeDisabled();
  expect(screen.getByText('Après le départ.')).toBeInTheDocument();
});
