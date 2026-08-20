import React from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Button, TextField, Chip,
  FormControlLabel, Switch, Tooltip
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import QuantityField from '../QuantityField';
import OccurrenceGrid from '../OccurrenceGrid';
import { useReservationForm } from './ReservationFormContext';
import { reconcileGrid as reconcileCardGrid } from '../../utils/cardOccurrences';
import { isWelcomePackLine } from '../../utils/welcomePackApply';
import { formatCurrency } from '../../utils/formatters';
import { COMPLEMENT_TOOLTIP, PRICE_TYPE_LABELS } from './extrasLabels';

/**
 * Occurrence checklist for an option-driven planning card (specs/option-planning-card.md §3.2).
 * 'once' → a single editable date + heure. 'daily' → one checkbox row per (stay day × time slot),
 * all pre-checked, with an editable heure. The selection drives the billed quantity (§3.4), shown
 * as a caption. Reads/writes the working occurrence grid via `setOptionCardOccurrences`; the grid
 * itself is rendered by the shared `OccurrenceGrid` (the arrival SAS sells the same moments).
 */
function OptionCardOccurrences({ opt }) {
  const { form, quantityPersons, setOptionCardOccurrences, isReservationLocked } = useReservationForm();
  const selected = form.selectedOptions.find((so) => Number(so.optionId) === Number(opt.id));
  const grid = Array.isArray(selected?.cardOccurrences) ? selected.cardOccurrences : [];
  const perPerson = String(opt.priceType || '').includes('per_person');
  // Covers actually served on each moment (specs/card-option-served-persons.md §3.2 rule 8): the
  // whole party unless the operator lowered it in the « Personnes servies » field above.
  const personFactor = perPerson
    ? Math.max(1, Number(selected?.cardPersons) || Number(quantityPersons) || 1)
    : 1;
  const checkedCount = grid.filter((o) => o.checked).length;
  const billedUnits = checkedCount * personFactor;

  if (grid.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Renseignez les dates du séjour pour configurer les occurrences.
      </Typography>
    );
  }

  // The distinct time slots (shared across all days) — edited once here, applied to every day.
  const slotTimes = [...new Set(grid.map((o) => o.slot ?? 0))]
    .sort((a, b) => a - b)
    .map((slot) => ({ slot, time: (grid.find((o) => (o.slot ?? 0) === slot) || {}).time || '' }));
  const setSlotTime = (slot, time) => {
    const retimed = grid.map((o) => ((o.slot ?? 0) === slot ? { ...o, time } : o));
    // Re-filter presence: moving a slot's time across the check-in/out bound on the arrival/departure
    // day adds or removes that day's occurrence (specs/option-planning-card.md § presence).
    setOptionCardOccurrences(opt.id, reconcileCardGrid(opt, form.startDate, form.endDate, retimed, form.checkInTime, form.checkOutTime));
  };
  const toggleOcc = (date, slot, checked) => setOptionCardOccurrences(opt.id, grid.map((o) => (o.date === date && (o.slot ?? 0) === slot ? { ...o, checked } : o)));

  return (
    <OccurrenceGrid
      grid={grid}
      onToggle={toggleOcc}
      slotTimes={slotTimes}
      onSlotTimeChange={setSlotTime}
      disabled={isReservationLocked}
      quantityText={(
        <>
          Quantité&nbsp;: <strong>{billedUnits}</strong>
          {perPerson ? ` (${checkedCount} × ${personFactor} pers. servies)` : ''}
        </>
      )}
    />
  );
}

