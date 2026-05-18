import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, TextField, Grid, Autocomplete, Button, Divider, FormControl, InputLabel, Select,
  MenuItem, Typography, CircularProgress, Chip, Stack, Card, CardContent, IconButton,
  FormControlLabel, Switch, useMediaQuery, Alert,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import FormRow from '../components/FormRow';
import MiniPlanningStrip from '../components/MiniPlanningStrip';
import { PLATFORMS } from '../constants/platforms';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { isValidEmail, isValidPhone } from '../utils/validation';

const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par nuit',
  per_person_per_night: 'par pers./nuit',
  per_hour: 'par heure',
  free: 'gratuit',
};

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'sent', label: 'Envoyé' },
  { value: 'accepted', label: 'Accepté' },
];

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayStr() {
  const n = new Date();
  return formatDate(n.getFullYear(), n.getMonth(), n.getDate());
}
function shiftDate(dateStr, delta) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + delta);
  return formatDate(d.getFullYear(), d.getMonth(), d.getDate());
}
function diffDays(s, e) {
  if (!s || !e) return 0;
  return Math.round((new Date(`${e}T00:00:00`) - new Date(`${s}T00:00:00`)) / 86400000);
}

const EMPTY_CLIENT = {
  lastName: '', firstName: '', streetNumber: '', street: '', postalCode: '',
  city: '', address: '', phone: '', phoneNumbers: [''], email: '', notes: '',
};

