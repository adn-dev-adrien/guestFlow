import React, { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select,
  MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Autocomplete, Chip, Checkbox, FormControlLabel, Divider, Grid
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteIcon from '@mui/icons-material/Delete';
import PropertyCalendarOverview from '../components/PropertyCalendarOverview';
import api from '../api';
import { getFrenchPublicHolidays, getSchoolHolidayInfo } from '../frenchHolidays';

const PLATFORMS = ['direct', 'airbnb', 'greengo', 'abritel', 'abracadaroom', 'booking', 'gitedefrance', 'pitchup'];

const TIME_OPTIONS = Array.from({ length: 29 }, (_, i) => {
  const h = String(Math.floor(i / 2) + 8).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par jour',
  per_person_per_night: 'par pers./jour',
  per_hour: 'par heure',
  free: 'gratuit',
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
  return PLATFORM_COLORS[platform] || '#757575';
}

const PLATFORM_COLORS = {
  direct: '#c9a227', airbnb: '#FF5A5F', greengo: '#4CAF50',
  abritel: '#1565c0', abracadaroom: '#00bcd4', booking: '#003580',
  gitedefrance: '#e6c832', pitchup: '#f57c00'
};

const CLEANING_COLOR = '#e53935';

const ZONE_COLORS = { A: '#1976d2', B: '#388e3c', C: '#f57c00' };

export default function CalendarPage() {
  const [searchParams] = useSearchParams();
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [overviewReservations, setOverviewReservations] = useState([]);
  const [reservations, setReservations] = useState([]);

  const getMonthsRange = (centerY, centerM, range = 3) => {
    const result = [];
    for (let i = -range; i <= range; i++) {
      const d = new Date(centerY, centerM + i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return result;
  };
  const getInitialMonths = () => {
    const now = new Date();
    return getMonthsRange(now.getFullYear(), now.getMonth(), 1);
  };
  const [months, setMonths] = useState(getInitialMonths);
  const [dragStartDate, setDragStartDate] = useState(null);
  const [dragEndDate, setDragEndDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [newClient, setNewClient] = useState({ lastName: '', firstName: '', email: '', phone: '', address: '', notes: '' });
  const [propertyOptions, setPropertyOptions] = useState([]);
  const [availableResources, setAvailableResources] = useState([]);
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [form, setForm] = useState({
    clientId: null, adults: 1, children: 0, babies: 0, platform: 'direct',
    singleBeds: '', doubleBeds: '', babyBeds: '',
    totalPrice: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], selectedResources: [], checkInTime: '15:00', checkOutTime: '10:00'
  });
  const scrollRef = useRef(null);
  const lastLoadedRange = useRef({ from: '', to: '' });
  const prevScrollHeight = useRef(0);
  const shouldAdjustScroll = useRef(false);
  const initialScrollDone = useRef(false);
  const originalReservationRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [editingReservationId, setEditingReservationId] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [calendarNotes, setCalendarNotes] = useState({});
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState('');
  const [noteDialogText, setNoteDialogText] = useState('');

  const loadProperties = async () => setProperties(await api.getProperties());

  const loadOverviewReservations = useCallback(async () => {
    const from = new Date().toISOString().split('T')[0];
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 30);
    const to = toDate.toISOString().split('T')[0];
    setOverviewReservations(await api.getReservations({ from, to }));
  }, []);

  const handleSelectProperty = (propertyId) => {
    setSelectedProp(propertyId);
    initialScrollDone.current = false;
    lastLoadedRange.current = { from: '', to: '' };
  };

  const loadSchoolHolidays = async () => setSchoolHolidays(await api.getSchoolHolidays());

  const loadCalendarData = useCallback(async () => {
    if (!selectedProp || months.length === 0) return;
    const first = months[0];
    const last = months[months.length - 1];
    const from = formatDate(first.year, first.month, 1);
    const to = formatDate(last.year, last.month, getDaysInMonth(last.year, last.month));
    if (from === lastLoadedRange.current.from && to === lastLoadedRange.current.to) return;
    lastLoadedRange.current = { from, to };
    const prop = await api.getProperty(selectedProp);
    setSelectedProperty(prop);
    const [data, notes] = await Promise.all([
      api.getReservations({ propertyId: selectedProp, from, to }),
      api.getCalendarNotes(selectedProp, from, to)
    ]);
    setReservations(data);
    const notesMap = {};
    notes.forEach(n => { notesMap[n.date] = n.note; });
    setCalendarNotes(notesMap);
  }, [selectedProp, months]);

  useEffect(() => { loadProperties(); loadSchoolHolidays(); loadOverviewReservations(); }, [loadOverviewReservations]);
  useEffect(() => { loadCalendarData(); }, [loadCalendarData]);

  // Read URL params for navigation from dashboard
  useEffect(() => {
    const propId = searchParams.get('propertyId');
    const y = searchParams.get('year');
    const m = searchParams.get('month');
    const resId = searchParams.get('reservationId');
    if (propId) handleSelectProperty(Number(propId));
    if (y && m !== null) {
      setMonths(getMonthsRange(Number(y), Number(m)));
      initialScrollDone.current = false;
      lastLoadedRange.current = { from: '', to: '' };
    }
    // If reservationId param is present, open the edit dialog after property is loaded
    if (resId) {
      window.pendingReservationId = resId;
    }
  }, [searchParams]);

  // Handle opening reservation edit dialog when coming from dashboard
  useEffect(() => {
    if (!selectedProp || !window.pendingReservationId) return;
    const resId = window.pendingReservationId;
    delete window.pendingReservationId;
    handleReservationClick(resId);
  }, [selectedProp]);

  // Maintain scroll position when prepending months
  useLayoutEffect(() => {
    if (shouldAdjustScroll.current && scrollRef.current) {
      const diff = scrollRef.current.scrollHeight - prevScrollHeight.current;
      scrollRef.current.scrollTop += diff;
      shouldAdjustScroll.current = false;
    }
  }, [months]);

  // Auto-scroll to one week before current date on initial load
  useEffect(() => {
    if (initialScrollDone.current || !selectedProp) return;
    
    // Just mark as done - calendar loads month + 2 following months already
    initialScrollDone.current = true;
  }, [selectedProp, months]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !initialScrollDone.current) return;
    if (el.scrollTop < 200) {
      prevScrollHeight.current = el.scrollHeight;
      shouldAdjustScroll.current = true;
      setMonths(prev => {
        const first = prev[0];
        const d = new Date(first.year, first.month - 1, 1);
        return [{ year: d.getFullYear(), month: d.getMonth() }, ...prev];
      });
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setMonths(prev => {
        const last = prev[prev.length - 1];
        const d = new Date(last.year, last.month + 1, 1);
        return [...prev, { year: d.getFullYear(), month: d.getMonth() }];
      });
    }
  };

  const loadClientsForSearch = async (q) => {
    const data = await api.getClients(q);
    setClients(data);
  };

  const loadResourcesAvailability = async (startDate, endDate, excludeReservationId = null) => {
    if (!selectedProp || !startDate || !endDate) {
      setAvailableResources([]);
      return;
    }
    const resources = await api.getResourcesAvailability({
      propertyId: selectedProp,
      startDate,
      endDate,
      ...(excludeReservationId ? { excludeReservationId } : {}),
    });
    setAvailableResources(resources);
  };

  const loadBabyBedAvailability = async (startDate, endDate, excludeReservationId = null) => {
    if (!selectedProp || !startDate || !endDate) {
      setBabyBedAvailability({ totalQuantity: 0, reserved: 0, available: null });
      return;
    }
    const data = await api.getBabyBedAvailability({
      propertyId: selectedProp,
      startDate,
      endDate,
      ...(excludeReservationId ? { excludeReservationId } : {}),
    });
    setBabyBedAvailability(data || { totalQuantity: 0, reserved: 0, available: 0 });
  };

  useEffect(() => {
    if (!dialogOpen || !form.startDate || !form.endDate) return;
    loadResourcesAvailability(form.startDate, form.endDate, editingReservationId || null);
    loadBabyBedAvailability(form.startDate, form.endDate, editingReservationId || null);
  }, [dialogOpen, form.startDate, form.endDate, selectedProp, editingReservationId]);

  useEffect(() => { loadClientsForSearch(clientSearch); }, [clientSearch]);

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  // Check if a day is fully blocked (mid-stay or past)
  const isDayFullyBlocked = (day, y, m) => {
    const dateStr = formatDate(y, m, day);
    if (dateStr < today) return true;
    if (reservations.some(r => dateStr > r.startDate && dateStr < r.endDate)) return true;
    return false;
  };

  // Check if a day has an existing arrival
  const hasArrivalOnDay = (day, y, m) => {
    const dateStr = formatDate(y, m, day);
    return reservations.some(r => r.startDate === dateStr);
  };

  const isInDragRange = (day, y, m) => {
    if (!dragStartDate || !dragEndDate) return false;
    const dateStr = formatDate(y, m, day);
    const min = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const max = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    return dateStr >= min && dateStr <= max;
  };

  const handleMouseDown = (day, y, m) => {
    if (isDayFullyBlocked(day, y, m) || hasArrivalOnDay(day, y, m)) return;
    const dateStr = formatDate(y, m, day);
    setDragStartDate(dateStr);
    setDragEndDate(dateStr);
    setIsDragging(true);
  };

  const handleMouseEnter = (day, y, m) => {
    if (!isDragging || !dragStartDate) return;
    const dateStr = formatDate(y, m, day);
    // Walk from dragStartDate to dateStr, clamping at obstacles
    const start = new Date(dragStartDate);
    const target = new Date(dateStr);
    let clamped = dateStr;
    if (target >= start) {
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor <= target) {
        const cy = cursor.getFullYear(), cm = cursor.getMonth(), cd = cursor.getDate();
        if (isDayFullyBlocked(cd, cy, cm)) {
          cursor.setDate(cursor.getDate() - 1);
          clamped = formatDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
          break;
        }
        if (hasArrivalOnDay(cd, cy, cm)) {
          clamped = formatDate(cy, cm, cd);
          break;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() - 1);
      while (cursor >= target) {
        const cy = cursor.getFullYear(), cm = cursor.getMonth(), cd = cursor.getDate();
        if (isDayFullyBlocked(cd, cy, cm) || hasArrivalOnDay(cd, cy, cm)) {
          cursor.setDate(cursor.getDate() + 1);
          clamped = formatDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
          break;
        }
        cursor.setDate(cursor.getDate() - 1);
      }
    }
    setDragEndDate(clamped);
  };

  const openNewReservation = async (startDate, endDate) => {
    const prop = await api.getProperty(selectedProp);
    const opts = await api.getOptions();
    const availableOpts = opts.filter(o => (prop.optionIds || []).includes(o.id));
    setPropertyOptions(availableOpts);

    const calc = await api.calculatePrice({ propertyId: selectedProp, startDate, endDate, adults: 1, children: 0 });

    setForm({
      clientId: null, adults: 1, children: 0, babies: 0, platform: 'direct',
      singleBeds: '', doubleBeds: '', babyBeds: '',
      totalPrice: calc.totalPrice, discountPercent: 0, finalPrice: calc.totalPrice, customPrice: '',
      depositAmount: calc.depositAmount, depositDueDate: calc.depositDueDate,
      balanceAmount: calc.balanceAmount, balanceDueDate: calc.balanceDueDate,
      cautionAmount: prop.defaultCautionAmount ?? 500, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
      notes: '', selectedOptions: [], selectedResources: [], startDate, endDate,
      checkInTime: calc.defaultCheckIn || prop.defaultCheckIn || '15:00',
      checkOutTime: calc.defaultCheckOut || prop.defaultCheckOut || '10:00'
    });
    await loadResourcesAvailability(startDate, endDate);
    await loadBabyBedAvailability(startDate, endDate);
    originalReservationRef.current = null;
    setEditingReservationId(null);
    setDialogOpen(true);
  };

  const handleMouseUp = async () => {
    if (!isDragging || !dragStartDate || !dragEndDate) return;
    setIsDragging(false);
    const minDate = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const maxDate = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    await openNewReservation(minDate, maxDate);
  };

  const recalcPrice = (updatedForm) => {
    const base = updatedForm.totalPrice;
    const nights = Math.max(1, Math.round((new Date(updatedForm.endDate) - new Date(updatedForm.startDate)) / 86400000));
    const persons = (Number(updatedForm.adults) || 1) + (Number(updatedForm.children) || 0);

    const typeMultiplier = (priceType) => {
      if (priceType === 'per_person') return persons;
      if (priceType === 'per_night') return nights;
      if (priceType === 'per_person_per_night') return persons * nights;
      return 1; // per_stay, per_hour, fixed
    };

    let optionsTotal = 0;
    for (const so of updatedForm.selectedOptions) {
      const opt = propertyOptions.find(o => o.id === so.optionId);
      if (!opt) continue;
      const userQty = Math.max(1, Number(so.quantity) || 1);
      const optTotal = Number(opt.price) * userQty * typeMultiplier(opt.priceType);
      so.quantity = userQty;
      so.totalPrice = optTotal;
      optionsTotal += optTotal;
    }
    let resourcesTotal = 0;
    for (const sr of (updatedForm.selectedResources || [])) {
      const resource = availableResources.find(r => r.id === sr.resourceId);
      const unitPrice = resource?.price !== undefined ? Number(resource.price) : Number(sr.unitPrice || 0);
      const qty = Math.max(0, Number(sr.quantity) || 0);
      sr.unitPrice = unitPrice;
      sr.totalPrice = unitPrice * qty * typeMultiplier(resource?.priceType || 'per_stay');
      resourcesTotal += sr.totalPrice;
    }
    const subtotal = base + optionsTotal + resourcesTotal;
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

  const setOptionQuantity = (optionId, quantity) => {
    setForm(prev => {
      const parsed = Number(quantity);
      const normalizedQty = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
      const exists = prev.selectedOptions.find(so => so.optionId === optionId);
      let newOpts;
      if (normalizedQty <= 0) {
        newOpts = prev.selectedOptions.filter(so => so.optionId !== optionId);
      } else if (exists) {
        newOpts = prev.selectedOptions.map(so =>
          so.optionId === optionId ? { ...so, quantity: normalizedQty } : so
        );
      } else {
        newOpts = [...prev.selectedOptions, { optionId, quantity: normalizedQty, totalPrice: 0 }];
      }
      return recalcPrice({ ...prev, selectedOptions: newOpts });
    });
  };

  const setResourceQuantity = (resourceId, quantity) => {
    setForm(prev => {
      const resource = availableResources.find(r => r.id === resourceId);
      const maxAvailable = Math.max(0, Number(resource?.available || 0));
      const parsed = Number(quantity);
      const normalizedQty = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(maxAvailable, parsed));

      const exists = prev.selectedResources.find(sr => sr.resourceId === resourceId);
      let newResources = prev.selectedResources;

      if (normalizedQty <= 0) {
        newResources = prev.selectedResources.filter(sr => sr.resourceId !== resourceId);
      } else if (exists) {
        newResources = prev.selectedResources.map(sr =>
          sr.resourceId === resourceId
            ? { ...sr, quantity: normalizedQty, unitPrice: Number(resource?.price || sr.unitPrice || 0), totalPrice: Number(resource?.price || sr.unitPrice || 0) * normalizedQty }
            : sr
        );
      } else {
        newResources = [
          ...prev.selectedResources,
          {
            resourceId,
            quantity: normalizedQty,
            unitPrice: Number(resource?.price || 0),
            totalPrice: Number(resource?.price || 0) * normalizedQty,
          }
        ];
      }

      return recalcPrice({ ...prev, selectedResources: newResources });
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

    if (exceedsSingleBedsLimit || exceedsDoubleBedsLimit) {
      setErrorMsg('Le nombre de lits saisi dépasse la capacité configurée du logement.');
      return;
    }

    for (const sr of (form.selectedResources || [])) {
      const resource = availableResources.find(r => r.id === sr.resourceId);
      if (!resource) continue;
      if ((Number(sr.quantity) || 0) > Number(resource.available || 0)) {
        setErrorMsg(`La ressource '${resource.name}' n'est plus disponible en quantité suffisante.`);
        return;
      }
    }

    try {
      if (editingReservationId) {
        let adjustedBalanceAmount = Number(form.balanceAmount || 0);
        const original = originalReservationRef.current;
        if (original && form.depositPaid && !form.balancePaid) {
          const delta = Number(form.finalPrice || 0) - Number(original.finalPrice || 0);
          if (delta !== 0) {
            adjustedBalanceAmount = Math.max(0, adjustedBalanceAmount + delta);
          }
        }
        await api.updateReservation(editingReservationId, {
          propertyId: Number(selectedProp),
          clientId: form.clientId,
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          babies: form.babies,
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
          totalPrice: form.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: form.finalPrice,
          depositAmount: form.depositAmount,
          depositDueDate: form.depositDueDate,
          depositPaid: form.depositPaid,
          balanceAmount: adjustedBalanceAmount,
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
          })),
          resources: form.selectedResources.map(sr => ({
            resourceId: sr.resourceId,
            quantity: sr.quantity,
            unitPrice: sr.unitPrice,
            totalPrice: sr.totalPrice,
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
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
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
          })),
          resources: form.selectedResources.map(sr => ({
            resourceId: sr.resourceId,
            quantity: sr.quantity,
            unitPrice: sr.unitPrice,
            totalPrice: sr.totalPrice,
          }))
        });
      }
      setDialogOpen(false);
      setEditingReservationId(null);
      originalReservationRef.current = null;
      setDragStartDate(null);
      setDragEndDate(null);
      lastLoadedRange.current = { from: '', to: '' };
      loadCalendarData();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la création de la réservation');
    }
  };

  const handleReservationClick = async (rawResId) => {
    if (isDragging) return;
    const resId = Number(rawResId);
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
      singleBeds: res.singleBeds ?? '',
      doubleBeds: res.doubleBeds ?? '',
      babyBeds: res.babyBeds ?? '',
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
      selectedResources: (res.resources || []).map(rr => ({
        resourceId: rr.resourceId,
        quantity: rr.quantity,
        unitPrice: rr.unitPrice,
        totalPrice: rr.totalPrice,
      })),
      depositPaid: !!res.depositPaid,
      balancePaid: !!res.balancePaid,
      cautionAmount: res.cautionAmount || 0,
      cautionReceived: !!res.cautionReceived,
      cautionReceivedDate: res.cautionReceivedDate || '',
      cautionReturned: !!res.cautionReturned,
      cautionReturnedDate: res.cautionReturnedDate || '',
    });
    originalReservationRef.current = {
      finalPrice: Number(res.finalPrice || 0),
      balanceAmount: Number(res.balanceAmount || 0),
      depositPaid: !!res.depositPaid,
      balancePaid: !!res.balancePaid,
    };
    await loadResourcesAvailability(res.startDate, res.endDate, resId);
    await loadBabyBedAvailability(res.startDate, res.endDate, resId);
    setEditingReservationId(resId);
    setDialogOpen(true);
  };

  const handleDeleteReservation = async () => {
    if (!editingReservationId) return;
    await api.deleteReservation(editingReservationId);
    setConfirmDeleteOpen(false);
    setDialogOpen(false);
    setEditingReservationId(null);
    lastLoadedRange.current = { from: '', to: '' };
    loadCalendarData();
  };

  const scrollToToday = () => {
    const now = new Date();
    setMonths(getMonthsRange(now.getFullYear(), now.getMonth(), 1));
    initialScrollDone.current = false;
    lastLoadedRange.current = { from: '', to: '' };
  };

  const cleaningHours = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;
  const maxSingleBeds = selectedProperty ? Number(selectedProperty.singleBeds ?? 0) : null;
  const maxDoubleBeds = selectedProperty ? Number(selectedProperty.doubleBeds ?? 0) : null;
  const bedsEntered = form.singleBeds !== '' || form.doubleBeds !== '';
  const adultsChildrenCount = (Number(form.adults) || 0) + (Number(form.children) || 0);
  const reservationBedCapacity = (Number(form.singleBeds) || 0) + (Number(form.doubleBeds) || 0) * 2;
  const bedsCapacityMismatch = bedsEntered && reservationBedCapacity < adultsChildrenCount;
  const exceedsSingleBedsLimit = maxSingleBeds !== null && form.singleBeds !== '' && Number(form.singleBeds) > maxSingleBeds;
  const exceedsDoubleBedsLimit = maxDoubleBeds !== null && form.doubleBeds !== '' && Number(form.doubleBeds) > maxDoubleBeds;
  const babyAvailableNumber = babyBedAvailability.available === null ? null : Number(babyBedAvailability.available || 0);
  const maxBabyBedsByRule = babyAvailableNumber === null
    ? Number(form.babies || 0)
    : Math.min(Number(form.babies || 0), babyAvailableNumber);
  const selectedBabyBeds = Number(form.babyBeds || 0);
  const remainingBabyBeds = babyAvailableNumber === null
    ? null
    : Math.max(0, babyAvailableNumber - selectedBabyBeds);

  useEffect(() => {
    if (babyAvailableNumber === null) return;
    const current = Number(form.babyBeds || 0);
    if (current > maxBabyBedsByRule) {
      setForm(prev => ({ ...prev, babyBeds: maxBabyBedsByRule }));
    }
  }, [form.babies, babyBedAvailability.available]);

  // Check if a reservation has visible mid-stay days in the current month
  const resHasMidDays = (res, y, m, dim) => {
    const monthStartStr = formatDate(y, m, 1);
    const monthEndStr = formatDate(y, m, dim);
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

  // ---------- CALENDAR NOTES ----------
  const NOTE_MAX_LENGTH = 50;

  const handleOpenNoteDialog = (dateStr) => {
    setNoteDialogDate(dateStr);
    setNoteDialogText(calendarNotes[dateStr] || '');
    setNoteDialogOpen(true);
  };

  const handleSaveNote = async () => {
    if (!selectedProp || !noteDialogDate) return;
    await api.upsertCalendarNote(selectedProp, noteDialogDate, noteDialogText);
    setCalendarNotes(prev => {
      const next = { ...prev };
      if (noteDialogText.trim()) next[noteDialogDate] = noteDialogText.trim();
      else delete next[noteDialogDate];
      return next;
    });
    setNoteDialogOpen(false);
  };

  const renderNoteLabel = (dateStr, hasReservation) => {
    const note = calendarNotes[dateStr];
    if (!note) return null;
    const fontSize = hasReservation ? 8 : 10;
    return (
      <Typography title={note} sx={{
        position: 'absolute', bottom: hasReservation ? 14 : 16, left: '50%', transform: 'translateX(-50%)',
        fontSize, lineHeight: 1.1, color: hasReservation ? 'rgba(255,255,255,0.9)' : '#1a1a1a',
        zIndex: 2, pointerEvents: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '90%', fontStyle: 'italic', fontWeight: 600,
        textShadow: hasReservation ? '0 0 2px rgba(0,0,0,0.5)' : 'none',
      }}>
        {note}
      </Typography>
    );
  };

  // ---------- RENDER A CALENDAR CELL ----------
  const visibleYears = [...new Set(months.map(m => m.year))];
  const allPublicHolidays = new Set();
  visibleYears.forEach(y => getFrenchPublicHolidays(y).forEach(d => allPublicHolidays.add(d)));

  const renderHolidayIndicators = (dateStr) => {
    const isPublicHoliday = allPublicHolidays.has(dateStr);
    const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
    return (
      <>
        {isPublicHoliday && (
          <Typography sx={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', fontSize: 14, color: '#d32f2f', zIndex: 3, pointerEvents: 'none', lineHeight: 1, opacity: 0.7, whiteSpace: 'nowrap' }}>férié</Typography>
        )}
        {schoolInfo && (
          <Box sx={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '3px', zIndex: 3, pointerEvents: 'none' }}>
            {schoolInfo.zones.map(z => (
              <Box key={z} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS[z] }} />
            ))}
          </Box>
        )}
      </>
    );
  };

  const renderDayCell = (day, y, m, dim) => {
    const dateStr = formatDate(y, m, day);
    const isPast = dateStr < today;
    const inDrag = isInDragRange(day, y, m);

    // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
    const departureRes = reservations.find(r => r.endDate === dateStr);
    const arrivalRes = reservations.find(r => r.startDate === dateStr);
    const midRes = reservations.find(r => dateStr > r.startDate && dateStr < r.endDate);

    // If mid-stay: full color fill
    if (midRes) {
      const color = getReservationColor(midRes.platform);
      const isToday = dateStr === today;
      // Show label on the true middle day of the entire reservation
      const resStart = new Date(midRes.startDate);
      const resEnd = new Date(midRes.endDate);
      const totalDays = Math.round((resEnd - resStart) / 86400000);
      const midDate = new Date(resStart);
      midDate.setDate(midDate.getDate() + Math.round(totalDays / 2));
      const midDateStr = formatDate(midDate.getFullYear(), midDate.getMonth(), midDate.getDate());
      const isLabelDay = dateStr === midDateStr;
      return (
        <Box key={day} data-date={dateStr} onClick={() => handleReservationClick(midRes.id)} onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }} sx={{
          textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', cursor: 'pointer',
          bgcolor: color, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64,
          opacity: isPast ? 0.5 : 1,
          border: isToday ? '3px solid #1976d2' : 'none',
          transition: 'border 0.2s',
        }}>
          {renderHolidayIndicators(dateStr)}
          {renderNoteLabel(dateStr, true)}
          {isLabelDay ? (
            <>
              <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
                {midRes.firstName} {midRes.lastName}
              </Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                {midRes.platform}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
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
      const isToday = dateStr === today;
      return (
        <Box key={day} data-date={dateStr}
          onMouseDown={() => !isPast && handleMouseDown(day, y, m)}
          onMouseEnter={() => handleMouseEnter(day, y, m)}
          onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }}
          sx={{
            textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
            cursor: isPast ? 'default' : 'pointer', fontSize: 14,
            bgcolor: isPast ? 'grey.300' : inDrag ? 'primary.light' : 'grey.100',
            color: isPast ? 'grey.500' : inDrag ? 'white' : 'text.primary',
            fontWeight: inDrag ? 600 : 400,
            border: isToday ? '3px solid #1976d2' : 'none',
            ...(!isPast && { '&:hover': { bgcolor: 'primary.light', color: 'white' } }),
            transition: 'background-color 0.15s, border 0.2s',
          }}
        >
          {renderHolidayIndicators(dateStr)}
          {renderNoteLabel(dateStr, false)}
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
      <Box key={day} data-date={dateStr}
        onMouseDown={(e) => {
          if (isPast) return;
          const pct = getClickPct(e);
          const onDepartZone = departureRes && pct <= departEndPct;
          const onArriveZone = arrivalRes && pct >= arrivePct;
          if (!onDepartZone && !onArriveZone) {
            handleMouseDown(day, y, m);
          }
        }}
        onMouseEnter={() => handleMouseEnter(day, y, m)}
        onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }}
        onClick={async (e) => {
          if (isDragging) return;
          const pct = getClickPct(e);
          if (departureRes && pct <= departEndPct) {
            handleReservationClick(departureRes.id);
          } else if (arrivalRes && pct >= arrivePct) {
            handleReservationClick(arrivalRes.id);
          } else if (departureRes && !arrivalRes) {
            // Free zone on departure-only day: create new reservation
            const startDate = formatDate(y, m, day);
            const endDate = formatDate(y, m, Math.min(day + 1, dim + 1));
            openNewReservation(startDate, endDate);
          } else if (!departureRes && arrivalRes) {
            // Free zone on arrival-only day: show arrival reservation
            handleReservationClick(arrivalRes.id);
          }
        }}
        title={tooltipParts.join('\n')}
        sx={{
          textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
          cursor: 'pointer', fontSize: 14, fontWeight: 600,
          background: gradient || 'grey.100',
          border: dateStr === today ? '3px solid #1976d2' : '1px solid #e0e0e0',
          color: 'text.primary', overflow: 'hidden',
          opacity: isPast ? 0.5 : 1,
          transition: 'border 0.2s',
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1, textShadow: '0 0 3px rgba(255,255,255,0.8)' }}>
          {day}
        </Box>
        {renderHolidayIndicators(dateStr)}
        {renderNoteLabel(dateStr, !!(departureRes || arrivalRes))}
        {/* Compact label for arrival on short reservations (no mid-day visible) */}
        {arrivalRes && !resHasMidDays(arrivalRes, y, m, dim) && (() => {
          const colorPct = 100 - (arrivePct || 0);
          const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
          const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
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
        {departureRes && !resHasMidDays(departureRes, y, m, dim) && !(departureRes.startDate >= formatDate(y, m, 1) && departureRes.startDate <= formatDate(y, m, dim)) && (() => {
          const colorPct = departEndPct || departPct || 0;
          const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
          const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
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

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: { xs: '100%', sm: 250 } }}>
            <InputLabel>Logement</InputLabel>
            <Select value={selectedProp} label="Logement" onChange={(e) => handleSelectProperty(e.target.value)}>
              {properties.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          {selectedProp && (
            <Button variant="text" onClick={() => setSelectedProp('')}>Vue logements</Button>
          )}
          <Button variant="outlined" onClick={scrollToToday} sx={{ width: { xs: '100%', sm: 'auto' } }}>Aujourd'hui</Button>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'white' }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.A }} />
              <Typography variant="caption" color="text.secondary">Zone A</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.B }} />
              <Typography variant="caption" color="text.secondary">Zone B</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.C }} />
              <Typography variant="caption" color="text.secondary">Zone C</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {selectedProp ? (
        <Card>
          <CardContent sx={{ p: 1 }}>
            <Box ref={scrollRef} onScroll={handleScroll}
              sx={{ height: { xs: 'calc(100vh - 290px)', md: 'calc(100vh - 250px)' }, overflowY: 'auto', overflowX: 'auto', pl: { xs: '8px', sm: '50px' } }}
            >
              <Box
                sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, userSelect: 'none', minWidth: 680 }}
                onMouseLeave={() => isDragging && setIsDragging(false)}
                onMouseUp={handleMouseUp}
              >
                {/* Sticky day names */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 5 }}>
                  {dayNames.map(d => (
                    <Box key={d} sx={{ textAlign: 'center', fontWeight: 600, py: 1, color: 'text.secondary', fontSize: 14 }}>{d}</Box>
                  ))}
                </Box>
                {/* Continuous day cells - organized by week/row */}
                {(() => {
                  const cells = [];
                  let col = 0;
                  const cellMonths = [];
                  
                  // Build all cells and track which month each belongs to
                  months.forEach(({ year: y, month: m }, mi) => {
                    const dim = getDaysInMonth(y, m);
                    const fow = new Date(y, m, 1).getDay();
                    const af = (fow + 6) % 7;
                    if (mi === 0) {
                      for (let i = 0; i < af; i++) {
                        cells.push(<Box key={`pad-${y}-${m}-${i}`} />);
                        cellMonths.push(null);
                        col = (col + 1) % 7;
                      }
                    }
                    for (let d = 1; d <= dim; d++) {
                      const monthKey = `${y}-${m}`;
                      const cell = renderDayCell(d, y, m, dim);
                      if (d === 1) {
                        const badgeLabel = `${monthNames[m].substring(0, 4)}. ${y}`;
                        cells.push(
                          <Box key={`m${y}-${m}-${d}`} sx={{ position: 'relative' }}>
                            <Box sx={{
                              position: 'absolute', top: 1, left: 1, zIndex: 4, pointerEvents: 'none',
                              bgcolor: 'primary.main', borderRadius: '4px', px: 0.5, py: '1px', lineHeight: 1,
                            }}>
                              <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap' }}>
                                {badgeLabel}
                              </Typography>
                            </Box>
                            {cell}
                          </Box>
                        );
                      } else {
                        cells.push(cell);
                      }
                      cellMonths.push(monthKey);
                      col = (col + 1) % 7;
                    }
                  });
                  
                  // Build rows and track which months appear in which rows
                  const rows = [];
                  const monthRowMap = {}; // monthKey -> array of row indices
                  let currentRow = [];
                  let currentRowMonthKey = null;
                  
                  cells.forEach((cell, idx) => {
                    currentRow.push(cell);
                    if (cellMonths[idx]) {
                      currentRowMonthKey = cellMonths[idx];
                    }
                    
                    if ((idx + 1) % 7 === 0) {
                      // End of week/row
                      const rowIndex = rows.length;
                      if (currentRowMonthKey) {
                        if (!monthRowMap[currentRowMonthKey]) {
                          monthRowMap[currentRowMonthKey] = [];
                        }
                        monthRowMap[currentRowMonthKey].push(rowIndex);
                      }
                      
                      rows.push({ monthKey: currentRowMonthKey, cells: currentRow });
                      currentRow = [];
                      currentRowMonthKey = null;
                    }
                  });
                  
                  // Determine which row should show each month's label (middle row)
                  const monthLabelRowMap = {};
                  Object.keys(monthRowMap).forEach(monthKey => {
                    const rowIndices = monthRowMap[monthKey];
                    const middleIndex = Math.floor((rowIndices[0] + rowIndices[rowIndices.length - 1]) / 2);
                    monthLabelRowMap[monthKey] = middleIndex;
                  });
                  
                  // Render rows with labels
                  return rows.map((row, rowIndex) => {
                    const shouldShowLabel = row.monthKey && monthLabelRowMap[row.monthKey] === rowIndex;
                    const [year, month] = row.monthKey ? row.monthKey.split('-').map(Number) : [0, 0];
                    
                    return (
                      <Box key={`row-${rowIndex}`} sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'relative' }}>
                        {shouldShowLabel && (
                          <Box sx={{ position: 'absolute', left: -45, top: 0, bottom: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                            <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap', lineHeight: 1 }}>
                              {monthNames[month].substring(0, 3)} {year}
                            </Typography>
                          </Box>
                        )}
                        {row.cells}
                      </Box>
                    );
                  });
                })()}
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <PropertyCalendarOverview
          title="Calendrier simplifié — 30 prochains jours"
          properties={properties}
          reservations={overviewReservations}
          platformColors={PLATFORM_COLORS}
          onPropertySelect={(property) => handleSelectProperty(property.id)}
        />
      )}

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onClose={() => setNoteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Note — {noteDialogDate}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth multiline rows={2} margin="dense"
            label="Note (50 car. max)"
            value={noteDialogText}
            onChange={e => setNoteDialogText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
            helperText={`${noteDialogText.length}/${NOTE_MAX_LENGTH}`}
          />
        </DialogContent>
        <DialogActions>
          {calendarNotes[noteDialogDate] && (
            <Button color="error" onClick={async () => {
              await api.deleteCalendarNote(selectedProp, noteDialogDate);
              setCalendarNotes(prev => { const next = { ...prev }; delete next[noteDialogDate]; return next; });
              setNoteDialogOpen(false);
            }}>Supprimer</Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setNoteDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveNote}>Enregistrer</Button>
        </DialogActions>
      </Dialog>

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
                <TextField label="Enfants (2 à 18 ans)" type="number" value={form.children} onChange={(e) => updateForm({ children: Number(e.target.value) })} fullWidth inputProps={{ min: 0 }} />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Bébés (0 à 2 ans)" type="number" value={form.babies} onChange={(e) => updateForm({ babies: Number(e.target.value) })} fullWidth inputProps={{ min: 0 }} />
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={4}>
                <TextField
                  label="Lits doubles"
                  type="number"
                  value={form.doubleBeds}
                  onChange={(e) => updateForm({ doubleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                  fullWidth
                  error={bedsCapacityMismatch || exceedsDoubleBedsLimit}
                  helperText={exceedsDoubleBedsLimit ? `Maximum logement: ${maxDoubleBeds}` : ''}
                  inputProps={{ min: 0, max: maxDoubleBeds ?? undefined }}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="Lits simples"
                  type="number"
                  value={form.singleBeds}
                  onChange={(e) => updateForm({ singleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                  fullWidth
                  error={bedsCapacityMismatch || exceedsSingleBedsLimit}
                  helperText={exceedsSingleBedsLimit ? `Maximum logement: ${maxSingleBeds}` : ''}
                  inputProps={{ min: 0, max: maxSingleBeds ?? undefined }}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="Lits bébé"
                  type="number"
                  value={form.babyBeds}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      updateForm({ babyBeds: '' });
                      return;
                    }
                    const n = Math.max(0, Number(val));
                    updateForm({ babyBeds: Math.min(n, maxBabyBedsByRule) });
                  }}
                  fullWidth
                  inputProps={{ min: 0, max: maxBabyBedsByRule }}
                  helperText={`Dispo restante: ${remainingBabyBeds === null ? '...' : remainingBabyBeds}`}
                />
              </Grid>
            </Grid>

            {bedsCapacityMismatch && (
              <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                Attention: la capacité des lits saisis ({reservationBedCapacity}) est inférieure au total adultes + enfants ({adultsChildrenCount}). Vous pouvez enregistrer, mais la configuration ne couvre pas toutes les personnes.
              </Typography>
            )}

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
                {propertyOptions.map(opt => {
                  const selected = form.selectedOptions.find(so => so.optionId === opt.id);
                  const nights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
                  const persons = (Number(form.adults) || 1) + (Number(form.children) || 0);
                  let factorHint = '';
                  if (opt.priceType === 'per_person') factorHint = `×${persons} pers.`;
                  else if (opt.priceType === 'per_night') factorHint = `×${nights} j.`;
                  else if (opt.priceType === 'per_person_per_night') factorHint = `×${persons} pers. ×${nights} j.`;
                  return (
                    <Box key={opt.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography sx={{ flex: 1 }}>{`${opt.title} — ${opt.price}€ ${PRICE_TYPE_LABELS[opt.priceType] || ''}`}</Typography>
                      <Typography variant="caption" sx={{ minWidth: 130, color: 'text.secondary' }}>
                        {factorHint}
                      </Typography>
                      <TextField
                        size="small"
                        type="number"
                        label="Qté"
                        value={selected ? selected.quantity : 0}
                        onChange={(e) => setOptionQuantity(opt.id, e.target.value)}
                        inputProps={{ min: 0 }}
                        sx={{ width: 90 }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}

            {availableResources.length > 0 && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" gutterBottom>Ressources</Typography>
                  {availableResources
                    .filter(resource => {
                      const n = (resource.name || '').toLowerCase();
                      return !(n.includes('lit') && (n.includes('bébé') || n.includes('bebe')));
                    })
                    .map(resource => {
                    const selected = form.selectedResources.find(sr => sr.resourceId === resource.id);
                    const unavailable = Number(resource.available || 0) <= 0;
                    const requestedTooMuch = selected && Number(selected.quantity || 0) > Number(resource.available || 0);
                    const nights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
                    const persons = (Number(form.adults) || 1) + (Number(form.children) || 0);
                    let factorHint = '';
                    if (resource.priceType === 'per_person') factorHint = `×${persons} pers.`;
                    else if (resource.priceType === 'per_night') factorHint = `×${nights} j.`;
                    else if (resource.priceType === 'per_person_per_night') factorHint = `×${persons} pers. ×${nights} j.`;
                    return (
                      <Box key={resource.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography sx={{ flex: 1 }}>{`${resource.name} — ${resource.price}€ ${PRICE_TYPE_LABELS[resource.priceType] || ''}`}</Typography>
                        <Typography variant="caption" sx={{ minWidth: 130, color: unavailable || requestedTooMuch ? 'error.main' : 'text.secondary', fontWeight: unavailable || requestedTooMuch ? 700 : 400 }}>
                          {unavailable ? 'Déjà réservée' : `${resource.available} dispo${factorHint ? ` • ${factorHint}` : ''}`}
                        </Typography>
                        <TextField
                          size="small"
                          type="number"
                          label="Qté"
                          value={selected ? selected.quantity : 0}
                          onChange={(e) => setResourceQuantity(resource.id, e.target.value)}
                          inputProps={{ min: 0, max: resource.available || 0 }}
                          error={requestedTooMuch}
                          sx={{ width: 90 }}
                        />
                      </Box>
                    );
                  })}
                </Box>
              </>
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
