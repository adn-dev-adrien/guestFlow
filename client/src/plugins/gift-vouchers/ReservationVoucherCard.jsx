/**
 * ReservationVoucherCard — « Bon cadeau » on the fiche (specs/gift-vouchers.md rules 40-41). The server shapes everything
 * (what the stay still owes, the payments already made with a voucher, what a cancelled stay may give back to the voucher);
 * this card renders it and sends the operator's gestures: pay with a code and an amount, take a payment back, re-credit.
 *
 * Nothing is rendered for a new fiche, a quote, an unknown stay, a stay with nothing owed and no voucher payment, or when the
 * server refuses the read (the reception role).
 *
 * Props (slot `reservation.cards`): reservationId, cardSx, contentSx, reloadFinance
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Button, Card, CardContent, Stack, TextField, Typography,
} from '@mui/material';
import { useAppDialogs, useToast } from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { eurosToCents, formatCents, formatDay } from './giftVoucherFormat';
import { TEXTS } from './giftVoucherTexts';

const T = TEXTS.stayCard;

export default function ReservationVoucherCard({
  reservationId, cardSx, contentSx, reloadFinance,
}) {
  const { confirm } = useAppDialogs();
  const { showSuccess } = useToast();
  const [stay, setStay] = useState(null);
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const stale = useRef(false);

  const load = useCallback(async () => {
    if (!reservationId) { setStay(null); return; }
    try {
      const fetched = await giftVouchersApi.getStay(reservationId);
      if (!stale.current) setStay(fetched);
    } catch {
      if (!stale.current) setStay(null);
    }
  }, [reservationId]);

  useEffect(() => {
    stale.current = false;
    load();
    return () => { stale.current = true; };
  }, [load]);

  if (!stay) return null;
  const recredit = stay.recredit && stay.recredit.voucherCents > 0 ? stay.recredit : null;
  const nothingToShow = !stay.lines.length && !(stay.canPay && stay.owedCents > 0) && !recredit;
  if (nothingToShow) return null;

  const done = async (next, message) => {
    setStay(next);
    setCode('');
    setAmount('');
    setErrors({});
    showSuccess(message);
    if (reloadFinance) reloadFinance();
  };

  async function submit(event) {
    event.preventDefault();
    const cents = eurosToCents(amount);
    const next = {};
    if (!code.trim()) next.code = T.codeRequired;
    if (cents === null || cents <= 0) next.amount = T.amountInvalid;
    else if (cents > stay.owedCents) next.amount = T.amountAbove(formatCents(stay.owedCents));
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await done(await giftVouchersApi.payStay(reservationId, { code, amountCents: cents }), T.paid);
    } catch (err) {
      const message = (err && err.message) || T.payFailed;
      setErrors(/montant|solde|doit/i.test(message) ? { amount: message } : { code: message });
    } finally {
      setBusy(false);
    }
  }

  async function undo(line) {
    const ok = await confirm({
      title: T.undoTitle,
      message: T.undoMessage(formatCents(line.amountCents)),
      confirmLabel: T.undoConfirm,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await done(await giftVouchersApi.undoStayPayment(reservationId, line.ref), T.undone);
    } catch (err) {
      setErrors({ undo: (err && err.message) || T.undoFailed });
    } finally {
      setBusy(false);
    }
  }

  async function giveBack() {
    setBusy(true);
    try {
      await done(await giftVouchersApi.recreditStay(reservationId), T.recredited);
    } catch (err) {
      setErrors({ recredit: (err && err.message) || T.recreditFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Typography variant="sectionHeader" sx={{ mb: 1.5 }}>{T.title}</Typography>
        <Stack spacing={1.5}>
          {stay.lines.map((line) => (
            <Box key={line.ref} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {`${line.label} · ${formatCents(line.amountCents)} · ${formatDay(line.paidDate)}`}
              </Typography>
              {line.undoable && (
                <Button color="inherit" size="small" onClick={() => undo(line)} disabled={busy} sx={{ minHeight: 44 }}>{T.undo}</Button>
              )}
            </Box>
          ))}
          {errors.undo && <Typography variant="body2" color="error" role="alert">{errors.undo}</Typography>}

          {stay.canPay && stay.owedCents > 0 && (
            <Box component="form" onSubmit={submit} noValidate>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{T.owed(formatCents(stay.owedCents))}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  label={T.codeLabel}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  error={Boolean(errors.code)}
                  helperText={errors.code || ' '}
                  size="small"
                  autoComplete="off"
                  sx={{ flex: 2 }}
                />
                <TextField
                  label={T.amountLabel}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={Boolean(errors.amount)}
                  helperText={errors.amount || ' '}
                  size="small"
                  autoComplete="off"
                  inputProps={{ inputMode: 'decimal' }}
                  sx={{ flex: 1 }}
                />
                <Button type="submit" variant="outlined" disabled={busy} sx={{ minHeight: 44, minWidth: 44 }}>{T.pay}</Button>
              </Stack>
            </Box>
          )}

          {recredit && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {recredit.recreditCents > 0 ? T.recreditOffer(formatCents(recredit.recreditCents), formatCents(recredit.voucherCents)) : T.recreditNone}
              </Typography>
              {recredit.recreditCents > 0 && (
                <Button variant="outlined" onClick={giveBack} disabled={busy} sx={{ minHeight: 44 }}>{T.recredit}</Button>
              )}
              {errors.recredit && <Typography variant="body2" color="error" role="alert">{errors.recredit}</Typography>}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
