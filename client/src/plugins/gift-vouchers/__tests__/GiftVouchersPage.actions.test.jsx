// specs/gift-vouchers.md rules 25-28 — the detail's actions: reveal the masked code, resend, extend, cancel (disabled once
// redeemed), adjust with a reason. « Nouveau bon » is a page of its own (NewVoucherPage.test.jsx); the cancellation flow is GiftVouchersPage.cancel.test.jsx.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import GiftVoucherDetail from '../GiftVoucherDetail';
import { detail, renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    get: vi.fn(), reveal: vi.fn(), resend: vi.fn(), extend: vi.fn(), cancel: vi.fn(), adjust: vi.fn(), downloadVoucher: vi.fn(), settleRefund: vi.fn(),
  },
}));
vi.mock('../../../api', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, default: { ...mod.default, getToday: vi.fn().mockResolvedValue({ today: '2026-11-15' }) } };
});

beforeEach(() => { vi.clearAllMocks(); });

const refusal = (message, code) => Object.assign(new Error(message), { code });

test('the code is masked until « Afficher le code » asks the server, then it is shown', async () => {
  giftVouchersApi.reveal.mockResolvedValue({ code: 'ABCD-EFGH-JKLM-3NPC' });
  giftVouchersApi.get.mockResolvedValue(detail());
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={vi.fn()} />);
  expect(screen.getByTestId('voucher-code')).toHaveTextContent('3NPC');
  expect(screen.getByTestId('voucher-code')).not.toHaveTextContent('ABCD');
  await userEvent.click(screen.getByRole('button', { name: 'Afficher le code' }));
  await waitFor(() => expect(screen.getByTestId('voucher-code')).toHaveTextContent('ABCD-EFGH-JKLM-3NPC'));
  expect(giftVouchersApi.reveal).toHaveBeenCalledWith(1);
});

test('« Renvoyer le mail » asks for another address when it is typed, and sends it to the server', async () => {
  giftVouchersApi.resend.mockResolvedValue(detail());
  renderWithShell(<GiftVoucherDetail voucher={detail({ buyerEmail: null })} onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Renvoyer le mail' }));
  await userEvent.type(await screen.findByLabelText(/Autre adresse e-mail/), 'autre@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Renvoyer' }));
  await waitFor(() => expect(giftVouchersApi.resend).toHaveBeenCalledWith(1, 'autre@example.test'));
});

test('« Télécharger le bon » and « Renvoyer le mail » are not offered for a voucher used, expired or cancelled, and say why', () => {
  renderWithShell(<GiftVoucherDetail voucher={detail({ canDownload: false, state: 'expired' })} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Télécharger le bon' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Renvoyer le mail' })).toBeDisabled();
  expect(screen.getByText(/ne peut plus être téléchargé ni renvoyé/)).toBeInTheDocument();
});

test('« Télécharger le bon » asks the server for the PDF of the voucher', async () => {
  giftVouchersApi.downloadVoucher.mockResolvedValue(undefined);
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Télécharger le bon' }));
  await waitFor(() => expect(giftVouchersApi.downloadVoucher).toHaveBeenCalledWith(1, 'BC-2026-0001'));
});

test('« Annuler le bon » asks for confirmation, then calls the server', async () => {
  const onChange = vi.fn();
  giftVouchersApi.cancel.mockResolvedValue(detail({ state: 'cancelled', canCancel: false }));
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler le bon' }));
  expect(giftVouchersApi.cancel).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le bon' }));
  await waitFor(() => expect(giftVouchersApi.cancel).toHaveBeenCalledWith(1));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
});

test('cancelling is disabled when the server says the voucher has been redeemed', () => {
  renderWithShell(<GiftVoucherDetail voucher={detail({ canCancel: false })} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Annuler le bon' })).toBeDisabled();
  expect(screen.getByText('Ce bon a déjà servi : il ne peut plus être annulé.')).toBeInTheDocument();
});

test('« Prolonger » sends the chosen date and shows the server refusal on the field', async () => {
  giftVouchersApi.extend.mockRejectedValueOnce(refusal('La nouvelle date doit être dans le futur.', 'DATE_NOT_IN_FUTURE'));
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Prolonger' }));
  const field = await screen.findByLabelText('Nouvelle date de fin');
  field.focus();
  await userEvent.type(field, '2020-01-01');
  await userEvent.click(screen.getByRole('button', { name: 'Prolonger' }));
  expect(await screen.findByText('La nouvelle date doit être dans le futur.')).toBeInTheDocument();
  expect(giftVouchersApi.extend).toHaveBeenCalledWith(1, '2020-01-01');
});

test('« Corriger le solde » needs a reason before it asks the server; the amount may be negative', async () => {
  giftVouchersApi.adjust.mockResolvedValue(detail({ balanceCents: 14000 }));
  const onChange = vi.fn();
  renderWithShell(<GiftVoucherDetail voucher={detail()} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Corriger le solde' }));
  const amount = await screen.findByLabelText(/Montant/);
  amount.focus();
  await userEvent.type(amount, '-10');
  await userEvent.click(screen.getByRole('button', { name: 'Corriger' }));
  expect(await screen.findByText('Un motif est demandé.')).toBeInTheDocument();
  expect(giftVouchersApi.adjust).not.toHaveBeenCalled();
  const reason = screen.getByLabelText(/Motif/);
  reason.focus();
  await userEvent.type(reason, 'Erreur de saisie');
  await userEvent.click(screen.getByRole('button', { name: 'Corriger' }));
  await waitFor(() => expect(giftVouchersApi.adjust).toHaveBeenCalledWith(1, -1000, 'Erreur de saisie'));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
});

test('the movements render the server label, day and author; a zero-amount movement shows no amount', async () => {
  const voucher = detail({
    movements: [
      {
        id: 1, kind: 'issue', label: 'Émission', amountCents: 15000, date: '2026-11-10', actorName: 'Adrien', reservationId: null, note: null,
      },
      {
        id: 2, kind: 'reveal', label: 'Code affiché', amountCents: 0, date: '2026-11-11', actorName: 'Site', reservationId: null, note: null,
      },
    ],
  });
  renderWithShell(<GiftVoucherDetail voucher={voucher} onChange={vi.fn()} />);
  const rows = screen.getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Émission');
  expect(rows[0]).toHaveTextContent('Adrien');
  expect(rows[0]).toHaveTextContent('150,00');
  expect(rows[1]).toHaveTextContent('Code affiché');
  expect(rows[1]).not.toHaveTextContent('€');
});
