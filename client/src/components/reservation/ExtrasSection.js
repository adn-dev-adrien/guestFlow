import React from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Divider, Button, TextField, Chip,
  FormControlLabel, Switch, Tooltip
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useReservationForm } from './ReservationFormContext';

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
          <TextField
            label="Lits doubles"
            type="number"
            value={form.doubleBeds}
            onChange={(e) => updateForm({ doubleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
            fullWidth
            error={bedsCapacityMismatch || exceedsDoubleBedsLimit}
            helperText={exceedsDoubleBedsLimit ? `Maximum logement: ${maxDoubleBeds}` : ''}
            slotProps={{ htmlInput: { min: 0, max: maxDoubleBeds ?? undefined } }}
          />
          <TextField
            label="Lits simples"
            type="number"
            value={form.singleBeds}
            onChange={(e) => updateForm({ singleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
            fullWidth
            error={bedsCapacityMismatch || exceedsSingleBedsLimit}
            helperText={exceedsSingleBedsLimit ? `Maximum logement: ${maxSingleBeds}` : ''}
            slotProps={{ htmlInput: { min: 0, max: maxSingleBeds ?? undefined } }}
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

// Tooltip text shared by every "Compl." checkbox (spec §6.4).
const COMPLEMENT_TOOLTIP = 'Cette ligne sera comptabilisée intégralement dans le Complément à percevoir, jamais dans l\'acompte ou le solde.';

const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par jour',
  per_person_per_night: 'par pers./jour',
  per_hour: 'par heure',
  free: 'gratuit',
};

/**
 * Options et ressources card: catalog options (incl. auto-timed), custom options, and resource pickers.
 * Reads everything from the reservation form context — no props.
 */
export default function ExtrasSection() {
  const {
    formSectionCardSx, lockedSectionSx, formSectionContentSx,
    form, propertyOptions, displayableResources,
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setOptionEnabled, setOptionQuantity, setResourceEnabled, setResourceQuantity,
    addCustomOption, updateCustomOption, removeCustomOption, isReservationLocked,
    setOptionInComplement, setResourceInComplement, setAutoOptionInComplement,
    firstEnabledBedLinenOptionId, bedLinenForcedOptionIds,
  } = useReservationForm();
  // Auto-options use a parallel signal (`form.autoOptionsInComplement`) because they aren't part
  // of `form.selectedOptions` — see ReservationPage.js (spec force-item-to-complement.md §3.1).
  const autoOptionsInComplementSet = new Set((form?.autoOptionsInComplement || []).map(Number));
  // specs/force-extras-complement-on-platform.md §3 rule 4: non-direct platforms hide every
  // "Compl." toggle (server forces inComplement = 1 on save anyway) and explain the routing
  // with a single muted caption above the section.
  const isPlatformReservation = Boolean(form?.platform) && String(form.platform).toLowerCase() !== 'direct';

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Options et ressources</Typography>
        {isPlatformReservation && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontStyle: 'italic' }}>
            Réservation plateforme — les extras sont automatiquement facturés en paiement complémentaire.
          </Typography>
        )}
        <Stack spacing={2}>
          {propertyOptions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Options</Typography>
              <Stack spacing={1.25}>
                {propertyOptions.map((opt) => {
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
                  let factorHint = '';
                  if (opt.priceType === 'per_person') factorHint = `×${quantityPersons} pers.`;
                  else if (opt.priceType === 'per_night') factorHint = `×${quantityNights} j.`;
                  else if (opt.priceType === 'per_person_per_night') factorHint = `×${quantityPersons} pers. ×${quantityNights} j.`;
                  return (
                    <Card
                      key={opt.id}
                      variant="outlined"
                      sx={{
                        borderColor: enabled ? '#2e7d32' : 'divider',
                        bgcolor: '#fff',
                        boxShadow: enabled ? '0 0 0 1px rgba(46, 125, 50, 0.12)' : 'none',
                        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                      }}
                    >
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-start' }, justifyContent: 'space-between' }}>
                          <Box flex={1}>
                            <Typography sx={{ fontWeight: 600 }}>{opt.title}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {isAutoTimedOption
                                ? `${opt.autoPricingMode === 'proportional' ? 'Prix proportionnel à la nuit' : `${opt.price}€ fixe`} • seuil nuit complète: ${opt.autoFullNightThreshold || (opt.autoOptionType === 'early_check_in' ? '10:00' : '17:00')}`
                                : `${opt.price}€ ${PRICE_TYPE_LABELS[opt.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}`}
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
                              <Typography variant="caption" color="text.secondary">Inclus par défaut</Typography>
                            )}
                          </Stack>
                        </Stack>

                        {enabled && !isAutoTimedOption && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                            <TextField
                              size="small"
                              type="number"
                              label="Qté"
                              value={selected ? toDisplayedQuantity(selected.quantity, opt.priceType) : getQuantityMultiplier(opt.priceType)}
                              onChange={(e) => setOptionQuantity(opt.id, toBaseQuantity(e.target.value, opt.priceType))}
                              sx={{ width: { xs: '100%', sm: 'auto' } }}
                              slotProps={{
                                htmlInput: { min: 1 }
                              }}
                            />
                            <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', justifyContent: 'flex-end' }}>
                              {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                                  Small Switch — same visual family as the activation Switch above, just
                                  smaller, so the operator perceives it as the same kind of widget at a
                                  glance. Tooltip carries the affordance label. Hidden on platform
                                  reservations (specs/force-extras-complement-on-platform.md §3 rule 4 —
                                  server forces inComplement = 1). */}
                              {!isPlatformReservation && (
                                <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                                  <FormControlLabel
                                    sx={{ m: 0 }}
                                    control={
                                      <Switch
                                        size="small"
                                        slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                                        checked={Boolean(selected?.inComplement)}
                                        onChange={(e) => setOptionInComplement(opt.id, e.target.checked)}
                                      />
                                    }
                                  />
                                </Tooltip>
                              )}
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={`Total: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                              />
                            </Stack>
                          </Stack>
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
                                  />
                                </Tooltip>
                              )}
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={`Total auto: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                              />
                            </Stack>
                          </Stack>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            </Box>
          )}

          <>
            {propertyOptions.length > 0 && <Divider />}
            <Box>
              <Stack direction="row" sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">Options personnalisées</Typography>
                <Button size="small" variant="outlined" onClick={addCustomOption} disabled={isReservationLocked}>
                  Ajouter une ligne
                </Button>
              </Stack>
              {(form.customOptions || []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Aucune option personnalisée.
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {(form.customOptions || []).map((line) => (
                    <Card key={line.customKey} variant="outlined" sx={{ bgcolor: '#fff' }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack spacing={1.25}>
                          <TextField
                            size="small"
                            label="Description"
                            value={line.description || ''}
                            onChange={(e) => updateCustomOption(line.customKey, { description: e.target.value })}
                            fullWidth
                          />
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                            <TextField
                              size="small"
                              type="number"
                              label="Prix TTC"
                              value={line.amount ?? 0}
                              onChange={(e) => updateCustomOption(line.customKey, { amount: Math.max(0, Number(e.target.value || 0)) })}
                              sx={{ width: { xs: '100%', sm: 180 } }}
                              slotProps={{
                                htmlInput: { min: 0, step: 0.01 }
                              }}
                            />
                            {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                                Small Switch + Tooltip pattern — see comment on the regular-option block
                                above. Hidden on platform reservations
                                (specs/force-extras-complement-on-platform.md §3 rule 4). */}
                            {!isPlatformReservation && (
                              <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                                <FormControlLabel
                                  sx={{ m: 0 }}
                                  control={
                                    <Switch
                                      size="small"
                                      slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                                      checked={Boolean(line.inComplement)}
                                      onChange={(e) => updateCustomOption(line.customKey, { inComplement: e.target.checked })}
                                    />
                                  }
                                />
                              </Tooltip>
                            )}
                            <Button color="error" variant="text" onClick={() => removeCustomOption(line.customKey)}>
                              Supprimer
                            </Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          </>

          {displayableResources.length > 0 && (
            <>
              {propertyOptions.length > 0 && <Divider />}
              <Box>
                <Typography variant="subtitle2" gutterBottom>Ressources</Typography>
                <Stack spacing={1.25}>
                  {displayableResources.map(resource => {
                    const selected = form.selectedResources.find(sr => sr.resourceId === resource.id);
                    const enabled = Boolean(selected && Number(selected.quantity) > 0);
                    const isPerHour = Boolean(resource.isComplex) || resource.priceType === 'per_hour';
                    const hasFreeFirstHour = isPerHour && Number(resource.freeMinutes || 0) >= 60;
                    const unavailable = Number(resource.available || 0) <= 0;
                    const requestedTooMuch = selected && Number(selected.quantity || 0) > Number(resource.available || 0);
                    const resourceConflict = Boolean(selected) && !isPerHour && (unavailable || requestedTooMuch);
                    let factorHint = '';
                    if (resource.priceType === 'per_person') factorHint = `×${quantityPersons} pers.`;
                    else if (resource.priceType === 'per_night') factorHint = `×${quantityNights} j.`;
                    else if (resource.priceType === 'per_person_per_night') factorHint = `×${quantityPersons} pers. ×${quantityNights} j.`;
                    return (
                      <Card
                        key={resource.id}
                        variant="outlined"
                        sx={{
                          borderColor: resourceConflict
                            ? 'error.main'
                            : unavailable
                              ? 'grey.400'
                              : enabled
                                ? '#1565c0'
                                : 'divider',
                          bgcolor: '#fff',
                          opacity: unavailable ? 0.72 : 1,
                          boxShadow: enabled && !resourceConflict ? '0 0 0 1px rgba(21, 101, 192, 0.12)' : 'none',
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                        }}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-start' }, justifyContent: 'space-between' }}>
                            <Box flex={1}>
                              <Typography sx={{ fontWeight: 600 }}>{resource.name}</Typography>
                              <Typography variant="body2" color={resourceConflict ? 'error.main' : 'text.secondary'}>
                                {unavailable
                                  ? 'Déjà réservée'
                                  : `${resource.price}€ ${PRICE_TYPE_LABELS[resource.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}${!isPerHour ? ` • ${resource.available} dispo` : ''}`}
                              </Typography>
                              {hasFreeFirstHour && (
                                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                                  1ère heure offerte pour ce logement
                                </Typography>
                              )}
                            </Box>
                            <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
                              <FormControlLabel
                                sx={{ m: 0 }}
                                control={<Switch checked={enabled} onChange={(e) => setResourceEnabled(resource.id, e.target.checked)} disabled={unavailable} />}
                                label={unavailable ? 'Indispo' : ''}
                              />
                            </Stack>
                          </Stack>

                          {enabled && (
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                              <TextField
                                size="small"
                                type="number"
                                label={isPerHour ? 'Heures' : 'Qté'}
                                value={selected ? toDisplayedQuantity(selected.quantity, resource.priceType) : getQuantityMultiplier(resource.priceType)}
                                onChange={(e) => setResourceQuantity(resource.id, toBaseQuantity(e.target.value, resource.priceType))}
                                error={resourceConflict}
                                helperText={resourceConflict ? 'Ressource non dispo sur ces dates' : (isPerHour ? 'La quantité correspond au nombre d\'heures.' : '')}
                                sx={{ width: { xs: '100%', sm: 'auto' } }}
                                slotProps={{
                                  htmlInput: isPerHour
                                    ? { min: 1, step: 1 }
                                    : { min: 1, max: (resource.available || 0) * getQuantityMultiplier(resource.priceType) }
                                }}
                              />
                              <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', justifyContent: 'flex-end' }}>
                                {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                                    Small Switch + Tooltip pattern, mirrors the option block above. Hidden
                                    on platform reservations
                                    (specs/force-extras-complement-on-platform.md §3 rule 4). */}
                                {!isPlatformReservation && (
                                  <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                                    <FormControlLabel
                                      sx={{ m: 0 }}
                                      control={
                                        <Switch
                                          size="small"
                                          slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                                          checked={Boolean(selected?.inComplement)}
                                          onChange={(e) => setResourceInComplement(resource.id, e.target.checked)}
                                        />
                                      }
                                    />
                                  </Tooltip>
                                )}
                                <Chip
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                  label={`Total: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                                />
                              </Stack>
                            </Stack>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
