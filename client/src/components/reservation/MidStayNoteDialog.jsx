import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Stack, Divider, Button,
  Checkbox, FormControlLabel, Accordion, AccordionSummary, AccordionDetails, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import QuantityField from '../QuantityField';
import { useReservationForm } from './ReservationFormContext';
import api from '../../api';
import { formatCurrency } from '../../utils/formatters';

/**
 * « Nouvelle note » — specs/mid-stay-notes.md §3.2 + §6.
 *
 * A bar tab: the operator ticks what the guest is paying among the prestations still to collect,
 * adds new ones from the catalogue, and closes the note with ONE payment choice (CB / caisse interne
 * / en fin de séjour). Feature-local by design: it drives the reservation form state directly
 * (option toggles + quantities) so a catalogue addition IS a normal sale, saved through the standard
 * pipeline — the note never invents its own pricing.
 *
 * Amounts are the server's (rule 22): the dialog sends the ticked keys, the remainder it opened on and
 * the live quote's remainder (`midStayExtrasLines`) to `POST /reservations/mid-stay-note/preview`, and
 * prints the total it gets back. On validation it sends only `{ checkedKeys, opening }`: the server
 * derives the amounts again against its stored remainder.
 *
 * Props:
 *  - `open`, `onClose()`
 *  - `pendingLines` — the current remainder lines (`[{ label, amount, key }]`), before any addition.
 *  - `onSettle({ checkedKeys, opening }, cash)` — save (if the form changed) then settle the note.
 *  - `onSellOnly()` — save only: everything stays due at check-out.
 */
