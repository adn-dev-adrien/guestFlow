import React, { useState } from 'react';
import { Box, Card, Stack, Typography, Divider, Button, Chip, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StatusBadge from './StatusBadge';
import { formatCurrency, displayDate } from '../utils/formatters';
import { COMPLEMENT_LABELS, COMPLEMENT_BREAKDOWN_LABELS } from '../constants/complements';

// Discreet italic gray chip surfaced next to a line that is routed to the Complément bucket
// (spec force-item-to-complement.md §6.2). When `onClick` is provided, the chip becomes a
// toggle the user can click to flip the line in/out of Complément directly from the summary.
// `active=false` renders a faded "+ compl." hint instead of the bold "compl." chip so the
// user discovers the affordance without it being visually loud.
function ComplementChip({ active = true, onClick, readOnly = false }) {
  const clickable = Boolean(onClick) && !readOnly;
  return (
    <Chip
      size="small"
      variant="outlined"
      label={active ? 'compl.' : '+ compl.'}
      clickable={clickable}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick(!active); } : undefined}
      sx={{
        ml: 0.5,
        height: 18,
        fontSize: 10,
        fontStyle: 'italic',
        color: active ? 'text.secondary' : 'text.disabled',
        borderColor: active ? 'divider' : 'transparent',
        opacity: active ? 1 : 0.55,
        cursor: clickable ? 'pointer' : 'default',
        '& .MuiChip-label': { px: 0.75 },
        '&:hover': clickable ? { opacity: 1, borderColor: 'divider', bgcolor: 'action.hover' } : undefined,
      }}
    />
  );
}

// Compute the split contributions of a line for PricingSummary rendering. Three outcomes:
//   - `forced`: the line lives 100 % in Complément → single row with chip + full total.
//   - `split`:  the line grew after payment(s) → two rows (snapshot portion without chip,
//               delta with chip).
//   - `simple`: current behaviour (no chip, single row).
function getLineSplit(line, totalPrice) {
  if (Number(line?.inComplement || 0) === 1) {
    return { kind: 'forced', snapshot: 0, delta: Number(totalPrice || 0) };
  }
  const acompte = Number(line?.acompteContribTtc || 0);
  const solde = Number(line?.soldeContribTtc || 0);
  const snapshot = acompte + solde;
  if (snapshot > 0 && Number(totalPrice || 0) - snapshot > 0.005) {
    return { kind: 'split', snapshot, delta: Number(totalPrice || 0) - snapshot };
  }
  return { kind: 'simple', snapshot: Number(totalPrice || 0), delta: 0 };
}

/**
 * PricingSummary — presentational right-panel pricing summary for the reservation/devis editor.
 *
 * Renders a server-computed `quote` (no business math here): accommodation price (engine struck /
 * manual green), options & resources (each with an "Offrir" toggle), extra-guest surcharge, tourist
 * tax (+ detail and offered-by-platform note), VAT breakdown, stay total TTC, deposit, balance, caution.
 * Owns its three display-detail toggles internally; lifts the "Offrir" interactions to the page.
 *
 * Props:
 *   quote                          server pricing quote (may be null before first calc)
 *   form                           the form fields read for display (dates, amounts, paid flags, platform)
 *   nightlyBreakdown               array of { date, nightNumber, price } for the per-night detail
 *   offeredOptionIds               Set of option ids currently offered
 *   propertyOptions, availableResources   catalogs used for titles/hints
 *   isIcalSource                   whether the reservation came from an iCal import
 *   selectedProperty               for the property name + VAT % fallbacks
 *   parsedTotalPrice               number|null — engine accommodation price (struck when discounted)
 *   accommodationDiscountedPriceDisplay   string — effective accommodation price shown in green
 *   onToggleExtraGuestOffered(next)
 *   onToggleOptionOffered(optionId, next)
 *   onToggleCustomOptionOffered(customKey, next)
 *   onToggleResourceOffered(resourceId, next)
 *   onToggleOptionInComplement(optionId, isAuto, next)   — flip a regular OR auto option in/out
 *                                                          of Complément directly from the summary
 *   onToggleCustomOptionInComplement(customKey, next)
 *   onToggleResourceInComplement(resourceId, next)
 *   onToggleTouristTaxInComplement(next)
 */
