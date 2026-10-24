import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Alert, TextField, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Checkbox, Typography, Divider, Switch, Autocomplete, LinearProgress, useMediaQuery, useTheme,
} from '@mui/material';
import MiniDayPlanner from './MiniDayPlanner';
import { api, formatCurrency } from '../sdk';
import resourceBookingDraft from './resourceBookingDraft';
import useResourceBookingPreview from './useResourceBookingPreview';
import { localIsoDate } from './localDate';

function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// Check if a time slot range overlaps with any occupied slots (including turnover)
function isSlotAvailable(slotStart, slotEnd, occupiedSlots) {
  return !occupiedSlots.some(occupied => {
    const occupiedStart = timeToMinutes(occupied.startTime);
    const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
    const newStart = timeToMinutes(slotStart);
    const newEnd = timeToMinutes(slotEnd);
    const newEndWithTurnover = newEnd + (occupied.turnover || 0);
    return newStart < occupiedEnd && newEndWithTurnover > occupiedStart;
  });
}

const BOOKING_STEP_MINUTES = 5;

// Wording only: every figure and minute count below is a field of the server's answer.
function offeredBilledLabel(price) {
  const offered = price.freeMinutesApplied;
  const billed = price.billedMinutes;
  return `${formatDuration(offered)} offert${offered > 1 && offered !== 60 ? 'es' : 'e'} · ${formatDuration(billed)} facturé${billed > 1 && billed !== 60 ? 'es' : 'e'}`;
}

const BAND_LABELS = { day: 'jour', evening: 'soir' };
function bandsLabel(bands) {
  return bands.map((b) => `${BAND_LABELS[b.band] || b.band} ${formatCurrency(b.amount)}`).join(' · ');
}

