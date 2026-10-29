import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Stack, Divider, Button,
  Checkbox, FormControlLabel, TextField, MenuItem, RadioGroup, Radio, FormControl, FormLabel,
  IconButton, Alert, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import DateField from '../DateField';
import QuantityField from '../QuantityField';
import ErrorAlert from '../ErrorAlert';
import { formatCurrency } from '../../utils/formatters';
import { localIsoToday } from '../../utils/isoDay';
import { evaluateArithmetic } from '../../utils/arithmetic';

/**
 * « Nouveau remboursement » — specs/reservation-refunds.md §6.
 *
 * An avoir: the operator ticks the billed prestations being given back (the server ships them, caps
 * included, in `refundableLines`), optionally adds a free line, and closes with a date + a means.
 * Feature-local by design — it reads a reservation's billed register and writes a reversed movement.
 *
 * The client never decides money: the caps shown here are UX hints, the server re-validates every
 * amount and returns 409 `REFUND_EXCEEDS_LINE` / `REFUND_EXCEEDS_STAY` when they are exceeded.
 *
 * Props:
 *  - `open`, `onClose()`
 *  - `refundableLines` — `[{ key, label, bucket, quantity, unitPrice, billedTtc, refundedTtc, refundableTtc }]`
 *  - `collectedTtc` — what has actually been collected so far, for the over-refund caption.
 *  - `overpaymentTtc` — the server's trop-perçu (rule 34); when > 0 the dialog opens with a free line
 *    « Trop-perçu » set to it, which the operator may change.
 *  - `overpaymentLines` — the same amount split by poste by the server (rule 35,
 *    `[{ bucket, label, amountTtc }]`): one « Trop-perçu » line per poste, so a tax paid too much is
 *    refunded on the tax. Wins over `overpaymentTtc` when present.
 *  - `defaultMethod` — the means the dialog opens on (`transfer` by default; `internal` for a trop-perçu
 *    taken « caisse interne »), which the operator can change.
 *  - `openOverpaymentTtc`, `onUseOverpayment()` — a trop-perçu still open on the stay (the ledger's row, rule 44),
 *    when the dialog was NOT opened on it: a warning with an action that reopens the dialog on the trop-perçu.
 *    A refund of a sold line stays independent of it.
 *  - `onSubmit(payload)` — throws an Error carrying the server message when the API refuses.
 *
 * Amounts are typed as text (« 12,5 » accepted, rule 37): a typed amount that is a whole number of
 * units moves the stepper to that count, any other amount leaves the line in « Montant libre » —
 * never a fractional quantity. The ceiling shows under each amount, and a refused total says why
 * right above the save button.
 */

const METHODS = [
  { value: 'transfer', label: 'Virement' },
  { value: 'cash', label: 'Espèces' },
  { value: 'internal', label: 'Caisse interne', caption: 'hors comptabilité' },
];

const FREE_LINE_BUCKETS = [
  { value: 'options', label: 'Prestation complémentaire' },
  { value: 'accommodation', label: 'Hébergement' },
  { value: 'resources', label: 'Activité' },
  { value: 'touristTax', label: 'Taxe de séjour' },
];

const todayIso = () => localIsoToday();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// NaN when the text is not an amount, so an unreadable entry blocks the save instead of counting 0.
const parseAmount = (text) => {
  if (String(text ?? '').trim() === '') return 0;
  const v = evaluateArithmetic(text);
  return v == null ? NaN : round2(v);
};
const amountText = (n) => round2(n).toFixed(2).replace('.', ',');
// A whole number of units, or null (« Montant libre »).
const wholeUnits = (amount, unitPrice) => {
  if (!(unitPrice > 0) || !Number.isFinite(amount)) return null;
  const q = Math.round(amount / unitPrice);
  return Math.abs(q * unitPrice - amount) < 0.005 ? q : null;
};
const DECIMAL_INPUT = { htmlInput: { inputMode: 'decimal' } };

