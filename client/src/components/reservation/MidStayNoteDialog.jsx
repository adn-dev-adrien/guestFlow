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
import { typedCountKind, typedCountValue, MAX_TYPED_NIGHTS } from '../../utils/optionTypedCount';
import { optionLineKey, displayedFloor } from '../../utils/arrivalLineKey';
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
const NO_PREVIEW = { items: [], total: 0, arrivalNotMarked: false };

export default function MidStayNoteDialog({ open, onClose, pendingLines = [], onSettle, onSellOnly }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const {
    form, propertyOptions, propertyOptionGroups, setOptionEnabled, setOptionQuantity,
    quantityPersons, quantityNights, setOptionTypedCount, pricingQuote, editingReservationId,
    captureOptionsState, restoreOptionsState, arrivalLines, maxGuestsAllowed,
  } = useReservationForm();

  const [checkedKeys, setCheckedKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(NO_PREVIEW);
  // The sold options when the dialog opened: « Annuler » must leave the reservation exactly as it was,
  // catalogue additions and removals included (§3.5 edge cases; non-card-option-served-persons.md rule 31).
  // State, not a ref: what the note adds is measured against it (rule 33), so it has to render.
  const [openingOptions, setOpeningOptions] = useState(null);
  // The remainder as it stood on open — the reference the server measures « what did this note add? » from.
  const openingRef = useRef([]);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!open) {
      setOpeningOptions(null);
      return;
    }
    setOpeningOptions(captureOptionsState());
    openingRef.current = (pendingLines || []).filter((l) => l.key)
      .map((l) => ({ key: l.key, label: l.label, amount: l.amount }));
    setCheckedKeys([]);
    setBusy(false);
    setPreview(NO_PREVIEW);
    // Snapshot once per opening; `form.selectedOptions` intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const liveLines = pricingQuote?.midStayExtrasLines;
  useEffect(() => {
    if (!open) return;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    api.previewMidStayNote({ reservationId: editingReservationId, opening: openingRef.current, current: liveLines || [], checkedKeys })
      .then((r) => {
        if (previewSeq.current !== seq) return;
        setPreview({ items: (r && r.items) || [], total: Number(r && r.total) || 0, arrivalNotMarked: Boolean(r && r.arrivalNotMarked) });
      })
      .catch(() => { if (previewSeq.current === seq) setPreview(NO_PREVIEW); });
  }, [open, checkedKeys, liveLines, editingReservationId]);

  const noteTotal = preview.total;
  const instruction = () => ({ checkedKeys, opening: openingRef.current });
  // What a line sold counts: its typed people or nights, else its units (a typed line's `quantity` stays
  // 1, specs/non-card-option-served-persons.md rule 13). Same reading as the field below.
  const kindOf = (optionId) => typedCountKind((propertyOptions || []).find((p) => Number(p.id) === Number(optionId)));
  const soldCount = (line) => {
    const kind = kindOf(line.optionId);
    if (!kind) return Number(line.quantity) || 0;
    return typedCountValue(line, kind, kind === 'nights' ? quantityNights : quantityPersons);
  };
  const hasAdditions = useMemo(() => {
    if (!openingOptions) return false;
    const before = new Map((openingOptions.selectedOptions || []).map((o) => [Number(o.optionId), soldCount(o)]));
    return (form.selectedOptions || []).some((o) => soldCount(o) > (before.get(Number(o.optionId)) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingOptions, form.selectedOptions, propertyOptions, quantityPersons, quantityNights]);

  const close = () => {
    if (openingOptions) restoreOptionsState(openingOptions);
    onClose();
  };

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch {
      // Refused: the fiche already shows why; the dialog stays open on what was ticked.
    } finally {
      setBusy(false);
    }
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
                      // Same field as the fiche's OptionRow (specs/non-card-option-served-persons.md
                      // rule 13). 0 = not sold; a number on an unsold line sells that number (rule 35).
                      const typedKind = typedCountKind(opt);
                      const typedCurrent = typedKind === 'nights' ? quantityNights : quantityPersons;
                      const displayed = !selected
                        ? 0
                        : (typedKind ? typedCountValue(selected, typedKind, typedCurrent) : Number(selected.quantity));
                      // Same bounds as the fiche's OptionRow (rule 32): what was sold at arrival is a
                      // floor; without one, 0 takes the line off.
                      const arrivalLine = (arrivalLines || {})[optionLineKey(opt.id)];
                      const typedFloor = arrivalLine?.minTypedCount != null ? displayedFloor(arrivalLine.minTypedCount) : 1;
                      const floor = !arrivalLine ? 0 : (typedKind ? typedFloor : displayedFloor(arrivalLine.minQuantity));
                      let ceiling;
                      if (typedKind === 'persons') ceiling = Math.max(Number(maxGuestsAllowed) || 0, Number(quantityPersons) || 1, displayed);
                      else if (typedKind === 'nights') ceiling = Math.max(MAX_TYPED_NIGHTS, displayed);
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
                              disabled={Boolean(arrivalLine)}
                              sx={{ textTransform: 'none', minWidth: 110 }}
                            >
                              {selected ? 'Ajouté ✓' : 'Ajouter'}
                            </Button>
                          ) : (
                            <QuantityField
                              value={displayed}
                              min={floor}
                              max={ceiling}
                              onCommit={(v) => {
                                const next = Number(v) || 0;
                                if (next <= 0) {
                                  setOptionEnabled(Number(opt.id), false);
                                } else if (typedKind) {
                                  // The switch's way in first: it applies the property's offered default.
                                  if (!selected) setOptionEnabled(Number(opt.id), true);
                                  setOptionTypedCount(Number(opt.id), typedKind, next);
                                } else {
                                  setOptionQuantity(Number(opt.id), next);
                                }
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
          {preview.arrivalNotMarked && (
            <Typography variant="caption" color="text.secondary">Arrivée non marquée : la vente rejoint le solde.</Typography>
          )}
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
