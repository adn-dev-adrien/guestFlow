import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Box, TextField, Autocomplete, Button, FormControl, InputLabel, Select,
  MenuItem, Typography, CircularProgress, Chip, Stack, Card, CardContent,
  Dialog, DialogTitle, DialogContent, DialogActions, useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import PageActionBar from '../components/PageActionBar';
import PricingSummary from '../components/PricingSummary';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import { ReservationFormProvider } from '../components/reservation/ReservationFormContext';
import StaySection from '../components/reservation/StaySection';
import GuestsBedsSection from '../components/reservation/GuestsBedsSection';
import ExtrasSection from '../components/reservation/ExtrasSection';
import FinanceSection from '../components/reservation/FinanceSection';
import { PLATFORMS } from '../constants/platforms';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { getFromParam, navigateBackWithFrom } from '../utils/navigation';

const DEVIS_STATUS_OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'sent', label: 'Envoyé' },
  { value: 'accepted', label: 'Accepté' },
];

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

function parseCustomPrice(value) {
  if (value === '' || value === null || value === undefined) return '';
  return Number(value);
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { confirm, alert } = useAppDialogs();
  const from = getFromParam(searchParams);
  
  // Check if in devis mode
  const isDevisMode = searchParams.get('mode') === 'devis';
  const devisIdFromUrl = searchParams.get('devisId');
  const editingDevisId = isDevisMode && devisIdFromUrl ? Number(devisIdFromUrl) : null;
  const prefillDevis = isDevisMode && !editingDevisId ? location.state?.prefillDevis : null;

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
  const [pricingQuote, setPricingQuote] = useState(null);
  const [minNightsState, setMinNightsState] = useState({ breached: false, required: 0, nights: 0 });
  const [useCurrentPricing, setUseCurrentPricing] = useState(false);
  const [offeredOptionIds, setOfferedOptionIds] = useState(new Set());
  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [existingReservationLocked, setExistingReservationLocked] = useState(false);
  const [isIcalImportedBlankPrice, setIsIcalImportedBlankPrice] = useState(false);
  const [isIcalSource, setIsIcalSource] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const [miniCalendarStart, setMiniCalendarStart] = useState(formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  const [miniSelectionAnchor, setMiniSelectionAnchor] = useState('');
  const [occupiedDates, setOccupiedDates] = useState([]);
  const [excludeReservationIdForDevis, setExcludeReservationIdForDevis] = useState(null);
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
    status: 'draft',
    singleBeds: '', doubleBeds: '', babyBeds: '',
    extraGuestSurchargeOffered: false,
    totalPrice: 0, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], customOptions: [], selectedResources: [], checkInTime: '15:00', checkOutTime: '10:00',
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
    extraGuestSurchargeOffered: Boolean(form.extraGuestSurchargeOffered),
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
    customOptions: (form.customOptions || [])
      .map((line, index) => ({
        customKey: String(line.customKey || `custom_${index + 1}`),
        description: String(line.description || '').trim(),
        amount: Number(line.amount || 0),
        offered: Boolean(line.offered),
      }))
      .filter((line) => line.description && Number(line.amount || 0) > 0)
      .sort((a, b) => a.customKey.localeCompare(b.customKey)),
    selectedResources: (form.selectedResources || [])
      .map((item) => ({ resourceId: Number(item.resourceId), quantity: Number(item.quantity || 0), offered: Boolean(item.offered) }))
      .sort((a, b) => a.resourceId - b.resourceId),
    offeredOptionIds: Array.from(offeredOptionIds).map(Number).sort((a, b) => a - b),
    platform: form.platform,
  }), [selectedProp, form.startDate, form.endDate, form.checkInTime, form.checkOutTime, form.adults, form.children, form.teens, form.extraGuestSurchargeOffered, form.discountPercent, form.customPrice, form.depositPaid, form.balancePaid, form.depositAmount, form.balanceAmount, form.selectedOptions, form.customOptions, form.selectedResources, propertyOptions, offeredOptionIds, form.platform]);
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

  // Establish the "clean" baseline for the unsaved-changes guard. For an existing reservation/devis the
  // server recalc reshapes the loaded form once on mount (offered flags, derived amounts) with no user
  // action — so we wait until that first quote has applied before snapshotting. Otherwise a freshly
  // loaded (or just-converted) record would be wrongly flagged dirty and prompt on leave. New/prefilled
  // records snapshot immediately.
  useEffect(() => {
    if (loading || initialSnapshot !== null) return;
    const isExistingRecord = Boolean(editingReservationId || editingDevisId);
    if (isExistingRecord && !pricingQuote) return;
    setInitialSnapshot(formSnapshot);
  }, [loading, initialSnapshot, formSnapshot, editingReservationId, editingDevisId, pricingQuote]);

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

  const applyQuoteToForm = useCallback((prev, quote, preserveBlankPrice = false) => {
    const resourceLinesById = new Map((quote.resourceLines || []).map((line) => [Number(line.resourceId), line]));

    // Preserve user-manually-set customPrice: if prev.customPrice is not empty, keep it
    // totalPrice comes from quote (server-calculated)
    const shouldPreserveCustomPrice = prev.customPrice !== '';

    return {
      ...prev,
      totalPrice: quote.totalPrice == null ? '' : Number(quote.totalPrice || 0),
      touristTaxRate: Number(quote.touristTaxRate || 0),
      touristTaxTotal: Number(quote.touristTaxTotal || 0),
      finalPrice: shouldPreserveCustomPrice && prev.customPrice !== ''
        ? Number(prev.customPrice)
        : (quote.finalPrice == null ? '' : Number(quote.finalPrice || 0)),
      depositAmount: Number(quote.depositAmount || 0),
      depositDueDate: quote.depositDueDate || '',
      balanceAmount: Number(quote.balanceAmount || 0),
      balanceDueDate: quote.balanceDueDate || '',
      selectedOptions: (quote.optionLines || []).filter((line) => !line.isCustom).map((line) => ({
        optionId: Number(line.optionId),
        quantity: Number(line.quantity || 0),
        totalPrice: Number(line.totalPrice || 0),
        originalTotalPrice: Number(line.originalTotalPrice ?? line.totalPrice ?? 0),
        offered: Boolean(line.offered),
        ...(line.autoExtraHours !== undefined ? { autoExtraHours: Number(line.autoExtraHours) } : {}),
        ...(line.autoFullNightApplied !== undefined ? { autoFullNightApplied: Boolean(line.autoFullNightApplied) } : {}),
      })),
      customOptions: (quote.optionLines || []).filter((line) => line.isCustom).map((line, index) => ({
        customKey: String(line.customKey || `custom_${index + 1}`),
        description: String(line.title || line.description || '').trim(),
        amount: Number(line.originalTotalPrice ?? line.totalPrice ?? 0),
        offered: Boolean(line.offered),
      })),
      selectedResources: (prev.selectedResources || []).map((item) => {
        const line = resourceLinesById.get(Number(item.resourceId));
        return {
          ...item,
          unitPrice: Number(line?.unitPrice ?? item.unitPrice ?? 0),
          totalPrice: Number(line?.totalPrice || 0),
          offered: Boolean(line?.offered ?? item.offered),
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
        const initialPropId = reservationId || editingDevisId
          ? null
          : (urlPropId ? Number(urlPropId) : (props.length > 0 ? props[0].id : ''));
        setExistingReservationLocked(false);

        if (prefillDevis?.form) {
          const prefillPropertyId = Number(prefillDevis.propertyId || prefillDevis.form.propertyId || 0) || null;
          if (prefillPropertyId) {
            const propDetails = await api.getProperty(prefillPropertyId);
            const opts = await api.getOptions();
            const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(prefillPropertyId));

            setSelectedProp(prefillPropertyId);
            setSelectedProperty(propDetails || props.find((p) => p.id === prefillPropertyId) || null);
            setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
            if (Array.isArray(propDetails?.resources)) {
              setAvailableResources(propDetails.resources.map((r) => ({
                ...r,
                available: Number(r.available ?? r.quantity ?? 0),
              })));
            }

            const allRes = await api.getReservations({ propertyId: prefillPropertyId });
            setReservations(allRes || []);
            setExcludeReservationIdForDevis(null);
          }

          setForm((prev) => ({
            ...prev,
            ...prefillDevis.form,
            status: prefillDevis.form.status || prev.status || 'draft',
            propertyId: prefillPropertyId || prefillDevis.form.propertyId || prev.propertyId,
            selectedOptions: prefillDevis.form.selectedOptions || [],
            customOptions: prefillDevis.form.customOptions || [],
            selectedResources: prefillDevis.form.selectedResources || [],
          }));
          setOfferedOptionIds(new Set(prefillDevis.offeredOptionIds || []));
          setLoading(false);
          return;
        }
        
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
          const propDetails = await api.getProperty(res.propertyId);
          setSelectedProp(res.propertyId);
          setSelectedProperty(propDetails || prop);
          
          const opts = await api.getOptions();
          const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(res.propertyId));
          setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
          if (Array.isArray(propDetails?.resources)) {
            setAvailableResources(propDetails.resources.map((r) => ({
              ...r,
              available: Number(r.available ?? r.quantity ?? 0),
            })));
          }

          // Load all reservations for this property to check conflicts
          const allRes = await api.getReservations({ propertyId: res.propertyId });
          setReservations(allRes);
          setExcludeReservationIdForDevis(null);

          const importedBlankPrice = res.sourceType === 'ical' && res.totalPrice == null && res.finalPrice == null;
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
            extraGuestSurchargeOffered: Boolean(res.extraGuestSurchargeOffered),
            totalPrice: importedBlankPrice ? '' : res.totalPrice || 0,
            touristTaxRate: res.touristTaxRate || 0,
            touristTaxTotal: res.touristTaxTotal || 0,
            discountPercent: res.discountPercent || 0,
            finalPrice: importedBlankPrice ? '' : res.finalPrice || 0,
            customPrice: importedBlankPrice ? '' : parseCustomPrice(res.customPrice),
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
            selectedOptions: (res.options || []).filter(o => !o.isCustom).map(o => ({ optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice, originalTotalPrice: o.originalTotalPrice, offered: Boolean(o.offered) })),
            customOptions: (res.options || []).filter(o => o.isCustom).map((o, index) => ({ customKey: String(o.customOptionId || `custom_${index + 1}`), description: o.title || o.description || '', amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0), offered: Boolean(o.offered) })),
            selectedResources: (res.resources || []).map(r => ({
              resourceId: r.resourceId,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              billedUnits: r.billedUnits,
              priceType: r.priceType,
              totalPrice: r.totalPrice,
              originalTotalPrice: Number(r.originalTotalPrice ?? r.totalPrice ?? 0),
              offered: Boolean(r.offered),
            })),
            checkInTime: res.checkInTime || '15:00',
            checkOutTime: res.checkOutTime || '10:00',
            startDate: res.startDate,
            endDate: res.endDate,
            propertyId: res.propertyId,
            depositPaid: res.depositPaid || false,
            balancePaid: res.balancePaid || false
          });
          setPricingQuote(null);
          setIsIcalImportedBlankPrice(importedBlankPrice);
          setIsIcalSource(res.sourceType === 'ical');

          initialPricingContextRef.current = {
            propertyId: res.propertyId,
            startDate: res.startDate,
            endDate: res.endDate,
          };
          
          // Charger les options offertes depuis le flag persistant
          const offeredOpts = new Set((res.options || [])
            .filter(o => !o.isCustom && Boolean(o.offered))
            .map(o => o.optionId)
          );
          setOfferedOptionIds(offeredOpts);
          
          setUseCurrentPricing(false);
          frozenOptionUnitByQuantityRef.current = Object.fromEntries(
            (res.options || []).map((o) => [
              o.optionId,
              o.unitPrice !== undefined
                ? Number(o.unitPrice || 0)
                : (Math.max(0, Number(o.totalPrice || 0)) / Math.max(1, Number(o.quantity || 1))),
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
        } else if (editingDevisId) {
          const devis = await api.getDevisById(editingDevisId);
          const prop = props.find(p => p.id === devis.propertyId);
          const propDetails = await api.getProperty(devis.propertyId);
          setSelectedProp(devis.propertyId);
          setSelectedProperty(propDetails || prop || null);

          const opts = await api.getOptions();
          const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(devis.propertyId));
          setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
          if (Array.isArray(propDetails?.resources)) {
            setAvailableResources(propDetails.resources.map((r) => ({
              ...r,
              available: Number(r.available ?? r.quantity ?? 0),
            })));
          }

          const allRes = await api.getReservations({ propertyId: devis.propertyId });
          setReservations(allRes || []);

          // Exclude the reservation that matches this devis' dates (if it was transformed into a reservation)
          const matchingRes = (allRes || []).find(
            (r) => r.startDate === devis.startDate && r.endDate === devis.endDate
          );
          if (matchingRes) {
            setExcludeReservationIdForDevis(matchingRes.id);
          }

          setForm({
            clientId: devis.clientId,
            adults: devis.adults || 1,
            children: devis.children || 0,
            teens: devis.teens || 0,
            babies: devis.babies || 0,
            platform: devis.platform || 'direct',
            status: devis.status || 'draft',
            singleBeds: devis.singleBeds || '',
            doubleBeds: devis.doubleBeds || '',
            babyBeds: devis.babyBeds || '',
            extraGuestSurchargeOffered: false,
            totalPrice: devis.totalPrice || 0,
            touristTaxRate: devis.touristTaxRate || 0,
            touristTaxTotal: devis.touristTaxTotal || 0,
            discountPercent: devis.discountPercent || 0,
            finalPrice: devis.finalPrice || 0,
            customPrice: parseCustomPrice(devis.customPrice),
            depositAmount: devis.depositAmount || 0,
            depositDueDate: devis.depositDueDate || '',
            balanceAmount: devis.balanceAmount || 0,
            balanceDueDate: devis.balanceDueDate || '',
            cautionAmount: devis.cautionAmount || 0,
            cautionReceived: false,
            cautionReceivedDate: '',
            cautionReturned: false,
            cautionReturnedDate: '',
            notes: devis.notes || '',
            selectedOptions: (devis.options || []).filter(o => !o.isCustom).map(o => ({ optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice, originalTotalPrice: o.originalTotalPrice, offered: Boolean(o.offered) })),
            customOptions: (devis.options || []).filter(o => o.isCustom).map((o, index) => ({ customKey: String(o.customOptionId || `custom_${index + 1}`), description: o.title || o.description || '', amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0), offered: Boolean(o.offered) })),
            selectedResources: (devis.resources || []).map(r => ({ resourceId: r.resourceId, quantity: r.quantity, unitPrice: r.unitPrice, totalPrice: r.totalPrice, offered: Boolean(r.offered) })),
            checkInTime: devis.checkInTime || '15:00',
            checkOutTime: devis.checkOutTime || '10:00',
            startDate: devis.startDate,
            endDate: devis.endDate,
            propertyId: devis.propertyId,
            depositPaid: false,
            balancePaid: false,
          });

          const offeredOpts = new Set((devis.options || [])
            .filter(o => !o.isCustom && Boolean(o.offered))
            .map(o => o.optionId)
          );
          setOfferedOptionIds(offeredOpts);
          setPricingQuote(null);
          setIsIcalImportedBlankPrice(false);
          setIsIcalSource(false);
          setUseCurrentPricing(false);

          await loadResourcesAvailability(devis.startDate, devis.endDate, devis.propertyId, null);
          await loadBabyBedAvailability(devis.startDate, devis.endDate, devis.propertyId, null);
        } else if (initialPropId && startDate && endDate) {
          // New reservation with pre-filled dates from URL
          const prop = await api.getProperty(initialPropId);
          const opts = await api.getOptions();
          const propIdNum = parseInt(initialPropId, 10);
          const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(propIdNum));
          setPropertyOptions(Array.isArray(prop?.options) ? prop.options : availableOpts);
          if (Array.isArray(prop?.resources)) {
            setAvailableResources(prop.resources.map((r) => ({
              ...r,
              available: Number(r.available ?? r.quantity ?? 0),
            })));
          }

          const calc = await api.calculatePrice({
            propertyId: initialPropId,
            startDate,
            endDate,
            checkInTime: prop.defaultCheckIn || '15:00',
            checkOutTime: prop.defaultCheckOut || '10:00',
            adults: 1,
            children: 0,
            teens: 0,
            extraGuestSurchargeOffered: false,
            offeredOptionIds: [],
            platform: 'direct',
            ...(editingReservationId ? { reservationId: editingReservationId } : {}),
          });
          setPricingQuote(calc);
          setNightlyBreakdown(calc.nightlyBreakdown || []);
          applyQuoteMinNights(calc);

          const allRes = await api.getReservations({ propertyId: initialPropId });
          setReservations(allRes);
          setExcludeReservationIdForDevis(null);

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
            extraGuestSurchargeOffered: false,
            totalPrice: calc.totalPrice,
            touristTaxRate: calc.touristTaxRate || 0,
            touristTaxTotal: calc.touristTaxTotal || 0,
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
            customOptions: [],
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
  }, [reservationId, editingDevisId, searchParams, prefillDevis]);

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
  // Load occupied dates from backend when property or dates change
  useEffect(() => {
    if (!selectedProp || !form.startDate || !form.endDate) {
      setOccupiedDates([]);
      return;
    }

    const loadOccupiedDates = async () => {
      try {
        const occupied = await api.getOccupiedDates(selectedProp, form.startDate, form.endDate, editingReservationId);
        setOccupiedDates(occupied || []);
      } catch (err) {
        console.error('Failed to load occupied dates:', err);
        setOccupiedDates([]);
      }
    };

    loadOccupiedDates();
  }, [selectedProp, form.startDate, form.endDate, editingReservationId]);

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
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          discountPercent: form.discountPercent,
          customPrice: form.customPrice,
          depositPaid: form.depositPaid,
          balancePaid: form.balancePaid,
          depositAmount: form.depositAmount,
          balanceAmount: form.balanceAmount,
          selectedOptions: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          selectedResources: buildSelectedResourcesPayload(),
          offeredOptionIds: Array.from(offeredOptionIds),
          lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
          lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
          forceCurrentPricing: useCurrentPricing,
          platform: form.platform,
          ...(editingReservationId ? { reservationId: editingReservationId } : {}),
        });

        if (requestId !== pricingQuoteRequestRef.current) return;
        setPricingQuote(calc);
        setNightlyBreakdown(calc.nightlyBreakdown || []);
        applyQuoteMinNights(calc);

        const preserveBlankPrice = isIcalImportedBlankPrice && form.customPrice === '' && form.totalPrice === '';

        setForm(prev => {
          if (prev.startDate !== form.startDate || prev.endDate !== form.endDate || prev.adults !== form.adults || prev.children !== form.children || prev.teens !== form.teens) {
            return prev;
          }
          return applyQuoteToForm(prev, calc, preserveBlankPrice);
        });
      } catch (err) {
        // Keep current form state if quote refresh fails
      }
    };

    refreshBasePrice();
  }, [selectedProp, pricingQuoteSignature, shouldLockExistingPricing, applyQuoteToForm, applyQuoteMinNights, useCurrentPricing, offeredOptionIds]);

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
    return { ...updatedForm };
  };

  const handleSuggestBeds = async () => {
    if (!selectedProp) return;
    try {
      const suggestion = await api.suggestBeds({
        propertyId: Number(selectedProp),
        adults: Number(form.adults) || 0,
        children: Number(form.children) || 0,
        teens: Number(form.teens) || 0,
        babies: Number(form.babies) || 0,
      });

      updateForm({
        singleBeds: Number(suggestion.singleBeds || 0),
        doubleBeds: Number(suggestion.doubleBeds || 0),
      });
    } catch (err) {
      await alert({ title: 'Suggestion impossible', message: err.message || 'Impossible de suggérer les lits pour ce logement.' });
    }
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
      const isPerHourResource = Boolean(resource?.isComplex) || resource?.priceType === 'per_hour';
      const maxAvailable = Math.max(0, Number(resource?.available || 0));
      const parsed = Number(quantity);
      const normalizedQty = Number.isNaN(parsed)
        ? 0
        : Math.max(0, isPerHourResource ? parsed : Math.min(maxAvailable, parsed));

      const exists = prev.selectedResources.find(sr => sr.resourceId === resourceId);
      let newResources = prev.selectedResources;

      if (normalizedQty <= 0) {
        newResources = prev.selectedResources.filter(sr => sr.resourceId !== resourceId);
      } else if (exists) {
        newResources = prev.selectedResources.map(sr =>
          sr.resourceId === resourceId
            ? { ...sr, quantity: normalizedQty }
            : sr
        );
      } else {
        newResources = [
          ...prev.selectedResources,
          {
            resourceId,
            quantity: normalizedQty,
            unitPrice: Number(resource?.price || 0),
            totalPrice: 0,
            offered: false,
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

  const setResourceOffered = (resourceId, offered) => {
    setForm((prev) => recalcPrice({
      ...prev,
      selectedResources: (prev.selectedResources || []).map((sr) => (
        Number(sr.resourceId) === Number(resourceId)
          ? { ...sr, offered: Boolean(offered) }
          : sr
      )),
    }));
  };

  const addCustomOption = () => {
    setForm((prev) => recalcPrice({
      ...prev,
      customOptions: [
        ...(prev.customOptions || []),
        { customKey: `custom_${Date.now()}`, description: '', amount: 0, offered: false },
      ],
    }));
  };

  const updateCustomOption = (customKey, changes) => {
    setForm((prev) => recalcPrice({
      ...prev,
      customOptions: (prev.customOptions || []).map((line) => (
        line.customKey === customKey ? { ...line, ...changes } : line
      )),
    }));
  };

  const removeCustomOption = (customKey) => {
    setForm((prev) => recalcPrice({
      ...prev,
      customOptions: (prev.customOptions || []).filter((line) => line.customKey !== customKey),
    }));
  };

  const buildSelectedOptionsPayload = () => {
    return (form.selectedOptions || [])
      .filter((item) => !propertyOptions.find((o) => o.id === Number(item.optionId))?.autoOptionType)
      .map((item) => ({ optionId: item.optionId, quantity: item.quantity }));
  };

  const buildCustomOptionsPayload = () => {
    return (form.customOptions || [])
      .map((line, index) => ({
        customKey: String(line.customKey || `custom_${index + 1}`),
        description: String(line.description || '').trim(),
        amount: Number(line.amount || 0),
        offered: Boolean(line.offered),
      }))
      .filter((line) => line.description && Number(line.amount || 0) > 0);
  };

  const buildSelectedResourcesPayload = () => {
    return (form.selectedResources || [])
      .map((item) => ({
        resourceId: item.resourceId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        offered: Boolean(item.offered),
      }))
      .filter((item) => Number(item.quantity || 0) > 0);
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
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        offeredOptionIds: Array.from(offeredOptionIds),
        platform: form.platform,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
      }),
      api.getReservations({ propertyId: nextPropertyId }),
    ]);

    const availableOpts = opts.filter(o => !o.propertyIds || o.propertyIds.length === 0 || o.propertyIds.includes(nextPropertyId));

    setSelectedProp(nextPropertyId);
    setSelectedProperty(prop);
    setReservations(allRes || []);
    setPropertyOptions(Array.isArray(prop?.options) ? prop.options : availableOpts);
    if (Array.isArray(prop?.resources)) {
      setAvailableResources(prop.resources.map((r) => ({
        ...r,
        available: Number(r.available ?? r.quantity ?? 0),
      })));
    }
    setPricingQuote(calc);
    applyQuoteMinNights(calc);
    setUseCurrentPricing(false);
    setForm(prev => recalcPrice({
      ...prev,
      selectedOptions: [],
      customOptions: [],
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
  const getTimeConflictState = (reservationForm) => {
    if (!reservationForm.startDate || !reservationForm.endDate) {
      return { arrivalMessage: '', departureMessage: '', message: '' };
    }

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
        const message = `Impossible : le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h de ménage). Veuillez choisir une heure d'arrivée à partir de ${availH}:${availM}.`;
        return { arrivalMessage: message, departureMessage: '', message };
      }
    }

    const nextRes = otherReservations.find(r => r.startDate === reservationForm.endDate);
    if (nextRes) {
      const nextCheckInHour = timeToHour(nextRes.checkInTime || '15:00');
      if (newCheckOutHour + cleaning > nextCheckInHour) {
        const maxCheckOutHour = nextCheckInHour - cleaning;
        const maxH = String(Math.floor(maxCheckOutHour)).padStart(2, '0');
        const maxM = maxCheckOutHour % 1 >= 0.5 ? '30' : '00';
        const message = `Impossible : le départ à ${reservationForm.checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale pour cette réservation est ${maxH}:${maxM}.`;
        return { arrivalMessage: '', departureMessage: message, message };
      }
    }

    return { arrivalMessage: '', departureMessage: '', message: '' };
  };

  const getDateRangeConflictInfo = useCallback((startDate, endDate) => {
    if (!selectedProp || !startDate || !endDate) return null;
    const excludeId = editingReservationId || excludeReservationIdForDevis;
    return getRangeOccupancyConflictInfo({
      startDate,
      endDate,
      occupiedDates,
      reservations,
      excludeReservationId: excludeId,
    });
  }, [selectedProp, occupiedDates, editingReservationId, excludeReservationIdForDevis, reservations]);

  // ==================== SAVE & DELETE ====================
  const refreshToCurrentPricing = async () => {
    if (isReservationLocked) return;
    if (!editingReservationId && !isDevisMode) return;
    const proceed = await confirm({
      title: 'Actualiser les tarifs',
      message: isDevisMode
        ? 'Voulez-vous recalculer ce devis avec les derniers tarifs en vigueur ? Le prix saisi manuellement sera réinitialisé.'
        : 'Voulez-vous recalculer cette réservation avec les derniers tarifs en vigueur ? Tant que vous n\'enregistrez pas, les anciens prix restent conservés.',
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
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        discountPercent: form.discountPercent,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        depositAmount: form.depositAmount,
        balanceAmount: form.balanceAmount,
        selectedOptions: buildSelectedOptionsPayload(),
        customOptions: buildCustomOptionsPayload(),
        selectedResources: buildSelectedResourcesPayload(),
        offeredOptionIds: Array.from(offeredOptionIds),
        platform: form.platform,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
        forceCurrentPricing: true,
        customPrice: '',
      });
      setPricingQuote(calc);
      applyQuoteMinNights(calc);
      setNightlyBreakdown(calc.nightlyBreakdown || []);
      setUseCurrentPricing(true);
      // Reverting to current pricing also clears any manual price override.
      setForm((prev) => applyQuoteToForm({ ...prev, customPrice: '' }, calc));
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible d\'actualiser les tarifs.' });
    }
  };

  const handleSaveReservation = async (afterSaveAction = null, forceMinNights = false, forceCapacity = false) => {
    const safeAfterSaveAction = typeof afterSaveAction === 'function' ? afterSaveAction : null;
    
    if (!selectedProp) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner un logement.' });
      return false;
    }

    if (!form.startDate || !form.endDate) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner les dates.' });
      return false;
    }

    if (!form.clientId) {
      await alert({ title: 'Erreur', message: 'Veuillez sélectionner un client.' });
      return false;
    }

    if (form.startDate < todayStr && !reservationId) {
      await alert({ title: 'Conflit de réservation', message: 'Impossible de réserver dans le passé.' });
      return false;
    }

    const dateRangeConflictInfo = getDateRangeConflictInfo(form.startDate, form.endDate);
    if (dateRangeConflictInfo) {
      await alert({ title: 'Conflit de réservation', message: dateRangeConflictInfo.message });
      return false;
    }

    const timeConflictState = getTimeConflictState(form);
    if (timeConflictState.message) {
      await alert({ title: 'Conflit de réservation', message: timeConflictState.message });
      return false;
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
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, true);
      }
      return false;
    }

    if (exceedsSingleBedsLimit || exceedsDoubleBedsLimit) {
      await alert({ title: 'Conflit de réservation', message: 'Le nombre de lits saisi dépasse la capacité configurée du logement.' });
      return false;
    }

    for (const sr of (form.selectedResources || [])) {
      const resource = availableResources.find(r => r.id === sr.resourceId);
      if (!resource) continue;
      if (resource.isComplex || resource.priceType === 'per_hour') continue;
      if ((Number(sr.quantity) || 0) > Number(resource.available || 0)) {
        await alert({ title: 'Conflit de réservation', message: `La ressource '${resource.name}' n'est plus disponible en quantité suffisante.` });
        return false;
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
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        discountPercent: form.discountPercent,
        customPrice: form.customPrice,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        depositAmount: form.depositAmount,
        balanceAmount: form.balanceAmount,
        selectedOptions: buildSelectedOptionsPayload(),
        customOptions: buildCustomOptionsPayload(),
        selectedResources: buildSelectedResourcesPayload(),
        offeredOptionIds: Array.from(offeredOptionIds),
        lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
        lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
        forceCurrentPricing: useCurrentPricing,
        platform: form.platform,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
      });
      setPricingQuote(quote);
      applyQuoteMinNights(quote);

      if (quote.minNightsBreached && !forceMinNights) {
        const proceed = await confirm({
          title: 'Durée minimale non respectée',
          message: `Cette réservation contient ${quote.nights} nuit(s), inférieur au minimum requis de ${quote.requiredMinNights} nuit(s). Voulez-vous forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity);
      }

      if (isDevisMode) {
        const devisPayload = {
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
          status: form.status || 'draft',
          totalPrice: quote.totalPrice,
          touristTaxRate: quote.touristTaxRate || 0,
          touristTaxTotal: quote.touristTaxTotal || 0,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          cautionAmount: form.cautionAmount,
          notes: form.notes,
          offeredOptionIds: Array.from(offeredOptionIds),
          selectedOptions: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          selectedResources: quote.resourceLines,
        };

        if (editingDevisId) {
          await api.updateDevis(editingDevisId, devisPayload);
          setInitialSnapshot(formSnapshot);
          if (safeAfterSaveAction) {
            safeAfterSaveAction();
          }
          return true;
        } else {
          const created = await api.createDevis(devisPayload);
          if (safeAfterSaveAction) {
            safeAfterSaveAction();
          } else if (created?.id) {
            navigate(`/reservations/new?mode=devis&devisId=${created.id}`);
          } else {
            navigate('/devis');
          }
          return true;
        }
      } else if (reservationId) {
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
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
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
          offeredOptionIds: Array.from(offeredOptionIds),
          options: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          resources: quote.resourceLines,
        });
        setInitialSnapshot(formSnapshot);
        if (safeAfterSaveAction) {
          safeAfterSaveAction();
        } else {
          navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus());
        }
        return true;
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
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          cautionAmount: form.cautionAmount,
          notes: form.notes,
          forceMinNights,
          forceCapacity,
          offeredOptionIds: Array.from(offeredOptionIds),
          options: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          resources: quote.resourceLines,
        });
        setInitialSnapshot(formSnapshot);
        if (safeAfterSaveAction) {
          safeAfterSaveAction();
        } else {
          navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus());
        }
        return true;
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
          return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity);
        }
        return false;
      }
      await alert({ title: 'Erreur', message: err.message });
      return false;
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
    if (isDevisMode) {
      requestLeave(() => navigate(-1));
      return;
    }
    requestLeave(() => navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus()));
  };

  // ── Devis helpers ─────────────────────────────────────────────────────────
  const handleCreateDevisFromForm = () => {
    navigate('/reservations/new?mode=devis', {
      state: {
        prefillDevis: {
          propertyId: Number(selectedProp || form.propertyId || 0) || null,
          form,
          offeredOptionIds: Array.from(offeredOptionIds || []),
        },
      },
    });
  };

  const handleConvertToDevis = async () => {
    if (!editingReservationId) return;
    const ok = await confirm({
      title: 'Transformer en devis',
      message: 'Voulez-vous créer un devis à partir de cette réservation ? La réservation actuelle ne sera pas modifiée.',
      confirmLabel: 'Créer le devis',
      confirmColor: 'info',
    });
    if (!ok) return;
    try {
      const devis = await api.createDevisFromReservation(editingReservationId);
        navigate(`/reservations/new?mode=devis&devisId=${devis.id}`);
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible de créer le devis.' });
    }
  };

  const handleOpenDevisPdf = async () => {
    if (!editingDevisId) return;
    try {
      const saved = await handleSaveReservation(() => {});
      if (!saved) return;

      const blob = await api.getDevisPdfBlob(editingDevisId);
      const fileUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `devis-${editingDevisId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible de télécharger le PDF du devis.' });
    }
  };

  // Devis status change. Moving a saved devis to "Accepté" saves the current edits, converts the devis
  // into a (persisted) reservation after confirmation, and lands on that reservation — this replaces the
  // former standalone "Passer en réservation" action. Other status changes (draft/sent) just update the
  // form. The landing reservation carries a back-target to the calendar centered on it, so "Annuler"
  // returns there.
  const handleDevisStatusChange = async (nextStatus) => {
    if (nextStatus === 'accepted' && editingDevisId) {
      const ok = await confirm({
        title: 'Accepter le devis',
        message: 'En acceptant ce devis, il sera enregistré puis converti en réservation (les dates seront bloquées). Voulez-vous continuer ?',
        confirmLabel: 'Convertir en réservation',
        cancelLabel: 'Annuler',
        confirmColor: 'warning',
      });
      if (!ok) return;
      try {
        // Persist current devis edits first so the reservation reflects them, then convert.
        const saved = await handleSaveReservation(() => {});
        if (!saved) return;
        const result = await api.convertDevisToReservation(editingDevisId);
        if (result?.reservationId) {
          // Land on the saved reservation; "Annuler"/retour goes back to the calendar centered on it.
          navigate(`/reservations/${result.reservationId}?from=${encodeURIComponent('/calendar')}`);
        } else {
          navigate('/reservations/new');
        }
      } catch (e) {
        await alert({ title: 'Erreur', message: e.message || 'Impossible de convertir le devis.' });
      }
      return;
    }
    updateForm({ status: nextStatus });
  };

  const handleDeleteDevis = async () => {
    if (!editingDevisId) return;
    const ok = await confirm({
      title: 'Supprimer le devis',
      message: 'Êtes-vous sûr de vouloir supprimer ce devis ? Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteDevis(editingDevisId);
      navigate('/devis');
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible de supprimer le devis.' });
    }
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
  const lockedSectionSx = isReservationLocked ? { opacity: 0.55, pointerEvents: 'none' } : undefined;
  const dateRangeConflictInfo = getDateRangeConflictInfo(form.startDate, form.endDate);
  const datesUnavailableForProperty = Boolean(dateRangeConflictInfo);
  const datesUnavailableMessage = dateRangeConflictInfo?.message || 'Ces dates ne sont pas dispo pour ce logement.';
  const minNightsWarning = minNightsState.breached
    ? `Séjour trop court: ${minNightsState.nights} nuit(s) pour un minimum saisonnier de ${minNightsState.required} nuit(s).`
    : '';
  const liveTimeConflictState = getTimeConflictState(form);
  const liveTimeConflictMessage = liveTimeConflictState.message;
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
  const parsedTotalPrice = form.totalPrice === '' ? null : Number(form.totalPrice || 0);
  const parsedCustomPrice = form.customPrice === '' ? null : Number(form.customPrice || 0);
  const accommodationBasePriceDisplay = parsedTotalPrice !== null ? parsedTotalPrice.toFixed(2) : null;
  const accommodationDiscountedPriceDisplay = pricingQuote?.accommodationAdjustedPrice != null
    ? Number(pricingQuote.accommodationAdjustedPrice).toFixed(2)
    : (parsedCustomPrice !== null ? Number(parsedCustomPrice).toFixed(2) : accommodationBasePriceDisplay);
  const displayableResources = availableResources.filter((resource) => {
    const name = String(resource?.name || '').toLowerCase();
    return !(name.includes('lit') && (name.includes('bébé') || name.includes('bebe')));
  });
  const isHourlyResource = (resource) => Boolean(resource?.isComplex) || resource?.priceType === 'per_hour';
  const hasExtrasSection = true;
  const formSectionCardSx = {
    bgcolor: '#fff',
    borderRadius: 2,
    overflow: 'hidden',
  };
  const sectionGridSx = { width: '100%', m: 0 };
  const formSectionContentSx = {
    p: { xs: 1.5, sm: 2 },
    '&:last-child': { pb: { xs: 1.5, sm: 2 } },
  };

  const computedTitle = isDevisMode
    ? (editingDevisId ? 'Modifier le devis' : 'Nouveau devis')
    : (reservationId ? 'Modifier la réservation' : 'Nouvelle réservation');

  const actionBarBefore = [
    ...(!isDevisMode && !reservationId
      ? [{ icon: <DescriptionIcon />, tooltip: 'Créer un devis', onClick: handleCreateDevisFromForm, color: 'info' }] : []),
    ...(!isDevisMode && reservationId
      ? [{ icon: <DescriptionIcon />, tooltip: 'Transformer en devis', onClick: handleConvertToDevis, color: 'info' }] : []),
    ...(isDevisMode ? [{
      node: (
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Statut</InputLabel>
          <Select value={form.status || 'draft'} label="Statut" onChange={(e) => handleDevisStatusChange(e.target.value)}>
            {DEVIS_STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      ),
    }] : []),
    ...(isDevisMode
      ? [{ icon: <DescriptionIcon />, tooltip: 'Télécharger PDF', onClick: handleOpenDevisPdf, color: 'info', disabled: !editingDevisId }] : []),
  ];

  const actionBarAfter = [
    ...(!isDevisMode && reservationId
      ? [{ icon: <DeleteIcon />, tooltip: 'Supprimer', onClick: handleDeleteReservation, color: 'error', disabled: isReservationLocked }] : []),
    ...(isDevisMode && editingDevisId
      ? [{ icon: <DeleteIcon />, tooltip: 'Supprimer le devis', onClick: handleDeleteDevis, color: 'error' }] : []),
  ];

  // Single bundle exposed to the form section components (StaySection / GuestsBedsSection /
  // ExtrasSection / FinanceSection) via ReservationFormContext. The page keeps owning all state,
  // the pricing pipeline and the handlers — this object is only an exposure layer (no logic moved).
  const formContextValue = {
    // shared styles
    formSectionCardSx, lockedSectionSx, formSectionContentSx, sectionGridSx,
    // core
    form, updateForm,
    // catalogs
    properties, propertyOptions, displayableResources,
    // stay
    selectedProp, handleReservationPropertyChange,
    miniCalendarStart, setMiniCalendarStart, miniVisibleDays, reservations,
    editingReservationId, handleMiniDateClick, centerMiniCalendarOnRange,
    arrivalMin, arrivalMax, departureMin, departureMax, handleManualDateInputChange,
    datesUnavailableForProperty, datesUnavailableMessage, minNightsState, minNightsWarning,
    liveTimeConflictState, liveTimeConflictMessage, defaultCheckInTime, defaultCheckOutTime,
    isReservationLocked,
    // guests / beds
    maxAdultsAllowed, maxBabiesAllowed, maxSingleBeds, maxDoubleBeds,
    exceedsAdultsCapacity, exceedsChildrenCapacity, exceedsBabiesCapacity, exceedsTotalCapacity,
    exceedsSingleBedsLimit, exceedsDoubleBedsLimit, bedsCapacityMismatch,
    totalGuestsCount, totalGuestsMax, reservationBedCapacity, requiredRegularBeds,
    maxBabyBedsByRule, remainingBabyBeds, handleSuggestBeds,
    // extras
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setOptionEnabled, setOptionQuantity, setResourceEnabled, setResourceQuantity,
    addCustomOption, updateCustomOption, removeCustomOption,
    // finance
    isDevisMode, reservationId, refreshToCurrentPricing,
    accommodationBasePriceDisplay, pricingQuote,
  };

  return (
    <Box sx={{ pb: 4 }}>
      <PageActionBar
        title={computedTitle}
        onBack={goBackToOrigin}
        subtitle={useCurrentPricing
          ? <Chip size="small" color="warning" variant="outlined" label="Tarifs actuels appliqués (non sauvegardé)" />
          : null}
        actionsBefore={actionBarBefore}
        onSave={handleSaveReservation}
        saveTooltip={isDevisMode ? 'Enregistrer le devis' : 'Enregistrer'}
        onCancel={goBackToOrigin}
        actionsAfter={actionBarAfter}
      />

      <Box
        sx={{
          maxWidth: 1300,
          mx: 'auto',
          px: 2,
          py: 3,
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
            Cette réservation est passée ou en cours : seuls le client, la plateforme, les ajustements de prix et les statuts de paiement/caution restent modifiables.
          </Typography>
        )}

        <Box
          sx={{
            position: 'relative',
          }}
        >

        <ReservationFormProvider value={formContextValue}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <StaySection />

          <Card variant="outlined" sx={formSectionCardSx}>
            <CardContent sx={formSectionContentSx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Client</Typography>
              <Stack spacing={1.25}>
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
                <Box>
                  <Button size="small" variant="text" onClick={() => setCreateClientOpen(true)}>
                    + Créer un nouveau client
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <GuestsBedsSection />

          <Card variant="outlined" sx={formSectionCardSx}>
            <CardContent sx={formSectionContentSx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Canal</Typography>
              <FormControl fullWidth>
                <InputLabel>Plateforme</InputLabel>
                <Select value={form.platform} label="Plateforme" onChange={(e) => updateForm({ platform: e.target.value })}>
                  {PLATFORMS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </FormControl>
            </CardContent>
          </Card>

          {hasExtrasSection && <ExtrasSection />}

          <FinanceSection />

          <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
            <CardContent sx={formSectionContentSx}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Notes</Typography>
              <TextField
                label="Notes"
                multiline
                rows={3}
                value={form.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
                fullWidth
              />
            </CardContent>
          </Card>
        </Box>
        </ReservationFormProvider>
        </Box>
        </Box>

        {/* Panneau latéral droit : Résumé des prix */}
        <PricingSummary
          quote={pricingQuote}
          form={form}
          nightlyBreakdown={nightlyBreakdown}
          offeredOptionIds={offeredOptionIds}
          propertyOptions={propertyOptions}
          availableResources={availableResources}
          isIcalSource={isIcalSource}
          selectedProperty={selectedProperty}
          parsedTotalPrice={parsedTotalPrice}
          accommodationDiscountedPriceDisplay={accommodationDiscountedPriceDisplay}
          onToggleExtraGuestOffered={(next) => updateForm({ extraGuestSurchargeOffered: next })}
          onToggleOptionOffered={(optionId, next) => {
            const updated = new Set(offeredOptionIds);
            if (next) updated.add(optionId);
            else updated.delete(optionId);
            setOfferedOptionIds(updated);
          }}
          onToggleCustomOptionOffered={(customKey, next) => updateCustomOption(customKey, { offered: next })}
          onToggleResourceOffered={(resourceId, next) => setResourceOffered(resourceId, next)}
        />

        {editingReservationId && (
          <Box sx={{ gridColumn: { xs: '1 / -1', md: '1 / 2' } }}>
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
