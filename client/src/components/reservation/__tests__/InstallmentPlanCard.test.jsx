// specs/direct-installments.md §6 — the « Échéancier » card: it renders the server's payload, follows rapid
// clicks on the count stepper with one request, shows the server's refusals under the field they name, and
// computes nothing itself.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import InstallmentPlanCard from '../InstallmentPlanCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    putInstallments: vi.fn(),
    deleteInstallments: vi.fn(),
    markInstallmentPaid: vi.fn(),
    sendInstallmentRequest: vi.fn(),
  },
}));
import api from '../../../api';

const installment = (number, extra = {}) => ({
  id: 40 + number, number, dueDate: `2027-0${number}-10`, amount: 334, status: 'upcoming', statusLabel: 'À venir',
  editable: true, amountEditable: true, amountEdited: false, dateEdited: false, added: 0,
  paidDate: null, method: null, requestedAt: null, linkUrl: null, clamped: false, ...extra,
});

const planOf = (overrides = {}) => ({
  eligible: true, canCreate: false, reason: null, countLocked: false, frozen: false,
  total: 1001.5, paid: 0, remaining: 1001.5, gap: 0, minCount: 2, maxCount: 12, count: 3, canRequest: true, arrivalDate: '2027-06-14',
  installments: [
    installment(1, { status: 'toRequest', statusLabel: 'À demander' }),
    installment(2),
    installment(3, { amount: 333.5, amountEditable: false }),
  ],
  ...overrides,
});

