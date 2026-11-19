import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import TenderLines, { tendersForDue } from '../TenderLines';
import ErrorAlert from '../ErrorAlert';
import FocusKeeper from '../FocusKeeper';
import useLatestPreview from '../../hooks/useLatestPreview';
import { TENDER_TEXTS } from '../../constants/tenderMethods';

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
 * The preview goes through `useLatestPreview` like every money preview (loop t26 UI26-2, plugins-phase-1-sdk rule 54): while a
 * recompute is on its way the total is dimmed and no settle button is enabled; a failed one shows « — », its reason and
 * « Réessayer »; the « Plusieurs moyens » lines come back as typed (`initialDraft`) and take the focus only when the operator opens them.
 *
 * Props:
 *  - `open`, `onClose()`
 *  - `pendingLines` — the current remainder lines (`[{ label, amount, key }]`), before any addition.
 *  - `onSettle({ checkedKeys, opening }, cash)` — save (if the form changed) then settle the note.
 *  - `onSellOnly()` — save only: everything stays due at check-out.
 *  Both reject on a refusal; a refused SAVE rejects with `saveRefused()` (nothing was stored).
 */
// Pricing-components rule 101 (reading 2026-11-17, loop t14 UI14-1) — the fiche refused the save itself: unlike a refused
// settlement, nothing was stored, so the dialog keeps its opening and « Annuler » still puts the form back.
const SAVE_REFUSED = 'SAVE_REFUSED';
export const saveRefused = () => Object.assign(new Error('Enregistrement refusé.'), { code: SAVE_REFUSED });

