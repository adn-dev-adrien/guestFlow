import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select,
  MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Autocomplete, Chip, Checkbox, FormControlLabel, Divider, Grid
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import api from '../api';

const PLATFORMS = ['direct', 'airbnb', 'greengo', 'abritel', 'abracadaroom', 'booking'];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

const PRICE_TYPE_LABELS = {
  per_stay: 'par séjour',
  per_person: 'par personne',
  per_night: 'par nuit',
  per_person_per_night: 'par pers./nuit',
  per_hour: 'par heure',
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Time window for proportional fill: 8h to 21h (13h range)
const DAY_START = 8;
const DAY_END = 21;
const DAY_RANGE = DAY_END - DAY_START;

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

function getReservationColor(platform) {
  const colors = {
    direct: '#1565c0', airbnb: '#FF5A5F', greengo: '#4CAF50',
    abritel: '#f57c00', abracadaroom: '#9c27b0', booking: '#003580'
  };
  return colors[platform] || '#757575';
}

const CLEANING_COLOR = '#e53935';

export default function CalendarPage() {
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [newClient, setNewClient] = useState({ lastName: '', firstName: '', email: '', phone: '', address: '', notes: '' });
  const [propertyOptions, setPropertyOptions] = useState([]);
  const [form, setForm] = useState({
    clientId: null, adults: 1, children: 0, babies: 0, platform: 'direct',
    totalPrice: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    notes: '', selectedOptions: [], checkInTime: '15:00', checkOutTime: '10:00'
  });
  const calRef = useRef(null);

  const loadProperties = async () => setProperties(await api.getProperties());

  const loadReservations = useCallback(async () => {
    if (!selectedProp) return;
    const prop = await api.getProperty(selectedProp);
    setSelectedProperty(prop);
    const from = formatDate(year, month, 1);
    const to = formatDate(year, month, getDaysInMonth(year, month));
    const data = await api.getReservations({ propertyId: selectedProp, from, to });
    setReservations(data);
  }, [selectedProp, year, month]);

  useEffect(() => { loadProperties(); }, []);
  useEffect(() => { loadReservations(); }, [loadReservations]);

  const loadClientsForSearch = async (q) => {
    const data = await api.getClients(q);
    setClients(data);
  };

  useEffect(() => { loadClientsForSearch(clientSearch); }, [clientSearch]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const adjustedFirst = (firstDayOfWeek + 6) % 7;

  const isInDragRange = (day) => {
    if (!dragStart || !dragEnd) return false;
    const min = Math.min(dragStart, dragEnd);
    const max = Math.max(dragStart, dragEnd);
    return day >= min && day <= max;
  };

  const handleMouseDown = (day) => {
    // Allow drag only on non-fully-occupied days
    const dateStr = formatDate(year, month, day);
    const midOccupied = reservations.some(r => dateStr > r.startDate && dateStr < r.endDate);
    if (midOccupied) return;
    setDragStart(day);
    setDragEnd(day);
    setIsDragging(true);
  };

  const handleMouseEnter = (day) => {
    if (isDragging) setDragEnd(day);
  };

  const handleMouseUp = async () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);
    const startDay = Math.min(dragStart, dragEnd);
    const endDay = Math.max(dragStart, dragEnd) + 1;
    const startDate = formatDate(year, month, startDay);
    const endDate = formatDate(year, month, Math.min(endDay, daysInMonth + 1));

    const prop = await api.getProperty(selectedProp);
    const opts = await api.getOptions();
    const availableOpts = opts.filter(o => (prop.optionIds || []).includes(o.id));
    setPropertyOptions(availableOpts);

    const calc = await api.calculatePrice({ propertyId: selectedProp, startDate, endDate, adults: 1, children: 0 });

    setForm({
      clientId: null, adults: 1, children: 0, babies: 0, platform: 'direct',
      totalPrice: calc.totalPrice, discountPercent: 0, finalPrice: calc.totalPrice, customPrice: '',
      depositAmount: calc.depositAmount, depositDueDate: calc.depositDueDate,
      balanceAmount: calc.balanceAmount, balanceDueDate: calc.balanceDueDate,
      notes: '', selectedOptions: [], startDate, endDate,
      checkInTime: calc.defaultCheckIn || prop.defaultCheckIn || '15:00',
      checkOutTime: calc.defaultCheckOut || prop.defaultCheckOut || '10:00'
    });
    setDialogOpen(true);
  };

  const recalcPrice = (updatedForm) => {
    const base = updatedForm.totalPrice;
    let optionsTotal = 0;
    for (const so of updatedForm.selectedOptions) {
      const opt = propertyOptions.find(o => o.id === so.optionId);
      if (!opt) continue;
      let qty = 1;
      const nights = Math.round((new Date(updatedForm.endDate) - new Date(updatedForm.startDate)) / 86400000);
      const persons = (updatedForm.adults || 1) + (updatedForm.children || 0);
      if (opt.priceType === 'per_person') qty = persons;
      else if (opt.priceType === 'per_night') qty = nights;
      else if (opt.priceType === 'per_person_per_night') qty = persons * nights;
      else if (opt.priceType === 'per_hour') qty = so.quantity || 1;
      const optTotal = opt.price * qty;
      so.quantity = qty;
      so.totalPrice = optTotal;
      optionsTotal += optTotal;
    }
    const subtotal = base + optionsTotal;
    let final;
    if (updatedForm.customPrice !== '') {
      final = Number(updatedForm.customPrice);
    } else {
      final = subtotal * (1 - (updatedForm.discountPercent || 0) / 100);
    }
    final = Math.round(final * 100) / 100;
    return { ...updatedForm, finalPrice: final };
  };

  const updateForm = (changes) => {
    setForm(prev => recalcPrice({ ...prev, ...changes }));
  };

  const toggleOption = (optionId) => {
    setForm(prev => {
      const exists = prev.selectedOptions.find(s => s.optionId === optionId);
      let newOpts;
      if (exists) {
        newOpts = prev.selectedOptions.filter(s => s.optionId !== optionId);
      } else {
        newOpts = [...prev.selectedOptions, { optionId, quantity: 1, totalPrice: 0 }];
      }
      return recalcPrice({ ...prev, selectedOptions: newOpts });
    });
  };

  const handleCreateClient = async () => {
    const c = await api.createClient(newClient);
    setForm(prev => ({ ...prev, clientId: c.id }));
    setClients(prev => [...prev, c]);
    setCreateClientOpen(false);
    setNewClient({ lastName: '', firstName: '', email: '', phone: '', address: '', notes: '' });
  };

  const handleSaveReservation = async () => {
    await api.createReservation({
      propertyId: Number(selectedProp),
      clientId: form.clientId,
      startDate: form.startDate,
      endDate: form.endDate,
      adults: form.adults,
      children: form.children,
      babies: form.babies,
      checkInTime: form.checkInTime,
      checkOutTime: form.checkOutTime,
      platform: form.platform,
      totalPrice: form.totalPrice,
      discountPercent: form.discountPercent,
      finalPrice: form.finalPrice,
      depositAmount: form.depositAmount,
      depositDueDate: form.depositDueDate,
      balanceAmount: form.balanceAmount,
      balanceDueDate: form.balanceDueDate,
      notes: form.notes,
      options: form.selectedOptions.map(so => ({
        optionId: so.optionId,
        quantity: so.quantity,
        totalPrice: so.totalPrice
      }))
    });
    setDialogOpen(false);
    setDragStart(null);
    setDragEnd(null);
    loadReservations();
  };

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const cleaningHours = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;

  // ---------- RENDER A CALENDAR CELL ----------
  const renderDayCell = (day) => {
    const dateStr = formatDate(year, month, day);
    const inDrag = isInDragRange(day);

    // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
    const departureRes = reservations.find(r => r.endDate === dateStr);
    const arrivalRes = reservations.find(r => r.startDate === dateStr);
    const midRes = reservations.find(r => dateStr > r.startDate && dateStr < r.endDate);

    // If mid-stay: full color fill
    if (midRes) {
      const color = getReservationColor(midRes.platform);
      return (
        <Box key={day} sx={{
          textAlign: 'center', py: 2, borderRadius: 1, position: 'relative',
          bgcolor: color, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
        }}>
          {day}
        </Box>
      );
    }

    // Compute departure and arrival percentages + cleaning
    const checkOutHour = departureRes ? timeToHour(departureRes.checkOutTime || '10:00') : null;
    const checkInHour = arrivalRes ? timeToHour(arrivalRes.checkInTime || '15:00') : null;

    const departPct = checkOutHour !== null ? hourToPercent(checkOutHour) : null;
    const cleanEndHour = checkOutHour !== null ? checkOutHour + cleaningHours : null;
    const cleanEndPct = cleanEndHour !== null ? hourToPercent(cleanEndHour) : null;
    const arrivePct = checkInHour !== null ? hourToPercent(checkInHour) : null;

    const hasVisual = departPct !== null || arrivePct !== null;

    // Empty or drag-only day
    if (!hasVisual) {
      return (
        <Box key={day}
          onMouseDown={() => handleMouseDown(day)}
          onMouseEnter={() => handleMouseEnter(day)}
          sx={{
            textAlign: 'center', py: 2, borderRadius: 1, position: 'relative',
            cursor: 'pointer', fontSize: 14,
            bgcolor: inDrag ? 'primary.light' : 'grey.100',
            color: inDrag ? 'white' : 'text.primary',
            fontWeight: inDrag ? 600 : 400,
            '&:hover': { bgcolor: 'primary.light', color: 'white' },
            transition: 'background-color 0.15s',
          }}
        >
          {day}
        </Box>
      );
    }

    // Build gradient stops for the diagonal fill
    const departColor = departureRes ? getReservationColor(departureRes.platform) : null;
    const arriveColor = arrivalRes ? getReservationColor(arrivalRes.platform) : null;
    const stops = [];

    if (departPct !== null) {
      stops.push(`${departColor} 0%`);
      stops.push(`${departColor} ${departPct}%`);
      // Cleaning block stuck right after checkout
      if (cleanEndPct !== null && cleanEndPct > departPct) {
        stops.push(`${CLEANING_COLOR} ${departPct}%`);
        stops.push(`${CLEANING_COLOR} ${Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)}%`);
        const cleanStop = Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100);
        if (arrivePct !== null && arrivePct > cleanStop) {
          stops.push(`transparent ${cleanStop}%`);
          stops.push(`transparent ${arrivePct}%`);
        } else if (arrivePct === null) {
          stops.push(`transparent ${cleanStop}%`);
          stops.push(`transparent 100%`);
        }
      } else {
        if (arrivePct !== null && arrivePct > departPct) {
          stops.push(`transparent ${departPct}%`);
          stops.push(`transparent ${arrivePct}%`);
        } else if (arrivePct === null) {
          stops.push(`transparent ${departPct}%`);
          stops.push(`transparent 100%`);
        }
      }
    }

    if (arrivePct !== null) {
      if (departPct === null) {
        stops.push(`transparent 0%`);
        stops.push(`transparent ${arrivePct}%`);
      }
      stops.push(`${arriveColor} ${arrivePct}%`);
      stops.push(`${arriveColor} 100%`);
    }

    const gradient = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : undefined;

    const tooltipParts = [];
    if (departureRes) tooltipParts.push(`Départ: ${departureRes.firstName} ${departureRes.lastName} à ${departureRes.checkOutTime || '10:00'}`);
    if (departureRes) tooltipParts.push(`Ménage: ${cleaningHours}h`);
    if (arrivalRes) tooltipParts.push(`Arrivée: ${arrivalRes.firstName} ${arrivalRes.lastName} à ${arrivalRes.checkInTime || '15:00'}`);

    return (
      <Box key={day}
        onMouseDown={() => handleMouseDown(day)}
        onMouseEnter={() => handleMouseEnter(day)}
        title={tooltipParts.join('\n')}
        sx={{
          textAlign: 'center', py: 2, borderRadius: 1, position: 'relative',
          cursor: 'pointer', fontSize: 14, fontWeight: 600,
          background: gradient || 'grey.100',
          color: 'text.primary', overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1, textShadow: '0 0 3px rgba(255,255,255,0.8)' }}>
          {day}
        </Box>
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Calendrier des réservations</Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: 250 }}>
            <InputLabel>Logement</InputLabel>
            <Select value={selectedProp} label="Logement" onChange={(e) => setSelectedProp(e.target.value)}>
              {properties.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button onClick={prevMonth}><ArrowBackIcon /></Button>
            <Typography variant="h6" sx={{ minWidth: 180, textAlign: 'center' }}>{monthNames[month]} {year}</Typography>
            <Button onClick={nextMonth}><ArrowForwardIcon /></Button>
          </Box>
        </CardContent>
      </Card>

      {selectedProp ? (
        <Card>
          <CardContent>
            <Box ref={calRef}
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, userSelect: 'none' }}
              onMouseLeave={() => isDragging && setIsDragging(false)}
              onMouseUp={handleMouseUp}
            >
              {dayNames.map(d => (
                <Box key={d} sx={{ textAlign: 'center', fontWeight: 600, py: 1, color: 'text.secondary', fontSize: 14 }}>{d}</Box>
              ))}
              {Array.from({ length: adjustedFirst }).map((_, i) => <Box key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => renderDayCell(i + 1))}
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              {PLATFORMS.map(p => (
                <Chip key={p} label={p} size="small" sx={{ bgcolor: getReservationColor(p), color: 'white' }} />
              ))}
              <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'white' }} />
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent><Typography align="center" color="text.secondary">Sélectionnez un logement pour voir son calendrier</Typography></CardContent></Card>
      )}

      {/* Reservation Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Nouvelle réservation</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Du {form.startDate} au {form.endDate}
            </Typography>

            <Autocomplete
              options={clients}
              getOptionLabel={(c) => c.id ? `${c.lastName} ${c.firstName} — ${c.email}` : ''}
              onInputChange={(_, val) => setClientSearch(val)}
              onChange={(_, val) => val && updateForm({ clientId: val.id })}
              renderInput={(params) => <TextField {...params} label="Rechercher un client" />}
              noOptionsText={
                <Button onClick={() => setCreateClientOpen(true)} size="small">Créer un nouveau client</Button>
              }
            />
            <Button size="small" variant="text" onClick={() => setCreateClientOpen(true)}>
              + Créer un nouveau client
            </Button>

            <Divider />

            <Grid container spacing={2}>
              <Grid item xs={4}>
                <TextField label="Adultes" type="number" value={form.adults} onChange={(e) => updateForm({ adults: Number(e.target.value) })} fullWidth inputProps={{ min: 1 }} />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Enfants" type="number" value={form.children} onChange={(e) => updateForm({ children: Number(e.target.value) })} fullWidth inputProps={{ min: 0 }} />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Bébés" type="number" value={form.babies} onChange={(e) => updateForm({ babies: Number(e.target.value) })} fullWidth inputProps={{ min: 0 }} />
              </Grid>
            </Grid>

            <FormControl fullWidth>
              <InputLabel>Plateforme</InputLabel>
              <Select value={form.platform} label="Plateforme" onChange={(e) => updateForm({ platform: e.target.value })}>
                {PLATFORMS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>

            <Divider />

            {/* Check-in / Check-out times */}
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <FormControl fullWidth>
                  <InputLabel>Heure d'arrivée</InputLabel>
                  <Select value={form.checkInTime} label="Heure d'arrivée" onChange={(e) => setForm(prev => ({ ...prev, checkInTime: e.target.value }))}>
                    {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <FormControl fullWidth>
                  <InputLabel>Heure de départ</InputLabel>
                  <Select value={form.checkOutTime} label="Heure de départ" onChange={(e) => setForm(prev => ({ ...prev, checkOutTime: e.target.value }))}>
                    {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Divider />

            {propertyOptions.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>Options</Typography>
                {propertyOptions.map(opt => (
                  <FormControlLabel
                    key={opt.id}
                    control={<Checkbox checked={form.selectedOptions.some(s => s.optionId === opt.id)} onChange={() => toggleOption(opt.id)} />}
                    label={`${opt.title} — ${opt.price}€ ${PRICE_TYPE_LABELS[opt.priceType] || ''}`}
                  />
                ))}
              </Box>
            )}

            <Divider />

            <Grid container spacing={2}>
              <Grid item xs={4}>
                <TextField label="Prix calculé (€)" type="number" value={form.totalPrice} InputProps={{ readOnly: true }} fullWidth />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Réduction (%)" type="number" value={form.discountPercent}
                  onChange={(e) => updateForm({ discountPercent: Number(e.target.value), customPrice: '' })} fullWidth inputProps={{ min: 0, max: 100 }} />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Prix final (€)" type="number" value={form.customPrice !== '' ? form.customPrice : form.finalPrice}
                  onChange={(e) => updateForm({ customPrice: e.target.value })} fullWidth />
              </Grid>
            </Grid>

            <Divider />

            <Grid container spacing={2}>
              <Grid item xs={3}>
                <TextField label="Acompte (€)" type="number" value={form.depositAmount}
                  onChange={(e) => setForm(prev => ({ ...prev, depositAmount: Number(e.target.value) }))} fullWidth />
              </Grid>
              <Grid item xs={3}>
                <TextField label="Date acompte" type="date" value={form.depositDueDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => setForm(prev => ({ ...prev, depositDueDate: e.target.value }))} fullWidth />
              </Grid>
              <Grid item xs={3}>
                <TextField label="Solde (€)" type="number" value={form.balanceAmount}
                  onChange={(e) => setForm(prev => ({ ...prev, balanceAmount: Number(e.target.value) }))} fullWidth />
              </Grid>
              <Grid item xs={3}>
                <TextField label="Date solde" type="date" value={form.balanceDueDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => setForm(prev => ({ ...prev, balanceDueDate: e.target.value }))} fullWidth />
              </Grid>
            </Grid>

            <TextField label="Notes" value={form.notes} onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))} multiline rows={2} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveReservation} disabled={!form.clientId}>Réserver</Button>
        </DialogActions>
      </Dialog>

      {/* Create client inline dialog */}
      <Dialog open={createClientOpen} onClose={() => setCreateClientOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nouveau client</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="Nom" value={newClient.lastName} onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })} fullWidth />
              <TextField label="Prénom" value={newClient.firstName} onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })} fullWidth />
            </Box>
            <TextField label="Email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} fullWidth />
            <TextField label="Téléphone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateClientOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleCreateClient} disabled={!newClient.lastName || !newClient.firstName}>Créer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
