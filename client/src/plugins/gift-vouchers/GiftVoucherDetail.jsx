/**
 * GiftVoucherDetail — one voucher (specs/gift-vouchers.md rules 25-28): its figures, the code (masked until « Afficher
 * le code »), its movements and the actions. Rendered in the side panel on `lg`, in a dialog below.
 *
 * Props: voucher (the server's detail payload), onChange(voucher), onClose (shown as « Fermer » when given)
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Button, Divider, Stack, Typography,
} from '@mui/material';
import {
  ConfirmDialog, StatusBadge, SummaryItem, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { AdjustDialog, ExtendDialog } from './GiftVoucherActionDialogs';
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
  const resend = () => run(() => giftVouchersApi.resend(voucher.id), (v) => { onChange(v); showSuccess(T.resent); });
  const pdf = () => run(() => giftVouchersApi.openPdf(voucher.id));
  const cancel = () => {
    setDialog(null);
    return run(() => giftVouchersApi.cancel(voucher.id), (v) => { onChange(v); showSuccess(T.cancelled); });
  };
  const done = (v) => { setDialog(null); onChange(v); };

  const actions = [
    { key: 'resend', label: T.resend, onClick: resend, disabled: cancelled || !voucher.buyerEmail, hint: !voucher.buyerEmail ? T.noEmail : null },
    { key: 'pdf', label: T.pdf, onClick: pdf },
    { key: 'extend', label: T.extend, onClick: () => setDialog('extend'), disabled: cancelled },
    { key: 'adjust', label: T.adjust, onClick: () => setDialog('adjust'), disabled: cancelled },
    {
      key: 'cancel', label: T.cancel, onClick: () => setDialog('cancel'), disabled: !voucher.canCancel, hint: !voucher.canCancel && !cancelled ? T.cancelNotAllowed : null, color: 'error',
    },
  ];

  return (
    <Stack spacing={2} data-testid="voucher-detail">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="sectionHeader">{voucher.number}</Typography>
        <StatusBadge status={badge.status} label={badge.label} />
      </Stack>

      <Stack spacing={0.5}>
        <SummaryItem label={T.balance} value={`${formatCents(voucher.balanceCents)} / ${formatCents(voucher.amountCents)}`} />
        <SummaryItem label={T.expiry} value={formatDay(voucher.expiresOn)} />
        <SummaryItem label={T.from} value={voucher.senderName || '—'} />
        <SummaryItem label={T.to} value={voucher.recipientName || '—'} />
        <SummaryItem label={T.email} value={voucher.buyerEmail || '—'} />
        {voucher.message ? <SummaryItem label={T.message} value={voucher.message} /> : null}
      </Stack>

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
      <ConfirmDialog
        open={dialog === 'cancel'} onClose={() => setDialog(null)} onConfirm={cancel} title={TEXTS.cancelDialog.title}
        message={TEXTS.cancelDialog.message} confirmLabel={TEXTS.cancelDialog.confirm} cancelLabel={TEXTS.cancelDialog.keep}
      />
    </Stack>
  );
}
