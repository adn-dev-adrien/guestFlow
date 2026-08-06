import React from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Divider, Button, TextField, Chip,
  FormControlLabel, Switch, Tooltip, MenuItem, IconButton
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArithmeticTextField from '../ArithmeticTextField';
import QuantityField from '../QuantityField';
import { useReservationForm } from './ReservationFormContext';
import { enumerateStayDates, timeOptions, toMinutes, minutesToTime } from '../../utils/resourceSessions';
import { formatCurrency } from '../../utils/formatters';
import OptionRow from './OptionRow';
import OptionCategorySection from './OptionCategorySection';
import { COMPLEMENT_TOOLTIP, PRICE_TYPE_LABELS } from './extrasLabels';

// French day-of-week + date label for an occurrence row (e.g. « lun. 7 juil. »).
function occurrenceDateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso || '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Session editor for an hourly-scheduled resource (specs/resource-hourly-scheduling.md §3.2). Lets the
 * operator add several sessions (date within the stay + start/end, slot-stepped) priced server-side from
 * the time-banded grid. Replaces the plain « Heures » quantity field for these resources.
 */
function ResourceSessions({ resource }) {
  const { form, setResourceSessions, isReservationLocked } = useReservationForm();
  const selected = form.selectedResources.find((sr) => sr.resourceId === resource.id);
  const sessions = Array.isArray(selected?.sessions) ? selected.sessions : [];
  const days = enumerateStayDates(form.startDate, form.endDate);
  const times = timeOptions(resource.openTime, resource.closeTime, resource.slotDuration);
  const minMinutes = Math.max(0, Number(resource.minimumUsageMinutes || 0));
  const slot = Math.max(1, Number(resource.slotDuration || 30));
  // The mandatory first whole hour: the minimum gap between start and end (≥ 1 h).
  const firstDur = minMinutes > 0 ? minMinutes : 60;
  const closeMin = toMinutes(resource.closeTime || '22:00');
  // End of a session given its start: start + the first whole hour, clamped to the closing time.
  const endForStart = (start) => minutesToTime(Math.min(closeMin, toMinutes(start) + firstDur));

  const dateLabel = (iso) => occurrenceDateLabel(iso);
  const updateSession = (idx, patch) => setResourceSessions(resource.id, sessions.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const removeSession = (idx) => setResourceSessions(resource.id, sessions.filter((_, i) => i !== idx));
  // Picking a start auto-sets the end to start + 1 h (the first whole hour).
  const setStart = (idx, start) => updateSession(idx, { start, end: endForStart(start) });
  const addSession = () => {
    const date = days[0] || form.startDate;
    const start = (times[0]) || resource.openTime || '12:00';
    setResourceSessions(resource.id, [...sessions, { date, start, end: endForStart(start) }]);
  };
  const isInvalid = (s) => {
    const dur = toMinutes(s.end) - toMinutes(s.start);
    return dur <= 0 || (minMinutes > 0 && dur < minMinutes);
  };

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>Séances</Typography>
        <Typography variant="caption" color="text.secondary">{resource.openTime}–{resource.closeTime} • pas {slot} min</Typography>
      </Stack>
      <Stack spacing={1}>
        {sessions.length === 0 && (
          <Typography variant="caption" color="text.secondary">Aucune séance — ajoutez-en une.</Typography>
        )}
        {sessions.map((s, idx) => (
          <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              select size="small" label="Jour" value={days.includes(s.date) ? s.date : ''}
              onChange={(e) => updateSession(idx, { date: e.target.value })}
              disabled={isReservationLocked} sx={{ minWidth: 150 }}
            >
              {days.map((d) => <MenuItem key={d} value={d} sx={{ textTransform: 'capitalize' }}>{dateLabel(d)}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Début" value={times.includes(s.start) ? s.start : ''}
              onChange={(e) => setStart(idx, e.target.value)}
              disabled={isReservationLocked} sx={{ width: 110 }}
            >
              {/* A start that can't fit the first whole hour before closing is disabled. */}
              {times.map((t) => <MenuItem key={t} value={t} disabled={toMinutes(t) + firstDur > closeMin}>{t}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Fin" value={times.includes(s.end) ? s.end : ''}
              onChange={(e) => updateSession(idx, { end: e.target.value })}
              error={isInvalid(s)}
              helperText={isInvalid(s) ? `min. ${Math.round(minMinutes / 60 * 10) / 10} h` : ''}
              disabled={isReservationLocked} sx={{ width: 110 }}
            >
              {/* End options before « début + 1 h » are greyed out; the Select opens centred on the
                  current value (MUI scrolls the selected item into view). */}
              {times.map((t) => <MenuItem key={t} value={t} disabled={toMinutes(t) < toMinutes(s.start) + firstDur}>{t}</MenuItem>)}
            </TextField>
            <IconButton size="small" color="error" onClick={() => removeSession(idx)} disabled={isReservationLocked} aria-label="Retirer la séance">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={addSession} disabled={isReservationLocked || days.length === 0} sx={{ alignSelf: 'flex-start' }}>
          Ajouter une séance
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Options et ressources card: catalog options (incl. auto-timed), custom options, and resource pickers.
 * Reads everything from the reservation form context — no props.
 */
export default function ExtrasSection() {
  const {
    formSectionCardSx, lockedSectionSx, formSectionContentSx,
    form, propertyOptions, propertyOptionGroups, displayableResources,
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setResourceEnabled, setResourceQuantity,
    addCustomOption, updateCustomOption, removeCustomOption, isReservationLocked,
    setResourceInComplement,
    bedLinenForcedOptionIds,
  } = useReservationForm();
  // specs/force-extras-complement-on-platform.md §3: non-direct platforms DEFAULT every operator-added
  // extra into Complément, but the per-line "Compl." toggle stays available so a line can be pulled
  // back out (rule 1bis). A muted caption explains the default. Only engine-derived auto-options keep
  // their toggle hidden — their routing is the algorithm's, not the operator's (rule 5).
  const isPlatformReservation = Boolean(form?.platform) && String(form.platform).toLowerCase() !== 'direct';
  // A freshly-added line carries no explicit `inComplement` flag yet; on a platform reservation it
  // defaults INTO Complément, so the toggle must read ON until the operator flips it.
  const complementChecked = (value) => (value == null ? isPlatformReservation : Boolean(value));
  // Internal-only options (specs/laundry-bath-mat.md §3 rule 11, e.g. the bath-mat option) are
  // never shown as selectable extras on the fiche — they're managed globally and counted in the
  // laundry/stock only. `displayToClient` absent → visible (back-compat).
  const visiblePropertyOptions = (propertyOptions || [])
    .filter((o) => Number(o.displayToClient == null ? 1 : o.displayToClient) !== 0);
  // Server-computed grouping (specs/option-categories.md §3 rule 4). Falls back to the flat list
  // when the payload predates the feature, so an older cached property detail still renders.
  const ungroupedOptions = propertyOptionGroups?.ungrouped || visiblePropertyOptions;
  const optionGroups = propertyOptionGroups?.groups || [];
  // "Enabled" here mirrors OptionRow's own rule: an explicit quantity, or a bed-linen option forced
  // on by a property default (specs/bed-config-in-linen-card.md §3 rule 4.bis).
  const isOptionEnabled = (opt) => {
    const selected = form.selectedOptions.find((so) => so.optionId === opt.id);
    return Boolean(selected && Number(selected.quantity) > 0) || Boolean(bedLinenForcedOptionIds?.has(opt.id));
  };

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="sectionHeader" sx={{ mb: 2 }}>Options et ressources</Typography>
        {isPlatformReservation && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontStyle: 'italic' }}>
            Réservation plateforme — les extras sont placés en paiement complémentaire par défaut (modifiable par ligne).
          </Typography>
        )}
        <Stack spacing={2}>
          {visiblePropertyOptions.length > 0 && (
            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1.5 }}>Options</Typography>
              <Stack spacing={1.25}>
                {ungroupedOptions.map((opt) => <OptionRow key={opt.id} opt={opt} />)}
              </Stack>
              {/* Categories (specs/option-categories.md §3 rules 7-11): collapsed sections after the
                  flat list. The enabled/remaining split is the only client-side derivation here —
                  it reads the operator's CURRENT, unsaved selection, which by definition can't come
                  from the server. Membership and order do come from the server (`optionGroups`). */}
              {optionGroups.length > 0 && (
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {optionGroups.map((group) => {
                    const enabled = group.options.filter((o) => isOptionEnabled(o));
                    const remaining = group.options.filter((o) => !isOptionEnabled(o));
                    return (
                      <OptionCategorySection
                        key={group.category}
                        category={group.category}
                        enabled={enabled}
                        remaining={remaining}
                      />
                    );
                  })}
                </Stack>
              )}
            </Box>
          )}

          <>
            {visiblePropertyOptions.length > 0 && <Divider />}
            <Box>
              <Stack direction="row" sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem' }}>Options personnalisées</Typography>
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
                    <Card key={line.customKey} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack spacing={1.25}>
                          <TextField
                            size="small"
                            label="Description"
                            value={line.description || ''}
                            onChange={(e) => updateCustomOption(line.customKey, { description: e.target.value })}
                            fullWidth
                          />
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
                            {/* ArithmeticTextField (specs/reservation-price-arithmetic.md): text input
                                that accepts the French comma (« 12,5 ») and commits on Enter/blur. A
                                type="number" here turned « 12, » into an empty value → amount 0 → the
                                live recompute dropped the line entirely (bug 2026-07-20). */}
                            <ArithmeticTextField
                              size="small"
                              label="Prix TTC"
                              value={line.amount ?? 0}
                              onCommit={(v) => updateCustomOption(line.customKey, { amount: v === '' ? 0 : v })}
                              sx={{ width: { xs: '100%', sm: 180 } }}
                            />
                            {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                                Small Switch + Tooltip pattern — see comment on the regular-option block
                                above. On platform reservations it defaults ON but stays editable
                                (specs/force-extras-complement-on-platform.md §3 rule 1bis). */}
                            <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                              <FormControlLabel
                                sx={{ m: 0 }}
                                control={
                                  <Switch
                                    size="small"
                                    slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                                    checked={complementChecked(line.inComplement)}
                                    onChange={(e) => updateCustomOption(line.customKey, { inComplement: e.target.checked })}
                                  />
                                }
                                label={<Typography variant="caption" sx={{ color: 'text.secondary' }}>Compl.</Typography>}
                              />
                            </Tooltip>
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
              {visiblePropertyOptions.length > 0 && <Divider />}
              <Box>
                <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem' }} gutterBottom>Ressources</Typography>
                <Stack spacing={1.25}>
                  {displayableResources.map(resource => {
                    const selected = form.selectedResources.find(sr => sr.resourceId === resource.id);
                    const enabled = Boolean(selected && Number(selected.quantity) > 0);
                    const isPerHour = Boolean(resource.isComplex) || resource.priceType === 'per_hour';
                    const isHourlyScheduled = Boolean(resource.showsPlanningCard) && resource.priceType === 'per_hour';
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
                        sx={(t) => ({
                          borderColor: resourceConflict
                            ? 'error.main'
                            : unavailable
                              ? 'grey.400'
                              : enabled
                                ? 'info.main'
                                : 'divider',
                          bgcolor: 'background.paper',
                          opacity: unavailable ? 0.72 : 1,
                          boxShadow: enabled && !resourceConflict ? `0 0 0 1px ${alpha(t.palette.info.main, 0.12)}` : 'none',
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                        })}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-start' }, justifyContent: 'space-between' }}>
                            <Box flex={1}>
                              <Typography sx={{ fontWeight: 600 }}>{resource.name}</Typography>
                              <Typography variant="body2" color={resourceConflict ? 'error.main' : 'text.secondary'}>
                                {unavailable
                                  ? 'Déjà réservée'
                                  : `${formatCurrency(resource.price)} ${PRICE_TYPE_LABELS[resource.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}${!isPerHour ? ` • ${resource.available} dispo` : ''}`}
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

                          {/* Same layout as the option card (uniform): the [Qté | spacer] + [Compl + Total]
                              row first, then — for an hourly resource — the session editor below (mirrors
                              the option's occurrence checklist placement). */}
                          {enabled && (
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                              {isHourlyScheduled ? (
                                <Box sx={{ flex: 1 }} />
                              ) : (
                                <QuantityField
                                  size="small"
                                  label={isPerHour ? 'Heures' : 'Qté'}
                                  min={1}
                                  max={isPerHour ? undefined : (resource.available || 0) * getQuantityMultiplier(resource.priceType)}
                                  value={selected ? toDisplayedQuantity(selected.quantity, resource.priceType) : getQuantityMultiplier(resource.priceType)}
                                  onCommit={(v) => setResourceQuantity(resource.id, toBaseQuantity(v, resource.priceType))}
                                  error={resourceConflict}
                                  helperText={resourceConflict ? 'Ressource non dispo sur ces dates' : (isPerHour ? 'La quantité correspond au nombre d\'heures.' : '')}
                                  disabled={isReservationLocked}
                                  sx={{ width: { xs: '100%', sm: 200 } }}
                                />
                              )}
                              <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', justifyContent: 'flex-end' }}>
                                {/* Force-to-complement override (spec force-item-to-complement.md §6.4).
                                    Small Switch + Tooltip pattern, mirrors the option block above. On
                                    platform reservations it defaults ON but stays editable
                                    (specs/force-extras-complement-on-platform.md §3 rule 1bis). */}
                                <Tooltip title={COMPLEMENT_TOOLTIP} arrow>
                                  <FormControlLabel
                                    sx={{ m: 0 }}
                                    control={
                                      <Switch
                                        size="small"
                                        slotProps={{ input: { 'aria-label': 'Forcer en complément' } }}
                                        checked={complementChecked(selected?.inComplement)}
                                        onChange={(e) => setResourceInComplement(resource.id, e.target.checked)}
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

                          {enabled && isHourlyScheduled && <ResourceSessions resource={resource} />}
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
