/**
 * SalePaymentLink — the « Envoyer un lien » block of a sale's reste (specs/outside-booking-sas.md rules 39-42): a Qonto payment link for what is still owed, shown, copied
 * and sent only by the operator's click. Generic: it renders the server's `paymentLink` payload and tells its parent what was clicked; the amount of a link is the server's
 * SETTLEMENT reste, never typed here.
 *
 * States, all from the payload:
 *   unavailable  `reason` PROVIDER_NOT_READY (or NOTHING_DUE) — nothing is rendered (the parent says « Rien à encaisser. » itself)
 *   needsEmail   `reason` NO_EMAIL — the action is shown disabled with « Adresse e-mail requise. » and an « E-mail » field; a valid address enables it
 *   ready        the action « Envoyer un lien »
 *   minted       `open` is set — « Lien · {amount} · valable jusqu'au {date} », « Copier le lien », « Envoyer par e-mail », « Retirer le lien »
 *
 * Props:
 *   link          { available, reason, email, open: { id, url, amountCents, expiresAt } | null } | null
 *   onMint(email)         the click on « Envoyer un lien » (the typed address, or null)
 *   onSendEmail(open)     the click on « Envoyer par e-mail » — the only thing that mails
 *   onWithdraw(open)      « Retirer le lien »
 *   busy                  an action is in flight
 *   error                 the server's refusal, shown under the block
 *   sentTo                the address the e-mail was sent to (shows « E-mail envoyé à … »)
 *   disabled              read-only
 */
import React, { useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';

const TEXTS = Object.freeze({
  action: 'Envoyer un lien',
  needsEmail: 'Adresse e-mail requise.',
  emailLabel: 'E-mail',
  emailInvalid: 'Adresse e-mail invalide.',
  copy: 'Copier le lien',
  copied: 'Lien copié.',
  copyFailed: 'Copie impossible : le lien est affiché ci-dessus.',
  email: 'Envoyer par e-mail',
  withdraw: 'Retirer le lien',
  minted: (amount, until) => `Lien · ${amount}${until ? ` · valable jusqu’au ${until}` : ''}`,
  sent: (to) => `E-mail envoyé à ${to}.`,
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const untilText = (iso) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
};

export default function SalePaymentLink({ link, onMint, onSendEmail, onWithdraw, busy = false, error = null, sentTo = null, disabled = false }) {
  const [email, setEmail] = useState('');
  const [copyState, setCopyState] = useState(null);
  if (!link || link.reason === 'PROVIDER_NOT_READY') return null;
  const { open } = link;
  if (!open && link.reason === 'NOTHING_DUE') return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(open.url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  if (open) {
    return (
      <Box sx={{ display: 'grid', gap: 1, p: 1.5, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{TEXTS.minted(formatCurrency(open.amountCents / 100), untilText(open.expiresAt))}</Typography>
        <Typography variant="caption" sx={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{open.url}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button variant="outlined" size="small" onClick={copy} disabled={busy} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.copy}</Button>
          <Button variant="outlined" size="small" onClick={() => onSendEmail(open)} disabled={disabled || busy || !link.email} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.email}</Button>
          <Button color="error" size="small" onClick={() => onWithdraw(open)} disabled={disabled || busy} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.withdraw}</Button>
        </Box>
        <Box aria-live="polite">
          {copyState === 'copied' && <Typography variant="caption" color="text.secondary">{TEXTS.copied}</Typography>}
          {copyState === 'failed' && <Typography variant="caption" color="error">{TEXTS.copyFailed}</Typography>}
          {sentTo && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{TEXTS.sent(sentTo)}</Typography>}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    );
  }

  const needsEmail = link.reason === 'NO_EMAIL';
  const typed = email.trim();
  const typedInvalid = typed !== '' && !EMAIL.test(typed);
  const canMint = !disabled && !busy && (!needsEmail || EMAIL.test(typed));
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box>
        <Button variant="outlined" onClick={() => onMint(needsEmail ? typed : null)} disabled={!canMint} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.action}</Button>
      </Box>
      {needsEmail && (
        <>
          <Typography variant="caption" color="text.secondary">{TEXTS.needsEmail}</Typography>
          <TextField
            size="small"
            type="email"
            label={TEXTS.emailLabel}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={typedInvalid}
            helperText={typedInvalid ? TEXTS.emailInvalid : ' '}
            disabled={disabled}
            slotProps={{ htmlInput: { style: { fontSize: 16 }, autoComplete: 'off' } }}
          />
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
