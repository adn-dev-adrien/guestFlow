import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, TextField, Grid, Autocomplete, Button, Divider, FormControl, InputLabel, Select,
  MenuItem, Typography, CircularProgress, Chip, FormControlLabel, Checkbox,
  Switch, Stack, Card, CardContent, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, FormHelperText
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import FormRow from '../components/FormRow';
import { PLATFORMS } from '../constants/platforms';
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
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [existingReservationLocked, setExistingReservationLocked] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const pendingLeaveActionRef = useRef(null);

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
  const isDirty = initialSnapshot !== null && formSnapshot !== initialSnapshot;

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
            adults: 1,
            children: 0,
            teens: 0,
          });

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
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

    const refreshBasePrice = async () => {
      try {
        const calc = await api.calculatePrice({
          propertyId: selectedProp,
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
        });

        setForm(prev => {
          if (prev.startDate !== form.startDate || prev.endDate !== form.endDate || prev.adults !== form.adults || prev.children !== form.children || prev.teens !== form.teens) {
            return prev;
          }
          return recalcPrice({
            ...prev,
            totalPrice: Number(calc.totalPrice || 0),
          });
        });
      } catch (err) {
        // Keep current form state if quote refresh fails
      }
    };

    refreshBasePrice();
  }, [selectedProp, form.startDate, form.endDate, form.adults, form.children, form.teens]);

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
        adults: form.adults,
        children: form.children,
        teens: form.teens,
      }),
      api.getReservations({ propertyId: nextPropertyId }),
    ]);

    const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(nextPropertyId));

    setSelectedProp(nextPropertyId);
    setSelectedProperty(prop);
    setReservations(allRes || []);
    setPropertyOptions(availableOpts);
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

  // ==================== SAVE & DELETE ====================
  const handleSaveReservation = async () => {
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

    const otherReservations = editingReservationId
      ? reservations.filter(r => r.id !== editingReservationId)
      : reservations;

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
      if (reservationId) {
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
          })),
          resources: form.selectedResources.map(sr => ({
            resourceId: sr.resourceId,
            quantity: sr.quantity,
            unitPrice: sr.unitPrice,
            totalPrice: sr.totalPrice,
          }))
        });
        navigateBackWithFrom(navigate, from);
      } else {
        const res = await api.createReservation({
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
        navigateBackWithFrom(navigate, from);
      }
    } catch (err) {
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
    await handleSaveReservation();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const goBackToOrigin = () => {
    requestLeave(() => navigateBackWithFrom(navigate, from));
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
  const datesUnavailableForProperty = Boolean(
    selectedProp
      && form.startDate
      && form.endDate
      && otherReservations.some((r) => r.startDate < form.endDate && r.endDate > form.startDate)
  );
  const datesUnavailableMessage = 'Ces dates ne sont pas dispo pour ce logement.';
  const liveTimeConflictMessage = getTimeConflictMessage(form);

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
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
          maxWidth: 900,
          mx: 'auto',
          px: 2,
          py: 3,
          mt: { xs: 9, sm: 10 },
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

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                label="Date d'arrivée"
                type="date"
                value={form.startDate || ''}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: arrivalMin, max: arrivalMax || undefined }}
                onChange={(e) => updateForm({ startDate: e.target.value })}
                error={datesUnavailableForProperty}
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
                onChange={(e) => updateForm({ endDate: e.target.value })}
                error={datesUnavailableForProperty}
                fullWidth
              />
            </Grid>
          </Grid>

          {datesUnavailableForProperty && (
            <Typography variant="body2" color="error" sx={{ mt: -1 }}>
              {datesUnavailableMessage}
            </Typography>
          )}

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

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <FormControl fullWidth error={Boolean(liveTimeConflictMessage)}>
                <InputLabel>Heure d'arrivée</InputLabel>
                <Select value={form.checkInTime} label="Heure d'arrivée" onChange={(e) => updateForm({ checkInTime: e.target.value })}>
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth error={Boolean(liveTimeConflictMessage)}>
                <InputLabel>Heure de départ</InputLabel>
                <Select value={form.checkOutTime} label="Heure de départ" onChange={(e) => updateForm({ checkOutTime: e.target.value })}>
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

          <Divider />

          {propertyOptions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Options</Typography>
              <Stack spacing={1.25}>
                {propertyOptions.map((opt) => {
                  const selected = form.selectedOptions.find((so) => so.optionId === opt.id);
                  const enabled = Boolean(selected && Number(selected.quantity) > 0);
                  const nights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
                  const persons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
                  let factorHint = '';
                  if (opt.priceType === 'per_person') factorHint = `×${persons} pers.`;
                  else if (opt.priceType === 'per_night') factorHint = `×${nights} j.`;
                  else if (opt.priceType === 'per_person_per_night') factorHint = `×${persons} pers. ×${nights} j.`;
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
                            <Typography variant="body2" color="text.secondary">{`${opt.price}€ ${PRICE_TYPE_LABELS[opt.priceType] || ''}${factorHint ? ` • ${factorHint}` : ''}`}</Typography>
                          </Box>
                          <Stack alignItems="flex-end" spacing={0.5}>
                            <FormControlLabel
                              sx={{ m: 0 }}
                              control={<Switch checked={enabled} onChange={(e) => setOptionEnabled(opt.id, e.target.checked)} />}
                              label="Activer"
                            />
                          </Stack>
                        </Stack>

                        {enabled && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }} justifyContent="space-between">
                            <TextField
                              size="small"
                              type="number"
                              label="Qté"
                              value={selected ? selected.quantity : 1}
                              onChange={(e) => setOptionQuantity(opt.id, e.target.value)}
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
                    const nights = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
                    const persons = (Number(form.adults) || 1) + (Number(form.children) || 0) + (Number(form.teens) || 0);
                    let factorHint = '';
                    if (resource.priceType === 'per_person') factorHint = `×${persons} pers.`;
                    else if (resource.priceType === 'per_night') factorHint = `×${nights} j.`;
                    else if (resource.priceType === 'per_person_per_night') factorHint = `×${persons} pers. ×${nights} j.`;
                    return (
                      <Card
                        key={resource.id}
                        variant="outlined"
                        sx={{
                          mb: 1,
                          borderColor: resourceConflict
                            ? 'error.main'
                            : unavailable
                              ? 'grey.400'
                              : enabled
                                ? '#1565c0'
                                : 'divider',
                          bgcolor: '#fff',
                          opacity: unavailable ? 0.72 : 1,
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease',
                        }}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                            <Box sx={{ flex: 1 }}>
                              <Typography sx={{ fontWeight: 600 }}>{resource.name}</Typography>
                              <Typography variant="body2" color="text.secondary">{`${resource.price}€ ${PRICE_TYPE_LABELS[resource.priceType] || ''}`}</Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: unavailable || requestedTooMuch ? 'error.main' : 'text.secondary', fontWeight: unavailable || requestedTooMuch ? 700 : 400 }}>
                              {unavailable ? 'Déjà réservée' : `${resource.available} dispo${factorHint ? ` • ${factorHint}` : ''}`}
                            </Typography>
                            <TextField
                              size="small"
                              type="number"
                              label="Qté"
                              value={selected ? selected.quantity : 0}
                              onChange={(e) => setResourceQuantity(resource.id, e.target.value)}
                              disabled={unavailable}
                              inputProps={{ min: 0, max: resource.available || 0 }}
                              error={resourceConflict}
                              helperText={resourceConflict ? 'Ressource non dispo sur ces dates' : ''}
                              sx={{ width: { xs: '100%', sm: 110 } }}
                            />
                          </Stack>
                        </CardContent>
                      </Card>
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
            <Grid item xs={6}>
              <TextField label="Acompte (€)" type="number" value={form.depositAmount}
                onChange={(e) => updateForm({ depositAmount: Number(e.target.value) })} fullWidth />
              <TextField label="À payer avant" type="date" value={form.depositDueDate}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => updateForm({ depositDueDate: e.target.value })} fullWidth sx={{ mt: 1 }} />
              <FormControlLabel
                control={<Checkbox checked={form.depositPaid || false} onChange={(e) => updateForm({ depositPaid: e.target.checked })} />}
                label="Acompte payé"
                sx={{ mt: 1 }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Solde (€)" type="number" value={form.balanceAmount}
                onChange={(e) => updateForm({ balanceAmount: Number(e.target.value) })} fullWidth />
              <TextField label="À payer avant" type="date" value={form.balanceDueDate}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => updateForm({ balanceDueDate: e.target.value })} fullWidth sx={{ mt: 1 }} />
              <FormControlLabel
                control={<Checkbox checked={form.balancePaid || false} onChange={(e) => updateForm({ balancePaid: e.target.checked })} />}
                label="Solde payé"
                sx={{ mt: 1 }}
              />
            </Grid>
          </Grid>

          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField label="Caution (€)" type="number" value={form.cautionAmount}
                onChange={(e) => updateForm({ cautionAmount: Number(e.target.value) })} fullWidth />
              <FormControlLabel
                control={<Checkbox checked={form.cautionReceived || false} onChange={(e) => updateForm({ cautionReceived: e.target.checked })} />}
                label="Caution reçue"
                sx={{ mt: 1 }}
              />
              <TextField label="Date réception" type="date" value={form.cautionReceivedDate}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => updateForm({ cautionReceivedDate: e.target.value })} fullWidth sx={{ mt: 1 }} />
            </Grid>
            <Grid item xs={6}>
              <Box />
              <FormControlLabel
                control={<Checkbox checked={form.cautionReturned || false} onChange={(e) => updateForm({ cautionReturned: e.target.checked })} />}
                label="Caution restituée"
                sx={{ mt: 5 }}
              />
              <TextField label="Date restitution" type="date" value={form.cautionReturnedDate}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => updateForm({ cautionReturnedDate: e.target.value })} fullWidth sx={{ mt: 1 }} />
            </Grid>
          </Grid>

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
