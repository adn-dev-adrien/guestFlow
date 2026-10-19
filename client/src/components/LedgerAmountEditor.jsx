/**
 * LedgerAmountEditor — the inline amount editor of a ledger row (specs/reservation-payment-ledger.md
 * rules 15, 21; §6). The field only proposes: every typed value is sent to `onCheck`, and the server's
 * answer is printed as it comes — a refusal in red under the field (the typed value stays, focus stays,
 * « Valider » is disabled with the reason beside it), or the consequence of the amount. « Valider »
 * hands the server's answer back to `onApply` verbatim; nothing is computed here.
 *
 * A plain text field on purpose (not ArithmeticTextField): « −5 » or « 100+20 » must reach the server
 * as typed, so the refusal of a negative amount can be shown rather than silently clamped.
 *
 * Props:
 *   label:        string — the field label (« Montant du solde (€) »)
 *   initialValue: string — the amount as first shown (« 614,40 »)
 *   help:         string — the help line before anything is typed (bounds, consequence)
 *   onCheck:      async (raw) → { ok, reason?, effects?: string[], reached?, refund?: { amount, label } }
 *   onApply:      (answer) → void — « Valider » with an `ok` answer
 *   onCancel:     () → void — « Annuler », or Escape: the row comes back exactly as it was
 *   onRefund:     (refund) → void — the refusal of a perceived row offers the refund (rule 19)
 *   extraActions: ReactNode — secondary buttons after « Annuler » (« Calcul automatique »)
 *   debounceMs:   number — delay before a typed value is checked (default 250)
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';

export default function LedgerAmountEditor({
  label, initialValue = '', help = '', onCheck, onApply, onCancel, onRefund, extraActions = null, debounceMs = 250,
}) {
  const [draft, setDraft] = useState(initialValue);
  const [answer, setAnswer] = useState(null);
  const [checking, setChecking] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const seq = useRef(0);
  const messageId = useId();
  const inputRef = useRef(null);
  const touched = draft !== initialValue;

  useEffect(() => {
    if (!touched) { setAnswer(null); return undefined; }
    const mine = ++seq.current;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await onCheck(draft);
        if (mine === seq.current) setAnswer(res || null);
      } catch (err) {
        if (mine === seq.current) setAnswer({ ok: false, reason: err?.message || 'Vérification impossible.' });
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const refused = Boolean(answer && answer.ok === false);
  const canApply = Boolean(answer && answer.ok) && !checking;
  const validate = () => {
    if (canApply) { onApply(answer); return; }
    setShakeKey((k) => k + 1);
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <Box
      sx={{
        mt: 1.25, p: 1.25, borderRadius: 1.5, bgcolor: 'background.default',
        display: 'grid', gap: 1,
        animation: 'ledgerOpen 200ms ease-out',
        '@keyframes ledgerOpen': { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
        '@media (prefers-reduced-motion: reduce)': {
          animation: 'ledgerFade 150ms ease-out',
          '@keyframes ledgerFade': { from: { opacity: 0 }, to: { opacity: 1 } },
        },
      }}
    >
      <TextField
        key={shakeKey}
        label={label}
        value={draft}
        inputRef={inputRef}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); validate(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        error={refused}
        size="small"
        autoComplete="off"
        slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-describedby': messageId } }}
        sx={{
          maxWidth: { sm: 260 },
          '& input': { fontSize: 16, fontVariantNumeric: 'tabular-nums' },
          ...(shakeKey > 0 ? {
            animation: 'ledgerShake 300ms',
            '@keyframes ledgerShake': { '25%': { transform: 'translateX(-4px)' }, '75%': { transform: 'translateX(4px)' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          } : {}),
        }}
      />
      <Box id={messageId} aria-live="polite" sx={{ fontSize: '0.8125rem', minHeight: 0 }}>
        {refused && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Typography variant="body2" data-ledger-refusal="" sx={{ color: 'error.main', fontWeight: 600 }}>{answer.reason}</Typography>
            {answer.refund && onRefund && (
              <Button variant="outlined" size="small" onClick={() => onRefund(answer.refund)} sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}>
                {answer.refund.label}
              </Button>
            )}
          </Box>
        )}
        {answer && answer.ok && (answer.effects || []).map((line) => (
          <Typography key={line} variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{line}</Typography>
        ))}
        {!answer && help && <Typography variant="body2" color="text.secondary">{help}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
        <Button
          variant="contained"
          disabled={!canApply}
          onClick={validate}
          sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}
        >
          Valider
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ minHeight: 44, textTransform: 'none' }}>Annuler</Button>
        {extraActions}
      </Box>
    </Box>
  );
}