export default function ResourceBookingDialog({
  open,
  resource,
  initialDate,
  initialTime,
  booking,
  onClose,
  onSave,
  onDelete,
}) {
  const slotDuration = resource?.slotDuration || 5;
  const turnoverMinutes = Number(resource?.turnoverMinutes || 0);
  const minimumUsageMinutes = Number(resource?.minimumUsageMinutes || 0);
  const isHourlyResource = Boolean(resource?.isComplex) || resource?.priceType === 'per_hour';
  const openTime = resource?.openTime || '08:00';
  const closeTime = resource?.closeTime || '22:00';
  const minimumDurationMinutes = Math.max(
    isHourlyResource ? slotDuration : 0,
    isHourlyResource ? minimumUsageMinutes : 0,
    BOOKING_STEP_MINUTES,
  );

  // Full screen on a phone, like every dialog (specs/ds-components.md rule 22).
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [date, setDate] = useState('');
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [externalMode, setExternalMode] = useState(true);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [propertyId, setPropertyId] = useState('');
  const [properties, setProperties] = useState([]);
  const [notes, setNotes] = useState('');
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedWarning, setSavedWarning] = useState(null);
  const [occupiedSlots, setOccupiedSlots] = useState([]);

  const openMinutes = timeToMinutes(openTime);
  const closeMinutes = timeToMinutes(closeTime);

  const timeOptions = useMemo(() => {
    const options = [];
    for (let m = openMinutes; m <= closeMinutes; m += BOOKING_STEP_MINUTES) {
      options.push(minutesToTime(m));
    }
    return options;
  }, [openMinutes, closeMinutes]);

  const endTimeOptions = useMemo(() => {
    if (!selectedStart) return [];
    const selectedStartMinutes = timeToMinutes(selectedStart);
    return timeOptions.filter((time) => timeToMinutes(time) >= selectedStartMinutes);
  }, [selectedStart, timeOptions]);

  // Derived
  const startTime = selectedStart;
  const endTime = selectedEnd;
  const durationMinutes = selectedStart && selectedEnd
    ? timeToMinutes(selectedEnd) - timeToMinutes(selectedStart)
    : 0;
  const isChronological = selectedStart && selectedEnd
    ? timeToMinutes(selectedEnd) > timeToMinutes(selectedStart)
    : true;
  const meetsMinimumDuration = selectedStart && selectedEnd
    ? durationMinutes >= minimumDurationMinutes
    : true;

  function isStartOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedEnd && mins >= timeToMinutes(selectedEnd)) return true;
    if (selectedEnd) return !isSlotAvailable(time, selectedEnd, occupiedSlots);
    const candidateEnd = minutesToTime(Math.min(closeMinutes, mins + minimumDurationMinutes));
    if ((mins + minimumDurationMinutes) > closeMinutes) return true;
    return !isSlotAvailable(time, candidateEnd, occupiedSlots);
  }

  function isEndOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedStart && mins <= timeToMinutes(selectedStart)) return true;
    if (selectedStart && (mins - timeToMinutes(selectedStart)) < minimumDurationMinutes) return true;
    if (selectedStart) return !isSlotAvailable(selectedStart, time, occupiedSlots);
    return occupiedSlots.some((occupied) => {
      const occupiedStart = timeToMinutes(occupied.startTime);
      const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
      return mins > occupiedStart && mins < occupiedEnd;
    });
  }

  // The price is the server's: the draft below is all the dialog sends, and the answer is rendered as is
  // (specs/resource-supplements-total-server-side.md rules 8-14).
  const draft = useMemo(() => resourceBookingDraft({
    resourceId: resource?.id, bookingId: booking?.id, date, startTime: selectedStart, endTime: selectedEnd, propertyId,
  }), [resource?.id, booking?.id, date, selectedStart, selectedEnd, propertyId]);
  const preview = useResourceBookingPreview({ draft, enabled: open });
  const price = preview.price;

  // Check if current selection has conflicts
  const slotAvailable = useMemo(() => {
    if (!date || !selectedStart || !selectedEnd) return true;
    return meetsMinimumDuration && isSlotAvailable(selectedStart, selectedEnd, occupiedSlots);
  }, [date, selectedStart, selectedEnd, occupiedSlots, meetsMinimumDuration]);

  // Load occupied slots when date changes
  useEffect(() => {
    if (!open || !date || !resource?.id) return;
    api.getOccupiedSlots(resource.id, date)
      .then((result) => {
        const slots = result.occupiedSlots || [];
        const filtered = booking?.id ? slots.filter((slot) => Number(slot.id) !== Number(booking.id)) : slots;
        setOccupiedSlots(filtered);
      })
      .catch(() => setOccupiedSlots([]));
  }, [open, date, resource?.id, booking?.id]);

  useEffect(() => {
    if (open) {
      api.getClients().then(setClients).catch(() => {});
      api.getProperties().then(setProperties).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSavedWarning(null);
    if (booking) {
      setDate(booking.date || '');
      setSelectedStart(booking.startTime || '');
      setSelectedEnd(booking.endTime || '');
      setNotes(booking.notes || '');
      setPaid(Boolean(booking.paid));
      setPropertyId(booking.propertyId ? String(booking.propertyId) : '');
      if (booking.clientId) {
        setExternalMode(false);
        setSelectedClient({ id: booking.clientId, firstName: booking.firstName || '', lastName: booking.lastName || '' });
      } else {
        setExternalMode(true);
        setClientName(booking.clientName || '');
        setClientPhone(booking.clientPhone || '');
        setSelectedClient(null);
      }
    } else {
      setDate(initialDate || localIsoDate());
      setSelectedStart('');
      setSelectedEnd('');
      setNotes('');
      setPaid(false);
      setPropertyId('');
      setExternalMode(true);
      setClientName('');
      setClientPhone('');
      setSelectedClient(null);
    }
  }, [booking, initialDate, open]); // eslint-disable-line

  // Handle MiniDayPlanner time selection
  const handleTimeSelect = (time, type) => {
    if (type === 'start') {
      setSelectedStart(time);
      setSelectedEnd(''); // Reset end when changing start
    } else if (type === 'end') {
      setSelectedEnd(time);
    }
  };

  async function handleSave() {
    if (!slotAvailable || !selectedStart || !selectedEnd || !isChronological || !meetsMinimumDuration) return; // Block save if invalid
    setSaving(true);
    try {
      const data = {
        date,
        startTime,
        endTime,
        notes,
        paid,
        propertyId: propertyId || null,
        displayedTotal: price ? price.total : undefined,
        ...(externalMode
          ? { clientId: null, clientName: clientName.trim() || null, clientPhone: clientPhone.trim() || null }
          : { clientId: selectedClient?.id || null, clientName: null, clientPhone: null }),
      };
      const saved = await onSave(data);
      if (saved?.warning) setSavedWarning(saved.warning);
      else if (saved) onClose();
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(
    date
    && selectedStart
    && selectedEnd
    && isChronological
    && meetsMinimumDuration
    && (externalMode ? clientName.trim() : selectedClient)
    && slotAvailable
  );
  const shownPrice = draft ? price : null;
  const showRefusal = Boolean(draft && preview.refusal && !preview.pending);
  const showUnavailable = Boolean(draft && preview.error && !preview.pending);


  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {booking ? 'Modifier la réservation' : 'Nouvelle réservation'}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
          {resource?.name} · {openTime}–{closeTime}{minimumDurationMinutes > 0 ? ` · Min ${minimumDurationMinutes} min` : ''}{turnoverMinutes > 0 ? ` · Remise en état ${turnoverMinutes} min` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        {savedWarning ? (
          <Alert severity="warning" role="status">
            Enregistré à {formatCurrency(savedWarning.stored)} — l'aperçu affichait {formatCurrency(savedWarning.displayed)}.
          </Alert>
        ) : (
        /* Planning left; on a phone the price summary comes first and stays in view while the planner is tapped */
        <Box
          sx={{
            display: 'grid',
            columnGap: 2.5,
            rowGap: 2,
            alignItems: 'start',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '240px minmax(0, 1fr)' },
            gridTemplateAreas: { xs: '"summary" "left" "form"', sm: '"left summary" "left form"' },
            gridTemplateRows: { sm: 'auto 1fr' },
          }}
        >

          {/* LEFT: date picker + day planner */}
          <Box sx={{ gridArea: 'left', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedStart(''); setSelectedEnd(''); }}
              fullWidth
              size="small"
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
            <MiniDayPlanner
              date={date}
              occupiedSlots={occupiedSlots}
              selectedStart={selectedStart}
              selectedEnd={selectedEnd}
              onTimeSelect={handleTimeSelect}
              openTime={openTime}
              closeTime={closeTime}
              slotDuration={BOOKING_STEP_MINUTES}
              minimumDuration={minimumDurationMinutes}
              disabled={false}
            />
          </Box>

          {/* Price summary — every figure is the server's answer */}
          <Box
            sx={{
              gridArea: 'summary',
              minWidth: 0,
              position: { xs: 'sticky', sm: 'static' },
              top: 0,
              zIndex: 2,
              bgcolor: 'background.paper',
            }}
          >
            {selectedStart && selectedEnd ? (
              <Box
                aria-busy={preview.pending}
                sx={{
                  position: 'relative', overflow: 'hidden', minHeight: 64,
                  px: 1.5, py: 1, borderRadius: 1,
                  bgcolor: slotAvailable && !showRefusal ? '#e8f5e9' : '#ffebee',
                  borderLeft: `3px solid ${slotAvailable && !showRefusal ? '#4caf50' : '#f44336'}`,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {selectedStart} → {selectedEnd} · {formatDuration(durationMinutes)}
                  {shownPrice && (
                    <Box
                      component="span"
                      sx={{
                        opacity: preview.pending ? 0.55 : 1,
                        transition: 'opacity 150ms ease-out',
                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                      }}
                    >
                      {' · '}{formatCurrency(shownPrice.total)}
                    </Box>
                  )}
                  {!shownPrice && draft && preview.pending && (
                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}> · Calcul du prix…</Box>
                  )}
                  {showUnavailable && (
                    <>
                      <Box component="span" sx={{ fontWeight: 400, color: 'error.main' }}> · Prix indisponible</Box>
                      <Button size="small" onClick={preview.retry} sx={{ ml: 1, minHeight: 44, minWidth: 44 }}>Réessayer</Button>
                    </>
                  )}
                </Typography>
                {shownPrice && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: 'block', fontVariantNumeric: 'tabular-nums',
                      opacity: preview.pending ? 0.55 : 1,
                    }}
                  >
                    {[
                      shownPrice.freeMinutesApplied > 0 ? offeredBilledLabel(shownPrice) : null,
                      shownPrice.pricing === 'banded' && shownPrice.bands.length > 0 ? bandsLabel(shownPrice.bands) : null,
                    ].filter(Boolean).join(' · ')}
                  </Typography>
                )}
                {showRefusal ? (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>{preview.refusal}</Typography>
                ) : (
                  <>
                    {!slotAvailable && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>Chevauche une réservation ou une remise en état</Typography>
                    )}
                    {!meetsMinimumDuration && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>Durée minimale {minimumDurationMinutes} min requise</Typography>
                    )}
                    {selectedStart && selectedEnd && !isChronological && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                        L'heure de fin doit être après l'heure de début.
                      </Typography>
                    )}
                  </>
                )}
                {draft && preview.pending && (
                  <LinearProgress
                    aria-label="Calcul du prix"
                    sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, bgcolor: 'transparent' }}
                  />
                )}
              </Box>
            ) : (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">
                  Sélectionnez un créneau dans le planning
                </Typography>
              </Box>
            )}
          </Box>

          {/* RIGHT: client + form */}
          <Box sx={{ gridArea: 'form', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.25 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Heure début</InputLabel>
                <Select
                  label="Heure début"
                  value={selectedStart}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setSelectedStart(nextStart);
                    if (selectedEnd && nextStart && timeToMinutes(selectedEnd) <= timeToMinutes(nextStart)) {
                      setSelectedEnd('');
                    }
                  }}
                >
                  <MenuItem value="">
                    <em>Choisir</em>
                  </MenuItem>
                  {timeOptions.map((time) => {
                    const disabled = isStartOptionDisabled(time);
                    return (
                      <MenuItem key={`start-${time}`} value={time} disabled={disabled} sx={disabled ? { color: 'text.disabled' } : undefined}>
                        {time}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Heure fin</InputLabel>
                <Select
                  label="Heure fin"
                  value={selectedEnd}
                  disabled={!selectedStart}
                  onChange={(e) => setSelectedEnd(e.target.value)}
                >
                  <MenuItem value="">
                    <em>Choisir</em>
                  </MenuItem>
                  {endTimeOptions.map((time) => {
                    const disabled = isEndOptionDisabled(time);
                    return (
                      <MenuItem key={`end-${time}`} value={time} disabled={disabled} sx={disabled ? { color: 'text.disabled' } : undefined}>
                        {time}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Box>

            <Divider />

            {/* Client toggle */}
            <FormControlLabel
              control={<Switch checked={!externalMode} onChange={(e) => setExternalMode(!e.target.checked)} size="small" />}
              label={<Typography variant="body2">Client enregistré</Typography>}
            />

            {externalMode ? (
              <>
                <TextField
                  label="Nom du client *"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Téléphone"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  fullWidth
                  size="small"
                />
              </>
            ) : (
              <Autocomplete
                options={clients}
                getOptionLabel={(c) => `${c.firstName || ''} ${c.lastName || ''}`.trim()}
                value={selectedClient}
                onChange={(_, v) => setSelectedClient(v)}
                renderInput={(params) => <TextField {...params} label="Client *" size="small" />}
                isOptionEqualToValue={(o, v) => o.id === v?.id}
              />
            )}

            {/* Property (optional) */}
            <FormControl fullWidth size="small">
              <InputLabel>Logement (optionnel)</InputLabel>
              <Select
                value={propertyId}
                label="Logement (optionnel)"
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <MenuItem value="">— Aucun —</MenuItem>
                {properties.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
              </Select>
            </FormControl>

            {/* Notes */}
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              multiline
              rows={2}
              size="small"
            />

            {/* Paid */}
            <FormControlLabel
              control={<Checkbox checked={paid} onChange={(e) => setPaid(e.target.checked)} size="small" />}
              label={<Typography variant="body2">Payé</Typography>}
            />
          </Box>
        </Box>
        )}
      </DialogContent>
      <DialogActions>
        {savedWarning ? (
          <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>Fermer</Button>
        ) : (
          <>
            {booking && (
              <Button color="error" onClick={() => onDelete(booking.id)} disabled={saving}>
                Supprimer
              </Button>
            )}
            <Button onClick={onClose} disabled={saving}>Annuler</Button>
            <Button variant="contained" onClick={handleSave} disabled={!canSave || !preview.fresh || saving}>
              {saving ? 'Enregistrement...' : (draft && preview.pending ?'Calcul du prix…' : 'Enregistrer')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
