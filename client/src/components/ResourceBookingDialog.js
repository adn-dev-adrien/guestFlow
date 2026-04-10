import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, TextField, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Checkbox, Typography, Divider, Switch, Autocomplete
} from '@mui/material';
import MiniDayPlanner from './MiniDayPlanner';
import api from '../api';

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
  const openTime = resource?.openTime || '08:00';
  const closeTime = resource?.closeTime || '22:00';

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

  function isStartOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedEnd && mins >= timeToMinutes(selectedEnd)) return true;
    if (selectedEnd) return !isSlotAvailable(time, selectedEnd, occupiedSlots);
    return occupiedSlots.some((occupied) => {
      const occupiedStart = timeToMinutes(occupied.startTime);
      const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
      return mins >= occupiedStart && mins < occupiedEnd;
    });
  }

  function isEndOptionDisabled(time) {
    const mins = timeToMinutes(time);
    if (selectedStart && mins <= timeToMinutes(selectedStart)) return true;
    if (selectedStart) return !isSlotAvailable(selectedStart, time, occupiedSlots);
    return occupiedSlots.some((occupied) => {
      const occupiedStart = timeToMinutes(occupied.startTime);
      const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
      return mins > occupiedStart && mins < occupiedEnd;
    });
  }

  // Price calculation: resource price is per hour, pro-rated
  const totalPrice = resource?.priceType === 'per_hour' || resource?.priceType === 'free'
    ? (resource.priceType === 'free' ? 0 : (resource.price || 0) * durationMinutes / 60)
    : (resource?.price || 0); // per_stay = fixed price regardless

  // Check if current selection has conflicts
  const slotAvailable = useMemo(() => {
    if (!date || !selectedStart || !selectedEnd) return true;
    return isSlotAvailable(selectedStart, selectedEnd, occupiedSlots);
  }, [date, selectedStart, selectedEnd, occupiedSlots]);

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
      setDate(initialDate || new Date().toISOString().split('T')[0]);
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
    if (!slotAvailable || !selectedStart || !selectedEnd || !isChronological) return; // Block save if invalid
    setSaving(true);
    try {
      const data = {
        date,
        startTime,
        endTime,
        notes,
        paid,
        propertyId: propertyId || null,
        totalPrice,
        ...(externalMode
          ? { clientId: null, clientName: clientName.trim() || null, clientPhone: clientPhone.trim() || null }
          : { clientId: selectedClient?.id || null, clientName: null, clientPhone: null }),
      };
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(
    date
    && selectedStart
    && selectedEnd
    && isChronological
    && (externalMode ? clientName.trim() : selectedClient)
    && slotAvailable
  );


  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {booking ? 'Modifier la réservation' : 'Nouvelle réservation'}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
          {resource?.name} · {openTime}–{closeTime}{turnoverMinutes > 0 ? ` · Remise en état ${turnoverMinutes} min` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        {/* Two-column layout: planning left, form right */}
        <Box sx={{ display: 'flex', gap: 2.5, flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'flex-start' }}>

          {/* LEFT: date picker + day planner */}
          <Box sx={{ flex: '0 0 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedStart(''); setSelectedEnd(''); }}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
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
              disabled={false}
            />
          </Box>

          {/* RIGHT: client + form */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Selected slot summary */}
            {selectedStart && selectedEnd && (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: slotAvailable ? '#e8f5e9' : '#ffebee', borderLeft: `3px solid ${slotAvailable ? '#4caf50' : '#f44336'}` }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {selectedStart} → {selectedEnd} · {formatDuration(durationMinutes)}
                  {totalPrice > 0 && <> · {totalPrice.toFixed(2)} €</>}
                </Typography>
                {!slotAvailable && (
                  <Typography variant="caption" color="error.main">Chevauche une réservation ou une remise en état</Typography>
                )}
              </Box>
            )}

            {!selectedStart && (
              <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">
                  Sélectionnez un créneau dans le planning
                </Typography>
              </Box>
            )}

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

            {selectedStart && selectedEnd && !isChronological && (
              <Typography variant="caption" color="error.main">
                L'heure de fin doit être après l'heure de début.
              </Typography>
            )}

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
      </DialogContent>
      <DialogActions>
        {booking && (
          <Button color="error" onClick={() => onDelete(booking.id)} disabled={saving}>
            Supprimer
          </Button>
        )}
        <Button onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