function Harness({ initial, onMoney = vi.fn(), disabled = false }) {
  const [plan, setPlan] = React.useState(initial);
  return (
    <DialogProvider>
      <InstallmentPlanCard reservationId={7} plan={plan} today="2026-10-27" disabled={disabled} onPlanChange={setPlan} onMoneyChanged={onMoney} />
    </DialogProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

const rowOf = (n) => screen.getByTestId(`installment-${n}`);

test('renders the payload: numbers, dates, amounts, statuses, footer — and the amount of the last unpaid is not editable', () => {
  render(<Harness initial={planOf()} />);
  expect(screen.getByText('Échéancier')).toBeInTheDocument();
  expect(screen.getByText('3 échéances')).toBeInTheDocument();
  expect(within(rowOf(1)).getByLabelText('Date de l’échéance 1')).toHaveValue('2027-01-10');
  expect(within(rowOf(1)).getByLabelText('Montant de l’échéance 1')).toHaveValue('334');
  expect(within(rowOf(1)).getByText('À demander')).toBeInTheDocument();
  expect(within(rowOf(2)).getByText('À venir')).toBeInTheDocument();
  expect(within(rowOf(3)).queryByLabelText('Montant de l’échéance 3')).toBeNull();
  expect(within(rowOf(3)).getByText(/333,50/)).toBeInTheDocument();
  expect(screen.getByText(/Total séjour/).textContent).toMatch(/1\s001,50/);
  expect(screen.getByRole('button', { name: 'Supprimer l’échéancier' })).toBeInTheDocument();
});

test('a typed amount shows « fixé », a rise shows what was added, a gap is announced', () => {
  render(<Harness initial={planOf({
    gap: 25,
    installments: [installment(1, { amountEdited: true }), installment(2, { added: 40 }), installment(3, { amountEditable: false })],
  })}
  />);
  expect(within(rowOf(1)).getByText('fixé')).toBeInTheDocument();
  expect(within(rowOf(2)).getByText(/\+40,00.*ajoutés|\+40.*ajoutés/)).toBeInTheDocument();
  expect(screen.getByText(/Échéancier au-dessus du séjour/)).toBeInTheDocument();
  expect(screen.getByText(/25,00/)).toBeInTheDocument();
});

test('a paid installment shows its date and no field, no action, and the count is locked', () => {
  render(<Harness initial={planOf({
    countLocked: true, frozen: true, paid: 334, remaining: 667.5,
    installments: [
      installment(1, { status: 'paid', statusLabel: 'Payée le 27/10 · lien', editable: false, amountEditable: false, paidDate: '2026-10-27', method: 'link' }),
      installment(2), installment(3, { amountEditable: false }),
    ],
  })}
  />);
  expect(within(rowOf(1)).queryByLabelText('Date de l’échéance 1')).toBeNull();
  expect(within(rowOf(1)).getByText('27/10/2026')).toBeInTheDocument();
  expect(within(rowOf(1)).getByText('Payée le 27/10 · lien')).toBeInTheDocument();
  expect(within(rowOf(1)).queryByRole('button')).toBeNull();
  expect(screen.getByRole('button', { name: 'Une échéance de moins' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Une échéance de plus' })).toBeDisabled();
  expect(screen.getByText(/Figé depuis le 1er versement/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Supprimer l’échéancier' })).toBeNull();
});

test('the stepper stops at the limits the server sends (2 and the room before the arrival)', () => {
  const { unmount } = render(<Harness initial={planOf({ count: 2, installments: [installment(1), installment(2, { amountEditable: false })] })} />);
  expect(screen.getByRole('button', { name: 'Une échéance de moins' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Une échéance de plus' })).toBeEnabled();
  unmount();
  render(<Harness initial={planOf({ maxCount: 3 })} />);
  expect(screen.getByRole('button', { name: 'Une échéance de plus' })).toBeDisabled();
});

test('rapid clicks each count, move the display at once, and send only the final count after 300 ms', async () => {
  vi.useFakeTimers();
  api.putInstallments.mockResolvedValue({ installmentPlan: planOf({ count: 6, installments: Array.from({ length: 6 }, (_, i) => installment(i + 1)) }) });
  render(<Harness initial={planOf()} />);
  const more = screen.getByRole('button', { name: 'Une échéance de plus' });
  fireEvent.click(more);
  fireEvent.click(more);
  fireEvent.click(more);
  expect(screen.getByText('6 échéances')).toBeInTheDocument();
  expect(api.putInstallments).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Une échéance de plus' })).toBe(more);
  await act(async () => { await vi.advanceTimersByTimeAsync(299); });
  expect(api.putInstallments).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2); });
  expect(api.putInstallments).toHaveBeenCalledTimes(1);
  expect(api.putInstallments).toHaveBeenCalledWith(7, { count: 6 });
  expect(screen.getByText('6 échéances')).toBeInTheDocument();
});

test('a late reply never moves the count back: it is ignored once a newer click is pending', async () => {
  vi.useFakeTimers();
  let release;
  api.putInstallments.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<Harness initial={planOf()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(301); });
  expect(api.putInstallments).toHaveBeenCalledWith(7, { count: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  expect(screen.getByText('5 échéances')).toBeInTheDocument();
  await act(async () => { release({ installmentPlan: planOf({ count: 4, installments: Array.from({ length: 4 }, (_, i) => installment(i + 1)) }) }); });
  expect(screen.getByText('5 échéances')).toBeInTheDocument();
});

test('a refused count puts the display back on the count the server holds', async () => {
  const user = userEvent.setup();
  api.putInstallments.mockRejectedValue(Object.assign(new Error('Un paiement est enregistré : le nombre d’échéances est figé.'), { status: 409 }));
  render(<Harness initial={planOf()} />);
  await user.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('3 échéances')).toBeInTheDocument());
});

test('rule 12 — with edited dates, a new count asks first and says they will be lost', async () => {
  const user = userEvent.setup();
  api.putInstallments.mockResolvedValue({ installmentPlan: planOf({ count: 4, installments: Array.from({ length: 4 }, (_, i) => installment(i + 1)) }) });
  render(<Harness initial={planOf({ installments: [installment(1), installment(2, { dateEdited: true }), installment(3, { amountEditable: false })] })} />);
  await user.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  expect(screen.getByText(/les dates et montants modifiés seront perdus/)).toBeInTheDocument();
  expect(api.putInstallments).not.toHaveBeenCalled();
  expect(screen.getByText('3 échéances')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Garder' }));
  expect(screen.queryByText(/seront perdus/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  await user.click(screen.getByRole('button', { name: 'Recalculer' }));
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledWith(7, { count: 4 }));
});

test('rule 11 — a refused date turns the field red with the server\'s sentence and keeps what was typed', async () => {
  const message = 'Échéance 2 : après l\'échéance 1 (10/01/2027) et avant l\'arrivée du 14/06/2027.';
  api.putInstallments.mockRejectedValue(Object.assign(new Error(message), { status: 400, field: 'dueDate' }));
  render(<Harness initial={planOf()} />);
  const field = within(rowOf(2)).getByLabelText('Date de l’échéance 2');
  fireEvent.change(field, { target: { value: '2026-12-01' } });
  fireEvent.blur(field);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(api.putInstallments).toHaveBeenCalledWith(7, { dates: [{ id: 42, dueDate: '2026-12-01' }] });
  expect(within(rowOf(2)).getByLabelText('Date de l’échéance 2')).toHaveValue('2026-12-01');
  expect(within(rowOf(2)).getByLabelText('Date de l’échéance 2')).toHaveAttribute('aria-invalid', 'true');
});

test('rule 9a — a typed amount is sent on blur; the refusal shows under the row', async () => {
  const user = userEvent.setup();
  api.putInstallments.mockRejectedValueOnce(Object.assign(new Error("Laisse moins de 1 € à l'échéance 3."), { status: 400 }));
  render(<Harness initial={planOf()} />);
  const field = within(rowOf(1)).getByLabelText('Montant de l’échéance 1');
  await user.clear(field);
  await user.type(field, '999');
  await user.tab();
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledWith(7, { amounts: [{ id: 41, amount: '999' }] }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Laisse moins de 1 € à l'échéance 3.");

  api.putInstallments.mockResolvedValueOnce({ installmentPlan: planOf({ installments: [installment(1, { amount: 500, amountEdited: true }), installment(2, { amount: 251 }), installment(3, { amount: 250.5, amountEditable: false })] }) });
  await user.clear(within(rowOf(1)).getByLabelText('Montant de l’échéance 1'));
  await user.type(within(rowOf(1)).getByLabelText('Montant de l’échéance 1'), '500{Enter}');
  await waitFor(() => expect(within(rowOf(2)).getByLabelText('Montant de l’échéance 2')).toHaveValue('251'));
  expect(within(rowOf(1)).getByText('fixé')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('no plan yet: one line and a « Créer un échéancier » button, disabled with the reason when money is in', async () => {
  const user = userEvent.setup();
  api.putInstallments.mockResolvedValue({ installmentPlan: planOf() });
  const { unmount } = render(<Harness initial={planOf({ canCreate: true, installments: [], count: 0 })} />);
  expect(screen.getByText('Paiement en plusieurs fois')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Créer un échéancier' }));
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledWith(7, { count: 3 }));
  expect(await screen.findByText('3 échéances')).toBeInTheDocument();
  unmount();

  render(<Harness initial={planOf({ canCreate: false, reason: 'Un paiement est déjà enregistré sur ce séjour.', installments: [], count: 0 })} />);
  expect(screen.getByRole('button', { name: 'Créer un échéancier' })).toBeDisabled();
  expect(screen.getByText('Un paiement est déjà enregistré sur ce séjour.')).toBeInTheDocument();
});

test('removing the plan returns to the empty line', async () => {
  const user = userEvent.setup();
  api.deleteInstallments.mockResolvedValue({ installmentPlan: planOf({ canCreate: true, installments: [], count: 0 }) });
  const onMoney = vi.fn();
  render(<Harness initial={planOf()} onMoney={onMoney} />);
  await user.click(screen.getByRole('button', { name: 'Supprimer l’échéancier' }));
  expect(await screen.findByRole('button', { name: 'Créer un échéancier' })).toBeInTheDocument();
  expect(onMoney).toHaveBeenCalled();
});

test('rules 16, 20 — « Envoyer la demande » only while online payment is on and nothing was sent; « Copier le lien » once sent', async () => {
  const user = userEvent.setup();
  api.sendInstallmentRequest.mockResolvedValue({ sent: true, recipientEmail: 'camille@example.com' });
  const onMoney = vi.fn();
  const { unmount } = render(<Harness initial={planOf({ installments: [installment(1), installment(2, { requestedAt: '2026-10-27T08:00:00Z', linkUrl: 'https://pay.example/2', status: 'requested', statusLabel: 'Demandée le 27/10' }), installment(3, { amountEditable: false })] })} onMoney={onMoney} />);
  expect(within(rowOf(1)).getByRole('button', { name: 'Envoyer la demande' })).toBeInTheDocument();
  expect(within(rowOf(2)).queryByRole('button', { name: 'Envoyer la demande' })).toBeNull();
  expect(within(rowOf(2)).getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument();
  await user.click(within(rowOf(1)).getByRole('button', { name: 'Envoyer la demande' }));
  await waitFor(() => expect(api.sendInstallmentRequest).toHaveBeenCalledWith(7, 41));
  await waitFor(() => expect(onMoney).toHaveBeenCalled());
  unmount();

  render(<Harness initial={planOf({ canRequest: false })} />);
  expect(screen.queryByRole('button', { name: 'Envoyer la demande' })).toBeNull();
});

test('rule 16 — « Marquer payée » opens the inline form with the mode, and replaces the plan with the answer', async () => {
  const user = userEvent.setup();
  api.markInstallmentPaid.mockResolvedValue({
    installmentPlan: planOf({
      countLocked: true, frozen: true, paid: 334, remaining: 667.5,
      installments: [installment(1, { status: 'paid', statusLabel: 'Payée le 27/10 · chèque', editable: false, amountEditable: false, paidDate: '2026-10-27', method: 'cheque' }), installment(2), installment(3, { amountEditable: false })],
    }),
  });
  render(<Harness initial={planOf()} />);
  await user.click(within(rowOf(1)).getByRole('button', { name: 'Marquer payée' }));
  expect(screen.getByLabelText('Perçu le')).toHaveValue('2026-10-27');
  await user.selectOptions(screen.getByLabelText('Mode de paiement'), 'cheque');
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.markInstallmentPaid).toHaveBeenCalledWith(7, 41, { paidDate: '2026-10-27', method: 'cheque' }));
  expect(await screen.findByText('Payée le 27/10 · chèque')).toBeInTheDocument();
  expect(screen.queryByLabelText('Perçu le')).toBeNull();
});

test('rule 16 — a refused mark shows the server\'s reason under the form, which stays open', async () => {
  const user = userEvent.setup();
  api.markInstallmentPaid.mockRejectedValue(Object.assign(new Error('Un encaissement ne peut pas être daté dans le futur.'), { field: 'paidDate' }));
  render(<Harness initial={planOf()} />);
  await user.click(within(rowOf(1)).getByRole('button', { name: 'Marquer payée' }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(await screen.findByText('Un encaissement ne peut pas être daté dans le futur.')).toBeInTheDocument();
  expect(screen.getByLabelText('Perçu le')).toBeInTheDocument();
});

test('a change of mind while the first request is in flight is sent: + then − ends on the server at the count asked', async () => {
  vi.useFakeTimers();
  const releases = [];
  api.putInstallments.mockImplementation(({}, body) => new Promise((resolve) => {
    releases.push(() => resolve({ installmentPlan: planOf({ count: body.count, installments: Array.from({ length: body.count }, (_, i) => installment(i + 1)) }) }));
  }));
  render(<Harness initial={planOf()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(301); });
  expect(api.putInstallments).toHaveBeenLastCalledWith(7, { count: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Une échéance de moins' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(301); });
  expect(api.putInstallments).toHaveBeenLastCalledWith(7, { count: 3 });
  expect(api.putInstallments).toHaveBeenCalledTimes(2);
  await act(async () => { releases[0](); });
  expect(screen.getByText('3 échéances')).toBeInTheDocument();
  await act(async () => { releases[1](); });
  expect(screen.getByText('3 échéances')).toBeInTheDocument();
});

test('« Supprimer l\u2019échéancier » waits for the count being gathered: it is disabled until the request has settled', async () => {
  const user = userEvent.setup();
  let release;
  api.putInstallments.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ installmentPlan: planOf({ count: 4, installments: Array.from({ length: 4 }, (_, i) => installment(i + 1)) }) }); }));
  render(<Harness initial={planOf()} />);
  await user.click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  expect(screen.getByRole('button', { name: 'Supprimer l’échéancier' })).toBeDisabled();
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Supprimer l’échéancier' })).toBeDisabled();
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Supprimer l’échéancier' })).toBeEnabled());
});

test('rule 44 — while the fiche has unsaved changes the card is read-only and says why', () => {
  render(<Harness initial={planOf()} disabled />);
  expect(screen.getByText('Enregistrer la fiche avant de modifier l’échéancier.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Une échéance de plus' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Supprimer l’échéancier' })).toBeDisabled();
  expect(within(rowOf(1)).getByLabelText('Date de l’échéance 1')).toBeDisabled();
  expect(within(rowOf(1)).getByLabelText('Montant de l’échéance 1')).toBeDisabled();
  expect(within(rowOf(1)).getByRole('button', { name: 'Marquer payée' })).toBeDisabled();
});

test('the arrival bound of a date is the SAVED one the server sends, not the fiche being edited', () => {
  render(<Harness initial={planOf({ arrivalDate: '2027-06-14' })} />);
  expect(within(rowOf(2)).getByLabelText('Date de l’échéance 2')).toHaveAttribute('max', '2027-06-14');
});

test('a date is sent when the field is left, not per keystroke, and a refused value is not sent twice', async () => {
  api.putInstallments.mockRejectedValue(Object.assign(new Error('Échéance 2 : date passée, à partir du 27/10/2026.'), { status: 400 }));
  render(<Harness initial={planOf()} />);
  const field = () => within(rowOf(2)).getByLabelText('Date de l’échéance 2');
  fireEvent.change(field(), { target: { value: '2026-01-01' } });
  fireEvent.change(field(), { target: { value: '2026-02-01' } });
  fireEvent.change(field(), { target: { value: '2026-12-01' } });
  expect(api.putInstallments).not.toHaveBeenCalled();
  fireEvent.blur(field());
  await screen.findByRole('alert');
  expect(api.putInstallments).toHaveBeenCalledTimes(1);
  expect(api.putInstallments).toHaveBeenCalledWith(7, { dates: [{ id: 42, dueDate: '2026-12-01' }] });
  fireEvent.blur(field());
  expect(api.putInstallments).toHaveBeenCalledTimes(1);
  fireEvent.change(field(), { target: { value: '2026-12-02' } });
  fireEvent.blur(field());
  await waitFor(() => expect(api.putInstallments).toHaveBeenCalledTimes(2));
});

test('once an error is gone the field shows the server value again, and the amount error does not cover the date', async () => {
  const user = userEvent.setup();
  api.putInstallments.mockRejectedValueOnce(Object.assign(new Error('Montant refusé.'), { status: 400 }));
  render(<Harness initial={planOf()} />);
  const amount = within(rowOf(1)).getByLabelText('Montant de l’échéance 1');
  await user.clear(amount);
  await user.type(amount, '999');
  await user.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent('Montant refusé.');
  expect(within(rowOf(1)).getByLabelText('Date de l’échéance 1')).not.toHaveAttribute('aria-invalid');
  api.putInstallments.mockResolvedValueOnce({ installmentPlan: planOf({ installments: [installment(1, { amount: 400, amountEdited: true }), installment(2, { amount: 301 }), installment(3, { amount: 300.5, amountEditable: false })] }) });
  await user.clear(within(rowOf(1)).getByLabelText('Montant de l’échéance 1'));
  await user.type(within(rowOf(1)).getByLabelText('Montant de l’échéance 1'), '400{Enter}');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(within(rowOf(1)).getByLabelText('Montant de l’échéance 1')).toHaveValue('400');
});
