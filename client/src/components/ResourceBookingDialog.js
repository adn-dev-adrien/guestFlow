import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, TextField, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Checkbox, Typography, Divider, Switch, Autocomplete,
} from '@mui/material';
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

function generateTimeSlots(openTime, closeTime, slotDuration) {
  const open = timeToMinutes(openTime);
  const close = timeToMinutes(closeTime);
  const slots = [];
  for (let m = open; m < close; m += slotDuration) {
    slots.push(minutesToTime(m));
  }
  return slots;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
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
  const slotDuration = resource?.slotDuration || 60;
  const openTime = resource?.openTime || '08:00';
  const closeTime = resource?.closeTime || '22:00';
  const timeSlots = generateTimeSlots(openTime, closeTime, slotDuration);

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [numSlots, setNumSlots] = useState(1);
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

  // Derived
  const startMinutes = timeToMinutes(startTime || openTime);
  const maxSlots = Math.max(1, Math.floor((timeToMinutes(closeTime) - startMinutes) / slotDuration));
  const endMinutes = startMinutes + Math.min(numSlots, maxSlots) * slotDuration;
  const endTime = minutesToTime(endMinutes);
  const durationMinutes = Math.min(numSlots, maxSlots) * slotDuration;

  // Price calculation: resource price is per hour, pro-rated
  const totalPrice = resource?.priceType === 'per_hour' || resource?.priceType === 'free'
    ? (resource.priceType === 'free' ? 0 : (resource.price || 0) * durationMinutes / 60)
    : (resource?.price || 0); // per_stay = fixed price regardless

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
      setStartTime(booking.startTime || openTime);
      const dur = timeToMinutes(booking.endTime || closeTime) - timeToMinutes(booking.startTime || openTime);
      setNumSlots(Math.max(1, Math.round(dur / slotDuration)));
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
      setStartTime(initialTime || timeSlots[0] || openTime);
      setNumSlots(1);
      setNotes('');
      setPaid(false);
      setPropertyId('');
      setExternalMode(true);
      setClientName('');
      setClientPhone('');
      setSelectedClient(null);
    }
  }, [booking, initialDate, initialTime, open]); // eslint-disable-line

  async function handleSave() {
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

  const canSave = Boolean(date && startTime && numSlots > 0 && (externalMode ? clientName.trim() : selectedClient));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{booking ? 'Modifier la réservation' : 'Nouvelle réservation'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {/* Resource info */}
          <Typography variant="body2" color="text.secondary">
            {resource?.name} · Ouvert {openTime}–{closeTime} · Créneaux {formatDuration(slotDuration)}
          </Typography>

          <Divider />

          {/* Date */}
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />

          {/* Start time */}
          <FormControl fullWidth>
            <InputLabel>Heure de début</InputLabel>
            <Select
              value={timeSlots.includes(startTime) ? startTime : (timeSlots[0] || '')}
              label="Heure de début"
              onChange={(e) => { setStartTime(e.target.value); setNumSlots(1); }}
            >
              {timeSlots.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Number of slots */}
          <FormControl fullWidth>
            <InputLabel>Durée</InputLabel>
            <Select
              value={Math.min(numSlots, maxSlots)}
              label="Durée"
              onChange={(e) => setNumSlots(Number(e.target.value))}
            >
              {Array.from({ length: maxSlots }, (_, i) => i + 1).map((n) => {
                const endM = startMinutes + n * slotDuration;
                return (
                  <MenuItem key={n} value={n}>
                    {formatDuration(n * slotDuration)} → {minutesToTime(endM)}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>

          <Typography variant="body2" sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 1.5, py: 0.75 }}>
            Créneau : <strong>{startTime} → {endTime}</strong>
            {totalPrice > 0 && <> &nbsp;·&nbsp; Prix : <strong>{totalPrice.toFixed(2)} €</strong></>}
          </Typography>

          <Divider />

          {/* Client toggle */}
          <FormControlLabel
            control={<Switch checked={!externalMode} onChange={(e) => setExternalMode(!e.target.checked)} />}
            label="Client enregistré dans l'application"
          />

          {externalMode ? (
            <>
              <TextField
                label="Nom du client *"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                fullWidth
              />
              <TextField
                label="Téléphone"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                fullWidth
              />
            </>
          ) : (
            <Autocomplete
              options={clients}
              getOptionLabel={(c) => `${c.firstName || ''} ${c.lastName || ''}`.trim()}
              value={selectedClient}
              onChange={(_, v) => setSelectedClient(v)}
              renderInput={(params) => <TextField {...params} label="Client *" />}
              isOptionEqualToValue={(o, v) => o.id === v?.id}
            />
          )}

          {/* Property (optional) */}
          <FormControl fullWidth>
            <InputLabel>Logement (optionnel)</InputLabel>
            <Select
              value={propertyId}
              label="Logement (optionnel)"
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <MenuItem value="">— Aucun (client externe) —</MenuItem>
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
          />

          {/* Paid */}
          <FormControlLabel
            control={<Checkbox checked={paid} onChange={(e) => setPaid(e.target.checked)} />}
            label="Payé"
          />
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