export default function PricingSummary({
  quote,
  form,
  nightlyBreakdown = [],
  offeredOptionIds,
  propertyOptions = [],
  availableResources = [],
  isIcalSource,
  selectedProperty,
  parsedTotalPrice,
  accommodationDiscountedPriceDisplay,
  onToggleExtraGuestOffered,
  onToggleOptionOffered,
  onToggleCustomOptionOffered,
  onToggleResourceOffered,
  onToggleOptionInComplement,
  onToggleCustomOptionInComplement,
  onToggleResourceInComplement,
  onToggleTouristTaxInComplement,
  // specs/tourist-tax-freeze-past-with-refresh.md — a past reservation's tourist tax is frozen; show a
  // refresh button next to the label to force a live recompute.
  isTouristTaxFrozen = false,
  onRefreshTouristTax,
}) {
  const [showNightlyBreakdown, setShowNightlyBreakdown] = useState(false);
  const [showTouristTaxDetail, setShowTouristTaxDetail] = useState(false);

  const nights = Number(quote?.nights || Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000)));
  const touristTaxLabel = String(quote?.touristTaxLabel || '').trim();
  const touristTaxTotal = Number(quote?.touristTaxTotal ?? form.touristTaxTotal ?? 0);
  const touristTaxOriginalTotal = Number(quote?.touristTaxOriginalTotal ?? touristTaxTotal);
  const touristTaxUnitAmount = Number(quote?.touristTaxUnitAmount || 0);
  const touristTaxAdultsCount = Number(quote?.touristTaxAdultsCount || 0);
  const touristTaxNights = Number(quote?.touristTaxNights || nights || 0);
  const touristTaxIncludedDeduction = Number(quote?.touristTaxIncludedInRateDeduction || 0);
  const touristTaxBaseBeforeDeduction = Number(quote?.touristTaxBaseBeforeDeduction || 0);
  const touristTaxFrozenAt = quote?.touristTaxFrozenAt || null;
  const touristTaxBrutInconsistent = Boolean(quote?.touristTaxBrutInconsistent);
  const optionsSelected = quote?.optionLines || [];
  const resourcesSelected = quote?.resourceLines || [];
  const extraGuestCount = Number(quote?.extraGuestCount || 0);
  const includedGuests = Number(quote?.includedGuests || 0);
  const extraGuestUnitPrice = Number(quote?.extraGuestUnitPrice || 0);
  const extraGuestSurchargeOriginal = Number(quote?.extraGuestSurchargeOriginal || 0);
  const extraGuestSurchargeOffered = Boolean(quote?.extraGuestSurchargeOffered ?? form.extraGuestSurchargeOffered);
  // A tiered supplement can be billed while the property's single `extraGuestPrice` is 0 — the
  // amount, not the unit price, is what proves there is something to show.
  const hasExtraGuestSurcharge = extraGuestCount > 0 && extraGuestSurchargeOriginal > 0
    && (extraGuestUnitPrice > 0 || Boolean(quote?.extraGuestTiersLabel));
  const extraGuestPerNight = quote?.extraGuestPriceUnit === 'per_night';
  // Tiered supplement: the server phrases the rule (« 15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit »)
  // because no single unit price describes it (specs/tariff-events-and-extra-guest-tiers §3.1).
  const extraGuestTiersLabel = quote?.extraGuestTiersLabel || null;
  const optionsTotal = Number(quote?.optionsTotal || 0);
  const resourcesTotal = Number(quote?.resourcesTotal || 0);
  const discountAmount = Number(quote?.discountAmount || 0);
  // Engine-authoritative total: the server already netted out the platform-collected tax (= 0 in
  // `touristTaxTotal`) and kept it in for owner-collected / direct cases. No client-side stripping.
  const totalSejour = Number(quote?.totalStayPrice || (Number(form.finalPrice || 0) + touristTaxTotal));

  // Single global VAT rate (specs/single-vat-rate.md §4.2). The engine still ships three
  // separate `vatPercentage*` keys for backward compatibility — they all carry the same
  // value, so we read one and ignore the others.
  const vatRate = Number(quote?.vatPercentageAccommodation ?? quote?.vatPercentageOptions ?? quote?.vatPercentageResources ?? 10);
  // Per-bucket HT/VAT amounts were dropped from the UI when the dual rate collapsed
  // (specs/single-vat-rate.md §6.2) — only the aggregated `totalNetPrice` and
  // `totalVatAmount` are still shown.
  const totalVatAmount = Number(quote?.totalVatAmount || 0);
  const totalNetPrice = Number(quote?.totalNetPrice || 0);

  // The engine resolves who collects the tax (per-platform flag on `ical_sources`, see
  // `pricing.js#isPlatformCollectingTouristTax`). The summary mirrors that decision:
  //   - collected + remitted by the platform → amount shown normally with a « Plateforme » tag (NOT
  //     « offert »: it isn't free, just handled platform-side) + the "Collectée par la plateforme" caption.
  //   - owner-collected non-direct → not crossed out, shown as "À collecter à l'arrivée" and
  //     scheduled in the complement (engine wires this through `touristTaxCollectedOnArrival`).
  //   - direct → not crossed out, kept in the balance (legacy behaviour).
  // Before the first quote comes back, fall back to the legacy heuristic so the panel does not
  // visually flicker on initial render.
  const isTouristTaxOffered = quote
    ? Boolean(quote.touristTaxOfferedByPlatform)
    : (isIcalSource || (String(form.platform || '').toLowerCase() !== 'direct'));
  const isTouristTaxCollectedOnArrival = Boolean(quote?.touristTaxCollectedOnArrival);
  const touristTaxDisplayedAmount = isTouristTaxOffered ? touristTaxOriginalTotal : touristTaxTotal;

  // specs/force-extras-complement-on-platform.md §3 rule 4: on non-direct platforms, every
  // extras line is server-forced to inComplement = 1. The per-line <ComplementChip> here is
  // therefore meaningless (no toggle to expose) and is hidden. The "Offert/Offrir" button
  // stays — a geste commercial works the same on platform and direct reservations.
  const isPlatformReservation = Boolean(form?.platform) && String(form.platform).toLowerCase() !== 'direct';

  return (
    <Box
      sx={{
        position: { xs: 'static', md: 'sticky' },
        top: { md: 148 },
        // Desktop: the summary becomes its own scroll area so the wheel/trackpad scrolls inside the
        // panel rather than the page when the cursor sits over it. We leave the mobile flow alone
        // (`xs` keeps the natural page scroll).
        maxHeight: { md: 'calc(100vh - 148px - 16px)' },
        overflowY: { md: 'auto' },
        // Hint browsers/scroll-snap engines to keep the inner scroll independent of the page.
        overscrollBehavior: 'contain',
      }}
    >
      <Card variant="outlined" sx={{ bgcolor: 'background.paper', p: 2 }}>
        <Typography variant="sectionHeader" sx={{ mb: 2 }}>
          Résumé tarifaire
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {selectedProperty?.label || selectedProperty?.name || 'Logement non sélectionné'}
        </Typography>

        <Stack spacing={1.5}>
          {/* Prix hébergement */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">Prix hébergement</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
              {discountAmount > 0 && parsedTotalPrice !== null && (
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, textDecoration: 'line-through', color: 'text.secondary' }}
                >
                  {formatCurrency(parsedTotalPrice)}
                </Typography>
              )}
              <Typography variant="body2" sx={{ fontWeight: 600, color: (discountAmount > 0 || form.customPrice !== '') ? 'success.main' : 'inherit' }}>
                {accommodationDiscountedPriceDisplay != null ? formatCurrency(accommodationDiscountedPriceDisplay) : '—'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                {nightlyBreakdown.length > 0 ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setShowNightlyBreakdown((prev) => !prev)}
                    sx={{ textTransform: 'none', p: 0, minWidth: 0, fontSize: 12 }}
                  >
                    {showNightlyBreakdown ? 'Masquer détail' : 'Détail'}
                  </Button>
                ) : (
                  <Box />
                )}
                <Typography variant="caption" color="text.secondary">({nights} nuit{nights > 1 ? 's' : ''})</Typography>
              </Box>
            </Box>
          </Box>

          {nightlyBreakdown.length > 0 && showNightlyBreakdown && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                px: 1,
                py: 1,
                bgcolor: 'grey.50',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                Détail prix par nuit
              </Typography>
              {nightlyBreakdown.map((night) => (
                <Box
                  key={`${night.date}-${night.nightNumber}`}
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.25 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Nuit {night.nightNumber} • {displayDate(night.date)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {formatCurrency(Number(night.price || 0))}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {hasExtraGuestSurcharge && (
            <>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Surcoût voyageurs
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {extraGuestTiersLabel ? (
                      `${extraGuestCount} pers. au-delà de ${includedGuests} incluses — ${extraGuestTiersLabel}`
                    ) : (
                      <>
                        {extraGuestCount} pers. au-delà de {includedGuests} incluses × {formatCurrency(extraGuestUnitPrice)}
                        {/* specs/tariff-recipes/spec.md §3.6 — per-night unit: the server sends the
                            nights count (Σ of the discount ratios is applied to the amount, not shown). */}
                        {extraGuestPerNight ? `/nuit × ${nights} nuit${nights > 1 ? 's' : ''}` : ''}
                      </>
                    )}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button
                    size="small"
                    variant={extraGuestSurchargeOffered ? 'contained' : 'outlined'}
                    color={extraGuestSurchargeOffered ? 'success' : 'inherit'}
                    onClick={() => onToggleExtraGuestOffered(!extraGuestSurchargeOffered)}
                    sx={{ minWidth: 60, fontSize: 11, textTransform: 'none' }}
                  >
                    {extraGuestSurchargeOffered ? '✓ Offert' : 'Offrir'}
                  </Button>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      textDecoration: extraGuestSurchargeOffered ? 'line-through' : 'none',
                      opacity: extraGuestSurchargeOffered ? 0.6 : 1,
                      color: extraGuestSurchargeOffered ? 'text.secondary' : 'inherit',
                    }}
                  >
                    {formatCurrency(extraGuestSurchargeOriginal)}
                  </Typography>
                </Box>
              </Box>
            </>
          )}

          {/* Options */}
          {optionsSelected.length > 0 && (
            <>
              <Divider />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Options
              </Typography>
              {optionsSelected.map((so, index) => {
                const opt = propertyOptions.find(o => o.id === so.optionId);
                const isCustom = Boolean(so.isCustom);
                const isOffered = isCustom
                  ? Boolean(so.offered)
                  : Boolean(so.offered ?? offeredOptionIds.has(Number(so.optionId)));
                // specs/per-property-default-options.md — a property-default option configured
                // « offered » is INCLUDED in the night rate. It is labelled « Comprise » rather than
                // « Offert », but like any offered line it shows its REAL price struck through and
                // bills 0: the guest must be able to see what the rate already covers, and what it
                // is worth. The engine tags the line `includedInRate`.
                const isIncludedInRate = !isCustom && Boolean(so.includedInRate);
                const freeUnits = Number(so.freeUnits || 0);
                const freeUnitsAmount = Number(so.freeUnitsAmount || 0);
                const total = isOffered
                  ? Number(so.originalTotalPrice ?? so.totalPrice ?? 0)
                  : Number(so.totalPrice || 0);
                // "Auto" hint = engine-derived early/late check option only. Linen options
                // carry autoOptionType for undeletability but autoEnabled=0 — they're manual
                // and must NOT display the "nuit complète" / "Xh suppl." hint.
                const isAuto = Number(opt?.autoEnabled || 0) === 1;
                let autoHint = '';
                if (isAuto) {
                  if (so.autoFullNightApplied) autoHint = 'nuit complète';
                  else if (so.autoExtraHours > 0) autoHint = `${Number(so.autoExtraHours).toFixed(1).replace('.0', '')}h suppl.`;
                }
                // Per-item routing split (spec force-item-to-complement.md §6.2):
                //   forced → 1 row + (clickable) chip
                //   split  → 2 rows (snapshot without chip + delta with READ-ONLY chip, because
                //            the snapshot reflects encaissements that already happened — flipping
                //            them would break conservation against those payment buckets)
                //   simple → 1 row + faded "+ compl." toggle so the user can route this line.
                const split = isOffered ? { kind: 'simple', snapshot: total, delta: 0 } : getLineSplit(so, total);
                // specs/force-extras-complement-on-platform.md §3 rule 1bis: on a platform reservation
                // the operator-added extras keep a clickable Complément chip so a line can be pulled
                // back out of Complément. Engine-derived auto-options (early/late check) stay forced
                // and chip-less — their routing is the algorithm's, not the operator's.
                const hideChipForPlatform = isPlatformReservation && isAuto;
                const baseLabel = `${so.title || opt?.title || '—'}${Number(so.quantity) > 1 ? ` ×${so.quantity}` : ''}`;
                const baseKey = so.optionId || so.customKey || `custom_${index}`;

                // Single callback unifies regular / auto / custom — the page knows which channel
                // to update; the summary just signals "the user clicked compl. on THIS line".
                const handleInComplementToggle = (next) => {
                  if (isCustom) {
                    if (typeof onToggleCustomOptionInComplement === 'function') {
                      onToggleCustomOptionInComplement(String(so.customKey || ''), next);
                    }
                    return;
                  }
                  if (typeof onToggleOptionInComplement === 'function') {
                    onToggleOptionInComplement(so.optionId, isAuto, next);
                  }
                };

                const renderRow = ({ label, amount, chip /* 'on'|'off'|'readonly'|null */, withOfferedToggle }) => (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary">
                        {label}
                      </Typography>
                      {chip === 'on' && <ComplementChip active onClick={handleInComplementToggle} />}
                      {chip === 'off' && <ComplementChip active={false} onClick={handleInComplementToggle} />}
                      {chip === 'readonly' && <ComplementChip active readOnly />}
                      {autoHint && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', width: '100%' }}>
                          {autoHint}
                        </Typography>
                      )}
                      {isIncludedInRate && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', width: '100%' }}>
                          incluse dans le tarif
                        </Typography>
                      )}
                      {/* specs/tariff-recipes/spec.md §3.9 rule 52bis — the first N units are covered
                          by the rate: say how many here, what they are worth in the amount column. */}
                      {freeUnits > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                          dont {freeUnits} inclus dans le tarif
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {withOfferedToggle && (
                        <Button
                          size="small"
                          variant={isOffered ? 'contained' : 'outlined'}
                          color={isOffered ? 'success' : 'inherit'}
                          onClick={() => {
                            if (isCustom) {
                              const targetKey = String(so.customKey || '');
                              if (!targetKey) return;
                              onToggleCustomOptionOffered(targetKey, !isOffered);
                              return;
                            }
                            onToggleOptionOffered(so.optionId, !isOffered);
                          }}
                          sx={{ minWidth: 60, fontSize: 11, textTransform: 'none' }}
                        >
                          {isIncludedInRate ? 'Comprise' : (isOffered ? '✓ Offert' : 'Offrir')}
                        </Button>
                      )}
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        {/* specs/welcome-pack-auto-options.md §6 — what the rate covers reads in the
                            amount column, greyed and smaller, right above the 0,00 € it explains. */}
                        {freeUnits > 0 && freeUnitsAmount > 0 && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ textDecoration: 'line-through', whiteSpace: 'nowrap', lineHeight: 1.2 }}
                          >
                            {formatCurrency(freeUnitsAmount)}
                          </Typography>
                        )}
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            // Offered and included-in-rate alike: the real price, struck through.
                            textDecoration: isOffered ? 'line-through' : 'none',
                            opacity: isOffered ? 0.6 : 1,
                            color: isOffered ? 'text.secondary' : 'inherit',
                          }}
                        >
                          {formatCurrency(amount)}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                );

                // The chip is hidden only for engine-forced auto-options on a platform reservation
                // (`hideChipForPlatform`); operator-added extras keep it so the routing is editable.
                if (split.kind === 'forced') {
                  return (
                    <Box key={baseKey}>
                      {renderRow({ label: baseLabel, amount: split.delta, chip: hideChipForPlatform ? null : 'on', withOfferedToggle: true })}
                    </Box>
                  );
                }
                if (split.kind === 'split') {
                  return (
                    <Stack key={baseKey} spacing={0.5}>
                      {renderRow({ label: baseLabel, amount: split.snapshot, chip: null, withOfferedToggle: true })}
                      {renderRow({ label: baseLabel, amount: split.delta, chip: hideChipForPlatform ? null : 'readonly', withOfferedToggle: false })}
                    </Stack>
                  );
                }
                return (
                  <Box key={baseKey}>
                    {renderRow({ label: baseLabel, amount: total, chip: (isOffered || hideChipForPlatform) ? null : 'off', withOfferedToggle: true })}
                  </Box>
                );
              })}
            </>
          )}

          {/* Ressources */}
          {resourcesSelected.length > 0 && (
            <>
              <Divider />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Ressources
              </Typography>
              {resourcesSelected.map(sr => {
                const res = availableResources.find(r => r.id === sr.resourceId);
                const isOffered = Boolean(sr.offered);
                const total = Number(sr.totalPrice || 0);
                const originalTotal = Number(sr.originalTotalPrice ?? total ?? 0);
                const isPerHour = Boolean(res?.isComplex)
                  || (sr.priceType || res?.priceType) === 'per_hour'
                  || Number(res?.freeMinutes || 0) > 0;
                const hasFreeFirstHour = isPerHour && Number(res?.freeMinutes || 0) >= 60;
                const displayedOriginalTotal = isOffered ? originalTotal : total;
                const resourceHint = hasFreeFirstHour ? '1ère heure offerte' : '';
                // Hours sold vs hours actually placed on a slot — both counted server-side
                // (`scheduledHours`, absent on a resource that cannot be scheduled). An hourly
                // resource is normally sold unscheduled and planned with the guest during the arrival
                // SAS, so « à planifier » is an ordinary state, not an alarm — but it must be visible,
                // or the operator cannot tell a scheduled bath from one nobody booked a slot for
                // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.1 rule 5).
                const hoursSold = Number(sr.quantity || 0);
                const hoursPlaced = Number(sr.scheduledHours || 0);
                const schedulingLabel = sr.scheduledHours === undefined || hoursSold <= 0 || hoursPlaced >= hoursSold
                  ? ''
                  : hoursPlaced <= 0
                    ? 'à planifier'
                    : `${hoursPlaced} h / ${hoursSold} h planifiées`;
                const split = isOffered
                  ? { kind: 'simple', snapshot: displayedOriginalTotal, delta: 0 }
                  : getLineSplit(sr, total);
                const baseLabel = `${sr.name || res?.name || '—'}${Number(sr.quantity) > 1 ? ` ×${sr.quantity}${isPerHour ? 'h' : ''}` : ''}`;

                const handleInComplementToggle = (next) => {
                  if (typeof onToggleResourceInComplement === 'function') {
                    onToggleResourceInComplement(sr.resourceId, next);
                  }
                };

                const renderRow = ({ amount, chip /* 'on'|'off'|'readonly'|null */, withOfferedToggle }) => (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary">
                        {baseLabel}
                      </Typography>
                      {chip === 'on' && <ComplementChip active onClick={handleInComplementToggle} />}
                      {chip === 'off' && <ComplementChip active={false} onClick={handleInComplementToggle} />}
                      {chip === 'readonly' && <ComplementChip active readOnly />}
                      {schedulingLabel && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={schedulingLabel}
                          sx={{ ml: 0.5, height: 18, fontSize: 10, color: 'text.secondary' }}
                        />
                      )}
                      {resourceHint && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', width: '100%' }}>
                          {resourceHint}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {withOfferedToggle && (
                        <Button
                          size="small"
                          variant={isOffered ? 'contained' : 'outlined'}
                          color={isOffered ? 'success' : 'inherit'}
                          onClick={() => onToggleResourceOffered(sr.resourceId, !isOffered)}
                          sx={{ minWidth: 60, fontSize: 11, textTransform: 'none' }}
                        >
                          {isOffered ? '✓ Offert' : 'Offrir'}
                        </Button>
                      )}
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          textDecoration: isOffered ? 'line-through' : 'none',
                          opacity: isOffered ? 0.6 : 1,
                          color: isOffered ? 'text.secondary' : 'inherit',
                        }}
                      >
                        {formatCurrency(amount)}
                      </Typography>
                    </Box>
                  </Box>
                );

                // Resources have no engine-derived "auto" variant, so the Complément chip is always
                // editable — including on platform reservations (specs/force-extras-complement-on-platform.md
                // §3 rule 1bis): the operator can pull a resource back out of Complément.
                if (split.kind === 'forced') {
                  return <Box key={sr.resourceId}>{renderRow({ amount: split.delta, chip: 'on', withOfferedToggle: true })}</Box>;
                }
                if (split.kind === 'split') {
                  return (
                    <Stack key={sr.resourceId} spacing={0.5}>
                      {renderRow({ amount: split.snapshot, chip: null, withOfferedToggle: true })}
                      {renderRow({ amount: split.delta, chip: 'readonly', withOfferedToggle: false })}
                    </Stack>
                  );
                }
                return <Box key={sr.resourceId}>{renderRow({ amount: displayedOriginalTotal, chip: isOffered ? null : 'off', withOfferedToggle: true })}</Box>;
              })}
            </>
          )}

          {/* Taxe de séjour */}
          <>
            <Divider />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Taxe de séjour</Typography>
                    {/* specs/tourist-tax-matches-the-office-calculation.md rules 10-11 — a tax the
                        guest has paid, or one already declared, is frozen; this button forces a live
                        recompute (then Save persists it). */}
                    {isTouristTaxFrozen && onRefreshTouristTax && (
                      <Tooltip title="Recalculer la taxe de séjour (figée — déjà encaissée ou déclarée)">
                        <IconButton size="small" onClick={onRefreshTouristTax} aria-label="Recalculer la taxe de séjour" sx={{ ml: 0.25, p: 0.25 }}>
                          <RefreshIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {/* Manual routing to Complément (spec force-item-to-complement.md §6.2).
                        Two render paths:
                          - `collectedOnArrival = true` (engine auto-routes — non-direct platform
                            that doesn't collect the tax): the chip is shown read-only as a hint
                            that the tax is in Complément. The user can't toggle this — the
                            routing is determined by the platform's `collectsTouristTax` setting.
                          - otherwise (direct or platform-collect): the chip is clickable,
                            mirrors the Switch in FinanceSection.
                        Hidden when the tax is offered (no money to route). */}
                    {!isTouristTaxOffered && Number(touristTaxTotal) > 0 && (
                      isTouristTaxCollectedOnArrival ? (
                        <ComplementChip active readOnly />
                      ) : (
                        <ComplementChip
                          active={Boolean(quote?.touristTaxInComplement)}
                          onClick={onToggleTouristTaxInComplement}
                        />
                      )
                    )}
                    {/* Case 2 — the platform collects + remits the tax to the commune. NOT « offert »
                        (it isn't free) : a short « Plateforme » tag says it's handled platform-side. */}
                    {isTouristTaxOffered && (
                      <Chip
                        size="small"
                        label="Plateforme"
                        sx={{ ml: 0.5, height: 18, fontSize: 10, fontWeight: 600, color: 'info.main', borderColor: 'info.main', bgcolor: 'transparent', '& .MuiChip-label': { px: 0.75 } }}
                        variant="outlined"
                      />
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowTouristTaxDetail((prev) => !prev)}
                      sx={{ textTransform: 'none', p: 0, minWidth: 0, fontSize: 12 }}
                    >
                      {showTouristTaxDetail ? 'Masquer détail' : 'Afficher détail'}
                    </Button>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {/* Case 2 (platform collects AND remits to the commune): the amount is shown normally
                      with the « Plateforme » tag above — NOT struck-through (it isn't « offert »). The
                      caption below explains who handles it. */}
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatCurrency(touristTaxDisplayedAmount)}
                  </Typography>
                </Box>
              </Box>

              {showTouristTaxDetail && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {touristTaxLabel || 'Calculée automatiquement selon le mode du logement'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Base: {formatCurrency(touristTaxUnitAmount)} x {touristTaxAdultsCount} adulte{touristTaxAdultsCount > 1 ? 's' : ''} x {touristTaxNights} nuit{touristTaxNights > 1 ? 's' : ''}
                  </Typography>
                  {/* specs/tourist-tax-matches-the-office-calculation.md rule 12 — say when the amount
                      was pinned, so the operator knows the caption above describes what was actually
                      charged and not today's tariff. */}
                  {isTouristTaxFrozen && touristTaxFrozenAt && (
                    <Typography variant="caption" color="text.secondary">
                      Figée le {String(touristTaxFrozenAt).slice(0, 10).split('-').reverse().join('/')}
                    </Typography>
                  )}
                  {/* specs/tourist-tax-included-services-deduction.md rule 13 — the services sold
                      inside the night rate are not the dry night: their reference value leaves the
                      declared base. */}
                  {touristTaxIncludedDeduction > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Base : {formatCurrency(touristTaxBaseBeforeDeduction)} − {formatCurrency(touristTaxIncludedDeduction)} de prestations comprises
                    </Typography>
                  )}
                </Box>
              )}

              {/* specs/tourist-tax-matches-the-office-calculation.md rule 16 — a brut that does not
                  cover the extras billed beside it cannot yield an accommodation: the base is floored
                  at 0, and saying so beats declaring a silent zero to the commune. */}
              {touristTaxBrutInconsistent && (
                <Typography variant="caption" sx={{ display: 'block', color: 'error.main' }}>
                  Le brut plateforme ne couvre pas les extras facturés — la taxe est calculée sur une assiette nulle.
                </Typography>
              )}

              {/* specs/per-platform-tourist-tax-three-way.md — three cases, three captions:
                  - offered (case 2): the platform collects AND remits to the commune → struck-through, absent from our books.
                  - reversed (case 1): the platform collects then reverses it to us → CHARGED in the balance, we declare it.
                  - on-arrival (case 3): we collect it at check-in → charged in the complement. */}
              {isTouristTaxOffered && (
                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                  Collectée et reversée à la commune par la plateforme
                </Typography>
              )}
              {!isTouristTaxOffered && Boolean(quote?.touristTaxReversedByPlatform) && (
                <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', fontStyle: 'italic' }}>
                  Collectée par la plateforme puis reversée — incluse dans le solde, à déclarer (Suivi taxe de séjour)
                </Typography>
              )}
              {!isTouristTaxOffered && isTouristTaxCollectedOnArrival && (
                <Typography variant="caption" sx={{ display: 'block', color: 'warning.main', fontStyle: 'italic' }}>
                  À collecter à l'arrivée (incluse dans le complément)
                </Typography>
              )}
            </Box>
          </>

          {/* TVA — single global rate (specs/single-vat-rate.md §6.2). Collapsed from the former
              per-bucket breakdown since accommodation / options / resources all share the
              same rate now. Total HT + TVA on two lines under the séjour total. */}
          <Divider />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">Total HT</Typography>
              <Typography variant="caption" sx={{ fontWeight: 500 }}>{formatCurrency(totalNetPrice)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">TVA {vatRate}%</Typography>
              <Typography variant="caption" sx={{ fontWeight: 500 }}>{formatCurrency(totalVatAmount)}</Typography>
            </Box>
          </Box>

          {/* Total du séjour — running-subtotal cascade (specs/platform-offered-tax-passthrough-and-
              cascade.md). « Total du séjour » = the gross (hébergement + toutes options/ressources +
              taxe). Then for a platform we deduct what we don't keep (taxe gérée plateforme + extras
              perçus sur place) to land on « Montant soumis à commission », minus the commission =
              « Versement plateforme », plus the on-site compléments = « Total perçu sur le séjour ». */}
          <Divider />
          {(() => {
            const acompteComm = Number(quote?.acompteCommissionAmount || 0);
            const soldeComm = Number(quote?.platformCommissionAmount || 0);
            const totalComm = Number(quote?.totalPlatformCommission ?? (acompteComm + soldeComm));
            const netReceived = quote?.platformNetReceivedAmount;
            const hasCommission = totalComm > 0;
            // « Total du séjour » = the GROSS the client pays: finalPrice (accommodation + all
            // options/resources) + the REAL tourist tax (original, even when offered — the guest paid it).
            // The end-of-stay complement has two halves: what the departure SAS bills (ménage, linge
            // manquant, extincteur — flat amounts OUTSIDE finalPrice) and the prestations sold during
            // the stay (real option/resource lines, already inside finalPrice). Only the first half is
            // added here, else the mid-stay part would be counted twice in the gross.
            // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 15 — the end-of-stay
            // complement is collected on site like the arrival one: same treatment in the cascade.
            const endOfStay = Number(quote?.endOfStayComplementTotal ?? form.endOfStayComplementAmount ?? 0);
            // specs/mid-stay-notes.md §3.5 rule 19 — prestations already collected through a note.
            const midStayNotes = Number(quote?.midStaySettledTotal || 0);
            // The SAS half of the end-of-stay complement (ménage/linge/extincteur) lives OUTSIDE
            // finalPrice; the mid-stay half (sold + collected or still due) is already inside it.
            const endOfStaySas = Math.max(0, endOfStay - Number(quote?.midStayRemainingTotal ?? quote?.midStayExtrasTotal ?? 0));
            const grossTotal = Number(quote?.finalPrice != null ? quote.finalPrice : totalSejour)
              + touristTaxOriginalTotal + endOfStaySas;
            // Deductions to the commission base: the tax the platform collects + remits to the commune
            // itself (offered), and the extras collected on-site (the complément). What's left is the
            // pre-arrival amount the platform commissions on.
            const offeredTax = isTouristTaxOffered ? touristTaxOriginalTotal : 0;
            const complement = Number(quote?.complementAmount || 0);
            const onSiteTotal = complement + endOfStay + midStayNotes;
            // specs/complement-buckets-by-moment.md §3 rule 1 — the server files each amount under the
            // moment it is collected; the panel only prints. Fallback for a quote from an older payload
            // (or a devis preview): everything under arrival, which is what the engine returns anyway.
            const split = quote?.complementSplit || { arrival: complement, duringStay: midStayNotes, endOfStay };
            const montantSoumis = Number(quote?.preArrivalAmount != null ? quote.preArrivalAmount : (grossTotal - offeredTax - onSiteTotal));
            const versement = netReceived != null ? Number(netReceived) : montantSoumis;
            // specs/reservation-refunds.md §3.3 rule 17 — money given back to the guest is the last
            // deduction of the cascade: everything above still shows what was sold and collected.
            const refundsTotal = Number(quote?.refundsTotal || 0);
            // specs/arrival-payment-detail-and-adjustment.md rule 21 — le client a réglé le paiement
            // unique de l'arrivée pour moins (réduction accordée sur l'hébergement) ou pour plus
            // (pourboire) que la somme de ses seaux. Le serveur l'a déjà répercuté sur
            // `sejourNetTotal` ; ici on ne fait qu'imprimer la ligne qui l'explique.
            const arrivalReduction = Number(quote?.arrivalPaymentReduction || 0);
            const arrivalTip = Number(quote?.arrivalPaymentTip || 0);
            const totalPercu = Number(quote?.sejourNetTotal ?? (versement + onSiteTotal - refundsTotal));
            // The cascade flow (deductions → versement → +complément) only makes sense for a platform
            // reservation. Direct keeps a single « Total du séjour » + a complément line if any.
            const row = (label, value, opts = {}) => (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, ...(opts.pt ? { pt: 0.5 } : {}) }}>
                <Typography variant={opts.strong ? 'subtitle2' : 'body2'} color={opts.strong ? 'text.primary' : 'text.secondary'} sx={opts.strong ? { fontWeight: 700 } : undefined}>{label}</Typography>
                {/* sign + amount kept on a single line for readability (no wrap in the narrow column). */}
                <Typography variant={opts.strong ? 'subtitle2' : 'body2'} sx={{ fontWeight: opts.strong ? 700 : 600, color: opts.color || 'inherit', whiteSpace: 'nowrap' }}>{opts.sign || ''}{formatCurrency(Math.abs(value))}</Typography>
              </Box>
            );
            return (
              <>
                {row('Total du séjour', grossTotal, { strong: true, color: 'primary.main', pt: true })}
                {isPlatformReservation ? (
                  <>
                    {offeredTax > 0 && row('Taxe de séjour (plateforme)', offeredTax, { sign: '− ', color: 'warning.main' })}
                    {onSiteTotal > 0 && row('Compléments (perçus sur place)', onSiteTotal, { sign: '− ', color: 'warning.main' })}
                    {(offeredTax > 0 || onSiteTotal > 0) && row('Montant soumis à commission', montantSoumis, { strong: true })}
                    {hasCommission && acompteComm > 0 && row('Commission acompte', acompteComm, { sign: '− ', color: 'warning.main' })}
                    {hasCommission && soldeComm > 0 && row('Commission solde', soldeComm, { sign: '− ', color: 'warning.main' })}
                    {(hasCommission || onSiteTotal > 0) && row('Versement plateforme', versement, { strong: true })}
                    {split.arrival > 0 && row(`${COMPLEMENT_LABELS.arrival} (perçu sur place)`, split.arrival, { sign: '+ ', color: 'success.main' })}
                    {split.duringStay > 0 && row(COMPLEMENT_LABELS.duringStay, split.duringStay, { sign: '+ ', color: 'success.main' })}
                    {split.endOfStay > 0 && row(COMPLEMENT_LABELS.endOfStay, split.endOfStay, { sign: '+ ', color: 'success.main' })}
                    {refundsTotal > 0 && row('Remboursements', refundsTotal, { sign: '− ', color: 'error.main' })}
                    {arrivalReduction > 0 && row('Réduction accordée', arrivalReduction, { sign: '− ', color: 'warning.main' })}
                    {arrivalTip > 0 && row('Pourboire', arrivalTip, { sign: '+ ', color: 'success.main' })}
                    {row('Total perçu sur le séjour', totalPercu, { strong: true, color: 'primary.main' })}
                    {form.complementPaid && split.arrival > 0 && (
                      <StatusBadge status="success" label="Complément payé" />
                    )}
                  </>
                ) : (
                  <>
                    {/* specs/complement-buckets-by-moment.md — one line per MOMENT of collection. The
                        server has already moved an unsettled arrival complement into `endOfStay`, so
                        there is no « deferred » wording to apply here: the amount is simply on the
                        line that says when it is taken. */}
                    {split.arrival > 0 && (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ color: form.complementPaid ? 'text.secondary' : 'error.main', fontWeight: form.complementPaid ? 400 : 600 }}>
                            {COMPLEMENT_BREAKDOWN_LABELS.arrival}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(split.arrival)}</Typography>
                        </Box>
                        {form.complementPaid && (
                          <StatusBadge status="success" label="Complément payé" />
                        )}
                      </>
                    )}
                    {split.duringStay > 0 && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">{COMPLEMENT_BREAKDOWN_LABELS.duringStay}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(split.duringStay)}</Typography>
                      </Box>
                    )}
                    {split.endOfStay > 0 && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: form.endOfStayComplementPaid ? 'text.secondary' : 'error.main', fontWeight: form.endOfStayComplementPaid ? 400 : 600 }}>
                          {COMPLEMENT_BREAKDOWN_LABELS.endOfStay}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(split.endOfStay)}</Typography>
                      </Box>
                    )}
                    {/* Direct: no cascade to print, so the « total perçu » line only appears once a
                        refund makes it differ from the gross above. */}
                    {refundsTotal > 0 && row('Remboursements', refundsTotal, { sign: '− ', color: 'error.main' })}
                    {arrivalReduction > 0 && row('Réduction accordée', arrivalReduction, { sign: '− ', color: 'warning.main' })}
                    {arrivalTip > 0 && row('Pourboire', arrivalTip, { sign: '+ ', color: 'success.main' })}
                    {(refundsTotal > 0 || arrivalReduction > 0 || arrivalTip > 0)
                      && row('Total perçu sur le séjour', totalPercu, { strong: true, color: 'primary.main' })}
                  </>
                )}
              </>
            );
          })()}

          {/* Acompte — when `depositDisabled` is on (per-reservation opt-out, see
              specs/disable-deposit-per-reservation.md), the row stays so the operator can
              see the deposit was considered and explicitly removed, but the amount + due
              date + "payé" chip are replaced by a single muted "Désactivé" line so the
              summary stays consistent with FinanceSection. */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {isPlatformReservation ? 'Montant acompte payé par le client' : 'Acompte'}
            </Typography>
            {form.depositDisabled ? (
              <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>
                Désactivé (ajouté au solde)
              </Typography>
            ) : (
              // specs/platform-per-echeance-commission.md — the stored acompte is the GROSS the guest
              // pays; the label says so, and the per-échéance commission + net « Versement plateforme »
              // are already broken out in the cascade above. Showing the gross here avoids the confusion
              // of a « payé par le client » figure that had the commission silently subtracted.
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(Number(form.depositAmount || 0))}</Typography>
            )}
          </Box>
          {!form.depositDisabled && form.depositDueDate && (
            <Typography variant="caption" color="text.secondary">
              À payer avant : {displayDate(form.depositDueDate)}
            </Typography>
          )}
          {!form.depositDisabled && form.depositPaid && (
            <StatusBadge status="success" label="Acompte payé" />
          )}

          {/* Solde — when `depositDisabled` is on, the displayed amount is the SUM of the
              two form fields so the operator sees the consolidated total immediately on
              toggle, without waiting for the live recompute round-trip. After save and after
              every subsequent recompute, `form.depositAmount` is 0 and `form.balanceAmount`
              already holds the full pre-arrival total, so the sum stays the right number
              (0 + total = total). Defensive against the transient window where the click has
              flipped the flag but the recomputed quote hasn't landed yet. See
              specs/disable-deposit-per-reservation.md §6. */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {isPlatformReservation ? 'Montant solde payé par le client' : 'Solde'}
            </Typography>
            {/* specs/platform-per-echeance-commission.md — the stored solde is the GROSS the guest pays;
                the commission + net « Versement plateforme » are in the cascade above. */}
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {formatCurrency(form.depositDisabled
                ? (Number(form.depositAmount || 0) + Number(form.balanceAmount || 0))
                : Number(form.balanceAmount || 0))}
            </Typography>
          </Box>
          {form.balanceDueDate && (
            <Typography variant="caption" color="text.secondary">
              À payer avant : {displayDate(form.balanceDueDate)}
            </Typography>
          )}
          {form.balancePaid && (
            <StatusBadge status="success" label="Solde payé" />
          )}

          {/* Caution */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">Caution</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(form.cautionAmount)}</Typography>
          </Box>
          {form.cautionReceived && (
            <StatusBadge status="success" label="Caution reçue" />
          )}
          {form.cautionReturned && (
            <StatusBadge status="info" label="Caution restituée" />
          )}
        </Stack>
      </Card>
    </Box>
  );
}
