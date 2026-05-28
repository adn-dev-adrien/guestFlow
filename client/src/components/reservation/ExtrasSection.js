import React from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Divider, Button, TextField, Chip,
  FormControlLabel, Switch
} from '@mui/material';
import { useReservationForm } from './ReservationFormContext';

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
  } = useReservationForm();

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Options et ressources</Typography>
        <Stack spacing={2}>
          {propertyOptions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Options</Typography>
              <Stack spacing={1.25}>
                {propertyOptions.map((opt) => {
                  const selected = form.selectedOptions.find((so) => so.optionId === opt.id);
                  const enabled = Boolean(selected && Number(selected.quantity) > 0);
                  const isAutoTimedOption = Boolean(opt.autoOptionType);
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
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'flex-start' }} justifyContent="space-between">
                          <Box flex={1}>
                            <Typography sx={{ fontWeight: 600 }}>{opt.title}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {isAutoTimedOption
                                ? `${opt.autoPricingMode === 'proportional' ? 'Prix proportionnel à la nuit' : `${opt.price}€ fixe`} • seuil nuit complète: ${opt.autoFullNightThreshold || (opt.autoOptionType === 'early_check_in' ? '10:00' : '17:00')}`
                                : `${opt.price}€ ${PRICE_TYPE_LABELS[opt.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}`}
                            </Typography>
                          </Box>
                          <Stack alignItems="flex-end" spacing={0.5}>
                            <FormControlLabel
                              sx={{ m: 0 }}
                              control={<Switch checked={enabled} disabled={isAutoTimedOption} onChange={(e) => setOptionEnabled(opt.id, e.target.checked)} />}
                            />
                            {isAutoTimedOption && (
                              <Typography variant="caption" color="text.secondary">Ajout automatique</Typography>
                            )}
                          </Stack>
                        </Stack>

                        {enabled && !isAutoTimedOption && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }} justifyContent="space-between">
                            <TextField
                              size="small"
                              type="number"
                              label="Qté"
                              value={selected ? toDisplayedQuantity(selected.quantity, opt.priceType) : getQuantityMultiplier(opt.priceType)}
                              onChange={(e) => setOptionQuantity(opt.id, toBaseQuantity(e.target.value, opt.priceType))}
                              inputProps={{ min: 1 }}
                              sx={{ width: { xs: '100%', sm: 'auto' } }}
                            />
                            <Chip
                              size="small"
                              color="primary"
                              variant="outlined"
                              label={`Total: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                              sx={{ width: { xs: '100%', sm: 'auto' } }}
                            />
                          </Stack>
                        )}

                        {enabled && isAutoTimedOption && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }} justifyContent="space-between">
                            {selected?.autoFullNightApplied
                              ? <Chip size="small" variant="outlined" label="Nuit complète appliquée" />
                              : selected?.autoExtraHours > 0
                                ? <Chip size="small" variant="outlined" label={`${Number(selected.autoExtraHours).toFixed(1).replace('.0', '')}h supplémentaire${selected.autoExtraHours >= 2 ? 's' : ''}`} />
                                : null}
                            <Chip
                              size="small"
                              color="primary"
                              variant="outlined"
                              label={`Total auto: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                              sx={{ width: { xs: '100%', sm: 'auto' } }}
                            />
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
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
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
                              inputProps={{ min: 0, step: 0.01 }}
                              sx={{ width: { xs: '100%', sm: 180 } }}
                            />
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
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'flex-start' }} justifyContent="space-between">
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
                            <Stack alignItems="flex-end" spacing={0.5}>
                              <FormControlLabel
                                sx={{ m: 0 }}
                                control={<Switch checked={enabled} onChange={(e) => setResourceEnabled(resource.id, e.target.checked)} disabled={unavailable} />}
                                label={unavailable ? 'Indispo' : ''}
                              />
                            </Stack>
                          </Stack>

                          {enabled && (
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }} justifyContent="space-between">
                              <TextField
                                size="small"
                                type="number"
                                label={isPerHour ? 'Heures' : 'Qté'}
                                value={selected ? toDisplayedQuantity(selected.quantity, resource.priceType) : getQuantityMultiplier(resource.priceType)}
                                onChange={(e) => setResourceQuantity(resource.id, toBaseQuantity(e.target.value, resource.priceType))}
                                inputProps={isPerHour
                                  ? { min: 1, step: 1 }
                                  : { min: 1, max: (resource.available || 0) * getQuantityMultiplier(resource.priceType) }}
                                error={resourceConflict}
                                helperText={resourceConflict ? 'Ressource non dispo sur ces dates' : (isPerHour ? 'La quantité correspond au nombre d\'heures.' : '')}
                                sx={{ width: { xs: '100%', sm: 'auto' } }}
                              />
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={`Total: ${(selected?.totalPrice || 0).toFixed(2)}€`}
                                sx={{ width: { xs: '100%', sm: 'auto' } }}
                              />
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
