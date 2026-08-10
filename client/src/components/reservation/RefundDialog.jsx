import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Stack, Divider, Button,
  Checkbox, FormControlLabel, TextField, MenuItem, RadioGroup, Radio, FormControl, FormLabel,
  IconButton, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import DateField from '../DateField';
import QuantityField from '../QuantityField';
import ErrorAlert from '../ErrorAlert';
import { formatCurrency } from '../../utils/formatters';

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
 *  - `onSubmit(payload)` — throws an Error carrying the server message when the API refuses.
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

const todayIso = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function RefundDialog({ open, onClose, refundableLines = [], collectedTtc = 0, onSubmit }) {
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
    setFreeLines([]);
    setRefundDate(todayIso());
    setMethod('transfer');
    setReason('');
    setError('');
    setBusy(false);
  }, [open]);

  const toggleLine = (line, checked) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (!checked) delete next[line.key];
      // Ticking a line pre-fills the whole refundable part — the common case is « give it all back ».
      else next[line.key] = { amount: line.refundableTtc, quantity: line.unitPrice ? round2(line.refundableTtc / line.unitPrice) : null };
      return next;
    });
  };

  const setLineAmount = (line, rawAmount) => {
    const amount = round2(rawAmount);
    setSelected((prev) => ({
      ...prev,
      [line.key]: { amount, quantity: line.unitPrice ? round2(amount / line.unitPrice) : null },
    }));
  };

  const setLineQuantity = (line, rawQuantity) => {
    const quantity = Math.max(0, Number(rawQuantity) || 0);
    setSelected((prev) => ({
      ...prev,
      [line.key]: { quantity, amount: round2(quantity * (line.unitPrice || 0)) },
    }));
  };

  const total = useMemo(() => round2(
    Object.values(selected).reduce((s, l) => s + (Number(l.amount) || 0), 0)
    + freeLines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
  ), [selected, freeLines]);

  const overCollected = total > round2(collectedTtc);
  const lineOverCap = refundableLines.some((line) => {
    const picked = selected[line.key];
    return picked && Number(picked.amount) > line.refundableTtc;
  });

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await onSubmit({
        refundDate,
        method,
        reason: reason.trim(),
        lines: [
          ...Object.entries(selected).map(([key, value]) => ({
            key,
            amountTtc: Number(value.amount) || 0,
            quantity: value.quantity || undefined,
          })),
          ...freeLines
            .filter((l) => String(l.label || '').trim() && Number(l.amount) > 0)
            .map((l) => ({ label: l.label.trim(), bucket: l.bucket, amountTtc: Number(l.amount) })),
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
                            {line.refundedTtc > 0 && ` · déjà remboursé ${formatCurrency(line.refundedTtc)}`}
                          </Typography>
                        </Box>
                      )}
                    />
                    {picked && (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        {line.unitPrice > 0 && (
                          <QuantityField
                            value={picked.quantity || 0}
                            min={0}
                            onCommit={(v) => setLineQuantity(line, v)}
                          />
                        )}
                        <TextField
                          size="small"
                          type="number"
                          label="Montant"
                          value={picked.amount}
                          onChange={(e) => setLineAmount(line, e.target.value)}
                          error={Number(picked.amount) > line.refundableTtc}
                          helperText={Number(picked.amount) > line.refundableTtc ? `Max ${formatCurrency(line.refundableTtc)}` : ''}
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
                  type="number"
                  label="Montant"
                  value={line.amount}
                  onChange={(e) => setFreeLines((prev) => prev.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))}
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

          {overCollected && total > 0 && (
            <Typography variant="caption" color="warning.main">
              Ce remboursement dépasse le montant encaissé à ce jour.
            </Typography>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total remboursé</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {total > 0 ? `− ${formatCurrency(total)}` : formatCurrency(0)}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: 1, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        <Button onClick={onClose} disabled={busy} fullWidth={isMobile}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || total <= 0 || lineOverCap}
          fullWidth={isMobile}
        >
          Enregistrer le remboursement
        </Button>
      </DialogActions>
    </Dialog>
  );
}
