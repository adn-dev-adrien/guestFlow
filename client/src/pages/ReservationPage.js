import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, TextField, Grid, Autocomplete, Button, Divider, FormControl, InputLabel, Select,
  MenuItem, Typography, CircularProgress, Chip, FormControlLabel,
  Switch, Stack, Card, CardContent, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, FormHelperText, useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import FormRow from '../components/FormRow';
import MiniPlanningStrip from '../components/MiniPlanningStrip';
import { PLATFORMS, PLATFORM_COLORS } from '../constants/platforms';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { getFromParam, navigateBackWithFrom } from '../utils/navigation';

const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par jour',
  per_person_per_night: 'par pers./jour',
  per_hour: 'par heure',
  free: 'gratuit',
};

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

function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function diffDays(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

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

export default function ReservationPage() {
  const { reservationId } = useParams();
  const editingReservationId = reservationId ? Number(reservationId) : null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { confirm, alert } = useAppDialogs();
  const from = getFromParam(searchParams);
  const theme = useTheme();
  const downSm = useMediaQuery(theme.breakpoints.down('sm'));
  const downMd = useMediaQuery(theme.breakpoints.down('md'));
  const downLg = useMediaQuery(theme.breakpoints.down('lg'));

  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [newClient, setNewClient] = useState(EMPTY_CLIENT);
  const [newClientCityOptions, setNewClientCityOptions] = useState([]);
  const [propertyOptions, setPropertyOptions] = useState([]);
  const [availableResources, setAvailableResources] = useState([]);
  const [nightlyBreakdown, setNightlyBreakdown] = useState([]);
  const [minNightsState, setMinNightsState] = useState({ breached: false, required: 0, nights: 0 });
  const [useCurrentPricing, setUseCurrentPricing] = useState(false);
  const [showNightlyBreakdown, setShowNightlyBreakdown] = useState(false);
  const [offeredOptionIds, setOfferedOptionIds] = useState(new Set());
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [existingReservationLocked, setExistingReservationLocked] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const [miniCalendarStart, setMiniCalendarStart] = useState(formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  const [miniSelectionAnchor, setMiniSelectionAnchor] = useState('');
  const miniCenteredOnceRef = useRef(false);
  const manualDateInputChangeRef = useRef(false);
  const miniStripDateChangeRef = useRef(false);
  const initialPricingContextRef = useRef({ propertyId: null, startDate: '', endDate: '' });
  const frozenOptionUnitByQuantityRef = useRef({});
  const frozenResourceUnitByQuantityRef = useRef({});
  const pendingLeaveActionRef = useRef(null);
  const pricingQuoteRequestRef = useRef(0);

  const [form, setForm] = useState({
    clientId: null, adults: 1, children: 0, teens: 0, babies: 0, platform: 'direct',
    singleBeds: '', doubleBeds: '', babyBeds: '',
    totalPrice: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], selectedResources: [], checkInTime: '15:00', checkOutTime: '10:00',
    startDate: '', endDate: '', propertyId: null
  });

  const newClientEmailError = !isValidEmail(newClient.email);
  const newClientPhoneErrors = (newClient.phoneNumbers || []).map((phone) => !isValidPhone(phone));
  const newClientPhoneError = newClientPhoneErrors.some(Boolean);
  const formSnapshot = useMemo(() => JSON.stringify({
    selectedProp: selectedProp ? Number(selectedProp) : null,
    form,
  }), [selectedProp, form]);
  const pricingQuoteSignature = useMemo(() => JSON.stringify({
    propertyId: selectedProp ? Number(selectedProp) : null,
    startDate: form.startDate,
    endDate: form.endDate,
    checkInTime: form.checkInTime,
    checkOutTime: form.checkOutTime,
    adults: Number(form.adults || 0),
    children: Number(form.children || 0),
    teens: Number(form.teens || 0),
    discountPercent: Number(form.discountPercent || 0),
    customPrice: form.customPrice === '' ? '' : Number(form.customPrice),
    depositPaid: Boolean(form.depositPaid),
    balancePaid: Boolean(form.balancePaid),
    depositAmount: form.depositPaid ? Number(form.depositAmount || 0) : null,
    balanceAmount: form.depositPaid && form.balancePaid ? Number(form.balanceAmount || 0) : null,
    selectedOptions: (form.selectedOptions || [])
      .filter((item) => !propertyOptions.find((o) => o.id === Number(item.optionId))?.autoOptionType)
      .map((item) => ({ optionId: Number(item.optionId), quantity: Number(item.quantity || 0) }))
      .sort((a, b) => a.optionId - b.optionId),
    selectedResources: (form.selectedResources || [])
      .map((item) => ({ resourceId: Number(item.resourceId), quantity: Number(item.quantity || 0) }))
      .sort((a, b) => a.resourceId - b.resourceId),
  }), [selectedProp, form.startDate, form.endDate, form.checkInTime, form.checkOutTime, form.adults, form.children, form.teens, form.discountPercent, form.customPrice, form.depositPaid, form.balancePaid, form.depositAmount, form.balanceAmount, form.selectedOptions, form.selectedResources, propertyOptions]);
  const isDirty = initialSnapshot !== null && formSnapshot !== initialSnapshot;
  const miniVisibleDays = downSm ? 5 : downMd ? 6 : downLg ? 7 : 8;
  const isExistingReservationPricingLocked = Boolean(
    editingReservationId
      && initialPricingContextRef.current.startDate
      && Number(selectedProp) === Number(initialPricingContextRef.current.propertyId)
      && form.startDate === initialPricingContextRef.current.startDate
      && form.endDate === initialPricingContextRef.current.endDate
  );
  const shouldLockExistingPricing = isExistingReservationPricingLocked && !useCurrentPricing;

  const centerMiniCalendarOnRange = (startDate, endDate) => {
    if (!startDate) return;
    const nights = Math.max(1, diffDays(startDate, endDate || addDays(startDate, 1)));
    const centerDate = addDays(startDate, Math.floor((nights - 1) / 2));
    const newStart = addDays(centerDate, -Math.floor(miniVisibleDays / 2));
    if (newStart) setMiniCalendarStart(newStart);
  };

  const handleMiniDateClick = (dateStr) => {
    if (isReservationLocked) return;
    miniStripDateChangeRef.current = true;

    const defaultCheckIn = selectedProperty?.defaultCheckIn || '15:00';
    const defaultCheckOut = selectedProperty?.defaultCheckOut || '10:00';

    if (!miniSelectionAnchor || miniSelectionAnchor === dateStr) {
      setMiniSelectionAnchor(dateStr);
      updateForm({
        startDate: dateStr,
        endDate: addDays(dateStr, 1),
        checkInTime: defaultCheckIn,
        checkOutTime: defaultCheckOut,
      });
      return;
    }

    if (dateStr < miniSelectionAnchor) {
      setMiniSelectionAnchor(dateStr);
      updateForm({
        startDate: dateStr,
        endDate: addDays(dateStr, 1),
        checkInTime: defaultCheckIn,
        checkOutTime: defaultCheckOut,
      });
      return;
    }

    updateForm({
      startDate: miniSelectionAnchor,
      endDate: dateStr,
      checkInTime: defaultCheckIn,
      checkOutTime: defaultCheckOut,
    });
    setMiniSelectionAnchor('');
  };

  const handleManualDateInputChange = (changes) => {
    manualDateInputChangeRef.current = true;
    updateForm({
      ...changes,
      checkInTime: selectedProperty?.defaultCheckIn || '15:00',
      checkOutTime: selectedProperty?.defaultCheckOut || '10:00',
    });
  };

  useEffect(() => {
    if (!loading && initialSnapshot === null) {
      setInitialSnapshot(formSnapshot);
    }
  }, [loading, initialSnapshot, formSnapshot]);

  useEffect(() => {
    if (!isDirty) return;

    const onPopState = () => {
      pendingLeaveActionRef.current = () => navigate(-1);
      setUnsavedDialogOpen(true);
      // Keep user on the current page until they confirm.
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isDirty, navigate]);

  useEffect(() => {
    const guardHandler = (targetPath) => {
      if (!isDirty) return false;
      if (!targetPath || targetPath === window.location.pathname) return false;
      pendingLeaveActionRef.current = () => navigate(targetPath);
      setUnsavedDialogOpen(true);
      return true;
    };

    window.__guestflowBeforeNavigate = guardHandler;
    return () => {
      if (window.__guestflowBeforeNavigate === guardHandler) {
        delete window.__guestflowBeforeNavigate;
      }
    };
  }, [isDirty, navigate]);

  useEffect(() => {
    miniCenteredOnceRef.current = false;
    manualDateInputChangeRef.current = false;
    miniStripDateChangeRef.current = false;
    setMiniSelectionAnchor('');
  }, [selectedProp]);

  useEffect(() => {
    if (!form.startDate) return;

    if (!miniCenteredOnceRef.current) {
      centerMiniCalendarOnRange(form.startDate, form.endDate);
      miniCenteredOnceRef.current = true;
      return;
    }

    // Do not recenter when dates come from mini strip clicks.
    if (miniStripDateChangeRef.current) {
      miniStripDateChangeRef.current = false;
      return;
    }

    // Recenter only when user changed date manually through date inputs.
    if (manualDateInputChangeRef.current) {
      manualDateInputChangeRef.current = false;
      centerMiniCalendarOnRange(form.startDate, form.endDate);
    }
  }, [form.startDate, form.endDate, miniVisibleDays]);

  useEffect(() => {
    if (!miniSelectionAnchor) return;
    if (form.startDate !== miniSelectionAnchor) setMiniSelectionAnchor('');
  }, [form.startDate, miniSelectionAnchor]);

  const applyQuoteToForm = useCallback((prev, quote) => {
    const resourceLinesById = new Map((quote.resourceLines || []).map((line) => [Number(line.resourceId), line]));

    return {
      ...prev,
      totalPrice: Number(quote.totalPrice || 0),
      finalPrice: Number(quote.finalPrice || 0),
      depositAmount: Number(quote.depositAmount || 0),
      depositDueDate: quote.depositDueDate || '',
      balanceAmount: Number(quote.balanceAmount || 0),
      balanceDueDate: quote.balanceDueDate || '',
      selectedOptions: (quote.optionLines || []).map((line) => ({
        optionId: Number(line.optionId),
        quantity: Number(line.quantity || 0),
        totalPrice: Number(line.totalPrice || 0),
        ...(line.autoExtraHours !== undefined ? { autoExtraHours: Number(line.autoExtraHours) } : {}),
        ...(line.autoFullNightApplied !== undefined ? { autoFullNightApplied: Boolean(line.autoFullNightApplied) } : {}),
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

  // ==================== INITIALIZATION & DATA LOADING ====================
  useEffect(() => {
    const initPage = async () => {
      try {
        setLoading(true);
        const props = await api.getProperties();
        setProperties(props);

        // Determine initial property
        const urlPropId = searchParams.get('propertyId');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const initialPropId = reservationId ? null : (urlPropId ? Number(urlPropId) : (props.length > 0 ? props[0].id : ''));
        setExistingReservationLocked(false);
        
        if (initialPropId) {
          setSelectedProp(initialPropId);
          const prop = props.find(p => p.id === initialPropId);
          if (prop) {
            setSelectedProperty(prop);
            setPropertyOptions([]);
          }
        }

        // Load reservation details if editing
        if (reservationId) {
          const res = await api.getReservation(reservationId);
          const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
          setExistingReservationLocked(Boolean(res.startDate && res.startDate <= todayStr));
          const prop = props.find(p => p.id === res.propertyId);
          setSelectedProp(res.propertyId);
          setSelectedProperty(prop);
          
          const opts = await api.getOptions();
          const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(res.propertyId));
          setPropertyOptions(availableOpts);

          // Load all reservations for this property to check conflicts
          const allRes = await api.getReservations({ propertyId: res.propertyId });
          setReservations(allRes);

          setForm({
            clientId: res.clientId,
            adults: res.adults || 1,
            children: res.children || 0,
            teens: res.teens || 0,
            babies: res.babies || 0,
            platform: res.platform || 'direct',
            singleBeds: res.singleBeds || '',
            doubleBeds: res.doubleBeds || '',
            babyBeds: res.babyBeds || '',
            totalPrice: res.totalPrice || 0,
            discountPercent: res.discountPercent || 0,
            finalPrice: res.finalPrice || 0,
            customPrice: '',
            depositAmount: res.depositAmount || 0,
            depositDueDate: res.depositDueDate || '',
            balanceAmount: res.balanceAmount || 0,
            balanceDueDate: res.balanceDueDate || '',
            cautionAmount: res.cautionAmount || 0,
            cautionReceived: res.cautionReceived || false,
            cautionReceivedDate: res.cautionReceivedDate || '',
            cautionReturned: res.cautionReturned || false,
            cautionReturnedDate: res.cautionReturnedDate || '',
            notes: res.notes || '',
            selectedOptions: (res.options || []).map(o => ({ optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice })),
            selectedResources: (res.resources || []).map(r => ({ resourceId: r.resourceId, quantity: r.quantity, unitPrice: r.unitPrice, totalPrice: r.totalPrice })),
            checkInTime: res.checkInTime || '15:00',
            checkOutTime: res.checkOutTime || '10:00',
            startDate: res.startDate,
            endDate: res.endDate,
            propertyId: res.propertyId,
            depositPaid: res.depositPaid || false,
            balancePaid: res.balancePaid || false
          });

          initialPricingContextRef.current = {
            propertyId: res.propertyId,
            startDate: res.startDate,
            endDate: res.endDate,
          };
          
          // Charger les options offertes (totalPrice === 0)
          const offeredOpts = new Set((res.options || [])
            .filter(o => Number(o.totalPrice || 0) === 0)
            .map(o => o.optionId)
          );
          setOfferedOptionIds(offeredOpts);
          
          setUseCurrentPricing(false);
          frozenOptionUnitByQuantityRef.current = Object.fromEntries(
            (res.options || []).map((o) => [
              o.optionId,
              Math.max(0, Number(o.totalPrice || 0)) / Math.max(1, Number(o.quantity || 1)),
            ])
          );
          frozenResourceUnitByQuantityRef.current = Object.fromEntries(
            (res.resources || []).map((r) => [
              r.resourceId,
              Number(r.unitPrice !== undefined ? r.unitPrice : (Math.max(0, Number(r.totalPrice || 0)) / Math.max(1, Number(r.quantity || 1)))),
            ])
          );

          // Load resources
          await loadResourcesAvailability(res.startDate, res.endDate, res.propertyId, res.id);
          await loadBabyBedAvailability(res.startDate, res.endDate, res.propertyId, res.id);
        } else if (initialPropId && startDate && endDate) {
          // New reservation with pre-filled dates from URL
          const prop = await api.getProperty(initialPropId);
          const opts = await api.getOptions();
          const propIdNum = parseInt(initialPropId, 10);
          const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(propIdNum));
          setPropertyOptions(availableOpts);

          const calc = await api.calculatePrice({
            propertyId: initialPropId,
            startDate,
            endDate,
            checkInTime: prop.defaultCheckIn || '15:00',
            checkOutTime: prop.defaultCheckOut || '10:00',
            adults: 1,
            children: 0,
            teens: 0,
            ...(editingReservationId ? { reservationId: editingReservationId } : {}),
          });
          setNightlyBreakdown(calc.nightlyBreakdown || []);
          applyQuoteMinNights(calc);

          const allRes = await api.getReservations({ propertyId: initialPropId });
          setReservations(allRes);

          setForm({
            clientId: null,
            adults: 1,
            children: 0,
            teens: 0,
            babies: 0,
            platform: 'direct',
            singleBeds: '',
            doubleBeds: '',
            babyBeds: '',
            totalPrice: calc.totalPrice,
            discountPercent: 0,
            finalPrice: calc.totalPrice,
            customPrice: '',
            depositAmount: calc.depositAmount,
            depositDueDate: calc.depositDueDate,
            balanceAmount: calc.balanceAmount,
            balanceDueDate: calc.balanceDueDate,
            cautionAmount: prop.defaultCautionAmount ?? 500,
            cautionReceived: false,
            cautionReceivedDate: '',
            cautionReturned: false,
            cautionReturnedDate: '',
            notes: '',
            selectedOptions: [],
            selectedResources: [],
            checkInTime: calc.defaultCheckIn || prop.defaultCheckIn || '15:00',
            checkOutTime: calc.defaultCheckOut || prop.defaultCheckOut || '10:00',
            startDate,
            endDate,
            propertyId: initialPropId,
            depositPaid: false,
            balancePaid: false
          });

          await loadResourcesAvailability(startDate, endDate, initialPropId);
          await loadBabyBedAvailability(startDate, endDate, initialPropId);
        }

        setLoading(false);
      } catch (err) {
        console.error('Init error:', err);
        setLoading(false);
      }
    };

    initPage();
  }, [reservationId, searchParams]);

  // ==================== DATA LOADING FUNCTIONS ====================
  const loadResourcesAvailability = async (startDate, endDate, propertyId, excludeReservationId = null) => {
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

  const loadBabyBedAvailability = async (startDate, endDate, propertyId, excludeReservationId = null) => {
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

  const loadClientsForSearch = async (q) => {
    const data = await api.getClients(q);
    setClients(data);
  };

  useEffect(() => { loadClientsForSearch(clientSearch); }, [clientSearch]);

  // Auto-refresh base price when reservation parameters change
  useEffect(() => {
    if (!selectedProp || !form.startDate || !form.endDate) return;

    const start = new Date(`${form.startDate}T00:00:00`);
    const end = new Date(`${form.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setMinNightsState({ breached: false, required: 0, nights: 0 });
      return;
    }

    const requestId = ++pricingQuoteRequestRef.current;

    const refreshBasePrice = async () => {
      try {
        const calc = await api.calculatePrice({
          propertyId: selectedProp,
          startDate: form.startDate,
          endDate: form.endDate,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          discountPercent: form.discountPercent,
          customPrice: form.customPrice,
          depositPaid: form.depositPaid,
          balancePaid: form.balancePaid,
          depositAmount: form.depositAmount,
          balanceAmount: form.balanceAmount,
          selectedOptions: (form.selectedOptions || []).filter((item) => !propertyOptions.find((o) => o.id === Number(item.optionId))?.autoOptionType).map((item) => ({ optionId: item.optionId, quantity: item.quantity })),
          selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: item.unitPrice })),
          lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
          lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
          forceCurrentPricing: useCurrentPricing,
          ...(editingReservationId ? { reservationId: editingReservationId } : {}),
        });

        if (requestId !== pricingQuoteRequestRef.current) return;
        setNightlyBreakdown(calc.nightlyBreakdown || []);
        applyQuoteMinNights(calc);

        setForm(prev => {
          if (prev.startDate !== form.startDate || prev.endDate !== form.endDate || prev.adults !== form.adults || prev.children !== form.children || prev.teens !== form.teens) {
            return prev;
          }
          return applyQuoteToForm(prev, calc);
        });
      } catch (err) {
        // Keep current form state if quote refresh fails
      }
    };

    refreshBasePrice();
  }, [selectedProp, pricingQuoteSignature, shouldLockExistingPricing, applyQuoteToForm, applyQuoteMinNights, useCurrentPricing]);

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
        const options = Array.from(new Set((data || []).map((c) => c.nom).filter(Boolean)));
        setNewClientCityOptions(options);
      } catch (e) {
        if (e.name !== 'AbortError') setNewClientCityOptions([]);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [createClientOpen, newClient.postalCode, newClient.city]);

  // ==================== CAPACITY & PRICING CALCULATIONS ====================
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
      return 1;
    };

    let optionsTotal = 0;
    for (const so of updatedForm.selectedOptions) {
      const opt = propertyOptions.find(o => o.id === so.optionId);
      const userQty = Math.max(0, Number(so.quantity) || 0);
      if (!opt && !shouldLockExistingPricing) continue;
      const isAutoTimedOption = Boolean(opt?.autoOptionType)
        || so.autoExtraHours !== undefined
        || so.autoFullNightApplied !== undefined;

      // Auto timed options (early check-in / late check-out) are priced by server quote.
      // Keep their computed total instead of recomputing from option base price (often 0).
      if (isAutoTimedOption) {
        so.quantity = userQty;
        so.totalPrice = Number(so.totalPrice || 0);
        optionsTotal += so.totalPrice;
        continue;
      }

      const frozenUnitByQty = Number(frozenOptionUnitByQuantityRef.current[so.optionId]);
      const optTotal = shouldLockExistingPricing && Number.isFinite(frozenUnitByQty)
        ? frozenUnitByQty * userQty
        : Number(opt?.price || 0) * userQty * typeMultiplier(opt?.priceType);
      so.quantity = userQty;
      so.totalPrice = optTotal;
      optionsTotal += optTotal;
    }

    let resourcesTotal = 0;
    for (const sr of (updatedForm.selectedResources || [])) {
      const resource = availableResources.find(r => r.id === sr.resourceId);
      const frozenUnitByQty = Number(frozenResourceUnitByQuantityRef.current[sr.resourceId]);
      const hasFrozenResourcePrice = shouldLockExistingPricing && Number.isFinite(frozenUnitByQty);
      const unitPrice = shouldLockExistingPricing && Number.isFinite(frozenUnitByQty)
        ? frozenUnitByQty
        : (resource?.price !== undefined ? Number(resource.price) : Number(sr.unitPrice || 0));
      const qty = Math.max(0, Number(sr.quantity) || 0);
      sr.unitPrice = unitPrice;
      sr.totalPrice = hasFrozenResourcePrice
        ? unitPrice * qty
        : unitPrice * qty * typeMultiplier(resource?.priceType || 'per_stay');
      resourcesTotal += sr.totalPrice;
    }

    const subtotal = base + optionsTotal + resourcesTotal;
    
    // Appliquer la remise UNIQUEMENT au prix de l'hébergement
    let accommodationPrice = base;
    if (updatedForm.customPrice !== '') {
      accommodationPrice = Number(updatedForm.customPrice);
    } else {
      accommodationPrice = base * (1 - (updatedForm.discountPercent || 0) / 100);
    }
    accommodationPrice = Math.round(accommodationPrice * 100) / 100;
    
    // Le final price = prix accomodation remisé + options + ressources
    const final = Math.round((accommodationPrice + optionsTotal + resourcesTotal) * 100) / 100;

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

  // ==================== OPTIONS & RESOURCES ====================
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

  const setOptionEnabled = (optionId, enabled) => {
    const existing = form.selectedOptions.find((so) => so.optionId === optionId);
    if (enabled) {
      setOptionQuantity(optionId, Math.max(1, Number(existing?.quantity) || 1));
      return;
    }
    setOptionQuantity(optionId, 0);
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

  const setResourceEnabled = (resourceId, enabled) => {
    const existing = form.selectedResources.find((sr) => sr.resourceId === resourceId);
    if (enabled) {
      setResourceQuantity(resourceId, Math.max(1, Number(existing?.quantity) || 1));
      return;
    }
    setResourceQuantity(resourceId, 0);
  };

  // ==================== CLIENT CREATION ====================
  const closeCreateClient = () => {
    setCreateClientOpen(false);
    setNewClient(EMPTY_CLIENT);
    setNewClientCityOptions([]);
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

  // ==================== PROPERTY MANAGEMENT ====================
  const handleReservationPropertyChange = async (propertyId) => {
    const nextPropertyId = Number(propertyId);
    if (!nextPropertyId) return;

    const [prop, opts, calc, allRes] = await Promise.all([
      api.getProperty(nextPropertyId),
      api.getOptions(),
      api.calculatePrice({
        propertyId: nextPropertyId,
        startDate: form.startDate,
        endDate: form.endDate,
        checkInTime: form.checkInTime,
        checkOutTime: form.checkOutTime,
        adults: form.adults,
        children: form.children,
        teens: form.teens,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
      }),
      api.getReservations({ propertyId: nextPropertyId }),
    ]);

    const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(nextPropertyId));

    setSelectedProp(nextPropertyId);
    setSelectedProperty(prop);
    setReservations(allRes || []);
    setPropertyOptions(availableOpts);
    applyQuoteMinNights(calc);
    setUseCurrentPricing(false);
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
      loadResourcesAvailability(form.startDate, form.endDate, nextPropertyId, editingReservationId || null),
      loadBabyBedAvailability(form.startDate, form.endDate, nextPropertyId, editingReservationId || null),
    ]);
  };

  // ==================== CONFLICT CHECKING ====================
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

  const getDateRangeConflictInfo = useCallback((startDate, endDate) => {
    if (!selectedProp || !startDate || !endDate) return null;

    const otherReservations = editingReservationId
      ? reservations.filter((reservation) => reservation.id !== editingReservationId)
      : reservations;

    const conflictingReservation = otherReservations.find((reservation) => {
      const occupiedStartDate = timeToHour(reservation.checkInTime || '15:00') <= 10
        ? addDays(reservation.startDate, -1)
        : reservation.startDate;
      const occupiedEndDate = timeToHour(reservation.checkOutTime || '10:00') >= 17
        ? addDays(reservation.endDate, 2)
        : reservation.endDate;
      return occupiedStartDate < endDate && occupiedEndDate > startDate;
    });

    if (!conflictingReservation) return null;

    const hasEarlyArrivalBlock = timeToHour(conflictingReservation.checkInTime || '15:00') <= 10;
    const hasLateDepartureBlock = timeToHour(conflictingReservation.checkOutTime || '10:00') >= 17;
    const overlapsEarlyArrivalBlock = hasEarlyArrivalBlock
      && addDays(conflictingReservation.startDate, -1) < endDate
      && conflictingReservation.startDate >= startDate;
    const overlapsLateDepartureBlock = hasLateDepartureBlock
      && addDays(conflictingReservation.endDate, 2) > startDate
      && conflictingReservation.endDate <= endDate;

    let message = 'Ce logement est déjà réservé pour ces dates.';
    if (overlapsEarlyArrivalBlock) {
      message = 'Ce logement est déjà réservé pour ces dates. Une arrivée anticipée bloque aussi la nuit précédente.';
    } else if (overlapsLateDepartureBlock) {
      message = 'Ce logement est déjà réservé pour ces dates. Un départ tardif bloque aussi la nuit suivante.';
    }

    return {
      reservation: conflictingReservation,
      message,
    };
  }, [selectedProp, editingReservationId, reservations]);

  // ==================== SAVE & DELETE ====================
  const refreshToCurrentPricing = async () => {
    if (!editingReservationId || isReservationLocked) return;
    const proceed = await confirm({
      title: 'Actualiser les tarifs',
      message: 'Voulez-vous recalculer cette réservation avec les derniers tarifs en vigueur ? Tant que vous n\'enregistrez pas, les anciens prix restent conservés.',
      confirmLabel: 'Actualiser',
      cancelLabel: 'Annuler',
      confirmColor: 'warning',
    });
    if (!proceed) return;

    try {
      const calc = await api.calculatePrice({
        propertyId: Number(selectedProp),
        startDate: form.startDate,
        endDate: form.endDate,
        checkInTime: form.checkInTime,
        checkOutTime: form.checkOutTime,
        adults: form.adults,
        children: form.children,
        teens: form.teens,
        discountPercent: form.discountPercent,
        customPrice: form.customPrice,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        depositAmount: form.depositAmount,
        balanceAmount: form.balanceAmount,
        selectedOptions: (form.selectedOptions || []).filter((item) => !propertyOptions.find((o) => o.id === Number(item.optionId))?.autoOptionType).map((item) => ({ optionId: item.optionId, quantity: item.quantity })),
        selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: item.unitPrice })),
        reservationId: editingReservationId,
        forceCurrentPricing: true,
      });
      applyQuoteMinNights(calc);
      setNightlyBreakdown(calc.nightlyBreakdown || []);
      setUseCurrentPricing(true);
      setForm((prev) => applyQuoteToForm(prev, calc));
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible d\'actualiser les tarifs.' });
    }
  };

  const handleSaveReservation = async (afterSaveAction = null, forceMinNights = false, forceCapacity = false) => {
    const safeAfterSaveAction = typeof afterSaveAction === 'function' ? afterSaveAction : null;
    const isLockedReservation = Boolean(reservationId && existingReservationLocked);

    if (isLockedReservation) {
      await alert({
        title: 'Modification impossible',
        message: 'Cette réservation n\'est plus modifiable. Seules les réservations à venir peuvent être modifiées.',
      });
      return;
    }
    
    if (!selectedProp) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner un logement.' });
      return;
    }

    if (!form.startDate || !form.endDate) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner les dates.' });
      return;
    }

    if (!form.clientId) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner un client.' });
      return;
    }

    if (form.startDate < todayStr && !reservationId) {
      await alert({ title: 'Conflit de réservation', message: 'Impossible de réserver dans le passé.' });
      return;
    }

    const dateRangeConflictInfo = getDateRangeConflictInfo(form.startDate, form.endDate);
    if (dateRangeConflictInfo) {
      await alert({ title: 'Conflit de réservation', message: dateRangeConflictInfo.message });
      return;
    }

    const timeConflictMessage = getTimeConflictMessage(form);
    if (timeConflictMessage) {
      await alert({ title: 'Conflit de réservation', message: timeConflictMessage });
      return;
    }

    if (exceedsGuestCapacity && !forceCapacity) {
      const capacityParts = [];
      if (exceedsAdultsCapacity) capacityParts.push(`adultes: ${adultsCount}/${maxAdultsAllowed}`);
      if (exceedsChildrenCapacity) capacityParts.push(`enfants+ados (hors lit bébé): ${childrenTeensCountForCapacity}/${maxChildrenAllowed}`);
      if (exceedsBabiesCapacity) capacityParts.push(`bébés: ${babiesCount}/${maxBabiesAllowed}`);
      if (exceedsTotalCapacity) capacityParts.push(`total: ${totalGuestsCount}/${totalGuestsMax}`);
      const proceed = await confirm({
        title: 'Capacité du logement dépassée',
        message: `Le nombre de personnes dépasse la capacité configurée (${capacityParts.join(' • ')}). Voulez-vous forcer l'enregistrement ?`,
        confirmLabel: 'Forcer l\'enregistrement',
        cancelLabel: 'Annuler',
        confirmColor: 'warning',
      });
      if (proceed) {
        await handleSaveReservation(safeAfterSaveAction, forceMinNights, true);
      }
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
        checkInTime: form.checkInTime,
        checkOutTime: form.checkOutTime,
        adults: form.adults,
        children: form.children,
        teens: form.teens,
        discountPercent: form.discountPercent,
        customPrice: form.customPrice,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        depositAmount: form.depositAmount,
        balanceAmount: form.balanceAmount,
        selectedOptions: (form.selectedOptions || []).filter((item) => !propertyOptions.find((o) => o.id === Number(item.optionId))?.autoOptionType).map((item) => ({ optionId: item.optionId, quantity: item.quantity })),
        selectedResources: (form.selectedResources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: item.unitPrice })),
        lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
        lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
        forceCurrentPricing: useCurrentPricing,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
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
        await handleSaveReservation(safeAfterSaveAction, true, forceCapacity);
        return;
      }

      if (reservationId) {
        const optionsToSave = quote.optionLines.map(opt => {
          // Si l'option est offerte, mettre le totalPrice à 0
          if (offeredOptionIds.has(opt.optionId)) {
            return { ...opt, totalPrice: 0 };
          }
          return opt;
        });

        await api.updateReservation(reservationId, {
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
          refreshPricingToCurrent: useCurrentPricing,
          forceMinNights,
          forceCapacity,
          options: optionsToSave,
          resources: quote.resourceLines,
        });
        if (safeAfterSaveAction) {
          safeAfterSaveAction();
        } else {
          navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus());
        }
      } else {
        const optionsToSave = quote.optionLines.map(opt => {
          // Si l'option est offerte, mettre le totalPrice à 0
          if (offeredOptionIds.has(opt.optionId)) {
            return { ...opt, totalPrice: 0 };
          }
          return opt;
        });

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
          forceCapacity,
          options: optionsToSave,
          resources: quote.resourceLines,
        });
        if (safeAfterSaveAction) {
          safeAfterSaveAction();
        } else {
          navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus());
        }
      }
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
          await handleSaveReservation(safeAfterSaveAction, true, forceCapacity);
        }
        return;
      }
      await alert({ title: 'Erreur', message: err.message });
    }
  };

  const handleDeleteReservation = async () => {
    if (!reservationId) return;
    const isLockedReservation = Boolean(existingReservationLocked);
    if (isLockedReservation) {
      await alert({
        title: 'Suppression impossible',
        message: 'Cette réservation n\'est plus modifiable. Seules les réservations à venir peuvent être modifiées.',
      });
      return;
    }
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Êtes-vous sûr de vouloir supprimer cette réservation ? Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteReservation(reservationId);
      navigateBackWithFrom(navigate, from);
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message });
    }
  };

  const requestLeave = (action) => {
    if (!isDirty) {
      action();
      return;
    }
    pendingLeaveActionRef.current = action;
    setUnsavedDialogOpen(true);
  };

  const handleDiscardChanges = () => {
    setUnsavedDialogOpen(false);
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    if (action) action();
  };

  const handleSaveAndLeave = async () => {
    setUnsavedDialogOpen(false);
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    await handleSaveReservation(action);
  };

  const buildBackUrlWithReservationFocus = useCallback(() => {
    if (!from) return from;
    if (!from.startsWith('/calendar')) return from;

    const [basePath, rawQuery = ''] = from.split('?');
    const params = new URLSearchParams(rawQuery);

    if (selectedProp) params.set('propertyId', String(selectedProp));
    if (form.startDate) params.set('focusStartDate', form.startDate);
    if (form.endDate) params.set('focusEndDate', form.endDate);

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }, [from, selectedProp, form.startDate, form.endDate]);

  const loadHistory = useCallback(async () => {
    if (!editingReservationId) return;
    try {
      setHistoryLoading(true);
      const rows = await api.getReservationHistory(editingReservationId);
      setHistoryEntries(Array.isArray(rows) ? rows : []);
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible de charger l\'historique.' });
    } finally {
      setHistoryLoading(false);
    }
  }, [editingReservationId, alert]);

  const toggleHistory = async () => {
    if (!historyOpen && historyEntries.length === 0) {
      await loadHistory();
    }
    setHistoryOpen((prev) => !prev);
  };

  const formatHistoryDate = (value) => {
    if (!value) return '';
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const utcIso = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
    const date = new Date(utcIso);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('fr-FR');
  };

  const formatHistoryValue = (value) => {
    if (value === null || value === undefined || value === '') return 'vide';
    if (typeof value === 'number') return Number(value).toFixed(2).replace(/\.00$/, '');
    return String(value);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const goBackToOrigin = () => {
    requestLeave(() => navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus()));
  };

  // Date bounds to visually block unavailable dates in native date picker.
  const otherReservations = reservationId
    ? reservations.filter((r) => r.id !== Number(reservationId)).sort((a, b) => a.startDate.localeCompare(b.startDate))
    : [...reservations].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const prevResBound = otherReservations.filter((r) => r.endDate <= (form.startDate || todayStr));
  const arrivalMin = prevResBound.length > 0 ? prevResBound[prevResBound.length - 1].endDate : todayStr;
  const arrivalMax = form.endDate || '';
  const departureMin = form.startDate || '';
  const nextResBound = otherReservations.filter((r) => r.startDate >= (form.endDate || ''));
  const departureMax = nextResBound.length > 0 ? nextResBound[0].startDate : '';
  const isReservationLocked = Boolean(reservationId && existingReservationLocked);
  const dateRangeConflictInfo = getDateRangeConflictInfo(form.startDate, form.endDate);
  const datesUnavailableForProperty = Boolean(dateRangeConflictInfo);
  const datesUnavailableMessage = dateRangeConflictInfo?.message || 'Ces dates ne sont pas dispo pour ce logement.';
  const minNightsWarning = minNightsState.breached
    ? `Séjour trop court: ${minNightsState.nights} nuit(s) pour un minimum saisonnier de ${minNightsState.required} nuit(s).`
    : '';
  const liveTimeConflictMessage = getTimeConflictMessage(form);
  const defaultCheckInTime = selectedProperty?.defaultCheckIn || '15:00';
  const defaultCheckOutTime = selectedProperty?.defaultCheckOut || '10:00';
  const quantityPersons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
  const quantityNights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
  const getQuantityMultiplier = (priceType) => {
    if (priceType === 'per_person') return quantityPersons;
    if (priceType === 'per_night') return quantityNights;
    if (priceType === 'per_person_per_night') return quantityPersons * quantityNights;
    return 1;
  };
  const toDisplayedQuantity = (baseQuantity, priceType) => {
    const multiplier = getQuantityMultiplier(priceType);
    const value = (Number(baseQuantity) || 0) * multiplier;
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  };
  const toBaseQuantity = (displayedQuantity, priceType) => {
    const parsed = Number(displayedQuantity);
    if (Number.isNaN(parsed)) return 0;
    const multiplier = getQuantityMultiplier(priceType);
    if (!multiplier) return parsed;
    const value = parsed / multiplier;
    return Number.isInteger(value) ? value : Number(value.toFixed(4));
  };
  const accommodationBasePrice = Number(form.totalPrice || 0);
  const accommodationDiscountedPrice = form.customPrice !== ''
    ? Math.max(0, Number(form.customPrice || 0))
    : Math.round(accommodationBasePrice * (1 - (Number(form.discountPercent || 0) / 100)) * 100) / 100;
  const accommodationDiscountAmount = Math.max(0, Math.round((accommodationBasePrice - accommodationDiscountedPrice) * 100) / 100);

  const computedTitle = reservationId ? 'Modifier la réservation' : 'Nouvelle réservation';

  return (
    <Box sx={{ pb: 4 }}>
      <Box
        sx={{
          position: 'fixed',
          top: { xs: 56, sm: 64 },
          left: { xs: 0, md: 240 },
          width: { xs: '100%', md: 'calc(100% - 240px)' },
          zIndex: 1200,
          px: { xs: 1.5, sm: 2, md: 3 },
          py: 1,
        }}
      >
        <Box
          sx={{
            maxWidth: 900,
            mx: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            bgcolor: '#fff',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button startIcon={<ArrowBackIcon />} variant="text" onClick={goBackToOrigin}>
              Retour
            </Button>
            <Typography variant="h6" sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: 700 }}>
              {computedTitle}
            </Typography>
            {useCurrentPricing && (
              <Chip size="small" color="warning" variant="outlined" label="Tarifs actuels appliqués (non sauvegardé)" />
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {reservationId && (
              <Button variant="outlined" color="warning" onClick={refreshToCurrentPricing} disabled={isReservationLocked}>
                Actualiser tarifs
              </Button>
            )}
            <Button startIcon={<SaveIcon />} variant="contained" onClick={handleSaveReservation} disabled={isReservationLocked}>
              Enregistrer
            </Button>
            <Button variant="outlined" onClick={goBackToOrigin}>
              Annuler
            </Button>
            {reservationId && (
              <Button startIcon={<DeleteIcon />} color="error" variant="outlined" onClick={handleDeleteReservation} disabled={isReservationLocked}>
                Supprimer
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          maxWidth: 1300,
          mx: 'auto',
          px: 2,
          py: 3,
          mt: { xs: 9, sm: 10 },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 320px' },
          gap: 3,
          '& .MuiOutlinedInput-root': {
            bgcolor: '#fff',
          },
          '& .MuiFilledInput-root': {
            bgcolor: '#fff',
          },
          '& .MuiInputBase-root.Mui-disabled': {
            bgcolor: '#fff',
          },
        }}
      >
        {/* Colonne gauche : Formulaire */}
        <Box>
        {isReservationLocked && (
          <Typography variant="body2" color="warning.main" sx={{ mb: 1 }}>
            Cette réservation est passée ou en cours et ne peut plus être modifiée. Seules les réservations à venir sont modifiables.
          </Typography>
        )}

        <Box
          sx={{
            position: 'relative',
          }}
        >
          {isReservationLocked && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 5,
                cursor: 'not-allowed',
                bgcolor: 'transparent',
              }}
            />
          )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Logement</InputLabel>
            <Select
              value={selectedProp}
              label="Logement"
              onChange={(e) => handleReservationPropertyChange(e.target.value)}
            >
              {properties.map(p => <MenuItem key={p.id} value={p.id}>{p.label || p.name}</MenuItem>)}
            </Select>
          </FormControl>

          <MiniPlanningStrip
            miniCalendarStart={miniCalendarStart}
            setMiniCalendarStart={setMiniCalendarStart}
            miniVisibleDays={miniVisibleDays}
            reservations={reservations}
            selectedPropertyId={selectedProp}
            currentReservation={form}
            currentReservationId={editingReservationId}
            onDateClick={handleMiniDateClick}
            onRecenter={() => centerMiniCalendarOnRange(form.startDate, form.endDate)}
            isLocked={isReservationLocked}
          />

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                label="Date d'arrivée"
                type="date"
                value={form.startDate || ''}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: arrivalMin, max: arrivalMax || undefined }}
                onChange={(e) => handleManualDateInputChange({ startDate: e.target.value })}
                error={datesUnavailableForProperty || minNightsState.breached}
                fullWidth
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="Date de départ"
                type="date"
                value={form.endDate || ''}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: departureMin || undefined, max: departureMax || undefined }}
                onChange={(e) => handleManualDateInputChange({ endDate: e.target.value })}
                error={datesUnavailableForProperty || minNightsState.breached}
                fullWidth
              />
            </Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <FormControl fullWidth error={Boolean(liveTimeConflictMessage)}>
                <InputLabel>{`Heure d'arrivée (défaut ${defaultCheckInTime})`}</InputLabel>
                <Select
                  value={form.checkInTime}
                  label={`Heure d'arrivée (défaut ${defaultCheckInTime})`}
                  onChange={(e) => updateForm({ checkInTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth error={Boolean(liveTimeConflictMessage)}>
                <InputLabel>{`Heure de départ (défaut ${defaultCheckOutTime})`}</InputLabel>
                <Select
                  value={form.checkOutTime}
                  label={`Heure de départ (défaut ${defaultCheckOutTime})`}
                  onChange={(e) => updateForm({ checkOutTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          {liveTimeConflictMessage && (
            <FormHelperText error sx={{ mt: -1 }}>
              {liveTimeConflictMessage}
            </FormHelperText>
          )}

          {datesUnavailableForProperty && (
            <Typography variant="body2" color="error" sx={{ mt: -1 }}>
              {datesUnavailableMessage}
            </Typography>
          )}

          {minNightsState.breached && (
            <Typography variant="body2" color="error" sx={{ mt: datesUnavailableForProperty ? 0 : -1 }}>
              {minNightsWarning}
            </Typography>
          )}
          
          <Divider />

          <Autocomplete
            options={clients}
            getOptionLabel={(c) => c.id ? `${c.lastName} ${c.firstName} — ${c.email}` : ''}
            value={clients.find(c => c.id === form.clientId) || null}
            onInputChange={(_, val, reason) => { if (reason === 'input') setClientSearch(val); }}
            onChange={(_, val) => val && updateForm({ clientId: val.id })}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => <TextField {...params} label="Rechercher ou créer un client" />}
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

          {availableResources.length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" gutterBottom>Ressources</Typography>
                <Stack spacing={1.25}>
                  {availableResources
                    .filter(resource => {
                      const n = (resource.name || '').toLowerCase();
                      return !(n.includes('lit') && (n.includes('bébé') || n.includes('bebe')));
                    })
                    .map(resource => {
                      const selected = form.selectedResources.find(sr => sr.resourceId === resource.id);
                      const enabled = Boolean(selected && Number(selected.quantity) > 0);
                      const unavailable = Number(resource.available || 0) <= 0;
                      const requestedTooMuch = selected && Number(selected.quantity || 0) > Number(resource.available || 0);
                      const resourceConflict = Boolean(selected) && (unavailable || requestedTooMuch);
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
                                    : `${resource.price}€ ${PRICE_TYPE_LABELS[resource.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''} • ${resource.available} dispo`}
                                </Typography>
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
                                  label="Qté"
                                  value={selected ? toDisplayedQuantity(selected.quantity, resource.priceType) : getQuantityMultiplier(resource.priceType)}
                                  onChange={(e) => setResourceQuantity(resource.id, toBaseQuantity(e.target.value, resource.priceType))}
                                  inputProps={{ min: 1, max: (resource.available || 0) * getQuantityMultiplier(resource.priceType) }}
                                  error={resourceConflict}
                                  helperText={resourceConflict ? 'Ressource non dispo sur ces dates' : ''}
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

          <Divider />

          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ mb: 1.5 }}>Finance</Typography>

            <Grid container spacing={1.5} alignItems="stretch">
              <Grid item xs={12} md={6}>
                <Card variant="outlined" sx={{ height: '100%', bgcolor: '#f7fafc', borderColor: 'divider' }}>
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      Prix hébergement
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
                      {accommodationBasePrice.toFixed(2)}€
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Tarif brut avant remise
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    borderColor: accommodationDiscountAmount > 0 ? 'success.main' : 'divider',
                    bgcolor: accommodationDiscountAmount > 0 ? 'rgba(76, 175, 80, 0.08)' : '#fff',
                  }}
                >
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      Prix remisé
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5, color: accommodationDiscountAmount > 0 ? 'success.main' : 'text.primary' }}>
                      {accommodationDiscountedPrice.toFixed(2)}€
                    </Typography>
                    {accommodationDiscountAmount > 0 && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'success.dark' }}>
                        Économie: {accommodationDiscountAmount.toFixed(2)}€
                      </Typography>
                    )}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
                      <TextField
                        label="Réduction (%)"
                        type="number"
                        value={form.discountPercent}
                        onChange={(e) => updateForm({ discountPercent: Number(e.target.value), customPrice: '' })}
                        fullWidth
                        inputProps={{ min: 0, max: 100 }}
                      />
                      <TextField
                        label="Prix remisé manuel"
                        type="number"
                        value={form.customPrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateForm({ customPrice: val === '' ? '' : Math.max(0, Number(val) || 0) });
                        }}
                        fullWidth
                        inputProps={{ min: 0, step: 0.01 }}
                      />
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
              
          <Divider sx={{ my: 1 }} />
            
          <Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>Acompte</Typography>
                <TextField
                  label="Échéance acompte"
                  type="date"
                  value={form.depositDueDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => updateForm({ depositDueDate: e.target.value })}
                  fullWidth
                />
                <Button
                  fullWidth
                  variant={form.depositPaid ? 'contained' : 'outlined'}
                  color={form.depositPaid ? 'success' : 'inherit'}
                  onClick={() => updateForm({ depositPaid: !form.depositPaid })}
                  sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                >
                  {form.depositPaid ? 'Acompte payé' : 'Marquer acompte payé'}
                </Button>
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>Solde</Typography>
                <TextField
                  label="Échéance solde"
                  type="date"
                  value={form.balanceDueDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => updateForm({ balanceDueDate: e.target.value })}
                  fullWidth
                />
                <Button
                  fullWidth
                  variant={form.balancePaid ? 'contained' : 'outlined'}
                  color={form.balancePaid ? 'success' : 'inherit'}
                  onClick={() => updateForm({ balancePaid: !form.balancePaid })}
                  sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                >
                  {form.balancePaid ? 'Solde payé' : 'Marquer solde payé'}
                </Button>
              </Grid>
            </Grid>
          </Box>

          <Divider sx={{ my: 1 }} />

          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ mb: 1.5 }}>Caution</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={6}>
                <Button
                  fullWidth
                  variant={form.cautionReceived ? 'contained' : 'outlined'}
                  color={form.cautionReceived ? 'info' : 'inherit'}
                  onClick={() => {
                    const next = !form.cautionReceived;
                    const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                    updateForm({
                      cautionReceived: next,
                      cautionReceivedDate: next ? today : '',
                    });
                  }}
                  sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                >
                  {form.cautionReceived ? 'Caution reçue' : 'Marquer caution reçue'}
                </Button>
                <TextField
                  label="Date réception"
                  type="date"
                  value={form.cautionReceivedDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => {
                    const selectedDate = e.target.value;
                    updateForm({
                      cautionReceivedDate: selectedDate,
                      cautionReceived: selectedDate ? true : form.cautionReceived,
                    });
                  }}
                  fullWidth
                  sx={{ mt: 2 }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Button
                  fullWidth
                  variant={form.cautionReturned ? 'contained' : 'outlined'}
                  color={form.cautionReturned ? 'secondary' : 'inherit'}
                  onClick={() => {
                    const next = !form.cautionReturned;
                    const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                    updateForm({
                      cautionReturned: next,
                      cautionReturnedDate: next ? today : form.cautionReturnedDate,
                    });
                  }}
                  sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                >
                  {form.cautionReturned ? 'Caution restituée' : 'Marquer caution restituée'}
                </Button>
                <TextField
                  label="Date restitution"
                  type="date"
                  value={form.cautionReturnedDate}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => updateForm({ cautionReturnedDate: e.target.value })}
                  fullWidth
                  sx={{ mt: 2 }}
                />
              </Grid>
            </Grid>
          </Box>

          <Divider />

          <TextField
            label="Notes"
            multiline
            rows={3}
            value={form.notes}
            onChange={(e) => updateForm({ notes: e.target.value })}
            fullWidth
          />
          </Box>
        </Box>
        </Box>

        {/* Panneau latéral droit : Résumé des prix */}
        <Box
          sx={{
            position: { xs: 'static', md: 'sticky' },
            top: { md: 120 },
            height: 'fit-content',
          }}
        >
          <Card variant="outlined" sx={{ bgcolor: '#fff', p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Résumé tarifaire
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {selectedProperty?.label || selectedProperty?.name || 'Logement non sélectionné'}
            </Typography>

            {(() => {
              const nights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
              const persons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
              const adultsCount = Number(form.adults) || 1;
              const touristTaxRate = Number(selectedProperty?.touristTaxPerDayPerPerson || 0);
              const touristTaxTotal = Math.round(touristTaxRate * nights * adultsCount * 100) / 100;
              const optionsSelected = propertyOptions
                .map((opt) => form.selectedOptions.find((so) => so.optionId === opt.id))
                .filter((so) => so && Number(so.quantity) > 0);
              const resourcesSelected = availableResources
                .filter((resource) => {
                  const n = (resource.name || '').toLowerCase();
                  return !(n.includes('lit') && (n.includes('bébé') || n.includes('bebe')));
                })
                .map((res) => form.selectedResources.find((sr) => sr.resourceId === res.id))
                .filter((sr) => sr && Number(sr.quantity) > 0);
              const optionLineTotal = (so) => Number(so.totalPrice || 0);
              const resourceLineTotal = (sr) => Number(sr.totalPrice || 0);
              const optionsTotal = optionsSelected.reduce((acc, so) => {
                // Exclure les options offertes du total
                if (offeredOptionIds.has(so.optionId)) return acc;
                return acc + optionLineTotal(so);
              }, 0);
              const resourcesTotal = resourcesSelected.reduce((acc, sr) => acc + resourceLineTotal(sr), 0);
              const subtotal = form.totalPrice + optionsTotal + resourcesTotal;
              
              // La remise s'applique UNIQUEMENT au prix de l'hébergement
              let accommodationPriceAfterDiscount = form.totalPrice;
              let discountAmount = 0;
              if (form.customPrice !== '') {
                accommodationPriceAfterDiscount = Number(form.customPrice);
                discountAmount = Math.max(0, form.totalPrice - accommodationPriceAfterDiscount);
              } else if (form.discountPercent > 0) {
                discountAmount = Math.round(form.totalPrice * form.discountPercent / 100 * 100) / 100;
                accommodationPriceAfterDiscount = Math.round((form.totalPrice - discountAmount) * 100) / 100;
              }
              
              const totalSejour = Math.round((accommodationPriceAfterDiscount + optionsTotal + resourcesTotal + touristTaxTotal) * 100) / 100;

              return (
                <Stack spacing={1.5}>
                  {/* Prix hébergement */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">Prix hébergement</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
                      {(form.discountPercent > 0 || form.customPrice !== '') && (
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            fontWeight: 600,
                            textDecoration: 'line-through',
                            color: 'text.secondary'
                          }}
                        >
                          {form.totalPrice.toFixed(2)}€
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600, color: (form.discountPercent > 0 || form.customPrice !== '') ? 'success.main' : 'inherit' }}>
                        {accommodationPriceAfterDiscount.toFixed(2)}€
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                        {nightlyBreakdown.length > 0 ? (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => setShowNightlyBreakdown((prev) => !prev)}
                            sx={{ textTransform: 'none', p: 0, minWidth: 0, fontSize: 12 }}
                          >
                            {showNightlyBreakdown ? 'Masquer détail' : 'Détail'}
                          </Button>
                        ) : (
                          <Box />
                        )}
                        <Typography variant="caption" color="text.secondary">({nights} nuit{nights > 1 ? 's' : ''})</Typography>
                      </Box>
                    </Box>
                  </Box>

                  {nightlyBreakdown.length > 0 && showNightlyBreakdown && (
                    <Box
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        px: 1,
                        py: 0.75,
                        bgcolor: '#fafafa',
                        maxHeight: 160,
                        overflowY: 'auto',
                      }}
                    >
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                        Détail prix par nuit
                      </Typography>
                      {nightlyBreakdown.map((night) => (
                        <Box
                          key={`${night.date}-${night.nightNumber}`}
                          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.25 }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            Nuit {night.nightNumber} • {new Date(`${night.date}T00:00:00`).toLocaleDateString('fr-FR')}
                          </Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {Number(night.price || 0).toFixed(2)}€
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}

                  {/* Options */}
                  {optionsSelected.length > 0 && (
                    <>
                      <Divider />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Options
                      </Typography>
                      {optionsSelected.map(so => {
                        const opt = propertyOptions.find(o => o.id === so.optionId);
                        const total = optionLineTotal(so);
                        const isAuto = Boolean(opt?.autoOptionType);
                        const isOffered = offeredOptionIds.has(so.optionId);
                        let autoHint = '';
                        if (isAuto) {
                          if (so.autoFullNightApplied) autoHint = 'nuit complète';
                          else if (so.autoExtraHours > 0) autoHint = `${Number(so.autoExtraHours).toFixed(1).replace('.0', '')}h suppl.`;
                        }
                        return (
                          <Box key={so.optionId} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" color="text.secondary">
                                {opt?.title || '—'}{Number(so.quantity) > 1 ? ` ×${so.quantity}` : ''}
                              </Typography>
                              {autoHint && (
                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                  {autoHint}
                                </Typography>
                              )}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Button
                                  size="small"
                                  variant={isOffered ? 'contained' : 'outlined'}
                                  color={isOffered ? 'success' : 'inherit'}
                                  onClick={() => {
                                    const next = new Set(offeredOptionIds);
                                    if (isOffered) next.delete(so.optionId);
                                    else next.add(so.optionId);
                                    setOfferedOptionIds(next);
                                  }}
                                  sx={{ minWidth: 60, fontSize: 11, textTransform: 'none' }}
                                >
                                  {isOffered ? '✓ Offert' : 'Offrir'}
                                </Button>
                                <Typography 
                                    variant="body2" 
                                    sx={{ 
                                    fontWeight: 600, 
                                    whiteSpace: 'nowrap',
                                    textDecoration: isOffered ? 'line-through' : 'none',
                                    opacity: isOffered ? 0.6 : 1,
                                    color: isOffered ? 'text.secondary' : 'inherit'
                                    }}
                                >
                                    {total.toFixed(2)}€
                                </Typography>
                            </Box>
                          </Box>
                        );
                      })}
                    </>
                  )}

                  {/* Ressources */}
                  {resourcesSelected.length > 0 && (
                    <>
                      {optionsSelected.length === 0 && <Divider />}
                      <Divider />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Ressources
                      </Typography>
                      {resourcesSelected.map(sr => {
                        const res = availableResources.find(r => r.id === sr.resourceId);
                        const total = resourceLineTotal(sr);
                        return (
                          <Box key={sr.resourceId} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                              {res?.name || '—'}{Number(sr.quantity) > 1 ? ` ×${sr.quantity}` : ''}
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{total.toFixed(2)}€</Typography>
                          </Box>
                        );
                      })}
                    </>
                  )}

                  {/* Taxe de séjour */}
                  {touristTaxTotal > 0 && (
                    <>
                      <Divider />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" color="text.secondary">Taxe de séjour</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {touristTaxRate.toFixed(2)}€ × {adultsCount} adulte{adultsCount > 1 ? 's' : ''} × {nights} nuit{nights > 1 ? 's' : ''}
                          </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{touristTaxTotal.toFixed(2)}€</Typography>
                      </Box>
                    </>
                  )}

                  {/* Réduction sur l'hébergement */}
                  {discountAmount > 0 && (
                    <>
                      <Divider />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Remise sur hébergement
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          {form.customPrice !== '' ? 'Prix personnalisé' : `Remise ${form.discountPercent}%`}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'error.main' }}>
                          -{discountAmount.toFixed(2)}€
                        </Typography>
                      </Box>
                    </>
                  )}

                  {/* Total du séjour */}
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total du séjour</Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>{totalSejour.toFixed(2)}€</Typography>
                  </Box>

                  {/* Acompte */}
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Acompte</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.depositAmount.toFixed(2)}€</Typography>
                  </Box>
                  {form.depositDueDate && (
                    <Typography variant="caption" color="text.secondary">
                      À payer avant : {new Date(form.depositDueDate).toLocaleDateString('fr-FR')}
                    </Typography>
                  )}
                  {form.depositPaid && (
                    <Chip size="small" label="Acompte payé" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
                  )}

                  {/* Solde */}
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Solde</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.balanceAmount.toFixed(2)}€</Typography>
                  </Box>
                  {form.balanceDueDate && (
                    <Typography variant="caption" color="text.secondary">
                      À payer avant : {new Date(form.balanceDueDate).toLocaleDateString('fr-FR')}
                    </Typography>
                  )}
                  {form.balancePaid && (
                    <Chip size="small" label="Solde payé" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
                  )}

                  {/* Caution */}
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Caution</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.cautionAmount.toFixed(2)}€</Typography>
                  </Box>
                  {form.cautionReceived && (
                    <Chip size="small" label="Caution reçue" color="success" variant="outlined" sx={{ width: 'fit-content' }} />
                  )}
                  {form.cautionReturned && (
                    <Chip size="small" label="Caution restituée" color="info" variant="outlined" sx={{ width: 'fit-content' }} />
                  )}
                </Stack>
              );
            })()}
          </Card>
        </Box>
      </Box>

      {editingReservationId && (
        <Box sx={{ maxWidth: 1300, mx: 'auto', px: 2, pb: 1 }}>
          <Card variant="outlined" sx={{ bgcolor: '#fff' }}>
            <CardContent sx={{ py: 1.25 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2">Historique des modifications</Typography>
                <Button size="small" variant="outlined" onClick={toggleHistory}>
                  {historyOpen ? 'Masquer historique' : 'Voir historique'}
                </Button>
              </Box>

              {historyOpen && (
                <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {historyLoading && <Typography variant="body2" color="text.secondary">Chargement...</Typography>}

                  {!historyLoading && historyEntries.length === 0 && (
                    <Typography variant="body2" color="text.secondary">Aucun historique disponible.</Typography>
                  )}

                  {!historyLoading && historyEntries.map((entry) => {
                    const changes = Array.isArray(entry.changedFields) ? entry.changedFields : [];
                    const historyDetails = changes.map((change) => `${change.label}: ${formatHistoryValue(change.from)} -> ${formatHistoryValue(change.to)}`).join(' | ');
                    return (
                      <Box
                        key={entry.id}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 1,
                          py: 0.75,
                          bgcolor: '#fafafa',
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>
                            {entry.eventType === 'create' ? 'Création' : 'Modification'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatHistoryDate(entry.createdAt)}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                          {entry.eventType === 'create'
                            ? (historyDetails || 'Réservation créée')
                            : (historyDetails || 'Mise à jour sans changement détecté')}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Client Creation Dialog */}
      <FormDialog
        open={createClientOpen}
        onClose={closeCreateClient}
        title="Créer un nouveau client"
        onSubmit={handleCreateClient}
        submitDisabled={!newClient.lastName || !newClient.firstName || newClientEmailError || newClientPhoneError}
        submitLabel="Enregistrer"
        maxWidth="md"
      >
        <ClientFormFields
          form={newClient}
          setForm={setNewClient}
          cityOptions={newClientCityOptions}
          emailError={newClientEmailError}
          phoneErrors={newClientPhoneErrors}
        />
      </FormDialog>

      <Dialog open={unsavedDialogOpen} onClose={() => setUnsavedDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Modifications non enregistrées</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Vous avez des modifications non enregistrées. Voulez-vous enregistrer avant de quitter cette page ?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnsavedDialogOpen(false)}>Continuer l'édition</Button>
          <Button color="error" onClick={handleDiscardChanges}>Perdre les modifications</Button>
          <Button variant="contained" onClick={handleSaveAndLeave}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
