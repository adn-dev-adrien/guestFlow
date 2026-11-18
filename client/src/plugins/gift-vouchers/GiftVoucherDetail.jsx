/**
 * GiftVoucherDetail — one voucher (specs/gift-vouchers.md rules 25-28): its figures, the code (masked until « Afficher
 * le code »), its movements and the actions. Rendered in the side panel on `lg`, in a dialog below.
 *
 * Cancelling follows the 14-day withdrawal the server reports (`withdrawal.open`): a confirmation naming the voucher and the amount to refund within it, a forcing
 * dialog with a mandatory reason after it (specs/gift-voucher-campaigns.md rule 54); a cancelled voucher carries its refund line, marked settled from here.
 *
 * Props: voucher (the server's detail payload), onChange(voucher), onClose (shown as « Fermer » when given)
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Box, Button, Chip, Divider, Link, Stack, Typography,
} from '@mui/material';
import {
  ConfirmDialog, StatusBadge, SummaryItem, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import {
  AdjustDialog, ExtendDialog, ForcedCancelDialog, ResendDialog,
} from './GiftVoucherActionDialogs';
import { formatCents, formatDay } from './giftVoucherFormat';
import { STATE_BADGES, TEXTS } from './giftVoucherTexts';

const T = TEXTS.detail;

export default function GiftVoucherDetail({ voucher, onChange, onClose }) {
  const { showSuccess, showError } = useToast();
  const [code, setCode] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(null); setDialog(null); }, [voucher.id]);

  const badge = STATE_BADGES[voucher.state] || STATE_BADGES.pending;
  const cancelled = voucher.state === 'cancelled';

  async function run(action, done) {
    setBusy(true);
    try {
      const result = await action();
      if (done) done(result);
    } catch (err) {
      showError((err && err.message) || 'L’action n’a pas abouti.');
    } finally {
      setBusy(false);
    }
  }

  const reveal = () => run(() => giftVouchersApi.reveal(voucher.id), (r) => { setCode(r.code); giftVouchersApi.get(voucher.id).then(onChange).catch(() => {}); });
  const pdf = () => run(() => giftVouchersApi.downloadVoucher(voucher.id, voucher.number), () => showSuccess(T.downloaded));
  const settle = (refund) => run(() => giftVouchersApi.settleRefund(voucher.id, refund.id), (v) => { onChange(v); showSuccess(T.refundSettled); });
  const cancel = async () => {
    setDialog(null);
    setBusy(true);
    try {
      onChange(await giftVouchersApi.cancel(voucher.id));
      showSuccess(T.cancelled);
    } catch (err) {
      if (err && err.code === 'CANCEL_FORCE_REQUIRED') setDialog('forced');
      else showError((err && err.message) || 'L’action n’a pas abouti.');
    } finally {
      setBusy(false);
    }
  };
  const done = (v) => { setDialog(null); onChange(v); };
  const withinWithdrawal = !voucher.withdrawal || voucher.withdrawal.open;
  const D = TEXTS.cancelDialog;
  const cancelMessage = voucher.refundCents > 0 ? D.message(voucher.number, formatCents(voucher.refundCents)) : D.messageOffered(voucher.number);

  const actions = [
    { key: 'resend', label: T.resend, onClick: () => setDialog('resend'), disabled: !voucher.canDownload, hint: !voucher.canDownload ? T.notDownloadable : null },
    { key: 'pdf', label: T.pdf, onClick: pdf, disabled: !voucher.canDownload },
    { key: 'extend', label: T.extend, onClick: () => setDialog('extend'), disabled: cancelled },
    { key: 'adjust', label: T.adjust, onClick: () => setDialog('adjust'), disabled: cancelled },
    {
      key: 'cancel', label: T.cancel, onClick: () => setDialog(withinWithdrawal ? 'cancel' : 'forced'), disabled: !voucher.canCancel, hint: !voucher.canCancel && !cancelled ? T.cancelNotAllowed : null, color: 'error',
    },
  ];

  return (
    <Stack spacing={2} data-testid="voucher-detail">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="sectionHeader">{voucher.number}</Typography>
        <StatusBadge status={badge.status} label={badge.label} />
      </Stack>

      <Stack spacing={0.5}>
        <SummaryItem label={T.campaign} value={voucher.oneShot ? T.oneShot : (voucher.campaignName || '—')} />
        <SummaryItem label={T.contents} value={(voucher.contentLines || []).join(' · ')} />
        <SummaryItem label={T.balance} value={`${formatCents(voucher.balanceCents)} / ${formatCents(voucher.amountCents)}`} />
        <SummaryItem label={T.expiry} value={formatDay(voucher.expiresOn)} />
        {voucher.vat ? <SummaryItem label={T.vat} value={`${String(voucher.vat.ratePercent).replace('.', ',')} % · ${formatCents(voucher.vat.vatCents)} (HT ${formatCents(voucher.vat.htCents)})`} /> : null}
        <SummaryItem label={T.from} value={voucher.senderName || '—'} />
        <SummaryItem label={T.to} value={voucher.recipientName || '—'} />
        <SummaryItem label={T.email} value={voucher.buyerEmail || '—'} />
        {voucher.message ? <SummaryItem label={T.message} value={voucher.message} /> : null}
        {voucher.unusedCents > 0 ? (
          <SummaryItem label={T.unused} value={`${formatCents(voucher.unusedCents)} · ${voucher.unused.map((u) => u.label).join(', ')}`} />
        ) : null}
        {voucher.bath ? (
          <SummaryItem
            label={T.usedOn}
            value={(
              <Link component={RouterLink} to={`/passages/${voucher.bath.bookingId}`} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                {`${formatDay(voucher.bath.usedOn)} · ${TEXTS.openBooking}`}
              </Link>
            )}
          />
        ) : null}
        {voucher.oneShot ? <Chip size="small" label={T.oneShot} sx={{ alignSelf: 'flex-start' }} /> : null}
      </Stack>

      {cancelled ? (
        <Stack spacing={1} data-testid="cancel-block">
          {voucher.cancelForced ? <Typography variant="body2" color="text.secondary">{T.forcedCancel}</Typography> : null}
          {voucher.cancelReason ? <SummaryItem label={T.cancelReason} value={voucher.cancelReason} /> : null}
          {voucher.offered ? <Typography variant="body2" color="text.secondary">{T.noRefund}</Typography> : null}
          {voucher.refunds.map((r) => (
            <Stack key={r.id} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {r.settledOn ? (
                <Typography variant="body2">{T.refundDone(formatCents(r.amountCents), formatDay(r.settledOn))}</Typography>
              ) : (
                <>
                  <StatusBadge status="warning" label={T.refundDue(formatCents(r.amountCents))} />
                  <Button size="small" variant="outlined" onClick={() => settle(r)} disabled={busy} sx={{ minHeight: 44 }}>{T.refundSettle}</Button>
                </>
              )}
            </Stack>
          ))}
        </Stack>
      ) : null}

      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">{T.code}</Typography>
        <Typography sx={{ fontFamily: 'monospace', letterSpacing: 1 }} data-testid="voucher-code">
          {code || voucher.codeMasked || '—'}
        </Typography>
        {!code && voucher.codeMasked ? (
          <Button size="small" onClick={reveal} disabled={busy} sx={{ minHeight: 44 }}>{T.reveal}</Button>
        ) : null}
        {code ? <Button size="small" onClick={() => setCode(null)} sx={{ minHeight: 44 }}>{T.hide}</Button> : null}
      </Stack>
      {voucher.mailError ? <Typography variant="body2" color="error">{T.mailError}</Typography> : null}

      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        {actions.map((a) => (
          <Box key={a.key}>
            <Button
              fullWidth variant="outlined" color={a.color || 'primary'} onClick={a.onClick}
              disabled={a.disabled || busy} sx={{ minHeight: 44 }}
            >
              {a.label}
            </Button>
            {a.hint ? <Typography variant="caption" color="text.secondary">{a.hint}</Typography> : null}
          </Box>
        ))}
      </Box>

      <Divider />
      <Typography variant="sectionHeader">{T.movements}</Typography>
      <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {(voucher.movements || []).map((m) => (
          <Box component="li" key={m.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">{m.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {[formatDay(m.date), m.actorName, m.note].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            {m.amountCents !== 0 ? <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{formatCents(m.amountCents)}</Typography> : null}
          </Box>
        ))}
      </Stack>

      {onClose ? <Button onClick={onClose} sx={{ minHeight: 44 }}>{T.close}</Button> : null}

      <ExtendDialog open={dialog === 'extend'} onClose={() => setDialog(null)} voucher={voucher} onDone={done} />
      <AdjustDialog open={dialog === 'adjust'} onClose={() => setDialog(null)} voucher={voucher} onDone={done} />
      <ResendDialog open={dialog === 'resend'} onClose={() => setDialog(null)} voucher={voucher} onDone={done} />
      <ForcedCancelDialog open={dialog === 'forced'} onClose={() => setDialog(null)} voucher={voucher} onDone={done} />
      <ConfirmDialog
        open={dialog === 'cancel'} onClose={() => setDialog(null)} onConfirm={cancel} title={D.title}
        message={cancelMessage} confirmLabel={D.confirm} cancelLabel={D.keep}
      />
    </Stack>
  );
}