export default function RefundDialog({
  open, onClose, refundableLines = [], collectedTtc = 0, overpaymentTtc = 0, overpaymentLines = null, defaultMethod = 'transfer', openOverpaymentTtc = 0, onUseOverpayment, onSubmit,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [selected, setSelected] = useState({}); // key → { amount, quantity }
  const [freeLines, setFreeLines] = useState([]);
  const [refundDate, setRefundDate] = useState(todayIso());
  const [method, setMethod] = useState('transfer');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected({});
    const split = Array.isArray(overpaymentLines) ? overpaymentLines.filter((l) => Number(l.amountTtc) > 0) : [];
    if (split.length > 0) {
      setFreeLines(split.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amount: amountText(l.amountTtc) })));
    } else {
      setFreeLines(overpaymentTtc > 0 ? [{ label: 'Trop-perçu', bucket: 'accommodation', amount: amountText(overpaymentTtc) }] : []);
    }
    setRefundDate(todayIso());
    setMethod(defaultMethod);
    setReason('');
    setError('');
    setBusy(false);
  }, [open, overpaymentTtc, overpaymentLines, defaultMethod]);

  const toggleLine = (line, checked) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (!checked) delete next[line.key];
      // Ticking a line pre-fills the whole refundable part — the common case is « give it all back ».
      else next[line.key] = { text: amountText(line.refundableTtc), amount: line.refundableTtc, quantity: wholeUnits(line.refundableTtc, line.unitPrice) };
      return next;
    });
  };

  const setLineAmount = (line, text) => {
    const amount = parseAmount(text);
    setSelected((prev) => ({
      ...prev,
      [line.key]: { text, amount, quantity: wholeUnits(amount, line.unitPrice) },
    }));
  };

  const setLineQuantity = (line, rawQuantity) => {
    const quantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
    const amount = round2(quantity * (line.unitPrice || 0));
    setSelected((prev) => ({
      ...prev,
      [line.key]: { text: amountText(amount), quantity, amount },
    }));
  };

  const freeAmounts = freeLines.map((l) => parseAmount(l.amount));
  const total = round2(
    Object.values(selected).reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0)
    + freeAmounts.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0),
  );

  const overCollected = total > round2(collectedTtc);
  const overCapLine = refundableLines.find((line) => {
    const picked = selected[line.key];
    return picked && picked.amount > line.refundableTtc;
  });
  const unreadable = Object.values(selected).some((l) => !Number.isFinite(l.amount))
    || freeAmounts.some((v) => !Number.isFinite(v));
  // A free line with an amount but no label would be dropped by the server's own rule: refused here, never
  // counted in a total that is not the one recorded (specs/reservation-refunds.md rule 41).
  const unlabeledFreeLine = (l, i) => Number.isFinite(freeAmounts[i]) && freeAmounts[i] > 0 && !String(l.label || '').trim();
  const missingLabel = freeLines.some(unlabeledFreeLine);
  let refusal = null;
  if (unreadable) refusal = { tone: 'error', text: 'Montant illisible.' };
  else if (missingLabel) refusal = { tone: 'error', text: 'Libellé manquant.' };
  else if (overCapLine) {
    const excess = round2(selected[overCapLine.key].amount - overCapLine.refundableTtc);
    refusal = { tone: 'error', text: `${overCapLine.label} : dépasse le remboursable de ${formatCurrency(excess)}.` };
  } else if (overCollected && total > 0) {
    refusal = { tone: 'warning', text: `Dépasse l’encaissé de ${formatCurrency(round2(total - collectedTtc))}.` };
  }
  const blocked = unreadable || missingLabel || Boolean(overCapLine);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await onSubmit({
        refundDate,
        method,
        reason: reason.trim(),
        // Opened on a trop-perçu: the server caps the refund at what is still over-collected (rule 42).
        ...(overpaymentTtc > 0 ? { fromOverpayment: true, overpaymentTtc } : {}),
        lines: [
          ...Object.entries(selected).map(([key, value]) => ({
            key,
            amountTtc: value.amount,
            quantity: value.quantity || undefined,
          })),
          ...freeLines
            .map((l, i) => ({ ...l, amountTtc: freeAmounts[i] }))
            .filter((l) => String(l.label || '').trim() && l.amountTtc > 0)
            .map((l) => ({ label: l.label.trim(), bucket: l.bucket, amountTtc: l.amountTtc })),
        ],
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Le remboursement n’a pas pu être enregistré.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>Nouveau remboursement</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <ErrorAlert message={error} />}
          {!(overpaymentTtc > 0) && openOverpaymentTtc > 0 && onUseOverpayment && (
            <Alert
              severity="warning"
              action={<Button color="inherit" size="small" onClick={onUseOverpayment} aria-label="Rembourser le trop-perçu" sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>Rembourser</Button>}
            >
              Un trop-perçu de {formatCurrency(openOverpaymentTtc)} est ouvert.
            </Alert>
          )}

          <Box>
            <Typography variant="sectionHeader" sx={{ fontSize: '0.9rem', mb: 1 }}>Prestations facturées</Typography>
            {refundableLines.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Plus rien n’est remboursable sur cette réservation.
              </Typography>
            )}
            <Stack spacing={1}>
              {refundableLines.map((line) => {
                const picked = selected[line.key];
                return (
                  <Box
                    key={line.key}
                    sx={{
                      display: 'flex', gap: 1, alignItems: { xs: 'stretch', sm: 'center' },
                      justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' },
                    }}
                  >
                    <FormControlLabel
                      sx={{ m: 0, flex: 1 }}
                      control={<Checkbox checked={Boolean(picked)} onChange={(e) => toggleLine(line, e.target.checked)} />}
                      label={(
                        <Box>
                          <Typography variant="body2">{line.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Facturé {formatCurrency(line.billedTtc)}
                            {/* La taxe de séjour se rembourse À LA NUIT : le libellé annonce l'unité
                                que le sélecteur manipule (specs/reservation-refunds.md §3.5). */}
                            {line.unitLabel && line.quantity > 0 && line.unitPrice > 0
                              && ` · ${line.quantity} ${line.unitLabel}${line.quantity > 1 ? 's' : ''} à ${formatCurrency(line.unitPrice)}`}
                            {line.refundedTtc > 0 && ` · déjà remboursé ${formatCurrency(line.refundedTtc)}`}
                          </Typography>
                        </Box>
                      )}
                    />
                    {picked && (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        {line.unitPrice > 0 && (picked.quantity != null ? (
                          <QuantityField
                            value={picked.quantity}
                            min={0}
                            onCommit={(v) => setLineQuantity(line, v)}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                            Montant libre
                          </Typography>
                        ))}
                        <TextField
                          size="small"
                          label="Montant"
                          value={picked.text}
                          onChange={(e) => setLineAmount(line, e.target.value)}
                          error={!Number.isFinite(picked.amount) || picked.amount > line.refundableTtc}
                          helperText={`Max ${formatCurrency(line.refundableTtc)}`}
                          slotProps={DECIMAL_INPUT}
                          sx={{ width: { xs: '100%', sm: 130 } }}
                        />
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box>
            {freeLines.map((line, index) => (
              <Box
                key={index}
                sx={{ display: 'flex', gap: 1, mb: 1, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' } }}
              >
                <TextField
                  size="small"
                  label="Libellé"
                  value={line.label}
                  error={unlabeledFreeLine(line, index)}
                  onChange={(e) => setFreeLines((prev) => prev.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)))}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  select
                  label="Catégorie"
                  value={line.bucket}
                  onChange={(e) => setFreeLines((prev) => prev.map((l, i) => (i === index ? { ...l, bucket: e.target.value } : l)))}
                  sx={{ width: { xs: '100%', sm: 200 } }}
                >
                  {FREE_LINE_BUCKETS.map((b) => <MenuItem key={b.value} value={b.value}>{b.label}</MenuItem>)}
                </TextField>
                <TextField
                  size="small"
                  label="Montant"
                  value={line.amount}
                  onChange={(e) => setFreeLines((prev) => prev.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))}
                  error={!Number.isFinite(freeAmounts[index])}
                  slotProps={DECIMAL_INPUT}
                  sx={{ width: { xs: '100%', sm: 130 } }}
                />
                <IconButton
                  aria-label="Retirer la ligne"
                  onClick={() => setFreeLines((prev) => prev.filter((_, i) => i !== index))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button
              size="small"
              onClick={() => setFreeLines((prev) => [...prev, { label: '', bucket: 'options', amount: '' }])}
              sx={{ textTransform: 'none' }}
            >
              + Ajouter une ligne libre
            </Button>
          </Box>

          <Divider />

          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <DateField
              label="Date du remboursement"
              value={refundDate}
              onChange={(e) => setRefundDate(e.target.value)}
              slotProps={{ htmlInput: { max: todayIso() }, inputLabel: { shrink: true } }}
              size="small"
              sx={{ width: { xs: '100%', sm: 220 } }}
            />
            <FormControl>
              <FormLabel sx={{ fontSize: '0.8rem' }}>Moyen</FormLabel>
              <RadioGroup
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                sx={{ flexDirection: { xs: 'column', sm: 'row' } }}
              >
                {METHODS.map((m) => (
                  <FormControlLabel
                    key={m.value}
                    value={m.value}
                    control={<Radio size="small" />}
                    label={(
                      <Typography variant="body2">
                        {m.label}
                        {m.caption && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                            ({m.caption})
                          </Typography>
                        )}
                      </Typography>
                    )}
                  />
                ))}
              </RadioGroup>
            </FormControl>
          </Box>

          <TextField
            size="small"
            label="Motif (optionnel)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Départ anticipé — petits-déjeuners non pris"
            fullWidth
          />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total remboursé</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {total > 0 ? `− ${formatCurrency(total)}` : formatCurrency(0)}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, flexWrap: { sm: 'wrap' }, justifyContent: 'flex-end', gap: 1, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        {refusal && (
          <Typography
            role={refusal.tone === 'error' ? 'alert' : 'status'}
            variant="caption"
            sx={{ width: '100%', textAlign: { xs: 'left', sm: 'right' }, fontWeight: 600, color: `${refusal.tone}.main` }}
          >
            {refusal.text}
          </Typography>
        )}
        <Button onClick={onClose} disabled={busy} fullWidth={isMobile}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || total <= 0 || blocked}
          fullWidth={isMobile}
        >
          Enregistrer le remboursement
        </Button>
      </DialogActions>
    </Dialog>
  );
}