export default function DevisDetailPage() {
  const { devisId } = useParams();
  const editingId = devisId ? Number(devisId) : null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { confirm, alert } = useAppDialogs();
  const theme = useTheme();
  const downMd = useMediaQuery(theme.breakpoints.down('md'));

  // ── State ────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [pricingQuote, setPricingQuote] = useState(null);
  const [nightlyBreakdown, setNightlyBreakdown] = useState([]);
  const [showNightlyBreakdown, setShowNightlyBreakdown] = useState(false);
  const [miniCalendarStart, setMiniCalendarStart] = useState(
    formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  );
  const [miniSelectionAnchor, setMiniSelectionAnchor] = useState('');
  const [occupiedDates, setOccupiedDates] = useState([]);
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });

  const pricingQuoteRequestRef = useRef(0);
  const miniCenteredRef = useRef(false);

  const [form, setForm] = useState({
    clientId: null, adults: 1, children: 0, teens: 0, babies: 0,
    platform: 'direct', singleBeds: '', doubleBeds: '', babyBeds: '',
    totalPrice: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 0,
    customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    cautionAmount: 0, notes: '', selectedOptions: [], selectedResources: [],
    checkInTime: '15:00', checkOutTime: '10:00', startDate: '', endDate: '',
    status: 'draft', validUntil: '',
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  const updateForm = useCallback((changes) => setForm((prev) => ({ ...prev, ...changes })), []);

  const nights = diffDays(form.startDate, form.endDate);

  const miniVisibleDays = downMd ? 6 : 8;

  const centerMini = useCallback((startDate, endDate) => {
    if (!startDate) return;
    const n = Math.max(1, diffDays(startDate, endDate || shiftDate(startDate, 1)));
    const center = shiftDate(startDate, Math.floor((n - 1) / 2));
    const start = shiftDate(center, -Math.floor(miniVisibleDays / 2));
    if (start) setMiniCalendarStart(start);
  }, [miniVisibleDays]);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const [props, allClients] = await Promise.all([
          api.getProperties(),
          api.getClients(),
        ]);
        if (!mounted) return;
        setProperties(props || []);
        setClients(allClients || []);

        if (editingId) {
          const d = await api.getDevisById(editingId);
          if (!mounted) return;
          const prop = (props || []).find((p) => p.id === d.propertyId);
          setSelectedProp(d.propertyId);
          setSelectedProperty(prop || null);

          const [opts, allRes, resAvail, babyAvail] = await Promise.all([
            api.getOptions(),
            api.getReservations({ propertyId: d.propertyId }),
            d.startDate && d.endDate ? api.getResourcesAvailability({
              propertyId: d.propertyId, startDate: d.startDate, endDate: d.endDate,
              excludeDevisId: editingId,
            }).catch(() => []) : Promise.resolve([]),
            d.startDate && d.endDate ? api.getBabyBedAvailability({
              propertyId: d.propertyId, startDate: d.startDate, endDate: d.endDate,
            }).catch(() => ({ available: null })) : Promise.resolve({ available: null }),
          ]);
          if (!mounted) return;
          setPropertyOptions((opts || []).filter((o) =>
            !o.propertyIds?.length || o.propertyIds.includes(d.propertyId)
          ));
          setReservations(allRes || []);
          setAvailableResources(resAvail || []);
          setBabyBedAvailability(babyAvail || { available: null });

          setForm({
            clientId: d.clientId,
            adults: d.adults || 1, children: d.children || 0,
            teens: d.teens || 0, babies: d.babies || 0,
            platform: d.platform || 'direct',
            singleBeds: d.singleBeds ?? '', doubleBeds: d.doubleBeds ?? '', babyBeds: d.babyBeds ?? '',
            totalPrice: d.totalPrice || 0, touristTaxTotal: d.touristTaxTotal || 0,
            discountPercent: d.discountPercent || 0, finalPrice: d.finalPrice || 0,
            customPrice: '',
            depositAmount: d.depositAmount || 0, depositDueDate: d.depositDueDate || '',
            balanceAmount: d.balanceAmount || 0, balanceDueDate: d.balanceDueDate || '',
            cautionAmount: d.cautionAmount || 0, notes: d.notes || '',
            selectedOptions: (d.options || []).map((o) => ({
              optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice,
            })),
            selectedResources: (d.resources || []).map((r) => ({
              resourceId: r.resourceId, quantity: r.quantity,
              unitPrice: r.unitPrice, totalPrice: r.totalPrice,
            })),
            checkInTime: d.checkInTime || '15:00', checkOutTime: d.checkOutTime || '10:00',
            startDate: d.startDate, endDate: d.endDate,
            status: d.status || 'draft', validUntil: d.validUntil || '',
          });
          centerMini(d.startDate, d.endDate);
          miniCenteredRef.current = true;
        } else {
          // New devis — pre-fill from URL params
          const urlPropId = searchParams.get('propertyId') ? Number(searchParams.get('propertyId')) : null;
          const urlStart = searchParams.get('startDate') || '';
          const urlEnd = searchParams.get('endDate') || '';
          const urlClientId = searchParams.get('clientId') ? Number(searchParams.get('clientId')) : null;

          let initPropId = urlPropId || (props?.length ? props[0].id : null);
          if (initPropId) {
            const prop = (props || []).find((p) => p.id === initPropId);
            setSelectedProp(initPropId);
            setSelectedProperty(prop || null);
            const [opts, allRes] = await Promise.all([
              api.getOptions(),
              api.getReservations({ propertyId: initPropId }),
            ]);
            if (!mounted) return;
            setPropertyOptions((opts || []).filter((o) =>
              !o.propertyIds?.length || o.propertyIds.includes(initPropId)
            ));
            setReservations(allRes || []);
            updateForm({
              cautionAmount: prop?.defaultCautionAmount || 0,
              checkInTime: prop?.defaultCheckIn || '15:00',
              checkOutTime: prop?.defaultCheckOut || '10:00',
              startDate: urlStart, endDate: urlEnd,
              clientId: urlClientId,
              adults: Number(searchParams.get('adults') || 1),
              children: Number(searchParams.get('children') || 0),
              teens: Number(searchParams.get('teens') || 0),
              babies: Number(searchParams.get('babies') || 0),
            });
          }
          if (urlStart) { centerMini(urlStart, urlEnd); miniCenteredRef.current = true; }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [editingId]);

  // ── Client search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clientSearch || clientSearch.length < 2) return;
    let mounted = true;
    api.getClients(clientSearch).then((data) => {
      if (mounted) setClients(data || []);
    });
    return () => { mounted = false; };
  }, [clientSearch]);

  // ── Occupied dates ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedProp || !form.startDate || !form.endDate) return;
    let mounted = true;
    api.getOccupiedDates(selectedProp, form.startDate, form.endDate, null).then((data) => {
      if (mounted) setOccupiedDates(data || []);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedProp, form.startDate, form.endDate]);

  // ── Resources availability ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedProp || !form.startDate || !form.endDate) return;
    let mounted = true;
    api.getResourcesAvailability({
      propertyId: selectedProp, startDate: form.startDate, endDate: form.endDate,
    }).then((data) => {
      if (mounted) setAvailableResources(data || []);
    }).catch(() => {});
    api.getBabyBedAvailability({
      propertyId: selectedProp, startDate: form.startDate, endDate: form.endDate,
    }).then((data) => {
      if (mounted) setBabyBedAvailability(data || { available: null });
    }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedProp, form.startDate, form.endDate]);

  // ── Pricing auto-refresh ─────────────────────────────────────────────────
  const pricingKey = useMemo(() => JSON.stringify({
    propertyId: selectedProp,
    startDate: form.startDate,
    endDate: form.endDate,
    adults: form.adults,
    children: form.children,
    teens: form.teens,
    discountPercent: form.discountPercent,
    customPrice: form.customPrice,
    selectedOptions: (form.selectedOptions || [])
      .map((i) => ({ optionId: i.optionId, quantity: i.quantity }))
      .sort((a, b) => a.optionId - b.optionId),
    selectedResources: (form.selectedResources || [])
      .map((i) => ({ resourceId: i.resourceId, quantity: i.quantity }))
      .sort((a, b) => a.resourceId - b.resourceId),
  }), [selectedProp, form.startDate, form.endDate, form.adults, form.children, form.teens,
    form.discountPercent, form.customPrice, form.selectedOptions, form.selectedResources]);

  useEffect(() => {
    if (!selectedProp || !form.startDate || !form.endDate) return;
    const start = new Date(`${form.startDate}T00:00:00`);
    const end = new Date(`${form.endDate}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return;

    const reqId = ++pricingQuoteRequestRef.current;
    api.calculatePrice({
      propertyId: selectedProp,
      startDate: form.startDate,
      endDate: form.endDate,
      checkInTime: form.checkInTime,
      checkOutTime: form.checkOutTime,
      adults: form.adults,
      children: form.children,
      teens: form.teens,
      discountPercent: form.discountPercent,
      customPrice: form.customPrice !== '' ? Number(form.customPrice) : undefined,
      selectedOptions: (form.selectedOptions || []).map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
      selectedResources: (form.selectedResources || []).map((i) => ({ resourceId: i.resourceId, quantity: i.quantity, unitPrice: i.unitPrice })),
      offeredOptionIds: [],
    }).then((calc) => {
      if (reqId !== pricingQuoteRequestRef.current) return;
      setPricingQuote(calc);
      setNightlyBreakdown(calc.nightlyBreakdown || []);
      setForm((prev) => ({
        ...prev,
        totalPrice: calc.totalPrice ?? prev.totalPrice,
        touristTaxTotal: calc.touristTaxTotal ?? 0,
        finalPrice: calc.finalPrice ?? prev.finalPrice,
        depositAmount: Number(calc.depositAmount || 0),
        depositDueDate: calc.depositDueDate || prev.depositDueDate,
        balanceAmount: Number(calc.balanceAmount || 0),
        balanceDueDate: calc.balanceDueDate || prev.balanceDueDate,
        selectedOptions: (calc.optionLines || []).map((line) => ({
          optionId: Number(line.optionId),
          quantity: Number(line.quantity || 0),
          totalPrice: Number(line.totalPrice || 0),
        })),
        selectedResources: prev.selectedResources.map((item) => {
          const line = (calc.resourceLines || []).find((l) => Number(l.resourceId) === item.resourceId);
          return line ? { ...item, unitPrice: line.unitPrice, totalPrice: line.totalPrice } : item;
        }),
      }));
    }).catch(() => {});
  }, [pricingKey]);

  // ── City autocomplete for new client ─────────────────────────────────────
  useEffect(() => {
    const cp = (newClient.postalCode || '').trim();
    if (!createClientOpen || cp.length < 2) { setNewClientCityOptions([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom&limit=20`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const data = await res.json();
        setNewClientCityOptions(Array.from(new Set((data || []).map((c) => c.nom).filter(Boolean))));
      } catch (e) { if (e.name !== 'AbortError') setNewClientCityOptions([]); }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [createClientOpen, newClient.postalCode]);

  // ── Property change ───────────────────────────────────────────────────────
  const handlePropertyChange = async (propId) => {
    const id = Number(propId);
    if (!id) return;
    const prop = properties.find((p) => p.id === id);
    setSelectedProp(id);
    setSelectedProperty(prop || null);
    const [opts, allRes] = await Promise.all([
      api.getOptions(),
      api.getReservations({ propertyId: id }),
    ]);
    setPropertyOptions((opts || []).filter((o) => !o.propertyIds?.length || o.propertyIds.includes(id)));
    setReservations(allRes || []);
    updateForm({
      selectedOptions: [], selectedResources: [],
      cautionAmount: prop?.defaultCautionAmount || 0,
      checkInTime: prop?.defaultCheckIn || '15:00',
      checkOutTime: prop?.defaultCheckOut || '10:00',
    });
  };

  // ── Mini calendar ─────────────────────────────────────────────────────────
  const handleMiniDateClick = (dateStr) => {
    const defaultCheckIn = selectedProperty?.defaultCheckIn || '15:00';
    const defaultCheckOut = selectedProperty?.defaultCheckOut || '10:00';
    if (!miniSelectionAnchor || miniSelectionAnchor === dateStr) {
      setMiniSelectionAnchor(dateStr);
      updateForm({ startDate: dateStr, endDate: shiftDate(dateStr, 1), checkInTime: defaultCheckIn, checkOutTime: defaultCheckOut });
      return;
    }
    if (dateStr < miniSelectionAnchor) {
      setMiniSelectionAnchor(dateStr);
      updateForm({ startDate: dateStr, endDate: shiftDate(dateStr, 1), checkInTime: defaultCheckIn, checkOutTime: defaultCheckOut });
      return;
    }
    updateForm({ startDate: miniSelectionAnchor, endDate: dateStr, checkInTime: defaultCheckIn, checkOutTime: defaultCheckOut });
    setMiniSelectionAnchor('');
  };

  // ── Options / Resources ───────────────────────────────────────────────────
  const setOptionEnabled = (optionId, enabled) => {
    setForm((prev) => {
      const exists = prev.selectedOptions.find((o) => o.optionId === optionId);
      if (!enabled) return { ...prev, selectedOptions: prev.selectedOptions.filter((o) => o.optionId !== optionId) };
      if (exists) return prev;
      return { ...prev, selectedOptions: [...prev.selectedOptions, { optionId, quantity: 1, totalPrice: 0 }] };
    });
  };
  const setOptionQuantity = (optionId, qty) => {
    const q = Math.max(0, Number(qty) || 0);
    setForm((prev) => {
      if (q <= 0) return { ...prev, selectedOptions: prev.selectedOptions.filter((o) => o.optionId !== optionId) };
      return {
        ...prev,
        selectedOptions: prev.selectedOptions.map((o) => o.optionId === optionId ? { ...o, quantity: q } : o),
      };
    });
  };
  const setResourceEnabled = (resourceId, enabled) => {
    setForm((prev) => {
      const resource = availableResources.find((r) => r.id === resourceId);
      if (!enabled) return { ...prev, selectedResources: prev.selectedResources.filter((r) => r.resourceId !== resourceId) };
      const exists = prev.selectedResources.find((r) => r.resourceId === resourceId);
      if (exists) return prev;
      return { ...prev, selectedResources: [...prev.selectedResources, { resourceId, quantity: 1, unitPrice: Number(resource?.price || 0), totalPrice: 0 }] };
    });
  };
  const setResourceQuantity = (resourceId, qty) => {
    const resource = availableResources.find((r) => r.id === resourceId);
    const max = Math.max(0, Number(resource?.available || 0));
    const q = Math.max(0, Math.min(max, Number(qty) || 0));
    setForm((prev) => {
      if (q <= 0) return { ...prev, selectedResources: prev.selectedResources.filter((r) => r.resourceId !== resourceId) };
      return { ...prev, selectedResources: prev.selectedResources.map((r) => r.resourceId === resourceId ? { ...r, quantity: q } : r) };
    });
  };

  // ── Bed suggestion ────────────────────────────────────────────────────────
  const handleSuggestBeds = async () => {
    if (!selectedProp) return;
    try {
      const s = await api.suggestBeds({
        propertyId: Number(selectedProp), adults: form.adults,
        children: form.children, teens: form.teens, babies: form.babies,
      });
      updateForm({ singleBeds: Number(s.singleBeds || 0), doubleBeds: Number(s.doubleBeds || 0) });
    } catch (e) {
      await alert({ title: 'Suggestion impossible', message: e.message });
    }
  };

  // ── Capacity ──────────────────────────────────────────────────────────────
  const maxAdults = selectedProperty ? Number(selectedProperty.maxAdults ?? 0) : null;
  const maxChildren = selectedProperty ? Number(selectedProperty.maxChildren ?? 0) : null;
  const maxBabies = selectedProperty ? Number(selectedProperty.maxBabies ?? 0) : null;
  const exceedsAdults = maxAdults !== null && Number(form.adults) > maxAdults;
  const exceedsChildren = maxChildren !== null && Number(form.children) + Number(form.teens) > maxChildren;
  const exceedsBabies = maxBabies !== null && Number(form.babies) > maxBabies;
  const exceedsCapacity = exceedsAdults || exceedsChildren || exceedsBabies;

  // ── Date conflict ─────────────────────────────────────────────────────────
  const dateConflict = useMemo(() => {
    if (!selectedProp || !form.startDate || !form.endDate) return null;
    return getRangeOccupancyConflictInfo({
      startDate: form.startDate, endDate: form.endDate,
      occupiedDates, reservations, excludeReservationId: null,
    });
  }, [selectedProp, form.startDate, form.endDate, occupiedDates, reservations]);

  // ── Client dialog ─────────────────────────────────────────────────────────
  const newClientEmailError = newClient.email && !isValidEmail(newClient.email);
  const newClientPhoneError = (newClient.phoneNumbers || []).some((p) => p && !isValidPhone(p));

  const handleCreateClient = async () => {
    if (newClientEmailError || newClientPhoneError) {
      await alert({ title: 'Client invalide', message: 'Veuillez corriger le format du mail ou du téléphone.' });
      return;
    }
    const phones = (newClient.phoneNumbers || []).map((p) => String(p || '').trim()).filter(Boolean);
    const c = await api.createClient({
      ...newClient,
      address: [newClient.streetNumber, newClient.street].filter(Boolean).join(' ').trim(),
      phoneNumbers: phones, phone: phones[0] || '',
    });
    updateForm({ clientId: c.id });
    setClients((prev) => [...prev, c]);
    setCreateClientOpen(false);
    setNewClient(EMPTY_CLIENT);
  };

  // ── Pricing summary ───────────────────────────────────────────────────────
  const optionsTotal = (form.selectedOptions || []).reduce((s, o) => s + Number(o.totalPrice || 0), 0);
  const resourcesTotal = (form.selectedResources || []).reduce((s, r) => s + Number(r.totalPrice || 0), 0);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedProp) { await alert({ title: 'Champ requis', message: 'Veuillez sélectionner un logement.' }); return; }
    if (!form.startDate || !form.endDate) { await alert({ title: 'Champ requis', message: 'Veuillez sélectionner les dates.' }); return; }
    if (!form.clientId) { await alert({ title: 'Champ requis', message: 'Veuillez sélectionner un client.' }); return; }

    const payload = {
      propertyId: Number(selectedProp),
      clientId: Number(form.clientId),
      status: form.status,
      startDate: form.startDate, endDate: form.endDate,
      adults: Number(form.adults), children: Number(form.children),
      teens: Number(form.teens), babies: Number(form.babies),
      singleBeds: form.singleBeds !== '' ? Number(form.singleBeds) : null,
      doubleBeds: form.doubleBeds !== '' ? Number(form.doubleBeds) : null,
      babyBeds: form.babyBeds !== '' ? Number(form.babyBeds) : null,
      checkInTime: form.checkInTime, checkOutTime: form.checkOutTime,
      platform: form.platform,
      discountPercent: Number(form.discountPercent || 0),
      customPrice: form.customPrice !== '' ? Number(form.customPrice) : undefined,
      depositAmount: Number(form.depositAmount || 0), depositDueDate: form.depositDueDate || null,
      balanceAmount: Number(form.balanceAmount || 0), balanceDueDate: form.balanceDueDate || null,
      cautionAmount: Number(form.cautionAmount || 0), notes: form.notes,
      validUntil: form.validUntil || null,
      selectedOptions: (form.selectedOptions || []).map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
      selectedResources: (form.selectedResources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity, unitPrice: r.unitPrice })),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.updateDevis(editingId, payload);
        navigate('/devis');
      } else {
        const created = await api.createDevis(payload);
        navigate(`/devis/${created.id}`);
      }
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible d\'enregistrer le devis.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Supprimer ce devis',
      message: 'Supprimer définitivement ce devis ? Cette action est irréversible.',
      confirmLabel: 'Supprimer', confirmColor: 'error',
    });
    if (!ok) return;
    await api.deleteDevis(editingId);
    navigate('/devis');
  };

  // ── Convert to reservation ────────────────────────────────────────────────
  const handleConvertToReservation = async () => {
    const ok = await confirm({
      title: 'Confirmer la réservation',
      message: 'Convertir ce devis en réservation ? Les dates seront bloquées et un numéro de réservation sera créé.',
      confirmLabel: 'Confirmer la réservation', confirmColor: 'success',
    });
    if (!ok) return;
    try {
      // Save first to ensure latest state is captured
      if (editingId) {
        const result = await api.convertDevisToReservation(editingId);
        navigate(`/reservations/${result.reservationId}`);
      }
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible de convertir le devis.' });
    }
  };

  // ── PDF ───────────────────────────────────────────────────────────────────
  const handleOpenPdf = () => {
    if (!editingId) return;
    window.open(api.getDevisPdfUrl(editingId), '_blank');
  };

  // ── Selected client ───────────────────────────────────────────────────────
  const selectedClient = clients.find((c) => c.id === form.clientId) || null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/devis')} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
          {editingId ? `Devis` : 'Nouveau devis'}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {editingId && (
            <>
              <Button
                variant="outlined"
                startIcon={<PictureAsPdfIcon />}
                onClick={handleOpenPdf}
                size="small"
              >
                PDF
              </Button>
              <Button
                variant="outlined"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={handleConvertToReservation}
                size="small"
                disabled={form.status === 'converted'}
              >
                Confirmer réservation
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
                size="small"
              >
                Supprimer
              </Button>
            </>
          )}
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={saving}
            size="small"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={2}>
        {/* LEFT COLUMN */}
        <Grid item xs={12} md={7}>

          {/* Property & Status */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Logement & statut</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={8}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Logement *</InputLabel>
                    <Select
                      value={selectedProp || ''}
                      label="Logement *"
                      onChange={(e) => handlePropertyChange(e.target.value)}
                    >
                      {properties.map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Statut</InputLabel>
                    <Select
                      value={form.status}
                      label="Statut"
                      onChange={(e) => updateForm({ status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Plateforme</InputLabel>
                    <Select
                      value={form.platform}
                      label="Plateforme"
                      onChange={(e) => updateForm({ platform: e.target.value })}
                    >
                      {PLATFORMS.map((p) => (
                        <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small"
                    label="Valable jusqu'au"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={form.validUntil}
                    onChange={(e) => updateForm({ validUntil: e.target.value })}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Dates */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Dates du séjour</Typography>

              {/* Mini strip calendar */}
              {selectedProp && (
                <Box sx={{ mb: 1.5, overflowX: 'auto' }}>
                  <MiniPlanningStrip
                    startDate={miniCalendarStart}
                    visibleDays={miniVisibleDays}
                    reservations={reservations}
                    selectedStart={form.startDate}
                    selectedEnd={form.endDate}
                    selectionAnchor={miniSelectionAnchor}
                    onDateClick={handleMiniDateClick}
                    onNavigate={(dir) => setMiniCalendarStart(shiftDate(miniCalendarStart, dir * Math.floor(miniVisibleDays / 2)))}
                  />
                </Box>
              )}

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small"
                    label="Arrivée *"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={form.startDate}
                    onChange={(e) => updateForm({ startDate: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small"
                    label="Départ *"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={form.endDate}
                    onChange={(e) => updateForm({ endDate: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure arrivée</InputLabel>
                    <Select
                      value={form.checkInTime}
                      label="Heure arrivée"
                      onChange={(e) => updateForm({ checkInTime: e.target.value })}
                    >
                      {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Heure départ</InputLabel>
                    <Select
                      value={form.checkOutTime}
                      label="Heure départ"
                      onChange={(e) => updateForm({ checkOutTime: e.target.value })}
                    >
                      {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              {nights > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {nights} nuit{nights > 1 ? 's' : ''}
                </Typography>
              )}

              {dateConflict && (
                <Alert severity="warning" sx={{ mt: 1 }}>{dateConflict.message}</Alert>
              )}
            </CardContent>
          </Card>

          {/* Guests */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Voyageurs</Typography>
              <Grid container spacing={2}>
                {[
                  { label: 'Adultes', key: 'adults', max: maxAdults, error: exceedsAdults },
                  { label: 'Ados', key: 'teens', max: null, error: false },
                  { label: 'Enfants', key: 'children', max: maxChildren, error: exceedsChildren },
                  { label: 'Bébés', key: 'babies', max: maxBabies, error: exceedsBabies },
                ].map(({ label, key, max, error }) => (
                  <Grid item xs={6} sm={3} key={key}>
                    <TextField
                      fullWidth size="small"
                      label={`${label}${max != null ? ` (max ${max})` : ''}`}
                      type="number"
                      inputProps={{ min: 0, max: max || undefined }}
                      value={form[key]}
                      onChange={(e) => updateForm({ [key]: Math.max(0, Number(e.target.value) || 0) })}
                      error={error}
                    />
                  </Grid>
                ))}
              </Grid>
              {exceedsCapacity && (
                <Alert severity="warning" sx={{ mt: 1 }}>La capacité du logement est dépassée.</Alert>
              )}

              <Divider sx={{ my: 1.5 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Répartition des lits</Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={5} sm={4}>
                  <TextField
                    fullWidth size="small" label="Lits simples"
                    type="number" inputProps={{ min: 0 }}
                    value={form.singleBeds}
                    onChange={(e) => updateForm({ singleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                  />
                </Grid>
                <Grid item xs={5} sm={4}>
                  <TextField
                    fullWidth size="small" label="Lits doubles"
                    type="number" inputProps={{ min: 0 }}
                    value={form.doubleBeds}
                    onChange={(e) => updateForm({ doubleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                  />
                </Grid>
                <Grid item xs={2} sm={4}>
                  <Button
                    size="small" variant="outlined"
                    startIcon={<AutoFixHighIcon />}
                    onClick={handleSuggestBeds}
                    title="Suggérer une répartition"
                  >
                    {downMd ? '' : 'Suggérer'}
                  </Button>
                </Grid>
                {Number(form.babies) > 0 && (
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth size="small" label={`Lits bébé (max ${babyBedAvailability.available ?? '?'})`}
                      type="number" inputProps={{ min: 0 }}
                      value={form.babyBeds}
                      onChange={(e) => updateForm({ babyBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                    />
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          {/* Client */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Client *</Typography>
                <Button size="small" variant="outlined" onClick={() => setCreateClientOpen(true)}>
                  Nouveau client
                </Button>
              </Box>
              <Autocomplete
                size="small"
                options={clients}
                getOptionLabel={(c) => c ? `${c.firstName} ${c.lastName}${c.email ? ` — ${c.email}` : ''}` : ''}
                value={selectedClient}
                onChange={(_, c) => updateForm({ clientId: c ? c.id : null })}
                onInputChange={(_, v) => setClientSearch(v)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => (
                  <TextField {...params} label="Rechercher un client" placeholder="Nom, prénom, email..." />
                )}
              />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Notes</Typography>
              <TextField
                fullWidth multiline minRows={3} size="small"
                label="Notes internes"
                value={form.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* RIGHT COLUMN */}
        <Grid item xs={12} md={5}>

          {/* Options */}
          {propertyOptions.length > 0 && (
            <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Options</Typography>
                <Stack spacing={1}>
                  {propertyOptions.filter((o) => !o.autoOptionType).map((opt) => {
                    const sel = form.selectedOptions.find((so) => so.optionId === opt.id);
                    const isEnabled = Boolean(sel);
                    return (
                      <FormRow key={opt.id}>
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={isEnabled}
                              onChange={(e) => setOptionEnabled(opt.id, e.target.checked)}
                            />
                          }
                          label={
                            <Typography variant="body2">
                              {opt.title}
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                ({PRICE_TYPE_LABELS[opt.priceType] || opt.priceType})
                              </Typography>
                            </Typography>
                          }
                          sx={{ flexGrow: 1, mr: 0 }}
                        />
                        {isEnabled && (
                          <>
                            <TextField
                              size="small" type="number" label="Qté"
                              value={sel.quantity}
                              onChange={(e) => setOptionQuantity(opt.id, e.target.value)}
                              sx={{ width: 64 }}
                              inputProps={{ min: 1 }}
                            />
                            <Typography variant="body2" sx={{ minWidth: 70, textAlign: 'right', color: 'text.secondary' }}>
                              {Number(sel.totalPrice || 0).toFixed(2)} €
                            </Typography>
                          </>
                        )}
                      </FormRow>
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Resources */}
          {availableResources.length > 0 && (
            <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Ressources</Typography>
                <Stack spacing={1}>
                  {availableResources.map((rsc) => {
                    const sel = form.selectedResources.find((sr) => sr.resourceId === rsc.id);
                    const isEnabled = Boolean(sel);
                    return (
                      <FormRow key={rsc.id}>
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={isEnabled}
                              onChange={(e) => setResourceEnabled(rsc.id, e.target.checked)}
                              disabled={rsc.available <= 0 && !isEnabled}
                            />
                          }
                          label={
                            <Typography variant="body2">
                              {rsc.name}
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                ({rsc.available} dispo)
                              </Typography>
                            </Typography>
                          }
                          sx={{ flexGrow: 1, mr: 0 }}
                        />
                        {isEnabled && (
                          <>
                            <TextField
                              size="small" type="number" label="Qté"
                              value={sel.quantity}
                              onChange={(e) => setResourceQuantity(rsc.id, e.target.value)}
                              sx={{ width: 64 }}
                              inputProps={{ min: 1, max: rsc.available }}
                            />
                            <Typography variant="body2" sx={{ minWidth: 70, textAlign: 'right', color: 'text.secondary' }}>
                              {Number(sel.totalPrice || 0).toFixed(2)} €
                            </Typography>
                          </>
                        )}
                      </FormRow>
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Pricing */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Tarification</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth size="small"
                    label="Prix hébergement personnalisé (laisser vide pour auto)"
                    type="number"
                    value={form.customPrice}
                    onChange={(e) => updateForm({ customPrice: e.target.value })}
                    inputProps={{ min: 0 }}
                    helperText={form.customPrice === '' && pricingQuote ? `Calculé : ${Number(pricingQuote.totalPrice || 0).toFixed(2)} €` : ''}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="Remise (%)"
                    type="number" inputProps={{ min: 0, max: 100 }}
                    value={form.discountPercent}
                    onChange={(e) => updateForm({ discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                </Grid>
              </Grid>

              {/* Nightly breakdown toggle */}
              {nightlyBreakdown.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Button size="small" variant="text" onClick={() => setShowNightlyBreakdown((v) => !v)}>
                    {showNightlyBreakdown ? 'Masquer' : 'Voir'} le détail nuitées
                  </Button>
                  {showNightlyBreakdown && (
                    <Box sx={{ mt: 1 }}>
                      {nightlyBreakdown.map((n) => (
                        <Box key={n.date} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            {n.date} — {n.seasonLabel}
                          </Typography>
                          <Typography variant="caption">{Number(n.price || 0).toFixed(2)} €</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )}

              <Divider sx={{ my: 1.5 }} />

              {/* Summary */}
              {[
                { label: 'Hébergement', value: form.totalPrice },
                optionsTotal > 0 && { label: 'Options', value: optionsTotal },
                resourcesTotal > 0 && { label: 'Ressources', value: resourcesTotal },
                Number(form.touristTaxTotal || 0) > 0 && { label: 'Taxe de séjour', value: form.touristTaxTotal },
                Number(form.discountPercent || 0) > 0 && { label: `Remise (${form.discountPercent}%)`, value: null, computed: true },
              ].filter(Boolean).map((row) => (
                <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                  <Typography variant="body2" color="text.secondary">{row.label}</Typography>
                  {row.computed
                    ? <Typography variant="body2" color="error">−{(Number(form.discountPercent) / 100 * (Number(form.totalPrice || 0) + optionsTotal + resourcesTotal)).toFixed(2)} €</Typography>
                    : <Typography variant="body2">{Number(row.value || 0).toFixed(2)} €</Typography>
                  }
                </Box>
              ))}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, pt: 1, borderTop: '2px solid', borderColor: 'primary.main' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Total TTC</Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                  {Number(form.finalPrice || 0).toFixed(2)} €
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {/* Payment schedule */}
          <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Modalités de règlement</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth size="small" label="Acompte (€)"
                    type="number" inputProps={{ min: 0 }}
                    value={form.depositAmount}
                    onChange={(e) => updateForm({ depositAmount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth size="small" label="Date acompte"
                    type="date" InputLabelProps={{ shrink: true }}
                    value={form.depositDueDate}
                    onChange={(e) => updateForm({ depositDueDate: e.target.value })}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth size="small" label="Solde (€)"
                    type="number" inputProps={{ min: 0 }}
                    value={form.balanceAmount}
                    onChange={(e) => updateForm({ balanceAmount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth size="small" label="Date solde"
                    type="date" InputLabelProps={{ shrink: true }}
                    value={form.balanceDueDate}
                    onChange={(e) => updateForm({ balanceDueDate: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth size="small" label="Caution (€)"
                    type="number" inputProps={{ min: 0 }}
                    value={form.cautionAmount}
                    onChange={(e) => updateForm({ cautionAmount: Math.max(0, Number(e.target.value) || 0) })}
                    helperText="Montant à remettre à l'arrivée"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Create client dialog */}
      <FormDialog
        open={createClientOpen}
        title="Nouveau client"
        onClose={() => { setCreateClientOpen(false); setNewClient(EMPTY_CLIENT); }}
        onSubmit={handleCreateClient}
        submitLabel="Créer"
      >
        <ClientFormFields
          client={newClient}
          onChange={(changes) => setNewClient((prev) => ({ ...prev, ...changes }))}
          cityOptions={newClientCityOptions}
          emailError={newClientEmailError}
          phoneErrors={(newClient.phoneNumbers || []).map((p) => p && !isValidPhone(p))}
        />
      </FormDialog>
    </Box>
  );
}