// specs/bed-config-in-linen-card.md §3 + §6. Bed counters (lits doubles / simples / bébé)
// + "Suggérer les lits" button + capacity-mismatch warning, rendered inside the option
// card of the FIRST enabled `countsAsBedLinen = 1` option (rule 10). Lives in this file as
// a private sub-component because it's tightly coupled to the reservation-form context and
// used exactly once.
function BedLinenInputsBlock() {
  const {
    form, updateForm,
    maxSingleBeds, maxDoubleBeds,
    exceedsSingleBedsLimit, exceedsDoubleBedsLimit, bedsCapacityMismatch,
    reservationBedCapacity, requiredRegularBeds,
    handleSuggestBeds,
    selectedProp, isReservationLocked,
  } = useReservationForm();
  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 1 }}>
        Configuration des lits
      </Typography>
      <Stack spacing={1.5}>
        {/* "Lits bébé" lives in the Voyageurs card (shown whenever babies > 0), not here —
            specs/bed-config-in-linen-card.md §10 follow-up (2026-06-08). */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          <QuantityField
            label="Lits doubles"
            min={0}
            max={maxDoubleBeds ?? undefined}
            allowEmpty
            value={form.doubleBeds}
            onCommit={(v) => updateForm({ doubleBeds: v })}
            fullWidth
            error={bedsCapacityMismatch || exceedsDoubleBedsLimit}
            helperText={exceedsDoubleBedsLimit ? `Maximum logement: ${maxDoubleBeds}` : ''}
            disabled={isReservationLocked}
          />
          <QuantityField
            label="Lits simples"
            min={0}
            max={maxSingleBeds ?? undefined}
            allowEmpty
            value={form.singleBeds}
            onCommit={(v) => updateForm({ singleBeds: v })}
            fullWidth
            error={bedsCapacityMismatch || exceedsSingleBedsLimit}
            helperText={exceedsSingleBedsLimit ? `Maximum logement: ${maxSingleBeds}` : ''}
            disabled={isReservationLocked}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
          <Button
            size="small"
            variant="text"
            startIcon={<AutoFixHighIcon fontSize="small" />}
            onClick={handleSuggestBeds}
            disabled={!selectedProp || isReservationLocked}
            sx={{ textTransform: 'none', width: { xs: '100%', sm: 'auto' } }}
          >
            Suggérer les lits
          </Button>
        </Box>
        {bedsCapacityMismatch && (
          <Typography variant="body2" color="error">
            Attention: la capacité des lits classiques saisis ({reservationBedCapacity}) est inférieure au besoin réel ({requiredRegularBeds}). Les enfants de 2 à 12 ans placés en lit bébé sont déduits automatiquement du calcul.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

/**
 * One catalogue option card on the reservation form — activation Switch, quantity, "Compl."
 * override, planning-card occurrences, bed-linen block and the auto-timed (early check-in / late
 * check-out) variant.
 *
 * Extracted from ExtrasSection so the same renderer serves the three places an option can now
 * appear: the flat ungrouped list, the pinned enabled rows of a category, and the folded remainder
 * (specs/option-categories.md §4.2). Everything is read from the reservation-form context — the
 * only prop is the option itself.
 */
export default function OptionRow({ opt }) {
  const {
    form, updateForm,
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setOptionEnabled, setOptionQuantity, isReservationLocked,
    setOptionInComplement, setAutoOptionInComplement,
    setOptionCardPersons, maxGuestsAllowed,
    firstEnabledBedLinenOptionId, bedLinenForcedOptionIds,
    isDevisMode,
  } = useReservationForm();

  // Auto-options use a parallel signal (`form.autoOptionsInComplement`) because they aren't part
  // of `form.selectedOptions` — see ReservationPage.js (spec force-item-to-complement.md §3.1).
  const autoOptionsInComplementSet = new Set((form?.autoOptionsInComplement || []).map(Number));
  // specs/force-extras-complement-on-platform.md §3: non-direct platforms DEFAULT every operator-added
  // extra into Complément, but the per-line "Compl." toggle stays available so a line can be pulled
  // back out (rule 1bis). Only engine-derived auto-options keep their toggle hidden — their routing
  // is the algorithm's, not the operator's (rule 5).
  const isPlatformReservation = Boolean(form?.platform) && String(form.platform).toLowerCase() !== 'direct';
  // A freshly-added line carries no explicit `inComplement` flag yet; on a platform reservation it
  // defaults INTO Complément, so the toggle must read ON until the operator flips it. A DEVIS is the
  // exception: a quote shows the guest one total, so every extra starts inside the acompte/solde
  // split whatever the platform (specs/devis-extras-parity-and-price-lock.md §3 rule 17).
  const complementChecked = (value) => (value == null ? (isPlatformReservation && !isDevisMode) : Boolean(value));

  const selected = form.selectedOptions.find((so) => so.optionId === opt.id);
  const explicitlyEnabled = Boolean(selected && Number(selected.quantity) > 0);
  // specs/bed-config-in-linen-card.md §3 rule 4.bis — a bed-linen-flagged
  // option that's a property default is FORCED ON, even when it's not (yet)
  // in form.selectedOptions. The Switch shows checked + disabled. The server
  // re-merges the same default at save time so the option lands in the DB.
  const isForcedByPropertyDefault = bedLinenForcedOptionIds?.has(opt.id) || false;
  const enabled = explicitlyEnabled || isForcedByPropertyDefault;
  // "Auto-timed" = the option is derived by the pricing engine itself (early
  // check-in / late check-out). The right discriminator is `autoEnabled === 1`,
  // NOT `autoOptionType` — since 2026-06-02 the latter is also used as a
  // "typed default" marker for the linen options (which carry autoOptionType +
  // autoEnabled=0; they're undeletable in the catalog but manually toggled per
  // reservation). Using autoOptionType here would wrongly disable the Switch.
  const isAutoTimedOption = Number(opt.autoEnabled || 0) === 1;
  // specs/baby-bed-supplement.md §3.1 — the third engine-derived family: not a timed option, so it
  // has no « seuil nuit complète » to show. Its driver is the « Lits bébé » counter of the
  // Voyageurs card, and its price is per cot, for the whole stay.
  const isBabyBedOption = isAutoTimedOption && opt.autoOptionType === 'baby_bed';
  let factorHint = '';
  if (opt.priceType === 'per_person') factorHint = `×${quantityPersons} pers.`;
  else if (opt.priceType === 'per_night') factorHint = `×${quantityNights} j.`;
  else if (opt.priceType === 'per_person_per_night') factorHint = `×${quantityPersons} pers. ×${quantityNights} j.`;
  // specs/cancellation-insurance.md §3.1 rule 5 — a percentage of the stay is a yes/no product:
  // no quantity to type, and the hint says what the percentage bites on.
  else if (opt.priceType === 'percent_of_stay') factorHint = 'du montant hébergement';
  const isPercentOfStay = opt.priceType === 'percent_of_stay';
  // specs/cancellation-insurance.md §3.1 rule 5bis — the insurance is a yes/no product whatever its
  // price type: the engine bills 1 × (its multiplier), so there is no quantity to type. A per-night
  // insurance still shows its « ×N j. » hint above, which is exactly what it will be billed.
  const hasNoQuantity = isPercentOfStay || Boolean(opt.isCancellationInsurance);
  // specs/card-option-served-persons.md §3.2 — a per-person card option (a meal, the breakfast) is
  // not always taken by the whole table: the field says how many covers each of its moments serves.
  // It replaces the « Qté » field, which a card option deliberately hides (the moments are the
  // quantity). Fixed-price card options don't get it — the covers wouldn't bite.
  const hasServedPersons = Boolean(opt.showsPlanningCard)
    && !hasNoQuantity
    && String(opt.priceType || '').includes('per_person');
  const servedPersons = Math.max(1, Number(selected?.cardPersons) || Number(quantityPersons) || 1);
  const servedPersonsMax = Math.max(servedPersons, Number(maxGuestsAllowed) || 0, Number(quantityPersons) || 1);

  return (
    <Card
      variant="outlined"
      sx={(t) => ({
        borderColor: enabled ? 'success.main' : 'divider',
        bgcolor: 'background.paper',
        boxShadow: enabled ? `0 0 0 1px ${alpha(t.palette.success.main, 0.12)}` : 'none',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
      })}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-start' }, justifyContent: 'space-between' }}>
          <Box flex={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 600 }}>{opt.title}</Typography>
              {/* specs/welcome-pack-auto-options.md §6 — says why this option ticked itself. */}
              {isWelcomePackLine(selected) && (
                <Chip size="small" color="success" variant="outlined" label="Pack de bienvenue" />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {isBabyBedOption
                ? `${formatCurrency(opt.price)} par lit bébé, pour le séjour`
                : isAutoTimedOption
                  ? `${opt.autoPricingMode === 'proportional' ? 'Prix proportionnel à la nuit' : `${formatCurrency(opt.price)} fixe`} • seuil nuit complète: ${opt.autoFullNightThreshold || (opt.autoOptionType === 'early_check_in' ? '10:00' : '17:00')}`
                  : `${isPercentOfStay ? `${Number(opt.price) || 0} %` : formatCurrency(opt.price)} ${PRICE_TYPE_LABELS[opt.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}`}
            </Typography>
          </Box>
          <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch checked={enabled} disabled={isAutoTimedOption || isForcedByPropertyDefault} onChange={(e) => setOptionEnabled(opt.id, e.target.checked)} />}
            />
            {isAutoTimedOption && (
              <Typography variant="caption" color="text.secondary">Ajout automatique</Typography>
            )}
            {!isAutoTimedOption && isForcedByPropertyDefault && (
              <Typography variant="caption" color="text.secondary">Inclus</Typography>
            )}
          </Stack>
        </Stack>

        {enabled && !isAutoTimedOption && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
            {/* Card-option (specs/option-planning-card.md §3.4): the occurrence
                checklist below replaces the manual Qté — the selection drives the
                billed quantity server-side. */}
            {hasServedPersons ? (
              <QuantityField
                size="small"
                label="Personnes servies"
                min={1}
                max={servedPersonsMax}
                value={servedPersons}
                onCommit={(v) => setOptionCardPersons(opt.id, v)}
                disabled={isReservationLocked}
                helperText="Par défaut toute la tablée — baissez-la si tout le monde ne mange pas."
                sx={{ width: { xs: '100%', sm: 240 } }}
              />
            ) : opt.showsPlanningCard || hasNoQuantity ? (
              <Box sx={{ flex: 1 }} />
            ) : (
              <QuantityField
                size="small"
                label="Qté"
                min={1}
                value={selected ? toDisplayedQuantity(selected.quantity, opt.priceType) : getQuantityMultiplier(opt.priceType)}
                onCommit={(v) => setOptionQuantity(opt.id, toBaseQuantity(v, opt.priceType))}
                disabled={isReservationLocked}
                sx={{ width: { xs: '100%', sm: 180 } }}
              />
            )}
            <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', justifyContent: 'flex-end' }}>
              {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                  Small Switch — same visual family as the activation Switch above, just
                  smaller, so the operator perceives it as the same kind of widget at a
                  glance. Tooltip carries the affordance label. On platform reservations
                  it defaults ON but stays editable (specs/force-extras-complement-on-platform.md
                  §3 rule 1bis). */}
              <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Switch
                      size="small"
                      slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                      checked={complementChecked(selected?.inComplement)}
                      onChange={(e) => setOptionInComplement(opt.id, e.target.checked)}
                    />
                  }
                  label={<Typography variant="caption" sx={{ color: 'text.secondary' }}>Compl.</Typography>}
                />
              </Tooltip>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Total: ${formatCurrency(selected?.totalPrice || 0)}`}
              />
            </Stack>
          </Stack>
        )}

        {/* Option-driven planning card occurrences (specs/option-planning-card.md
            §3.2). The checklist of moments + the billed-quantity caption. */}
        {enabled && !isAutoTimedOption && Boolean(opt.showsPlanningCard) && (
          <OptionCardOccurrences opt={opt} />
        )}

        {/* Breakfast desired time (specs/breakfast-time.md) — only on the
            breakfast-typed option when enabled. Defaults to the option's configured
            time; empty form value = use the option default (planning resolves it). */}
        {/* Legacy single « Heure souhaitée » — only when breakfast is NOT a card option.
            When showsPlanningCard is on, the per-day occurrence checklist drives the hour
            (specs/breakfast-option-planning-card.md §3 rule 2). */}
        {enabled && opt.autoOptionType === 'breakfast' && !opt.showsPlanningCard && (
          <TextField
            size="small"
            type="time"
            label="Heure souhaitée"
            value={form.breakfastTime || opt.breakfastTime || '09:00'}
            onChange={(e) => updateForm({ breakfastTime: e.target.value })}
            sx={{ mt: 1, width: { xs: '100%', sm: 200 } }}
          />
        )}

        {/* specs/bed-config-in-linen-card.md §3 rules 2 + 10 — bed counters
            sit inside the first enabled `countsAsBedLinen = 1` option card. */}
        {enabled
          && Number(opt.countsAsBedLinen || 0) === 1
          && firstEnabledBedLinenOptionId === opt.id && (
            <BedLinenInputsBlock />
        )}

        {enabled && isAutoTimedOption && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            {selected?.autoFullNightApplied
              ? <Chip size="small" variant="outlined" label="Nuit complète appliquée" />
              : selected?.autoExtraHours > 0
                ? <Chip size="small" variant="outlined" label={`${Number(selected.autoExtraHours).toFixed(1).replace('.0', '')}h supplémentaire${selected.autoExtraHours >= 2 ? 's' : ''}`} />
                : null}
            <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', justifyContent: 'flex-end' }}>
              {/* Force-to-complement override for auto-options (spec force-item-to-complement.md §3.1).
                  Same small Switch + Tooltip pattern as regular options above. Common
                  case: late check-out surcharge collected at check-out → belongs in the
                  Complément entry, not in the deposit/balance split. Hidden on platform
                  reservations — server forces inComplement = 1
                  (specs/force-extras-complement-on-platform.md §3 rule 5). */}
              {!isPlatformReservation && (
                <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Switch
                        size="small"
                        slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                        checked={autoOptionsInComplementSet.has(Number(opt.id))}
                        onChange={(e) => setAutoOptionInComplement(opt.id, e.target.checked)}
                      />
                    }
                    label={<Typography variant="caption" sx={{ color: 'text.secondary' }}>Compl.</Typography>}
                  />
                </Tooltip>
              )}
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Total auto: ${formatCurrency(selected?.totalPrice || 0)}`}
              />
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
