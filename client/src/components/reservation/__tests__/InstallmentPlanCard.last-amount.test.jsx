// specs/payments/direct-installments.md rules 53, 54, 57, 58, 60 — the last installment can be typed, a closed plan offers
// « Ajuster automatiquement » and prints the server's « Reste à régler à l'arrivée », and the acompte collected before the
// plan is a read-only paid row. The card renders the server's payload and computes nothing.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import InstallmentPlanCard from '../InstallmentPlanCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { putInstallments: vi.fn(), deleteInstallments: vi.fn(), markInstallmentPaid: vi.fn(), sendInstallmentRequest: vi.fn() },
}));
import api from '../../../api';
import { closedPlan } from './installmentPlanFixtures';

function Harness({ initial }) {
  const [plan, setPlan] = React.useState(initial);
  return (
    <DialogProvider>
      {/* date-literal-ok: the `today` prop is injected, the card reads no clock */}
      <InstallmentPlanCard reservationId={7} plan={plan} today="2026-10-27" onPlanChange={setPlan} onMoneyChanged={vi.fn()} />
    </DialogProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.putInstallments.mockImplementation((...args) => Promise.reject(new Error(`unplanned putInstallments(${JSON.stringify(args)})`)));
});

const rowOf = (n) => screen.getByTestId(`installment-${n}`);

test('rule 53 — the last unpaid installment is a field like the others, and typing it posts the amount', async () => {
  const open = closedPlan({ closed: false, arrivalRest: 0 });
  open.installments[2] = { ...open.installments[2], canRelease: false, amountEdited: false };
  api.putInstallments.mockResolvedValue({ installmentPlan: closedPlan() });
  render(<Harness initial={open} />);
  const field = within(rowOf(3)).getByRole('textbox', { name: 'Montant de l’échéance 3' });
  fireEvent.change(field, { target: { value: '350' } });
  fireEvent.blur(field);
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledWith(7, { amounts: [{ id: 43, amount: '350' }] }));
  expect(await screen.findByText('Reste à régler à l’arrivée :')).toBeInTheDocument();
});

test('rules 54, 58 — a closed plan ends with the server\'s « Reste à régler à l\'arrivée », nothing computed here', () => {
  render(<Harness initial={closedPlan({ arrivalRest: 123.45 })} />);
  const rest = screen.getByText('Reste à régler à l’arrivée :').closest('p');
  expect(rest).toHaveTextContent('123,45');
});

test('rule 58 — an open plan prints no arrival rest', () => {
  render(<Harness initial={closedPlan({ closed: false, arrivalRest: 0 })} />);
  expect(screen.queryByText('Reste à régler à l’arrivée :')).not.toBeInTheDocument();
});

test('rule 57 — « Ajuster automatiquement » sits on the last row only and posts the release', async () => {
  const reopened = closedPlan({ closed: false, arrivalRest: 0 });
  reopened.installments[2] = { ...reopened.installments[2], canRelease: false, amountEdited: false, amount: 401.5 };
  api.putInstallments.mockResolvedValue({ installmentPlan: reopened });
  render(<Harness initial={closedPlan()} />);
  expect(within(rowOf(1)).queryByRole('button', { name: 'Ajuster automatiquement' })).not.toBeInTheDocument();
  fireEvent.click(within(rowOf(3)).getByRole('button', { name: 'Ajuster automatiquement' }));
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledWith(7, { installmentId: 43, releaseAmount: true }));
  await waitFor(() => expect(screen.queryByText('Reste à régler à l’arrivée :')).not.toBeInTheDocument());
  expect(within(rowOf(3)).queryByRole('button', { name: 'Ajuster automatiquement' })).not.toBeInTheDocument();
});

test('rule 55 — a refused amount shows the server\'s sentence under the field and keeps the plan', async () => {
  const message = 'Échéance 3 : dépasse le séjour de 198,50 € (401,50 € au plus).';
  api.putInstallments.mockRejectedValue(Object.assign(new Error(message), { status: 400 }));
  render(<Harness initial={closedPlan({ closed: false, arrivalRest: 0 })} />);
  const field = within(rowOf(3)).getByRole('textbox', { name: 'Montant de l’échéance 3' });
  fireEvent.change(field, { target: { value: '600' } });
  fireEvent.blur(field);
  expect(await within(rowOf(3)).findByRole('alert')).toHaveTextContent(message);
  expect(field).toHaveAttribute('aria-invalid', 'true');
});

test('rule 60 — the acompte collected before the plan is a read-only paid row, the total is the plan\'s own', () => {
  render(<Harness initial={closedPlan({ deposit: { amount: 300, paidDate: '2026-10-20', method: null }, total: 701.5 })} />); // date-literal-ok: a paid date the card only prints
  const deposit = screen.getByTestId('installment-deposit');
  expect(deposit).toHaveTextContent('Acompte');
  expect(deposit).toHaveTextContent('300');
  expect(deposit).toHaveTextContent('Payé le');
  expect(within(deposit).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(deposit).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('Total échéancier')).toBeInTheDocument();
});

test('rule 60 — without an acompte there is no deposit row and the footer keeps « Total séjour »', () => {
  render(<Harness initial={closedPlan()} />);
  expect(screen.queryByTestId('installment-deposit')).not.toBeInTheDocument();
  expect(screen.getByText('Total séjour')).toBeInTheDocument();
});