export default function MidStayNoteDialog({ open, onClose, pendingLines = [], onSettle, onSellOnly }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const {
    form, propertyOptions, propertyOptionGroups, setOptionEnabled, setOptionQuantity,
    toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier, pricingQuote,
  } = useReservationForm();

  const [checkedKeys, setCheckedKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState({ items: [], total: 0 });
  // Snapshot of the sold options when the dialog opened: « Annuler » must leave the reservation
  // exactly as it was, catalogue additions included (§3.5 edge cases).
  const snapshotRef = useRef(null);
  // The remainder as it stood on open — the reference the server measures « what did this note add? » from.
  const openingRef = useRef([]);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    snapshotRef.current = JSON.parse(JSON.stringify(form.selectedOptions || []));
    openingRef.current = (pendingLines || []).filter((l) => l.key)
      .map((l) => ({ key: l.key, label: l.label, amount: l.amount }));
    setCheckedKeys([]);
    setBusy(false);
    setPreview({ items: [], total: 0 });
    // Snapshot once per opening; `form.selectedOptions` intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const liveLines = pricingQuote?.midStayExtrasLines;
  useEffect(() => {
    if (!open) return;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    api.previewMidStayNote({ opening: openingRef.current, current: liveLines || [], checkedKeys })
      .then((r) => { if (previewSeq.current === seq) setPreview({ items: (r && r.items) || [], total: Number(r && r.total) || 0 }); })
      .catch(() => { if (previewSeq.current === seq) setPreview({ items: [], total: 0 }); });
  }, [open, checkedKeys, liveLines]);

  const noteTotal = preview.total;
  const instruction = () => ({ checkedKeys, opening: openingRef.current });
  const hasAdditions = useMemo(() => {
    const before = new Map((snapshotRef.current || []).map((o) => [Number(o.optionId), Number(o.quantity) || 0]));
    return (form.selectedOptions || []).some((o) => (Number(o.quantity) || 0) > (before.get(Number(o.optionId)) || 0));
  }, [form.selectedOptions]);

  const rollback = () => {
    const before = snapshotRef.current;
    if (!before) return;
    const beforeQty = new Map(before.map((o) => [Number(o.optionId), Number(o.quantity) || 0]));
    for (const o of (form.selectedOptions || [])) {
      const id = Number(o.optionId);
      if (!beforeQty.has(id)) setOptionEnabled(id, false);
      else if (beforeQty.get(id) !== (Number(o.quantity) || 0)) setOptionQuantity(id, beforeQty.get(id));
    }
  };

  const close = () => { rollback(); onClose(); };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); onClose(); } finally { setBusy(false); }
  };

  // Same server-computed grouping as the fiche's Options section (specs/option-categories.md):
  // `{ ungrouped, groups: [{ category, options }] }`, with a flat fallback for older payloads.
  // Auto-timed options (early check-in / late check-out) are never a mid-stay sale.
  const catalogue = useMemo(() => {
    // The cancellation insurance is never sold during the stay (specs/cancellation-insurance.md
    // §3.2 rule 17) — same reason as at check-in: there is nothing left to cancel.
    const sellable = (list) => (list || []).filter((o) => !o.autoEnabled && !o.isCancellationInsurance);
    const groups = [
      { category: 'Prestations', options: sellable(propertyOptionGroups?.ungrouped || propertyOptions) },
      ...((propertyOptionGroups?.groups || []).map((g) => ({ category: g.category, options: sellable(g.options) }))),
    ];
    return groups.filter((g) => g.options.length > 0);
  }, [propertyOptionGroups, propertyOptions]);

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>Nouvelle note</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {pendingLines.length > 0 && (
            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.9rem', mb: 1 }}>À percevoir</Typography>
              {pendingLines.map((line) => (
                <FormControlLabel
                  key={line.key}
                  sx={{ display: 'flex', m: 0 }}
                  control={(
                    <Checkbox
                      checked={checkedKeys.includes(line.key)}
                      onChange={(e) => setCheckedKeys((prev) => (
                        e.target.checked ? [...prev, line.key] : prev.filter((k) => k !== line.key)
                      ))}
                    />
                  )}
                  label={(
                    <Typography variant="body2">
                      {line.label} : {formatCurrency(line.amount)}
                    </Typography>
                  )}
                />
              ))}
            </Box>
          )}

          <Box>
            <Typography variant="sectionHeader" sx={{ fontSize: '0.9rem', mb: 1 }}>Ajouter une prestation</Typography>
            {catalogue.length === 0 && (
              <Typography variant="body2" color="text.secondary">Aucune prestation au catalogue.</Typography>
            )}
            {catalogue.map((group) => (
              <Accordion key={group.category} disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 44 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{group.category}</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0, pt: 0 }}>
                  <Stack spacing={1}>
                    {group.options.map((opt) => {
                      const selected = (form.selectedOptions || []).find((o) => Number(o.optionId) === Number(opt.id));
                      // Same displayed-units convention as the fiche's OptionRow (a « par pers./jour »
                      // option shows persons × nights). 0 = not sold; the first « + » sells the
                      // default quantity, exactly like flicking the switch on the fiche.
                      const displayed = selected ? toDisplayedQuantity(selected.quantity, opt.priceType) : 0;
                      return (
                        <Box
                          key={opt.id}
                          sx={{
                            display: 'flex', gap: 1, justifyContent: 'space-between',
                            flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' },
                          }}
                        >
                          <Typography variant="body2">
                            {opt.title}
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                              {formatCurrency(opt.price)}
                            </Typography>
                          </Typography>
                          {/* A planning-card option (petit-déjeuner…) is billed by its scheduled
                              occurrences, never by a raw quantity — the fiche shows no Qté field for
                              it either. Here it is a simple add/remove; the days stay editable on the
                              fiche (specs/option-planning-card.md §3.4). */}
                          {opt.showsPlanningCard ? (
                            <Button
                              size="small"
                              variant={selected ? 'contained' : 'outlined'}
                              color={selected ? 'success' : 'primary'}
                              onClick={() => setOptionEnabled(Number(opt.id), !selected)}
                              sx={{ textTransform: 'none', minWidth: 110 }}
                            >
                              {selected ? 'Ajouté ✓' : 'Ajouter'}
                            </Button>
                          ) : (
                            <QuantityField
                              value={displayed}
                              min={0}
                              onCommit={(v) => {
                                const next = Number(v) || 0;
                                if (next <= 0) setOptionEnabled(Number(opt.id), false);
                                // Not sold yet → enable it and let the form apply its default
                                // quantity; calling both setters would fight over the same line.
                                else if (!selected) setOptionEnabled(Number(opt.id), true);
                                else setOptionQuantity(Number(opt.id), toBaseQuantity(next, opt.priceType));
                              }}
                            />
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>

          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total de la note</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{formatCurrency(noteTotal)}</Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: 1, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        <Button onClick={close} disabled={busy} fullWidth={isMobile}>Annuler</Button>
        {/* « En fin de séjour » = a sale only; pointless when the note adds nothing new. */}
        {hasAdditions && (
          <Button onClick={() => run(onSellOnly)} disabled={busy} fullWidth={isMobile}>
            En fin de séjour
          </Button>
        )}
        <Button
          variant="outlined"
          disabled={busy || noteTotal <= 0}
          onClick={() => run(() => onSettle(instruction(), true))}
          fullWidth={isMobile}
        >
          Caisse interne
        </Button>
        <Button
          variant="contained"
          disabled={busy || noteTotal <= 0}
          onClick={() => run(() => onSettle(instruction(), false))}
          fullWidth={isMobile}
        >
          CB / Chèque
        </Button>
      </DialogActions>
    </Dialog>
  );
}
