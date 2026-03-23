import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select,
  MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Autocomplete, Chip, Checkbox, FormControlLabel, Divider, Grid
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import api from '../api';

const PLATFORMS = ['direct', 'airbnb', 'greengo', 'abritel', 'abracadaroom', 'booking'];

const TIME_OPTIONS = Array.from({ length: 29 }, (_, i) => {
  const h = String(Math.floor(i / 2) + 8).padStart(2, '0');
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
  const [searchParams] = useSearchParams();
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
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], checkInTime: '15:00', checkOutTime: '10:00'
  });
  const calRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [editingReservationId, setEditingReservationId] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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

  // Read URL params for navigation from dashboard
  useEffect(() => {
    const propId = searchParams.get('propertyId');
    const y = searchParams.get('year');
    const m = searchParams.get('month');
    if (propId) setSelectedProp(Number(propId));
    if (y) setYear(Number(y));
    if (m !== null) setMonth(Number(m));
  }, [searchParams]);

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
  const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  // Check if a day is fully blocked (mid-stay or past)
  const isDayFullyBlocked = (day) => {
    const dateStr = formatDate(year, month, day);
    if (dateStr < today) return true;
    if (reservations.some(r => dateStr > r.startDate && dateStr < r.endDate)) return true;
    return false;
  };

  // Check if a day has an existing arrival
  const hasArrivalOnDay = (day) => {
    const dateStr = formatDate(year, month, day);
    return reservations.some(r => r.startDate === dateStr);
  };

  const isInDragRange = (day) => {
    if (!dragStart || !dragEnd) return false;
    const min = Math.min(dragStart, dragEnd);
    const max = Math.max(dragStart, dragEnd);
    return day >= min && day <= max;
  };

  const handleMouseDown = (day) => {
    if (isDayFullyBlocked(day) || hasArrivalOnDay(day)) return;
    setDragStart(day);
    setDragEnd(day);
    setIsDragging(true);
  };

  const handleMouseEnter = (day) => {
    if (!isDragging) return;
    let clampedDay = day;
    if (day >= dragStart) {
      for (let d = dragStart + 1; d <= day; d++) {
        if (isDayFullyBlocked(d)) { clampedDay = d - 1; break; }
        if (hasArrivalOnDay(d)) { clampedDay = d; break; }
      }
    } else {
      for (let d = dragStart - 1; d >= day; d--) {
        if (isDayFullyBlocked(d) || hasArrivalOnDay(d)) { clampedDay = d + 1; break; }
      }
    }
    setDragEnd(clampedDay);
  };

  const openNewReservation = async (startDate, endDate) => {
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
      cautionAmount: prop.defaultCautionAmount ?? 500, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
      notes: '', selectedOptions: [], startDate, endDate,
      checkInTime: calc.defaultCheckIn || prop.defaultCheckIn || '15:00',
      checkOutTime: calc.defaultCheckOut || prop.defaultCheckOut || '10:00'
    });
    setEditingReservationId(null);
    setDialogOpen(true);
  };

  const handleMouseUp = async () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);
    const startDay = Math.min(dragStart, dragEnd);
    const lastDay = Math.max(dragStart, dragEnd);
    const endDay = hasArrivalOnDay(lastDay) ? lastDay : lastDay + 1;
    const startDate = formatDate(year, month, startDay);
    const endDate = formatDate(year, month, Math.min(endDay, daysInMonth + 1));
    await openNewReservation(startDate, endDate);
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
    // --- Common validation for create and update ---
    const cleaning = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;
    const newCheckInHour = timeToHour(form.checkInTime || '15:00');
    const newCheckOutHour = timeToHour(form.checkOutTime || '10:00');
    const excludeId = editingReservationId;

    // Filter out the reservation being edited for overlap checks
    const otherReservations = excludeId
      ? reservations.filter(r => r.id !== excludeId)
      : reservations;

    // Reject past start dates
    const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (form.startDate < todayStr) {
      setErrorMsg('Impossible de réserver dans le passé.');
      return;
    }

    // Strict overlap: other reservations whose date range overlaps
    const hasOverlap = otherReservations.some(r => r.startDate < form.endDate && r.endDate > form.startDate);
    if (hasOverlap) {
      setErrorMsg('Ce logement est déjà réservé pour ces dates.');
      return;
    }

    // Check turnover at start: other reservation ending on our start date
    const prevRes = otherReservations.find(r => r.endDate === form.startDate);
    if (prevRes) {
      const prevCheckOutHour = timeToHour(prevRes.checkOutTime || '10:00');
      const availableFrom = prevCheckOutHour + cleaning;
      if (newCheckInHour < availableFrom) {
        const availH = String(Math.floor(availableFrom)).padStart(2, '0');
        const availM = availableFrom % 1 >= 0.5 ? '30' : '00';
        setErrorMsg(`Impossible : le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h de ménage). Veuillez choisir une heure d'arrivée à partir de ${availH}:${availM}.`);
        return;
      }
    }

    // Check turnover at end: other reservation starting on our end date
    const nextRes = otherReservations.find(r => r.startDate === form.endDate);
    if (nextRes) {
      const nextCheckInHour = timeToHour(nextRes.checkInTime || '15:00');
      if (newCheckOutHour + cleaning > nextCheckInHour) {
        const maxCheckOutHour = nextCheckInHour - cleaning;
        const maxH = String(Math.floor(maxCheckOutHour)).padStart(2, '0');
        const maxM = maxCheckOutHour % 1 >= 0.5 ? '30' : '00';
        setErrorMsg(`Impossible : le départ à ${form.checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale pour cette réservation est ${maxH}:${maxM}.`);
        return;
      }
    }
    // --- End common validation ---

    try {
      if (editingReservationId) {
        await api.updateReservation(editingReservationId, {
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
          depositPaid: form.depositPaid,
          balanceAmount: form.balanceAmount,
          balanceDueDate: form.balanceDueDate,
          balancePaid: form.balancePaid,
          cautionAmount: form.cautionAmount,
          cautionReceived: form.cautionReceived,
          cautionReceivedDate: form.cautionReceivedDate,
          cautionReturned: form.cautionReturned,
          cautionReturnedDate: form.cautionReturnedDate,
          notes: form.notes,
          options: form.selectedOptions.map(so => ({
            optionId: so.optionId,
            quantity: so.quantity,
            totalPrice: so.totalPrice
          }))
        });
      } else {
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
          cautionAmount: form.cautionAmount,
          notes: form.notes,
          options: form.selectedOptions.map(so => ({
            optionId: so.optionId,
            quantity: so.quantity,
            totalPrice: so.totalPrice
          }))
        });
      }
      setDialogOpen(false);
      setEditingReservationId(null);
      setDragStart(null);
      setDragEnd(null);
      loadReservations();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la création de la réservation');
    }
  };

  const handleReservationClick = async (resId) => {
    if (isDragging) return;
    const res = await api.getReservation(resId);
    const prop = await api.getProperty(selectedProp);
    const opts = await api.getOptions();
    const availableOpts = opts.filter(o => (prop.optionIds || []).includes(o.id));
    setPropertyOptions(availableOpts);

    const client = await api.getClient(res.clientId);
    setClients(prev => {
      if (prev.some(c => c.id === client.id)) return prev;
      return [...prev, client];
    });

    setForm({
      clientId: res.clientId,
      adults: res.adults || 1,
      children: res.children || 0,
      babies: res.babies || 0,
      platform: res.platform || 'direct',
      totalPrice: res.totalPrice || 0,
      discountPercent: res.discountPercent || 0,
      finalPrice: res.finalPrice || 0,
      customPrice: '',
      depositAmount: res.depositAmount || 0,
      depositDueDate: res.depositDueDate || '',
      balanceAmount: res.balanceAmount || 0,
      balanceDueDate: res.balanceDueDate || '',
      notes: res.notes || '',
      startDate: res.startDate,
      endDate: res.endDate,
      checkInTime: res.checkInTime || '15:00',
      checkOutTime: res.checkOutTime || '10:00',
      selectedOptions: (res.options || []).map(o => ({ optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice })),
      depositPaid: !!res.depositPaid,
      balancePaid: !!res.balancePaid,
      cautionAmount: res.cautionAmount || 0,
      cautionReceived: !!res.cautionReceived,
      cautionReceivedDate: res.cautionReceivedDate || '',
      cautionReturned: !!res.cautionReturned,
      cautionReturnedDate: res.cautionReturnedDate || '',
    });
    setEditingReservationId(resId);
    setDialogOpen(true);
  };

  const handleDeleteReservation = async () => {
    if (!editingReservationId) return;
    await api.deleteReservation(editingReservationId);
    setConfirmDeleteOpen(false);
    setDialogOpen(false);
    setEditingReservationId(null);
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

  // Check if a reservation has visible mid-stay days in the current month
  const resHasMidDaysThisMonth = (res) => {
    const monthStartStr = formatDate(year, month, 1);
    const monthEndStr = formatDate(year, month, daysInMonth);
    const s = new Date(res.startDate); s.setDate(s.getDate() + 1);
    const firstMid = formatDate(s.getFullYear(), s.getMonth(), s.getDate());
    const e = new Date(res.endDate); e.setDate(e.getDate() - 1);
    const lastMid = formatDate(e.getFullYear(), e.getMonth(), e.getDate());
    if (firstMid > lastMid) return false;
    return firstMid <= monthEndStr && lastMid >= monthStartStr;
  };

  const compactName = (firstName, lastName) => {
    const f = (firstName || '').charAt(0);
    const l = lastName || '';
    const full = f ? `${f}. ${l}` : l;
    return full.length > 8 ? full.slice(0, 7) + '…' : full;
  };

  // ---------- RENDER A CALENDAR CELL ----------
  const renderDayCell = (day) => {
    const dateStr = formatDate(year, month, day);
    const isPast = dateStr < today;
    const inDrag = isInDragRange(day);

    // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
    const departureRes = reservations.find(r => r.endDate === dateStr);
    const arrivalRes = reservations.find(r => r.startDate === dateStr);
    const midRes = reservations.find(r => dateStr > r.startDate && dateStr < r.endDate);

    // If mid-stay: full color fill
    if (midRes) {
      const color = getReservationColor(midRes.platform);
      // Show label on the middle day of the reservation (within this month)
      const resStart = new Date(midRes.startDate);
      const resEnd = new Date(midRes.endDate);
      const firstDay = resStart.getFullYear() === year && resStart.getMonth() === month ? resStart.getDate() : 1;
      const lastDay = resEnd.getFullYear() === year && resEnd.getMonth() === month ? resEnd.getDate() : daysInMonth;
      const midDay = Math.round((firstDay + lastDay) / 2);
      const isLabelDay = day === midDay;
      return (
        <Box key={day} onClick={() => handleReservationClick(midRes.id)} sx={{
          textAlign: 'center', py: 2, borderRadius: 1, position: 'relative', cursor: 'pointer',
          bgcolor: color, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 48,
        }}>
          {isLabelDay ? (
            <>
              <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
                {midRes.firstName} {midRes.lastName}
              </Typography>
              <Typography sx={{ fontSize: 9, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                {midRes.platform}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
          )}
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
          onMouseDown={() => !isPast && handleMouseDown(day)}
          onMouseEnter={() => handleMouseEnter(day)}
          sx={{
            textAlign: 'center', py: 2, borderRadius: 1, position: 'relative',
            cursor: isPast ? 'default' : 'pointer', fontSize: 14,
            bgcolor: isPast ? 'grey.300' : inDrag ? 'primary.light' : 'grey.100',
            color: isPast ? 'grey.500' : inDrag ? 'white' : 'text.primary',
            fontWeight: inDrag ? 600 : 400,
            ...(!isPast && { '&:hover': { bgcolor: 'primary.light', color: 'white' } }),
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
      const gapColor = inDrag ? '#42a5f5' : 'transparent';
      // Cleaning block stuck right after checkout
      if (cleanEndPct !== null && cleanEndPct > departPct) {
        stops.push(`${CLEANING_COLOR} ${departPct}%`);
        stops.push(`${CLEANING_COLOR} ${Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)}%`);
        const cleanStop = Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100);
        if (arrivePct !== null && arrivePct > cleanStop) {
          stops.push(`${gapColor} ${cleanStop}%`);
          stops.push(`${gapColor} ${arrivePct}%`);
        } else if (arrivePct === null) {
          stops.push(`${gapColor} ${cleanStop}%`);
          stops.push(`${gapColor} 100%`);
        }
      } else {
        if (arrivePct !== null && arrivePct > departPct) {
          stops.push(`${gapColor} ${departPct}%`);
          stops.push(`${gapColor} ${arrivePct}%`);
        } else if (arrivePct === null) {
          stops.push(`${gapColor} ${departPct}%`);
          stops.push(`${gapColor} 100%`);
        }
      }
    }

    if (arrivePct !== null) {
      if (departPct === null) {
        const freeColor = inDrag ? '#42a5f5' : 'transparent';
        stops.push(`${freeColor} 0%`);
        stops.push(`${freeColor} ${arrivePct}%`);
      }
      stops.push(`${arriveColor} ${arrivePct}%`);
      stops.push(`${arriveColor} 100%`);
    }

    const gradient = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : undefined;

    // Boundary between departure/cleaning zone and free zone (for click detection)
    const departEndPct = departPct !== null
      ? (cleanEndPct !== null && cleanEndPct > departPct
        ? Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)
        : departPct)
      : 0;

    const tooltipParts = [];
    if (departureRes) tooltipParts.push(`Départ: ${departureRes.firstName} ${departureRes.lastName} à ${departureRes.checkOutTime || '10:00'}`);
    if (departureRes) tooltipParts.push(`Ménage: ${cleaningHours}h`);
    if (arrivalRes) tooltipParts.push(`Arrivée: ${arrivalRes.firstName} ${arrivalRes.lastName} à ${arrivalRes.checkInTime || '15:00'}`);

    // Compute click zone from cursor position on the 135deg gradient
    const getClickPct = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return ((e.clientX - rect.left) + (e.clientY - rect.top)) / (rect.width + rect.height) * 100;
    };

    return (
      <Box key={day}
        onMouseDown={(e) => {
          if (isPast) return;
          const pct = getClickPct(e);
          const onDepartZone = departureRes && pct <= departEndPct;
          const onArriveZone = arrivalRes && pct >= arrivePct;
          if (!onDepartZone && !onArriveZone) {
            handleMouseDown(day);
          }
        }}
        onMouseEnter={() => handleMouseEnter(day)}
        onClick={async (e) => {
          if (isDragging) return;
          const pct = getClickPct(e);
          if (departureRes && pct <= departEndPct) {
            handleReservationClick(departureRes.id);
          } else if (arrivalRes && pct >= arrivePct) {
            handleReservationClick(arrivalRes.id);
          } else if (departureRes && !arrivalRes) {
            // Free zone on departure-only day: create new reservation
            const startDate = formatDate(year, month, day);
            const endDate = formatDate(year, month, Math.min(day + 1, daysInMonth + 1));
            openNewReservation(startDate, endDate);
          } else if (!departureRes && arrivalRes) {
            // Free zone on arrival-only day: show arrival reservation
            handleReservationClick(arrivalRes.id);
          }
        }}
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
        {/* Compact label for arrival on short reservations (no mid-day visible) */}
        {arrivalRes && !resHasMidDaysThisMonth(arrivalRes) && (() => {
          const colorPct = 100 - (arrivePct || 0);
          const nameSize = Math.max(8, Math.round(colorPct / 100 * 22));
          const platSize = Math.max(7, Math.round(colorPct / 100 * 16));
          return (
            <Box sx={{ position: 'absolute', bottom: 1, right: 2, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
              <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {compactName(arrivalRes.firstName, arrivalRes.lastName)}
              </Typography>
              <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {arrivalRes.platform}
              </Typography>
            </Box>
          );
        })()}
        {/* Compact label for departure on short reservations when arrival not in this month */}
        {departureRes && !resHasMidDaysThisMonth(departureRes) && !(departureRes.startDate >= formatDate(year, month, 1) && departureRes.startDate <= formatDate(year, month, daysInMonth)) && (() => {
          const colorPct = departEndPct || departPct || 0;
          const nameSize = Math.max(8, Math.round(colorPct / 100 * 22));
          const platSize = Math.max(7, Math.round(colorPct / 100 * 16));
          return (
            <Box sx={{ position: 'absolute', top: 1, left: 2, zIndex: 2, textAlign: 'left', lineHeight: 1, pointerEvents: 'none' }}>
              <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {compactName(departureRes.firstName, departureRes.lastName)}
              </Typography>
              <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {departureRes.platform}
              </Typography>
            </Box>
          );
        })()}
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
              <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'white' }} />
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent><Typography align="center" color="text.secondary">Sélectionnez un logement pour voir son calendrier</Typography></CardContent></Card>
      )}

      {/* Reservation Dialog */}
      {(() => {
        // Compute min/max date bounds for arrival and departure inputs
        const otherRes = editingReservationId
          ? reservations.filter(r => r.id !== editingReservationId).sort((a, b) => a.startDate.localeCompare(b.startDate))
          : reservations.sort((a, b) => a.startDate.localeCompare(b.startDate));
        const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

        // Arrival date bounds
        // min: end date of previous reservation (the one ending just before or on form.startDate), or today
        const prevResBound = otherRes.filter(r => r.endDate <= (form.startDate || todayStr));
        const arrivalMin = prevResBound.length > 0 ? prevResBound[prevResBound.length - 1].endDate : todayStr;
        // max: form.endDate - 1 day (can't arrive on or after departure), capped to end of next reservation's start
        const arrivalMax = form.endDate || '';

        // Departure date bounds
        // min: form.startDate + 1 day (at least 1 night)
        const departureMin = form.startDate || '';
        // max: start date of next reservation (the one starting on or after form.endDate), or empty (unlimited)
        const nextResBound = otherRes.filter(r => r.startDate >= (form.endDate || ''));
        const departureMax = nextResBound.length > 0 ? nextResBound[0].startDate : '';

        return (
      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingReservationId(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{editingReservationId ? 'Modifier la réservation' : 'Nouvelle réservation'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField label="Date d'arrivée" type="date" value={form.startDate || ''}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: arrivalMin, max: arrivalMax }}
                  onChange={(e) => setForm(prev => ({ ...prev, startDate: e.target.value }))} fullWidth />
              </Grid>
              <Grid item xs={6}>
                <TextField label="Date de départ" type="date" value={form.endDate || ''}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: departureMin, max: departureMax || undefined }}
                  onChange={(e) => setForm(prev => ({ ...prev, endDate: e.target.value }))} fullWidth />
              </Grid>
            </Grid>

            <Autocomplete
              options={clients}
              getOptionLabel={(c) => c.id ? `${c.lastName} ${c.firstName} — ${c.email}` : ''}
              value={clients.find(c => c.id === form.clientId) || null}
              onInputChange={(_, val, reason) => { if (reason === 'input') setClientSearch(val); }}
              onChange={(_, val) => val && updateForm({ clientId: val.id })}
              isOptionEqualToValue={(option, value) => option.id === value.id}
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

            <Divider />

            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Caution</Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={3}>
                <TextField label="Montant caution (€)" type="number" value={form.cautionAmount}
                  onChange={(e) => setForm(prev => ({ ...prev, cautionAmount: Number(e.target.value) }))} fullWidth />
              </Grid>
              <Grid item xs={3}>
                <FormControlLabel control={<Checkbox checked={form.cautionReceived} onChange={(e) => setForm(prev => ({ ...prev, cautionReceived: e.target.checked, cautionReceivedDate: e.target.checked && !prev.cautionReceivedDate ? new Date().toISOString().split('T')[0] : prev.cautionReceivedDate }))} />}
                  label="Reçue" />
              </Grid>
              {form.cautionReceived && (
                <Grid item xs={3}>
                  <TextField label="Date réception" type="date" value={form.cautionReceivedDate}
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => setForm(prev => ({ ...prev, cautionReceivedDate: e.target.value }))} fullWidth />
                </Grid>
              )}
              {form.cautionReceived && (
                <>
                  <Grid item xs={3}>
                    <FormControlLabel control={<Checkbox checked={form.cautionReturned} onChange={(e) => setForm(prev => ({ ...prev, cautionReturned: e.target.checked, cautionReturnedDate: e.target.checked && !prev.cautionReturnedDate ? new Date().toISOString().split('T')[0] : prev.cautionReturnedDate }))} />}
                      label="Restituée" />
                  </Grid>
                  {form.cautionReturned && (
                    <Grid item xs={3}>
                      <TextField label="Date restitution" type="date" value={form.cautionReturnedDate}
                        InputLabelProps={{ shrink: true }}
                        onChange={(e) => setForm(prev => ({ ...prev, cautionReturnedDate: e.target.value }))} fullWidth />
                    </Grid>
                  )}
                </>
              )}
            </Grid>

            <TextField label="Notes" value={form.notes} onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))} multiline rows={2} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions>
          {editingReservationId && (
            <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDeleteOpen(true)} sx={{ mr: 'auto' }}>
              Supprimer
            </Button>
          )}
          <Button onClick={() => { setDialogOpen(false); setEditingReservationId(null); }}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveReservation} disabled={!form.clientId}>
            {editingReservationId ? 'Enregistrer' : 'Réserver'}
          </Button>
        </DialogActions>
      </Dialog>
        );
      })()}

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

      {/* Error dialog */}
      <Dialog open={!!errorMsg} onClose={() => setErrorMsg('')} maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningAmberIcon color="warning" /> Conflit de réservation
        </DialogTitle>
        <DialogContent>
          <Typography>{errorMsg}</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setErrorMsg('')}>Compris</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle>Confirmer la suppression</DialogTitle>
        <DialogContent>
          <Typography>Êtes-vous sûr de vouloir supprimer cette réservation ? Cette action est irréversible.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>Annuler</Button>
          <Button color="error" variant="contained" onClick={handleDeleteReservation}>Supprimer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
