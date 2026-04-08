import React, { useEffect, useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select,
  MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Autocomplete, Chip, Checkbox, FormControlLabel, Divider, Grid
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PageHeader from '../components/PageHeader';
import ClientFormFields from '../components/ClientFormFields';
import FormRow from '../components/FormRow';
import PropertyCalendarOverview from '../components/PropertyCalendarOverview';
import { PLATFORMS, getPlatformColor, PLATFORM_COLORS } from '../constants/platforms';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { getFrenchPublicHolidays, getSchoolHolidayInfo } from '../frenchHolidays';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { withFrom } from '../utils/navigation';

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

function shiftDate(dateStr, daysDelta) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + daysDelta);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
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
  return getPlatformColor(platform);
}

const CLEANING_COLOR = '#e53935';

const ZONE_COLORS = { A: '#1976d2', B: '#388e3c', C: '#f57c00' };

const EMPTY_CLIENT = {
  lastName: '',
  firstName: '',
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
  address: '',
  phone: '',
  phoneNumbers: [''],
  email: '',
  notes: ''
};

export default function CalendarPage() {
  const { confirm, alert } = useAppDialogs();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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
  const [newClient, setNewClient] = useState(EMPTY_CLIENT);
  const [newClientCityOptions, setNewClientCityOptions] = useState([]);
  const [propertyOptions, setPropertyOptions] = useState([]);
  const [availableResources, setAvailableResources] = useState([]);
  const [minNightsState, setMinNightsState] = useState({ breached: false, required: 0, nights: 0 });
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [form, setForm] = useState({
    clientId: null, adults: 1, children: 0, teens: 0, babies: 0, platform: 'direct',
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
  const pricingRequestRef = useRef(0);
  const [editingReservationId, setEditingReservationId] = useState(null);
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [calendarNotes, setCalendarNotes] = useState({});
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState('');
  const [noteDialogText, setNoteDialogText] = useState('');
  const newClientEmailError = !isValidEmail(newClient.email);
  const newClientPhoneErrors = (newClient.phoneNumbers || []).map((phone) => !isValidPhone(phone));
  const newClientPhoneError = newClientPhoneErrors.some(Boolean);
  const pricingQuoteSignature = useMemo(() => JSON.stringify({
    propertyId: selectedProp ? Number(selectedProp) : null,
    startDate: form.startDate,
    endDate: form.endDate,
    adults: Number(form.adults || 0),
    children: Number(form.children || 0),
    teens: Number(form.teens || 0),
    discountPercent: Number(form.discountPercent || 0),
    customPrice: form.customPrice === '' ? '' : Number(form.customPrice),
    depositPaid: Boolean(form.depositPaid),
    balancePaid: Boolean(form.balancePaid),
    depositAmount: form.depositPaid ? Number(form.depositAmount || 0) : null,
    balanceAmount: form.depositPaid && form.balancePaid ? Number(form.balanceAmount || 0) : null,
    selectedOptions: (form.selectedOptions || []).map((item) => ({ optionId: Number(item.optionId), quantity: Number(item.quantity || 0) })).sort((a, b) => a.optionId - b.optionId),
    selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: Number(item.resourceId), quantity: Number(item.quantity || 0) })).sort((a, b) => a.resourceId - b.resourceId),
  }), [selectedProp, form.startDate, form.endDate, form.adults, form.children, form.teens, form.discountPercent, form.customPrice, form.depositPaid, form.balancePaid, form.depositAmount, form.balanceAmount, form.selectedOptions, form.selectedResources]);

  const applyQuoteToForm = useCallback((prev, quote) => {
    const optionLinesById = new Map((quote.optionLines || []).map((line) => [Number(line.optionId), line]));
    const resourceLinesById = new Map((quote.resourceLines || []).map((line) => [Number(line.resourceId), line]));

    return {
      ...prev,
      totalPrice: Number(quote.totalPrice || 0),
      finalPrice: Number(quote.finalPrice || 0),
      depositAmount: Number(quote.depositAmount || 0),
      depositDueDate: quote.depositDueDate || '',
      balanceAmount: Number(quote.balanceAmount || 0),
      balanceDueDate: quote.balanceDueDate || '',
      selectedOptions: (prev.selectedOptions || []).map((item) => ({
        ...item,
        totalPrice: Number(optionLinesById.get(Number(item.optionId))?.totalPrice || 0),
      })),
      selectedResources: (prev.selectedResources || []).map((item) => {
        const line = resourceLinesById.get(Number(item.resourceId));
        return {
          ...item,
          unitPrice: Number(line?.unitPrice ?? item.unitPrice ?? 0),
          totalPrice: Number(line?.totalPrice || 0),
        };
      }),
    };
  }, []);

  const applyQuoteMinNights = useCallback((quote) => {
    setMinNightsState({
      breached: Boolean(quote?.minNightsBreached),
      required: Number(quote?.requiredMinNights || 0),
      nights: Number(quote?.nights || 0),
    });
  }, []);

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

  const loadResourcesAvailability = async (startDate, endDate, excludeReservationId = null, propertyId = selectedProp) => {
    if (!propertyId || !startDate || !endDate) {
      setAvailableResources([]);
      return;
    }
    const resources = await api.getResourcesAvailability({
      propertyId,
      startDate,
      endDate,
      ...(excludeReservationId ? { excludeReservationId } : {}),
    });
    setAvailableResources(resources);
  };

  const loadBabyBedAvailability = async (startDate, endDate, excludeReservationId = null, propertyId = selectedProp) => {
    if (!propertyId || !startDate || !endDate) {
      setBabyBedAvailability({ totalQuantity: 0, reserved: 0, available: null });
      return;
    }
    const data = await api.getBabyBedAvailability({
      propertyId,
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

  useEffect(() => {
    if (!dialogOpen || !selectedProp || !form.startDate || !form.endDate) return;

    const start = new Date(`${form.startDate}T00:00:00`);
    const end = new Date(`${form.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setMinNightsState({ breached: false, required: 0, nights: 0 });
      return;
    }

    const requestId = ++pricingRequestRef.current;

    const refreshBasePrice = async () => {
      try {
        const calc = await api.calculatePrice({
          propertyId: selectedProp,
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          discountPercent: form.discountPercent,
          customPrice: form.customPrice,
          depositPaid: form.depositPaid,
          balancePaid: form.balancePaid,
          depositAmount: form.depositAmount,
          balanceAmount: form.balanceAmount,
          selectedOptions: (form.selectedOptions || []).map((item) => ({ optionId: item.optionId, quantity: item.quantity })),
          selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: item.unitPrice })),
        });

        if (pricingRequestRef.current !== requestId) return;
        applyQuoteMinNights(calc);

        setForm(prev => {
          if (prev.startDate !== form.startDate || prev.endDate !== form.endDate) return prev;
          return applyQuoteToForm(prev, calc);
        });
      } catch (err) {
        // Keep the current form state if the quote refresh fails.
      }
    };

    refreshBasePrice();
  }, [dialogOpen, selectedProp, pricingQuoteSignature, applyQuoteToForm, applyQuoteMinNights]);

  useEffect(() => { loadClientsForSearch(clientSearch); }, [clientSearch]);

  useEffect(() => {
    const cp = (newClient.postalCode || '').trim();
    if (!createClientOpen || cp.length < 2) {
      setNewClientCityOptions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const cityQuery = (newClient.city || '').trim();
        const params = new URLSearchParams({
          codePostal: cp,
          fields: 'nom,code,codesPostaux',
          limit: '20',
        });
        if (cityQuery) params.set('nom', cityQuery);
        const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        const options = Array.from(new Set((data || []).map((city) => city.nom).filter(Boolean)));
        setNewClientCityOptions(options);
      } catch (err) {
        if (err.name !== 'AbortError') setNewClientCityOptions([]);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [createClientOpen, newClient.postalCode, newClient.city]);

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

  const openNewReservation = (startDate, endDate) => {
    const centerMonth = months[Math.floor(months.length / 2)] || { year: new Date().getFullYear(), month: new Date().getMonth() };
    const fromParams = new URLSearchParams();
    if (selectedProp) fromParams.set('propertyId', String(selectedProp));
    fromParams.set('year', String(centerMonth.year));
    fromParams.set('month', String(centerMonth.month));
    const fromUrl = `/calendar?${fromParams.toString()}`;

    navigate(withFrom(`/reservations/new?propertyId=${selectedProp}&startDate=${startDate}&endDate=${endDate}`, fromUrl));
  };

  const handleMouseUp = async () => {
    if (!isDragging || !dragStartDate || !dragEndDate) return;
    setIsDragging(false);
    const minDate = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const maxDate = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    const endDate = minDate === maxDate ? shiftDate(maxDate, 1) : maxDate;
    await openNewReservation(minDate, endDate);
  };

  const recalcPrice = (updatedForm) => {
    const base = updatedForm.totalPrice;
    const nights = Math.max(1, Math.round((new Date(updatedForm.endDate) - new Date(updatedForm.startDate)) / 86400000));
    const persons = (Number(updatedForm.adults) || 1) + (Number(updatedForm.children) || 0) + (Number(updatedForm.teens) || 0);
    const depositPercent = Number(selectedProperty?.depositPercent ?? 30);
    const depositDaysBefore = Number(selectedProperty?.depositDaysBefore ?? 30);
    const balanceDaysBefore = Number(selectedProperty?.balanceDaysBefore ?? 7);

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

    const autoDepositAmount = Math.round(final * (depositPercent / 100) * 100) / 100;
    const autoBalanceAmount = Math.round((final - autoDepositAmount) * 100) / 100;

    let depositAmount = autoDepositAmount;
    let balanceAmount = autoBalanceAmount;

    if (updatedForm.depositPaid && updatedForm.balancePaid) {
      depositAmount = Number(updatedForm.depositAmount || 0);
      balanceAmount = Number(updatedForm.balanceAmount || 0);
    } else if (updatedForm.depositPaid) {
      depositAmount = Number(updatedForm.depositAmount || 0);
      balanceAmount = Math.max(0, Math.round((final - depositAmount) * 100) / 100);
    }

    return {
      ...updatedForm,
      finalPrice: final,
      depositAmount,
      depositDueDate: shiftDate(updatedForm.startDate, -depositDaysBefore),
      balanceAmount,
      balanceDueDate: shiftDate(updatedForm.startDate, -balanceDaysBefore),
    };
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

  const closeCreateClient = () => {
    setCreateClientOpen(false);
    setNewClient(EMPTY_CLIENT);
    setNewClientCityOptions([]);
  };

  const closeReservationEditor = () => {
    setDialogOpen(false);
    setEditingReservationId(null);
    closeCreateClient();
  };

  const getTimeConflictMessage = (reservationForm) => {
    if (!reservationForm.startDate || !reservationForm.endDate) return '';

    const cleaning = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;
    const newCheckInHour = timeToHour(reservationForm.checkInTime || '15:00');
    const newCheckOutHour = timeToHour(reservationForm.checkOutTime || '10:00');
    const otherReservations = editingReservationId
      ? reservations.filter(r => r.id !== editingReservationId)
      : reservations;

    const prevRes = otherReservations.find(r => r.endDate === reservationForm.startDate);
    if (prevRes) {
      const prevCheckOutHour = timeToHour(prevRes.checkOutTime || '10:00');
      const availableFrom = prevCheckOutHour + cleaning;
      if (newCheckInHour < availableFrom) {
        const availH = String(Math.floor(availableFrom)).padStart(2, '0');
        const availM = availableFrom % 1 >= 0.5 ? '30' : '00';
        return `Impossible : le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h de ménage). Veuillez choisir une heure d'arrivée à partir de ${availH}:${availM}.`;
      }
    }

    const nextRes = otherReservations.find(r => r.startDate === reservationForm.endDate);
    if (nextRes) {
      const nextCheckInHour = timeToHour(nextRes.checkInTime || '15:00');
      if (newCheckOutHour + cleaning > nextCheckInHour) {
        const maxCheckOutHour = nextCheckInHour - cleaning;
        const maxH = String(Math.floor(maxCheckOutHour)).padStart(2, '0');
        const maxM = maxCheckOutHour % 1 >= 0.5 ? '30' : '00';
        return `Impossible : le départ à ${reservationForm.checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale pour cette réservation est ${maxH}:${maxM}.`;
      }
    }

    return '';
  };

  const handleReservationPropertyChange = async (propertyId) => {
    const nextPropertyId = Number(propertyId);
    if (!nextPropertyId) return;

    const [prop, opts, calc] = await Promise.all([
      api.getProperty(nextPropertyId),
      api.getOptions(),
      api.calculatePrice({
        propertyId: nextPropertyId,
        startDate: form.startDate,
        endDate: form.endDate,
        adults: form.adults,
        children: form.children,
        teens: form.teens,
      }),
    ]);

    const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(nextPropertyId));

    setSelectedProp(nextPropertyId);
    setSelectedProperty(prop);
    setPropertyOptions(availableOpts);
    applyQuoteMinNights(calc);
    setForm(prev => recalcPrice({
      ...prev,
      selectedOptions: [],
      selectedResources: [],
      singleBeds: '',
      doubleBeds: '',
      babyBeds: '',
      totalPrice: Number(calc.totalPrice || 0),
      cautionAmount: prop.defaultCautionAmount ?? 500,
      checkInTime: prev.checkInTime || calc.defaultCheckIn || prop.defaultCheckIn || '15:00',
      checkOutTime: prev.checkOutTime || calc.defaultCheckOut || prop.defaultCheckOut || '10:00',
    }));

    await Promise.all([
      loadResourcesAvailability(form.startDate, form.endDate, editingReservationId || null, nextPropertyId),
      loadBabyBedAvailability(form.startDate, form.endDate, editingReservationId || null, nextPropertyId),
    ]);
  };

  const handleCreateClient = async () => {
    if (newClientEmailError || newClientPhoneError) {
      await alert({ title: 'Client invalide', message: 'Veuillez corriger le format du mail ou du téléphone.' });
      return;
    }

    const normalizedPhones = (newClient.phoneNumbers || [])
      .map((phone) => String(phone || '').trim())
      .filter((phone) => phone !== '');
    const payload = {
      ...newClient,
      address: [newClient.streetNumber, newClient.street].filter(Boolean).join(' ').trim(),
      phoneNumbers: normalizedPhones,
      phone: normalizedPhones[0] || '',
    };

    const c = await api.createClient(payload);
    setForm(prev => ({ ...prev, clientId: c.id }));
    setClients(prev => prev.some(client => client.id === c.id) ? prev : [...prev, c]);
    closeCreateClient();
  };

  const handleSaveReservation = async (forceMinNights = false) => {
    // --- Common validation for create and update ---
    const excludeId = editingReservationId;

    // Filter out the reservation being edited for overlap checks
    const otherReservations = excludeId
      ? reservations.filter(r => r.id !== excludeId)
      : reservations;

    // Reject past start dates
    const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (form.startDate < todayStr) {
      await alert({ title: 'Conflit de réservation', message: 'Impossible de réserver dans le passé.' });
      return;
    }

    // Strict overlap: other reservations whose date range overlaps
    const hasOverlap = otherReservations.some(r => r.startDate < form.endDate && r.endDate > form.startDate);
    if (hasOverlap) {
      await alert({ title: 'Conflit de réservation', message: 'Ce logement est déjà réservé pour ces dates.' });
      return;
    }

    const timeConflictMessage = getTimeConflictMessage(form);
    if (timeConflictMessage) {
      await alert({ title: 'Conflit de réservation', message: timeConflictMessage });
      return;
    }
    // --- End common validation ---

    if (exceedsGuestCapacity) {
      const capacityParts = [];
      if (exceedsAdultsCapacity) capacityParts.push(`adultes: ${adultsCount}/${maxAdultsAllowed}`);
      if (exceedsChildrenCapacity) capacityParts.push(`enfants+ados (hors lit bébé): ${childrenTeensCountForCapacity}/${maxChildrenAllowed}`);
      if (exceedsBabiesCapacity) capacityParts.push(`bébés: ${babiesCount}/${maxBabiesAllowed}`);
      if (exceedsTotalCapacity) capacityParts.push(`total: ${totalGuestsCount}/${totalGuestsMax}`);
      await alert({
        title: 'Capacité du logement dépassée',
        message: `Le nombre de personnes dépasse la capacité configurée (${capacityParts.join(' • ')}).`,
      });
      return;
    }

    if (exceedsSingleBedsLimit || exceedsDoubleBedsLimit) {
      await alert({ title: 'Conflit de réservation', message: 'Le nombre de lits saisi dépasse la capacité configurée du logement.' });
      return;
    }

    for (const sr of (form.selectedResources || [])) {
      const resource = availableResources.find(r => r.id === sr.resourceId);
      if (!resource) continue;
      if ((Number(sr.quantity) || 0) > Number(resource.available || 0)) {
        await alert({ title: 'Conflit de réservation', message: `La ressource '${resource.name}' n'est plus disponible en quantité suffisante.` });
        return;
      }
    }

    try {
      const quote = await api.calculatePrice({
        propertyId: Number(selectedProp),
        startDate: form.startDate,
        endDate: form.endDate,
        adults: form.adults,
        children: form.children,
        teens: form.teens,
        discountPercent: form.discountPercent,
        customPrice: form.customPrice,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        depositAmount: form.depositAmount,
        balanceAmount: form.balanceAmount,
        selectedOptions: (form.selectedOptions || []).map((item) => ({ optionId: item.optionId, quantity: item.quantity })),
        selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: item.unitPrice })),
      });
      applyQuoteMinNights(quote);

      if (quote.minNightsBreached && !forceMinNights) {
        const proceed = await confirm({
          title: 'Durée minimale non respectée',
          message: `Cette réservation contient ${quote.nights} nuit(s), inférieur au minimum requis de ${quote.requiredMinNights} nuit(s). Voulez-vous forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return;
        await handleSaveReservation(true);
        return;
      }

      if (editingReservationId) {
        await api.updateReservation(editingReservationId, {
          propertyId: Number(selectedProp),
          clientId: form.clientId,
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          babies: form.babies,
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          depositPaid: form.depositPaid,
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          balancePaid: form.balancePaid,
          cautionAmount: form.cautionAmount,
          cautionReceived: form.cautionReceived,
          cautionReceivedDate: form.cautionReceivedDate,
          cautionReturned: form.cautionReturned,
          cautionReturnedDate: form.cautionReturnedDate,
          notes: form.notes,
          forceMinNights,
          options: quote.optionLines,
          resources: quote.resourceLines,
        });
      } else {
        await api.createReservation({
          propertyId: Number(selectedProp),
          clientId: form.clientId,
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          babies: form.babies,
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          cautionAmount: form.cautionAmount,
          notes: form.notes,
          forceMinNights,
          options: quote.optionLines,
          resources: quote.resourceLines,
        });
      }
      closeReservationEditor();
      setDragStartDate(null);
      setDragEndDate(null);
      lastLoadedRange.current = { from: '', to: '' };
      loadCalendarData();
    } catch (err) {
      if (err?.code === 'MIN_NIGHTS' && !forceMinNights) {
        const proceed = await confirm({
          title: 'Durée minimale non respectée',
          message: err.message || 'La durée minimale configurée pour cette saison n\'est pas respectée. Voulez-vous forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          await handleSaveReservation(true);
        }
        return;
      }
      await alert({ title: 'Erreur', message: err.message || 'Erreur lors de la création de la réservation' });
    }
  };

  const handleReservationClick = (rawResId) => {
    if (isDragging) return;
    const centerMonth = months[Math.floor(months.length / 2)] || { year: new Date().getFullYear(), month: new Date().getMonth() };
    const fromParams = new URLSearchParams();
    if (selectedProp) fromParams.set('propertyId', String(selectedProp));
    fromParams.set('year', String(centerMonth.year));
    fromParams.set('month', String(centerMonth.month));
    const fromUrl = `/calendar?${fromParams.toString()}`;

    navigate(withFrom(`/reservations/${rawResId}`, fromUrl));
  };

  const handleDeleteReservation = async () => {
    if (!editingReservationId) return;
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Êtes-vous sûr de vouloir supprimer cette réservation ? Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    await api.deleteReservation(editingReservationId);
    closeReservationEditor();
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
  const maxAdultsAllowed = selectedProperty ? Number(selectedProperty.maxAdults ?? 0) : null;
  const maxChildrenAllowed = selectedProperty ? Number(selectedProperty.maxChildren ?? 0) : null;
  const maxBabiesAllowed = selectedProperty ? Number(selectedProperty.maxBabies ?? 0) : null;
  const bedsEntered = form.singleBeds !== '' || form.doubleBeds !== '' || form.babyBeds !== '';
  const adultsCount = Number(form.adults) || 0;
  const childrenCount = Number(form.children) || 0;
  const teensCount = Number(form.teens) || 0;
  const babiesCount = Number(form.babies) || 0;
  const totalGuestsCount = adultsCount + childrenCount + teensCount + babiesCount;
  const totalGuestsMax = maxAdultsAllowed === null || maxChildrenAllowed === null || maxBabiesAllowed === null
    ? null
    : maxAdultsAllowed + maxChildrenAllowed + maxBabiesAllowed;
  const exceedsAdultsCapacity = maxAdultsAllowed !== null && adultsCount > maxAdultsAllowed;
  const exceedsBabiesCapacity = maxBabiesAllowed !== null && babiesCount > maxBabiesAllowed;
  const reservationBedCapacity = (Number(form.singleBeds) || 0) + (Number(form.doubleBeds) || 0) * 2;
  const exceedsSingleBedsLimit = maxSingleBeds !== null && form.singleBeds !== '' && Number(form.singleBeds) > maxSingleBeds;
  const exceedsDoubleBedsLimit = maxDoubleBeds !== null && form.doubleBeds !== '' && Number(form.doubleBeds) > maxDoubleBeds;
  const babyAvailableNumber = babyBedAvailability.available === null ? null : Number(babyBedAvailability.available || 0);
  const maxBabyBedsByRule = babyAvailableNumber === null
    ? babiesCount + childrenCount
    : Math.min(babiesCount + childrenCount, babyAvailableNumber);
  const selectedBabyBeds = Number(form.babyBeds || 0);
  const childrenSleepingInBabyBeds = Math.max(0, selectedBabyBeds - babiesCount);
  const childrenSleepingInRegularBeds = Math.max(0, childrenCount - childrenSleepingInBabyBeds);
  const childrenTeensCountForCapacity = childrenSleepingInRegularBeds + teensCount;
  const exceedsChildrenCapacity = maxChildrenAllowed !== null && childrenTeensCountForCapacity > maxChildrenAllowed;
  const exceedsTotalCapacity = totalGuestsMax !== null && totalGuestsCount > totalGuestsMax;
  const exceedsGuestCapacity = exceedsAdultsCapacity || exceedsChildrenCapacity || exceedsBabiesCapacity || exceedsTotalCapacity;
  const requiredRegularBeds = adultsCount + teensCount + childrenSleepingInRegularBeds;
  const bedsCapacityMismatch = bedsEntered && reservationBedCapacity < requiredRegularBeds;
  const remainingBabyBeds = babyAvailableNumber === null
    ? null
    : Math.max(0, babyAvailableNumber - selectedBabyBeds);

  useEffect(() => {
    if (babyAvailableNumber === null) return;
    const current = Number(form.babyBeds || 0);
    if (current > maxBabyBedsByRule) {
      setForm(prev => ({ ...prev, babyBeds: maxBabyBedsByRule }));
    }
  }, [form.babies, form.children, babyBedAvailability.available]);

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
            const endDate = shiftDate(startDate, 1);
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
      <PageHeader title="Calendrier des réservations" />

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
        const minNightsWarning = minNightsState.breached
          ? `Séjour trop court: ${minNightsState.nights} nuit(s) pour un minimum saisonnier de ${minNightsState.required} nuit(s).`
          : '';

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
                  onChange={(e) => updateForm({ startDate: e.target.value })}
                  error={minNightsState.breached}
                  fullWidth />
              </Grid>
              <Grid item xs={6}>
                <TextField label="Date de départ" type="date" value={form.endDate || ''}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: departureMin, max: departureMax || undefined }}
                  onChange={(e) => updateForm({ endDate: e.target.value })}
                  error={minNightsState.breached}
                  fullWidth />
              </Grid>
            </Grid>

            {minNightsState.breached && (
              <Typography variant="body2" color="error" sx={{ mt: -1 }}>
                {minNightsWarning}
              </Typography>
            )}

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
              <Grid item xs={3}>
                <TextField
                  label={`Adultes${maxAdultsAllowed !== null ? ` (max ${maxAdultsAllowed})` : ''}`}
                  type="number"
                  value={form.adults}
                  onChange={(e) => updateForm({ adults: Number(e.target.value) })}
                  fullWidth
                  inputProps={{ min: 1, max: maxAdultsAllowed ?? undefined }}
                  error={exceedsAdultsCapacity}
                />
              </Grid>
              <Grid item xs={3}>
                <TextField
                  label={`Enfants (2 à 12 ans)`}
                  type="number"
                  value={form.children}
                  onChange={(e) => updateForm({ children: Number(e.target.value) })}
                  fullWidth
                  inputProps={{ min: 0 }}
                  error={exceedsChildrenCapacity}
                />
              </Grid>
              <Grid item xs={3}>
                <TextField
                  label={`Ados (12 à 18 ans)`}
                  type="number"
                  value={form.teens}
                  onChange={(e) => updateForm({ teens: Number(e.target.value) })}
                  fullWidth
                  inputProps={{ min: 0 }}
                  error={exceedsChildrenCapacity}
                />
              </Grid>
              <Grid item xs={3}>
                <TextField
                  label={`Bébés (0 à 2 ans)`}
                  type="number"
                  value={form.babies}
                  onChange={(e) => updateForm({ babies: Number(e.target.value) })}
                  fullWidth
                  inputProps={{ min: 0, max: maxBabiesAllowed ?? undefined }}
                  error={exceedsBabiesCapacity}
                />
              </Grid>
            </Grid>

            {exceedsTotalCapacity && (
              <Typography variant="body2" color="error" sx={{ mt: -1 }}>
                Capacité totale dépassée: {totalGuestsCount}/{totalGuestsMax} personnes.
              </Typography>
            )}

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
                Attention: la capacité des lits classiques saisis ({reservationBedCapacity}) est inférieure au besoin réel ({requiredRegularBeds}). Les enfants de 2 à 12 ans placés en lit bébé sont déduits automatiquement du calcul.
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
                  const persons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
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
                    const persons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
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
            <Button color="error" startIcon={<DeleteIcon />} onClick={handleDeleteReservation} sx={{ mr: 'auto' }}>
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
            <FormRow>
              <TextField label="Nom" value={newClient.lastName} onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })} fullWidth />
              <TextField label="Prénom" value={newClient.firstName} onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })} fullWidth />
            </FormRow>
            <TextField
              label="Email"
              value={newClient.email}
              onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
              fullWidth
              error={newClientEmailError}
              helperText={newClientEmailError ? 'Format email invalide' : ''}
            />
            <TextField
              label="Téléphone"
              value={newClient.phone}
              onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
              fullWidth
              error={newClientPhoneError}
              helperText={newClientPhoneError ? 'Format téléphone invalide' : ''}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateClientOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleCreateClient} disabled={!newClient.lastName || !newClient.firstName || newClientEmailError || newClientPhoneError}>Créer</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