export default function MidStayNoteDialog({ open, onClose, pendingLines = [], onSettle, onSellOnly }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const {
    form, propertyOptions, propertyOptionGroups, setOptionEnabled, setOptionQuantity,
    quantityPersons, quantityNights, setOptionTypedCount, pricingQuote, pricingQuotePending, editingReservationId,
    captureOptionsState, restoreOptionsState, arrivalLines, maxGuestsAllowed,
  } = useReservationForm();

  const [checkedKeys, setCheckedKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  // specs/mixed-method-payments.md rules 1, 21-22 — « Plusieurs moyens », closed on every opening.
  const [splitOpen, setSplitOpen] = useState(false);
  const [tenders, setTenders] = useState(null);
  // The sold options when the dialog opened: « Annuler » must leave the reservation exactly as it was,
  // catalogue additions and removals included (§3.5 edge cases; non-card-option-served-persons.md rule 31).
  // State, not a ref: what the note adds is measured against it (rule 33), so it has to render.
  const [openingOptions, setOpeningOptions] = useState(null);
  // The remainder as it stood on open — the reference the server measures « what did this note add? » from. State, not a ref: it is
  // part of the preview's draft, which is read at render; null until this opening has taken it (nothing is asked before).
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    if (!open) {
      setOpeningOptions(null);
      setOpening(null);
      return;
    }
    setOpeningOptions(captureOptionsState());
    setOpening((pendingLines || []).filter((l) => l.key)
      .map((l) => ({ key: l.key, label: l.label, amount: l.amount })));
    setCheckedKeys([]);
    setBusy(false);
    setSplitOpen(false);
    setTenders(null);
    // Snapshot once per opening; `form.selectedOptions` intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const liveLines = pricingQuote?.midStayExtrasLines;
  const draft = useMemo(() => ({
    reservationId: editingReservationId, opening: opening || [], current: liveLines || [], checkedKeys,
  }), [editingReservationId, opening, liveLines, checkedKeys]);
  const fetcher = useCallback(async (body, options) => api.previewMidStayNote(body, options), []);
  const preview = useLatestPreview({
    fetcher, draft, enabled: open && opening !== null, scope: editingReservationId, resetKey: open ? 'open' : 'closed',
  });
  const shown = preview.data;
  // null while unknown (before the first answer, after a failure): « — », never « 0,00 € ».
  const noteTotal = shown ? Number(shown.total) || 0 : null;
  const dueCents = noteTotal == null ? null : Math.round(noteTotal * 100);
  // Loop t25 — the lines' report counts only for the total on screen (`tendersForDue`).
  const tendersNow = dueCents == null ? null : tendersForDue(tenders, dueCents);
  // The settle buttons act on the total of the draft on screen only (owner decision: no action on an unknown value): a prestation
  // added is first priced by the fiche's live quote (`pricingQuotePending`), then by the note's preview.
  const recomputing = preview.pending || Boolean(pricingQuotePending);
  const settleOff = busy || recomputing || !preview.fresh || !(noteTotal > 0);
  const instruction = () => ({ checkedKeys, opening: opening || [] });
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
    } catch (err) {
      // Refused: the fiche already shows why; the dialog stays open on what was ticked. A refused settlement only comes
      // after the fiche was saved, so the stored state is the new opening « Annuler » returns to (mid-stay-notes rule 24,
      // R31-C-L1); a refused save stored nothing and keeps the opening.
      if (err?.code !== SAVE_REFUSED) setOpeningOptions(captureOptionsState());
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
      {/* The region keeps the focus in the dialog when a recompute removes or disables the control holding it (the « Plusieurs moyens »
          lines on a failure, a settle button while asked) — plugins-phase-1-sdk rule 54, loop t26 UI26-2. */}
      <FocusKeeper sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
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
            <Box data-pending-block={shown ? undefined : ''} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: recomputing ? 0.6 : 1, transition: 'opacity 120ms' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total de la note</Typography>
              <Typography data-testid="note-total" variant="subtitle2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{noteTotal == null ? '—' : formatCurrency(noteTotal)}</Typography>
            </Box>
            {/* The lines stay mounted through a recompute (the latest total is kept, dimmed); unmounted on an unknown total, they come back
                as typed (mixed-method-payments rule 59) and take the focus only on the operator's opening (`tenders` null). */}
            {splitOpen && noteTotal > 0 && (
              <TenderLines dueCents={dueCents} onChange={setTenders} initialDraft={tenders ? tenders.draft : null} disabled={busy} autoFocus={!tenders} />
            )}
            {splitOpen && preview.failed && (
              <Typography variant="body2" color="text.secondary" data-testid="tenders-unknown">À encaisser : —</Typography>
            )}
            {shown && shown.arrivalNotMarked && (
              <Typography variant="caption" color="text.secondary">Arrivée non marquée : la vente rejoint le solde.</Typography>
            )}
            {preview.error && <ErrorAlert message={preview.error.message || 'Total indisponible.'} onRetry={preview.retry} />}
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
            variant="text"
            data-split-toggle="note"
            disabled={busy || (!splitOpen && !(noteTotal > 0))}
            onClick={() => { setSplitOpen((v) => !v); setTenders(null); }}
            sx={{ color: 'text.secondary' }}
            fullWidth={isMobile}
          >
            {splitOpen ? TENDER_TEXTS.close : TENDER_TEXTS.open}
          </Button>
          {splitOpen ? (
            <Button
              variant="contained"
              disabled={settleOff || !(tendersNow && tendersNow.canSubmit)}
              onClick={() => { if (!settleOff && tendersNow && tendersNow.canSubmit && tendersNow.live()) run(() => onSettle(instruction(), false, {
                expectedAmountCents: dueCents, tenders: tendersNow.tenders, shortfall: tendersNow.shortfall,
              })); }}
              fullWidth={isMobile}
            >
              {TENDER_TEXTS.collect(noteTotal == null ? '—' : formatCurrency(tendersNow && tendersNow.gapCents > 0 ? tendersNow.receivedCents / 100 : noteTotal))}
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                disabled={settleOff}
                onClick={() => run(() => onSettle(instruction(), true))}
                fullWidth={isMobile}
              >
                Caisse interne
              </Button>
              <Button
                variant="contained"
                disabled={settleOff}
                onClick={() => run(() => onSettle(instruction(), false))}
                fullWidth={isMobile}
              >
                CB / Chèque
              </Button>
            </>
          )}
        </DialogActions>
      </FocusKeeper>
    </Dialog>
  );
}
