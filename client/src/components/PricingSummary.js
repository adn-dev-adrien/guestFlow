import React, { useState } from 'react';
import { Box, Card, Stack, Typography, Divider, Button, Chip } from '@mui/material';

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
}) {
  const [showNightlyBreakdown, setShowNightlyBreakdown] = useState(false);
  const [showVatDetail, setShowVatDetail] = useState(false);
  const [showTouristTaxDetail, setShowTouristTaxDetail] = useState(false);

  const nights = Number(quote?.nights || Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000)));
  const touristTaxLabel = String(quote?.touristTaxLabel || '').trim();
  const touristTaxTotal = Number(quote?.touristTaxTotal ?? form.touristTaxTotal ?? 0);
  const touristTaxOriginalTotal = Number(quote?.touristTaxOriginalTotal ?? touristTaxTotal);
  const touristTaxUnitAmount = Number(quote?.touristTaxUnitAmount || 0);
  const touristTaxAdultsCount = Number(quote?.touristTaxAdultsCount || 0);
  const touristTaxNights = Number(quote?.touristTaxNights || nights || 0);
  const optionsSelected = quote?.optionLines || [];
  const resourcesSelected = quote?.resourceLines || [];
  const extraGuestCount = Number(quote?.extraGuestCount || 0);
  const includedGuests = Number(quote?.includedGuests || 0);
  const extraGuestUnitPrice = Number(quote?.extraGuestUnitPrice || 0);
  const extraGuestSurchargeOriginal = Number(quote?.extraGuestSurchargeOriginal || 0);
  const extraGuestSurchargeOffered = Boolean(quote?.extraGuestSurchargeOffered ?? form.extraGuestSurchargeOffered);
  const hasExtraGuestSurcharge = extraGuestCount > 0 && extraGuestUnitPrice > 0 && extraGuestSurchargeOriginal > 0;
  const optionsTotal = Number(quote?.optionsTotal || 0);
  const resourcesTotal = Number(quote?.resourcesTotal || 0);
  const discountAmount = Number(quote?.discountAmount || 0);
  const rawTotalSejour = Number(quote?.totalStayPrice || (Number(form.finalPrice || 0) + touristTaxTotal));
  const totalSejour = isIcalSource ? rawTotalSejour - touristTaxTotal : rawTotalSejour;

  const vatPercentageAccommodation = Number(quote?.vatPercentageAccommodation ?? selectedProperty?.vatPercentageAccommodation ?? 20);
  const vatPercentageOptions = Number(quote?.vatPercentageOptions ?? selectedProperty?.vatPercentageOptions ?? 20);
  const vatPercentageResources = Number(quote?.vatPercentageResources ?? selectedProperty?.vatPercentageResources ?? 20);
  const accommodationVatAmount = Number(quote?.accommodationVatAmount || 0);
  const accommodationNetPrice = Number(quote?.accommodationNetPrice || 0);
  const optionsVatAmount = Number(quote?.optionsVatAmount || 0);
  const optionsNetPrice = Number(quote?.optionsNetPrice || 0);
  const resourcesVatAmount = Number(quote?.resourcesVatAmount || 0);
  const resourcesNetPrice = Number(quote?.resourcesNetPrice || 0);
  const totalVatAmount = Number(quote?.totalVatAmount || 0);
  const totalNetPrice = Number(quote?.totalNetPrice || 0);

  const isTouristTaxOffered = isIcalSource || (String(form.platform || '').toLowerCase() !== 'direct');
  const touristTaxDisplayedAmount = isTouristTaxOffered ? touristTaxOriginalTotal : touristTaxTotal;

  return (
    <Box
      sx={{
        position: { xs: 'static', md: 'sticky' },
        top: { md: 148 },
        height: 'fit-content',
      }}
    >
      <Card variant="outlined" sx={{ bgcolor: '#fff', p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
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
                  {parsedTotalPrice.toFixed(2)}€
                </Typography>
              )}
              <Typography variant="body2" sx={{ fontWeight: 600, color: (discountAmount > 0 || form.customPrice !== '') ? 'success.main' : 'inherit' }}>
                {accommodationDiscountedPriceDisplay ?? '—'}€
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
                py: 0.75,
                bgcolor: '#fafafa',
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
                    Nuit {night.nightNumber} • {new Date(`${night.date}T00:00:00`).toLocaleDateString('fr-FR')}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {Number(night.price || 0).toFixed(2)}€
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
                    {extraGuestCount} pers. au-delà de {includedGuests} incluses × {extraGuestUnitPrice.toFixed(2)}€
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
                    {extraGuestSurchargeOriginal.toFixed(2)}€
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
                const total = isOffered
                  ? Number(so.originalTotalPrice ?? so.totalPrice ?? 0)
                  : Number(so.totalPrice || 0);
                const isAuto = Boolean(opt?.autoOptionType);
                let autoHint = '';
                if (isAuto) {
                  if (so.autoFullNightApplied) autoHint = 'nuit complète';
                  else if (so.autoExtraHours > 0) autoHint = `${Number(so.autoExtraHours).toFixed(1).replace('.0', '')}h suppl.`;
                }
                return (
                  <Box key={so.optionId || so.customKey || `custom_${index}`} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        {so.title || opt?.title || '—'}{Number(so.quantity) > 1 ? ` ×${so.quantity}` : ''}
                      </Typography>
                      {autoHint && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          {autoHint}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                        {isOffered ? '✓ Offert' : 'Offrir'}
                      </Button>
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
                        {total.toFixed(2)}€
                      </Typography>
                    </Box>
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
                return (
                  <Box key={sr.resourceId} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" color="text.secondary">
                        {sr.name || res?.name || '—'}{Number(sr.quantity) > 1 ? ` ×${sr.quantity}${isPerHour ? 'h' : ''}` : ''}
                      </Typography>
                      {resourceHint && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          {resourceHint}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {(isPerHour || isOffered) && (
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
                        {displayedOriginalTotal.toFixed(2)}€
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </>
          )}

          {/* Taxe de séjour */}
          <>
            <Divider />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">Taxe de séjour</Typography>
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
                  {isTouristTaxOffered && (
                    <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Offert</Typography>
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: isTouristTaxOffered ? 'line-through' : 'none', opacity: isTouristTaxOffered ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    {touristTaxDisplayedAmount.toFixed(2)}€
                  </Typography>
                </Box>
              </Box>

              {showTouristTaxDetail && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {touristTaxLabel || 'Calculée automatiquement selon le mode du logement'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Base: {touristTaxUnitAmount.toFixed(2)}€ x {touristTaxAdultsCount} adulte{touristTaxAdultsCount > 1 ? 's' : ''} x {touristTaxNights} nuit{touristTaxNights > 1 ? 's' : ''}
                  </Typography>
                </Box>
              )}

              {isTouristTaxOffered && (
                <Typography variant="caption" sx={{ display: 'block', color: 'success.main', fontStyle: 'italic' }}>
                  Collectée par la plateforme
                </Typography>
              )}
            </Box>
          </>

          {/* Détails TVA */}
          <Divider />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Détails TVA
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={() => setShowVatDetail((prev) => !prev)}
                sx={{ textTransform: 'none', p: 0, minWidth: 0, fontSize: 12 }}
              >
                {showVatDetail ? 'Masquer' : 'Afficher'}
              </Button>
            </Box>

            {showVatDetail && (
              <>
                {/* Accommodation VAT */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <Typography variant="caption" color="text.secondary">
                    Hébergement (HT + TVA {vatPercentageAccommodation}%)
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    {accommodationNetPrice.toFixed(2)}€ + {accommodationVatAmount.toFixed(2)}€
                  </Typography>
                </Box>

                {/* Options VAT */}
                {optionsTotal > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      Options (HT + TVA {vatPercentageOptions}%)
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {optionsNetPrice.toFixed(2)}€ + {optionsVatAmount.toFixed(2)}€
                    </Typography>
                  </Box>
                )}

                {/* Resources VAT */}
                {resourcesTotal > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      Ressources (HT + TVA {vatPercentageResources}%)
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {resourcesNetPrice.toFixed(2)}€ + {resourcesVatAmount.toFixed(2)}€
                    </Typography>
                  </Box>
                )}

                {/* Total HT / TVA */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    Total HT / TVA
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {totalNetPrice.toFixed(2)}€ / {totalVatAmount.toFixed(2)}€
                  </Typography>
                </Box>
              </>
            )}
          </Box>

          {/* Total du séjour */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total du séjour TTC</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>{totalSejour.toFixed(2)}€</Typography>
          </Box>

          {/* Acompte */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">Acompte</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.depositAmount.toFixed(2)}€</Typography>
          </Box>
          {form.depositDueDate && (
            <Typography variant="caption" color="text.secondary">
              À payer avant : {new Date(form.depositDueDate).toLocaleDateString('fr-FR')}
            </Typography>
          )}
          {form.depositPaid && (
            <Chip size="small" label="Acompte payé" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
          )}

          {/* Solde */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">Solde</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.balanceAmount.toFixed(2)}€</Typography>
          </Box>
          {form.balanceDueDate && (
            <Typography variant="caption" color="text.secondary">
              À payer avant : {new Date(form.balanceDueDate).toLocaleDateString('fr-FR')}
            </Typography>
          )}
          {form.balancePaid && (
            <Chip size="small" label="Solde payé" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
          )}

          {/* Caution */}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">Caution</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.cautionAmount.toFixed(2)}€</Typography>
          </Box>
          {form.cautionReceived && (
            <Chip size="small" label="Caution reçue" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
          )}
          {form.cautionReturned && (
            <Chip size="small" label="Caution restituée" color="info" variant="outlined" sx={{ width: 'fit-content' }} />
          )}
        </Stack>
      </Card>
    </Box>
  );
}
