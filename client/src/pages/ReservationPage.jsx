import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router';
import {
  Box, TextField, Autocomplete, Button, FormControl, InputLabel, Select,
  MenuItem, Typography, Chip, Stack, Card, CardContent,
  useMediaQuery,
  ToggleButton, ToggleButtonGroup, Tooltip
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import MailOutlineIcon from '@mui/icons-material/MailOutlined';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PaymentsIcon from '@mui/icons-material/Payments';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import PageActionBar from '../components/PageActionBar';
import ReservationConflictBadge from '../components/ReservationConflictBadge';
import EmailManualSendDialog from '../components/EmailManualSendDialog';
import PricingSummary from '../components/PricingSummary';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import { ReservationFormProvider } from '../components/reservation/ReservationFormContext';
import StaySection from '../components/reservation/StaySection';
import GuestsBedsSection from '../components/reservation/GuestsBedsSection';
import ExtrasSection from '../components/reservation/ExtrasSection';
import FinanceSection from '../components/reservation/FinanceSection';
import ReservationHistoryPanel from '../components/reservation/ReservationHistoryPanel';
import usePlatforms from '../hooks/usePlatforms';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import api from '../api';
import { getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { getFromParam, navigateBackWithFrom } from '../utils/navigation';
import { applyQuoteToForm as applyQuoteToFormPure } from '../utils/applyQuoteToForm';
import { midStayNoteAccess, countMidStayNotes } from '../utils/midStayNoteAccess';
import {
  buildInitialGrid as buildInitialCardGrid,
  buildGridFromStored as buildCardGridFromStored,
  reconcileGrid as reconcileCardGrid,
  toWireOccurrences as toWireCardOccurrences,
  isDailyCard,
} from '../utils/cardOccurrences';
import { formatCurrency } from '../utils/formatters';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';

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
  // Pure-info confirmations toast instead of modaling (specs/ds-components.md §3.2).
  const { showSuccess } = useToast();
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
  const [initError, setInitError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  // Inline client display/edit (replaces the old dropdown). `selectedClient` is the source of truth
  // for the bold name; `clientSearchOpen` reveals the search to attach a DIFFERENT existing client;
  // `clientDialogMode` switches the shared FormDialog between create and edit.
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientDialogMode, setClientDialogMode] = useState('create');
  // specs/email-automation.md §6.6 — opens EmailManualSendDialog from the action bar.
  const [emailSendOpen, setEmailSendOpen] = useState(false);
  // specs/mid-stay-notes.md §3.5 rule 17 — l'état vit ICI et non dans FinanceSection : la fenêtre
  // s'ouvre depuis deux endroits, la barre d'actions collante (point d'entrée principal) et le bloc
  // « Encaissements en séjour » plus bas dans la carte Finance.
  const [midStayNoteOpen, setMidStayNoteOpen] = useState(false);
  const [newClient, setNewClient] = useState(EMPTY_CLIENT);
  const [newClientCityOptions, setNewClientCityOptions] = useState([]);
  const [propertyOptions, setPropertyOptions] = useState([]);
  // Server-computed option grouping for the fiche (specs/option-categories.md §4.2) — `{ ungrouped,
  // groups }`, already visibility-filtered and ordered. null until a property is loaded, and on
  // payloads that predate the feature: ExtrasSection then falls back to the flat list.
  const [propertyOptionGroups, setPropertyOptionGroups] = useState(null);
  const [availableResources, setAvailableResources] = useState([]);
  const [nightlyBreakdown, setNightlyBreakdown] = useState([]);
  const [pricingQuote, setPricingQuote] = useState(null);
  const [minNightsState, setMinNightsState] = useState({ breached: false, required: 0, nights: 0 });
  const [useCurrentPricing, setUseCurrentPricing] = useState(false);
  // specs/tourist-tax-freeze-past-with-refresh.md — past reservations keep a FROZEN tourist tax; this
  // flag (set by the refresh button) forces a one-off live recompute until the reservation is reloaded.
  const [touristTaxRefreshRequested, setTouristTaxRefreshRequested] = useState(false);
  const [offeredOptionIds, setOfferedOptionIds] = useState(new Set());

  // §3.7 — cache of the current property's option defaults. Refreshed whenever `form.propertyId`
  // changes (incl. on edit-load), so `setOptionQuantity` can apply the offered flag when the
  // operator re-toggles an option ON. Map<optionId, { offered }>. Empty when no property or no
  // defaults exist (the GET fails soft → empty list). The state declaration is here (early
  // because `applyPropertyDefaultsAsync` below seeds it), but the useEffect that watches
  // `form.propertyId` lives further down — AFTER the `form` state is declared — to avoid a
  // TDZ crash in the minified prod bundle when accessing `form` before its useState ran.
  const [propertyOptionDefaults, setPropertyOptionDefaults] = useState([]);
  const propertyOptionDefaultsMap = useMemo(() => {
    const m = new Map();
    for (const d of propertyOptionDefaults) {
      m.set(Number(d.optionId), { offered: Boolean(d.offered) });
    }
    return m;
  }, [propertyOptionDefaults]);

  // §3.7 — apply per-property option defaults to a fresh form. Called from the new-reservation
  // init path AND from the property-change handler (both reset selectedOptions: []). NEVER called
  // from the edit path (the historical option set on a saved reservation must stay frozen —
  // rule 30). The function merges defaults into selectedOptions + offeredOptionIds; existing
  // entries are preserved (no duplicate, no override of operator picks).
  const applyPropertyDefaultsAsync = useCallback(async (propertyId) => {
    if (!propertyId) return;
    try {
      const defaults = await api.getPropertyOptionDefaults(propertyId);
      const list = Array.isArray(defaults) ? defaults : [];
      // Cache the list so the toggle behaviour (setOptionQuantity) can consult it later when
      // the operator manually re-adds an option on an existing reservation.
      setPropertyOptionDefaults(list);
      if (list.length === 0) return;
      setForm((prev) => {
        const existing = new Set((prev.selectedOptions || []).map((so) => Number(so.optionId)));
        const toAdd = list
          .filter((d) => !existing.has(Number(d.optionId)))
          .map((d) => ({ optionId: Number(d.optionId), quantity: 1, totalPrice: 0 }));
        if (toAdd.length === 0) return prev;
        return { ...prev, selectedOptions: [...(prev.selectedOptions || []), ...toAdd] };
      });
      setOfferedOptionIds((prev) => {
        const next = new Set(prev);
        for (const d of list) {
          if (d.offered) next.add(Number(d.optionId));
        }
        return next;
      });
    } catch (_) {
      // Soft fail — a defaults fetch must never block the reservation flow.
    }
  }, []);

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
    // Human-readable reservation number (specs/reservation-number-and-search.md). Generated server-side
    // on first save; editable (overridable). '' for a new reservation until the first save returns it.
    reservationNumber: '',
    bookingConflictAt: null, // online-payment date conflict (specs/public-online-payment.md §6)
    singleBeds: '', doubleBeds: '', babyBeds: '',
    extraGuestSurchargeOffered: false,
    totalPrice: 0, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    // Manual deposit override (specs/editable-deposit-amount.md). '' = automatic (percentage);
    // a number freezes the deposit and lets the solde absorb tariff changes.
    depositAmountOverride: '',
    depositDisabled: false, // per-reservation opt-out (specs/disable-deposit-per-reservation.md)
    cautionAmount: 0, cautionReceived: false, cautionReceivedDate: '', cautionReturned: false, cautionReturnedDate: '',
    notes: '', selectedOptions: [], customOptions: [], selectedResources: [], checkInTime: '15:00', checkOutTime: '10:00',
    // Desired breakfast time (specs/breakfast-time.md); '' = use the breakfast option's default.
    breakfastTime: '',
    startDate: '', endDate: '', propertyId: null,
    // Per-item routing to Complément (spec force-item-to-complement.md). The flag is binary:
    // ON = the tourist tax lives 100 % in the Complément entry; OFF = it follows the auto
    // deposit/balance split. Per-line `inComplement` lives inside each selected* entry.
    touristTaxInComplement: false,
    // List of optionIds (auto-options only: early check-in / late check-out / ...) the user
    // wants routed to Complément. Auto-options aren't in `selectedOptions` (the engine derives
    // them from `option.autoEnabled`), so they need this parallel channel.
    autoOptionsInComplement: [],
    // specs/platform-commission-line.md — operator-entered platform commission (€), '' = none. Drives
    // the « total séjour − commission = net perçu » block on the fiche (platform reservations only).
    platformCommissionAmount: '',
    // specs/platform-per-echeance-commission.md — commission on the acompte (platform only), '' = none.
    acompteCommissionAmount: '',
    // specs/platform-payment-entry.md — brut (pins the total séjour) + virement (reconciliation), '' = unset.
    platformGrossAmount: '',
    platformPayoutAmount: '',
  });

  // §3.7 — keep the defaults cache in sync with the form's current property. This covers the
  // EDIT-existing-reservation path: we don't auto-merge defaults on edit (rule 30), but the
  // cache must be populated so that when the operator manually toggles an option back on, the
  // setOptionQuantity logic can apply the offered flag per the property's contract.
  // **Declared AFTER `form`** to avoid a TDZ crash in the minified prod bundle that fired on
  // the first render before the `form` useState had initialised.
  useEffect(() => {
    const propId = Number(form.propertyId);
    if (!propId) {
      setPropertyOptionDefaults([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getPropertyOptionDefaults(propId);
        if (!cancelled) setPropertyOptionDefaults(Array.isArray(data) ? data : []);
      } catch (_) {
        if (!cancelled) setPropertyOptionDefaults([]);
      }
    })();
    return () => { cancelled = true; };
  }, [form.propertyId]);

  const newClientEmailError = !isValidEmail(newClient.email);
  const newClientPhoneError = !isValidPhone(newClient.phone);
  // specs/force-extras-complement-on-platform.md §3 rule 4: non-direct platforms route every
  // extras line to the Complément. Used below to project the pricing engine's preview before
  // the server enforces the same rule on save — see the `quoteInput` useMemo.
  // Dynamic platform list (built-ins ∪ DB platforms, incl. iCal-added). specs/ical-platforms-in-dropdowns.md.
  const platforms = usePlatforms();
  // Guard against an out-of-range <Select> value: a just-saved reservation whose platform isn't
  // (yet) in the list still renders its own value.
  const platformOptions = form.platform && !platforms.includes(form.platform)
    ? [...platforms, form.platform]
    : platforms;
  const isPlatformReservation = Boolean(form.platform) && String(form.platform).toLowerCase() !== 'direct';
  const formSnapshot = useMemo(() => JSON.stringify({
    selectedProp: selectedProp ? Number(selectedProp) : null,
    form,
  }), [selectedProp, form]);
  // A reservation is "past" (→ frozen tourist tax) when its last night (endDate − 1 day) is before the
  // 1st of the current month (specs/tourist-tax-freeze-past-with-refresh.md §3 rule 1).
  const isPastReservation = useMemo(() => {
    if (!editingReservationId || !form.endDate) return false;
    const lastNight = new Date(`${form.endDate}T00:00:00`);
    lastNight.setDate(lastNight.getDate() - 1);
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return lastNight < firstOfMonth;
  }, [editingReservationId, form.endDate]);
  const freezeTouristTax = isPastReservation && !touristTaxRefreshRequested;
  // Reset the manual refresh when switching to another reservation (the frozen value is re-loaded).
  useEffect(() => { setTouristTaxRefreshRequested(false); }, [editingReservationId]);

  const pricingQuoteSignature = useMemo(() => JSON.stringify({
    propertyId: selectedProp ? Number(selectedProp) : null,
    freezeTouristTax,
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
    // specs/platform-commission-line.md — recompute when the platform commission changes (it drives the
    // « net perçu » line + the solde).
    platformCommissionAmount: form.platformCommissionAmount === '' ? '' : Number(form.platformCommissionAmount),
    acompteCommissionAmount: form.acompteCommissionAmount === '' ? '' : Number(form.acompteCommissionAmount),
    // specs/platform-payment-entry.md — the brut pins the total séjour (recompute when it changes).
    platformGrossAmount: form.platformGrossAmount === '' ? '' : Number(form.platformGrossAmount),
    depositPaid: Boolean(form.depositPaid),
    balancePaid: Boolean(form.balancePaid),
    complementPaid: Boolean(form.complementPaid),
    depositAmount: form.depositPaid ? Number(form.depositAmount || 0) : null,
    balanceAmount: form.depositPaid && form.balancePaid ? Number(form.balanceAmount || 0) : null,
    complementAmount: form.complementPaid ? Number(form.complementAmount || 0) : null,
    // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
    depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
    depositDisabled: Boolean(form.depositDisabled),
    // specs/force-extras-complement-on-platform.md §3 rule 4: on non-direct platforms, every
    // extras line is routed to the Complément server-side at save. We mirror that bit here
    // so the live preview shows the correct totals immediately, without mutating form state
    // (operators keep their toggles intact if they switch back to direct mid-edit). The server
    // re-applies the same forcing in reservationsModel.replace{Options,CustomOptions,Resources}
    // so the wire payload doesn't have to be sanitized here.
    selectedOptions: (form.selectedOptions || [])
      // Exclude only options the pricing engine derives ITSELF (early/late check-in/out, i.e.
      // `autoEnabled = 1`). Options that merely carry `autoOptionType` for the undeletability
      // marker (linen options, since 2026-06-02) ARE part of the manual selection and must
      // round-trip to the server.
      .filter((item) => Number(propertyOptions.find((o) => o.id === Number(item.optionId))?.autoEnabled || 0) !== 1)
      .map((item) => {
        const line = { optionId: Number(item.optionId), quantity: Number(item.quantity || 0), inComplement: item.inComplement == null ? null : (item.inComplement ? 1 : 0) };
        // Include the checked occurrences so the live preview re-fetches when the selection changes.
        if (Array.isArray(item.cardOccurrences)) line.cardOccurrences = toWireCardOccurrences(item.cardOccurrences);
        return line;
      })
      .sort((a, b) => a.optionId - b.optionId),
    customOptions: (form.customOptions || [])
      .map((line, index) => ({
        customKey: String(line.customKey || `custom_${index + 1}`),
        description: String(line.description || '').trim(),
        amount: Number(line.amount || 0),
        offered: Boolean(line.offered),
        inComplement: line.inComplement == null ? null : (line.inComplement ? 1 : 0),
      }))
      .filter((line) => line.description && Number(line.amount || 0) > 0)
      .sort((a, b) => a.customKey.localeCompare(b.customKey)),
    selectedResources: (form.selectedResources || [])
      .map((item) => ({ resourceId: Number(item.resourceId), quantity: Number(item.quantity || 0), offered: Boolean(item.offered), inComplement: item.inComplement == null ? null : (item.inComplement ? 1 : 0), sessions: Array.isArray(item.sessions) ? item.sessions : [] }))
      .sort((a, b) => a.resourceId - b.resourceId),
    offeredOptionIds: Array.from(offeredOptionIds).map(Number).sort((a, b) => a - b),
    platform: form.platform,
    touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
    // On a platform reservation, every auto-enabled option is also in Complément — union the
    // explicit operator set with the catalog's auto-enabled ids so the engine preview matches
    // what the server will write on save.
    autoOptionsInComplement: isPlatformReservation
      ? Array.from(new Set([
          ...((form.autoOptionsInComplement || []).map(Number)),
          ...propertyOptions.filter((o) => Number(o.autoEnabled || 0) === 1).map((o) => Number(o.id)),
        ])).sort((a, b) => a - b)
      : [...(form.autoOptionsInComplement || [])].map(Number).sort((a, b) => a - b),
    // specs/tourist-tax-freeze-past-with-refresh.md — `freezeTouristTax` MUST be a dependency: the
    // « Recalculer » button flips it (via `touristTaxRefreshRequested`), and without it here the memo
    // stays stale, the live-preview effect never re-fires, and the tax only recomputes after a save.
  }), [selectedProp, form.startDate, form.endDate, form.checkInTime, form.checkOutTime, form.adults, form.children, form.teens, form.extraGuestSurchargeOffered, form.discountPercent, form.customPrice, form.depositPaid, form.balancePaid, form.depositAmount, form.balanceAmount, form.depositAmountOverride, form.selectedOptions, form.customOptions, form.selectedResources, propertyOptions, offeredOptionIds, form.platform, form.depositDisabled, form.touristTaxInComplement, form.autoOptionsInComplement, form.platformCommissionAmount, form.acompteCommissionAmount, form.platformGrossAmount, isPlatformReservation, freezeTouristTax]);
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

  // Thin wrapper over the pure helper (src/utils/applyQuoteToForm.js). Kept as a useCallback so
  // setForm closures don't re-create the dependency on every render.
  const applyQuoteToForm = useCallback(
    (prev, quote, preserveBlankPrice = false) => applyQuoteToFormPure(prev, quote, { preserveBlankPrice }),
    [],
  );

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
            const availableOpts = opts.filter(o => (o.propertyIds || []).includes(prefillPropertyId));

            setSelectedProp(prefillPropertyId);
            setSelectedProperty(propDetails || props.find((p) => p.id === prefillPropertyId) || null);
            setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
            setPropertyOptionGroups(propDetails?.optionGroups || null);
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
            setPropertyOptionGroups(null);
          }
        }

        // Load reservation details if editing
        if (reservationId) {
          // Fetch the reservation AND the global settings in parallel — we need
          // `settings.reservations.allowEditPastReservations` to know whether the past-edition
          // lock applies (specs/admin-unlock-past-reservations.md). The setting is small and
          // cached server-side; an extra parallel fetch is cheaper than threading it through
          // an app-wide context for a feature only one page consumes.
          const [res, settings] = await Promise.all([
            api.getReservation(reservationId),
            api.getSettings(),
          ]);
          const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
          const isPast = Boolean(res.startDate && res.startDate <= todayStr);
          const adminUnlock = Boolean(settings?.reservations?.allowEditPastReservations);
          setExistingReservationLocked(isPast && !adminUnlock);
          const prop = props.find(p => p.id === res.propertyId);
          const propDetails = await api.getProperty(res.propertyId);
          setSelectedProp(res.propertyId);
          setSelectedProperty(propDetails || prop);
          
          const opts = await api.getOptions();
          const availableOpts = opts.filter(o => (o.propertyIds || []).includes(res.propertyId));
          setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
          setPropertyOptionGroups(propDetails?.optionGroups || null);
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
            reservationNumber: res.reservationNumber || '',
            bookingConflictAt: res.bookingConflictAt || null,
            adults: res.adults || 1,
            children: res.children || 0,
            teens: res.teens || 0,
            babies: res.babies || 0,
            platform: res.platform || 'direct',
            singleBeds: res.singleBeds || '',
            doubleBeds: res.doubleBeds || '',
            babyBeds: res.babyBeds || '',
            breakfastTime: res.breakfastTime || '',
            extraGuestSurchargeOffered: Boolean(res.extraGuestSurchargeOffered),
            totalPrice: importedBlankPrice ? '' : res.totalPrice || 0,
            touristTaxRate: res.touristTaxRate || 0,
            touristTaxTotal: res.touristTaxTotal || 0,
            discountPercent: res.discountPercent || 0,
            finalPrice: importedBlankPrice ? '' : res.finalPrice || 0,
            customPrice: importedBlankPrice ? '' : parseCustomPrice(res.customPrice),
            depositAmount: res.depositAmount || 0,
            depositDueDate: res.depositDueDate || '',
            // Manual deposit override (specs/editable-deposit-amount.md): server returns '' when auto.
            depositAmountOverride: res.depositAmountOverride === '' || res.depositAmountOverride == null ? '' : Number(res.depositAmountOverride),
            balanceAmount: res.balanceAmount || 0,
            balanceDueDate: res.balanceDueDate || '',
            cautionAmount: res.cautionAmount || 0,
            cautionReceived: res.cautionReceived || false,
            cautionReceivedDate: res.cautionReceivedDate || '',
            cautionReturned: res.cautionReturned || false,
            cautionReturnedDate: res.cautionReturnedDate || '',
            notes: res.notes || '',
            // Per-item routing (spec force-item-to-complement.md): hydrate `inComplement` +
            // captured contribs so PricingSummary can render `[compl.]` chips and split lines
            // where current totalPrice > acompteContribTtc + soldeContribTtc.
            selectedOptions: (res.options || []).filter(o => !o.isCustom).map(o => {
              // Option-driven planning cards (specs/option-planning-card.md §3.2): rebuild the
              // working occurrence grid from the stored {date,time}[] so the checklist restores the
              // exact saved selection. The option's catalog config (mode + slots) drives the grid.
              const cat = (opts || []).find((c) => Number(c.id) === Number(o.optionId));
              const cardOccurrences = (cat && cat.showsPlanningCard)
                ? buildCardGridFromStored(cat, res.startDate, res.endDate, o.cardOccurrences, res.checkInTime, res.checkOutTime)
                : undefined;
              return {
                optionId: o.optionId, quantity: o.quantity, totalPrice: o.totalPrice, originalTotalPrice: o.originalTotalPrice,
                offered: Boolean(o.offered),
                inComplement: Number(o.inComplement || 0) === 1,
                acompteContribTtc: o.acompteContribTtc != null ? Number(o.acompteContribTtc) : null,
                soldeContribTtc: o.soldeContribTtc != null ? Number(o.soldeContribTtc) : null,
                ...(cardOccurrences ? { cardOccurrences } : {}),
              };
            }),
            customOptions: (res.options || []).filter(o => o.isCustom).map((o, index) => ({
              customKey: String(o.customOptionId || `custom_${index + 1}`),
              customOptionId: o.customOptionId != null ? Number(o.customOptionId) : undefined,
              description: o.title || o.description || '',
              amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0),
              offered: Boolean(o.offered),
              inComplement: Number(o.inComplement || 0) === 1,
              acompteContribTtc: o.acompteContribTtc != null ? Number(o.acompteContribTtc) : null,
              soldeContribTtc: o.soldeContribTtc != null ? Number(o.soldeContribTtc) : null,
            })),
            selectedResources: (res.resources || []).map(r => ({
              resourceId: r.resourceId,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              billedUnits: r.billedUnits,
              priceType: r.priceType,
              totalPrice: r.totalPrice,
              originalTotalPrice: Number(r.originalTotalPrice ?? r.totalPrice ?? 0),
              offered: Boolean(r.offered),
              inComplement: Number(r.inComplement || 0) === 1,
              acompteContribTtc: r.acompteContribTtc != null ? Number(r.acompteContribTtc) : null,
              soldeContribTtc: r.soldeContribTtc != null ? Number(r.soldeContribTtc) : null,
              sessions: Array.isArray(r.sessions) ? r.sessions : [],
            })),
            checkInTime: res.checkInTime || '15:00',
            checkOutTime: res.checkOutTime || '10:00',
            startDate: res.startDate,
            endDate: res.endDate,
            propertyId: res.propertyId,
            depositPaid: res.depositPaid || false,
            depositPaidDate: res.depositPaidDate || '',
            depositDisabled: Boolean(res.depositDisabled),
            balancePaid: res.balancePaid || false,
            balancePaidDate: res.balancePaidDate || '',
            complementPaid: Boolean(res.complementPaid),
            complementPaidDate: res.complementPaidDate || '',
            complementPaidCash: Boolean(res.complementPaidCash),
            // End-of-stay complement (departure SAS) — surfaced on the fiche like the arrival complement
            // (specs/cash-complement-and-endofstay-finance.md §3.1).
            endOfStayComplementAmount: Number(res.endOfStayComplementAmount || 0),
            endOfStayComplementPaid: Boolean(res.endOfStayComplementPaid),
            endOfStayComplementPaidDate: res.endOfStayComplementPaidDate || '',
            endOfStayComplementPaidCash: Boolean(res.endOfStayComplementPaidCash),
            endOfStayComplementDetail: res.endOfStayComplementDetail || null,
            // specs/mid-stay-notes.md §3.1 — history of what was collected DURING the stay.
            midStaySettledNotes: res.midStaySettledNotes || null,
            // specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » at check-in:
            // the fiche then shows ONE complement, built server-side (amount + lines + paid state).
            complementDeferredToCheckout: Boolean(res.complementDeferredToCheckout),
            checkoutComplement: res.checkoutComplement || null,
            platformCommissionAmount: res.platformCommissionAmount == null || res.platformCommissionAmount === '' ? '' : res.platformCommissionAmount,
            acompteCommissionAmount: res.acompteCommissionAmount == null || res.acompteCommissionAmount === '' ? '' : res.acompteCommissionAmount,
            platformGrossAmount: res.platformGrossAmount == null || res.platformGrossAmount === '' ? '' : res.platformGrossAmount,
            platformPayoutAmount: res.platformPayoutAmount == null || res.platformPayoutAmount === '' ? '' : res.platformPayoutAmount,
            touristTaxInComplement: Boolean(res.touristTaxInComplement),
            // Auto-options that were flipped to Complément on this reservation. Their inComplement
            // bit lives in `reservation_options`, but they're not part of form.selectedOptions
            // (auto-options have their own server-side channel) — keep them in a parallel array.
            // Discriminator: `autoEnabled = 1` only, NOT autoOptionType (which the linen options
            // also carry since 2026-06-02 — they ARE in form.selectedOptions like any manual option).
            autoOptionsInComplement: (res.options || [])
              .filter((o) => !o.isCustom && Number(o.autoEnabled || 0) === 1 && Number(o.inComplement || 0) === 1)
              .map((o) => Number(o.optionId)),
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
          const availableOpts = opts.filter(o => (o.propertyIds || []).includes(devis.propertyId));
          setPropertyOptions(Array.isArray(propDetails?.options) ? propDetails.options : availableOpts);
          setPropertyOptionGroups(propDetails?.optionGroups || null);
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
            breakfastTime: devis.breakfastTime || '',
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
            // 2026-06-06 — bilingual PDF (specs/devis-english-language.md §3 rule 1).
            pdfLanguage: devis.pdfLanguage || 'fr',
            depositPaid: false,
            depositPaidDate: '',
            balancePaid: false,
            balancePaidDate: '',
            complementPaid: false,
            complementPaidDate: '',
            complementPaidCash: false,
            endOfStayComplementAmount: 0,
            endOfStayComplementPaid: false,
            endOfStayComplementPaidDate: '',
            endOfStayComplementPaidCash: false,
            endOfStayComplementDetail: null,
            midStaySettledNotes: null,
            complementDeferredToCheckout: false,
            checkoutComplement: null,
            platformCommissionAmount: '',
            acompteCommissionAmount: '',
            platformGrossAmount: '',
            platformPayoutAmount: '',
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
          const availableOpts = opts.filter(o => (o.propertyIds || []).includes(propIdNum));
          setPropertyOptions(Array.isArray(prop?.options) ? prop.options : availableOpts);
          setPropertyOptionGroups(prop?.optionGroups || null);
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
            depositPaidDate: '',
            balancePaid: false,
            balancePaidDate: '',
            complementPaid: false,
            complementPaidDate: '',
            complementPaidCash: false,
            endOfStayComplementAmount: 0,
            endOfStayComplementPaid: false,
            endOfStayComplementPaidDate: '',
            endOfStayComplementPaidCash: false,
            endOfStayComplementDetail: null,
            midStaySettledNotes: null,
            complementDeferredToCheckout: false,
            checkoutComplement: null,
            platformCommissionAmount: '',
            acompteCommissionAmount: '',
            platformGrossAmount: '',
            platformPayoutAmount: '',
          });

          await loadResourcesAvailability(startDate, endDate, initialPropId);
          await loadBabyBedAvailability(startDate, endDate, initialPropId);
          // §3.7 — pre-populate selectedOptions with the property's defaults (linen options
          // typically). Soft-fail; awaiting so the form is consistent before the user can interact.
          await applyPropertyDefaultsAsync(initialPropId);
        }

        setLoading(false);
      } catch (err) {
        setInitError(true);
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
  // Keep `selectedClient` (the bold-name display) in sync with the attached clientId — from the
  // search list when present, otherwise fetched directly so it works on initial load / deep-links.
  useEffect(() => {
    if (!form.clientId) { setSelectedClient(null); return undefined; }
    const inList = clients.find((c) => c.id === form.clientId);
    if (inList) { setSelectedClient(inList); return undefined; }
    let cancelled = false;
    api.getClient(form.clientId).then((c) => { if (!cancelled && c) setSelectedClient(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [form.clientId, clients]);
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
          platformCommissionAmount: form.platformCommissionAmount, // specs/platform-commission-line.md (solde commission)
          acompteCommissionAmount: form.acompteCommissionAmount, // specs/platform-per-echeance-commission.md (acompte commission)
          platformGrossAmount: form.platformGrossAmount, // specs/platform-payment-entry.md (pins the total séjour)
          depositPaid: form.depositPaid,
          balancePaid: form.balancePaid,
          complementPaid: form.complementPaid,
          depositAmount: form.depositAmount,
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          balanceAmount: form.balanceAmount,
          depositDisabled: Boolean(form.depositDisabled),
          selectedOptions: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          selectedResources: buildSelectedResourcesPayload(),
          offeredOptionIds: Array.from(offeredOptionIds),
          lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
          lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
          forceCurrentPricing: useCurrentPricing,
          platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
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

  // specs/reservation-option-immutability.md rule 4 — the "forced ON / Inclus" property-default
  // display applies ONLY when creating a new reservation. In edit mode an existing reservation is
  // frozen: its options render exactly as it carries them, so we never force a property default it
  // does not already have. (This reverses the former rule 4.bis, which forced the option on every
  // reservation of the property, including pre-default-era ones.)
  const propertyDefaultOptionIds = new Set(propertyOptionDefaults.map((d) => Number(d.optionId)));
  const bedLinenForcedOptionIds = editingReservationId
    ? new Set()
    : new Set(
        propertyOptions
          .filter((opt) => Number(opt.countsAsBedLinen || 0) === 1 && propertyDefaultOptionIds.has(opt.id))
          .map((opt) => opt.id),
      );

  // specs/bed-config-in-linen-card.md §3 rules 2 + 10 — bed inputs live inside the FIRST
  // enabled `countsAsBedLinen = 1` option card. The boolean drives the rendering on both
  // sides: `GuestsBedsSection` no longer renders bed inputs at all, and `ExtrasSection`
  // mounts the bed-inputs sub-block exactly once, under the card whose id matches
  // `firstEnabledBedLinenOptionId`. An option that's "forced on" by a property default
  // counts as enabled even if it's not (yet) in `form.selectedOptions`.
  const firstEnabledBedLinenOptionId = (() => {
    for (const opt of propertyOptions) {
      if (Number(opt.countsAsBedLinen || 0) !== 1) continue;
      const sel = form.selectedOptions.find((so) => so.optionId === opt.id);
      const explicitlyEnabled = Boolean(sel && Number(sel.quantity) > 0);
      if (explicitlyEnabled || bedLinenForcedOptionIds.has(opt.id)) return opt.id;
    }
    return null;
  })();
  const bedLinenOptionEnabled = firstEnabledBedLinenOptionId !== null;

  useEffect(() => {
    if (babyAvailableNumber === null) return;
    const current = Number(form.babyBeds || 0);
    if (current > maxBabyBedsByRule) {
      setForm(prev => ({ ...prev, babyBeds: maxBabyBedsByRule }));
    }
  }, [form.babies, form.children, babyBedAvailability.available]);

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
    setForm(prev => ({ ...prev, ...changes }));
  };

  // ==================== OPTIONS & RESOURCES ====================
  const setOptionQuantity = (optionId, quantity) => {
    // Snapshot the transition outcome so we can react to it OUTSIDE of the setForm updater
    // (e.g. mirror the property's `offered` default into offeredOptionIds). React forbids
    // calling another setState inside an updater function — track the side effect here.
    let didAdd = false;
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
        // Absent → present transition. Mark for the offered-mirror side effect below.
        didAdd = true;
        newOpts = [...prev.selectedOptions, { optionId, quantity: normalizedQty, totalPrice: 0 }];
      }
      return { ...prev, selectedOptions: newOpts };
    });
    // §3.7 fix — when the operator toggles an option BACK ON on an existing reservation,
    // inherit the offered flag from the property's default. Without this, the option keeps
    // whatever the offeredOptionIds had at load time, ignoring the property contract.
    // Only fires on a fresh add AND when a default actually exists for this option — no
    // default → leave the historical state alone.
    if (didAdd) {
      const def = propertyOptionDefaultsMap.get(Number(optionId));
      if (def) {
        setOfferedOptionIds((prev) => {
          const next = new Set(prev);
          if (def.offered) next.add(Number(optionId));
          else next.delete(Number(optionId));
          return next;
        });
      }
    }
  };

  // Option-driven planning cards (specs/option-planning-card.md §3.2). Set the working occurrence
  // grid ({date,time,slot,checked}[]) on a card-option's selected line. Adds the line if absent.
  const setOptionCardOccurrences = (optionId, occurrences) => {
    setForm((prev) => {
      const exists = (prev.selectedOptions || []).some((so) => Number(so.optionId) === Number(optionId));
      const next = exists
        ? prev.selectedOptions.map((so) => (Number(so.optionId) === Number(optionId) ? { ...so, cardOccurrences: occurrences } : so))
        : [...(prev.selectedOptions || []), { optionId: Number(optionId), quantity: 1, totalPrice: 0, cardOccurrences: occurrences }];
      return { ...prev, selectedOptions: next };
    });
  };

  const setOptionEnabled = (optionId, enabled) => {
    const existing = form.selectedOptions.find((so) => so.optionId === optionId);
    const catalogOpt = (propertyOptions || []).find((o) => Number(o.id) === Number(optionId));
    if (enabled) {
      setOptionQuantity(optionId, Math.max(1, Number(existing?.quantity) || 1));
      // Seed the occurrence grid (all candidates pre-checked, §3.2) on first enable of a card-option.
      if (catalogOpt && catalogOpt.showsPlanningCard && !(existing && Array.isArray(existing.cardOccurrences) && existing.cardOccurrences.length)) {
        setOptionCardOccurrences(optionId, buildInitialCardGrid(catalogOpt, form.startDate, form.endDate, form.checkInTime, form.checkOutTime));
      }
      return;
    }
    setOptionQuantity(optionId, 0);
    // specs/bed-config-in-linen-card.md §3 rule 3 — disabling a `countsAsBedLinen = 1`
    // option zeroes the single/double bed counters in form state, mirroring the server invariant
    // on save (rule 7). Baby beds are NOT cleared (§10 follow-up 2026-06-08): they are independent
    // of the bed-linen option and stay editable in the Voyageurs card whenever babies > 0.
    const opt = propertyOptions.find((o) => o.id === optionId);
    if (opt && Number(opt.countsAsBedLinen || 0) === 1) {
      updateForm({ singleBeds: '', doubleBeds: '' });
    }
  };

  // Option-driven planning cards (specs/option-planning-card.md §3.4): when the stay dates change,
  // reconcile every enabled daily card-option's occurrence grid — new in-range days appear
  // pre-checked, out-of-range days drop, existing check/time state is preserved.
  useEffect(() => {
    setForm((prev) => {
      let changed = false;
      const next = (prev.selectedOptions || []).map((so) => {
        if (!Array.isArray(so.cardOccurrences)) return so;
        const cat = (propertyOptions || []).find((o) => Number(o.id) === Number(so.optionId));
        if (!cat || !cat.showsPlanningCard || !isDailyCard(cat)) return so;
        const reconciled = reconcileCardGrid(cat, prev.startDate, prev.endDate, so.cardOccurrences, prev.checkInTime, prev.checkOutTime);
        if (reconciled === so.cardOccurrences) return so;
        changed = true;
        return { ...so, cardOccurrences: reconciled };
      });
      return changed ? { ...prev, selectedOptions: next } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.startDate, form.endDate, form.checkInTime, form.checkOutTime, propertyOptions]);

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

      return { ...prev, selectedResources: newResources };
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
    setForm((prev) => ({
      ...prev,
      selectedResources: (prev.selectedResources || []).map((sr) => (
        Number(sr.resourceId) === Number(resourceId)
          ? { ...sr, offered: Boolean(offered) }
          : sr
      )),
    }));
  };

  // Per-item routing toggles (spec force-item-to-complement.md). Each helper mutates the
  // line's `inComplement` flag — the engine then drops the line from the auto deposit/balance
  // split + routes it 100 % into the Complément entry.
  const setOptionInComplement = (optionId, inComplement) => {
    setForm((prev) => ({
      ...prev,
      selectedOptions: (prev.selectedOptions || []).map((so) => (
        Number(so.optionId) === Number(optionId)
          ? { ...so, inComplement: Boolean(inComplement) }
          : so
      )),
    }));
  };

  const setResourceInComplement = (resourceId, inComplement) => {
    setForm((prev) => ({
      ...prev,
      selectedResources: (prev.selectedResources || []).map((sr) => (
        Number(sr.resourceId) === Number(resourceId)
          ? { ...sr, inComplement: Boolean(inComplement) }
          : sr
      )),
    }));
  };

  // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md §3.2): the fiche editor
  // owns the [{date,start,end}] list; the server prices it from the time-banded grid.
  const setResourceSessions = (resourceId, sessions) => {
    setForm((prev) => {
      const list = Array.isArray(sessions) ? sessions : [];
      const exists = (prev.selectedResources || []).find((sr) => Number(sr.resourceId) === Number(resourceId));
      if (exists) {
        return {
          ...prev,
          selectedResources: prev.selectedResources.map((sr) => (
            Number(sr.resourceId) === Number(resourceId) ? { ...sr, sessions: list } : sr
          )),
        };
      }
      const resource = availableResources.find((r) => r.id === resourceId);
      return {
        ...prev,
        selectedResources: [
          ...(prev.selectedResources || []),
          { resourceId, quantity: 1, unitPrice: Number(resource?.price || 0), totalPrice: 0, offered: false, sessions: list },
        ],
      };
    });
  };

  // Auto-options (early check-in / late check-out / ...) aren't in `selectedOptions`, so their
  // routing-to-complément flag travels through a parallel array of optionIds. Toggling membership
  // here drives both the live recompute (via the snapshot dependency) and the persisted state
  // (the engine applies the override + the model writes `inComplement = 1` on the option row).
  const setAutoOptionInComplement = (optionId, inComplement) => {
    setForm((prev) => {
      const set = new Set((prev.autoOptionsInComplement || []).map(Number));
      if (inComplement) set.add(Number(optionId));
      else set.delete(Number(optionId));
      return { ...prev, autoOptionsInComplement: Array.from(set) };
    });
  };

  // Generic per-line toggle used by PricingSummary so the user can flip a line in/out of
  // Complément directly from the summary chip. The summary doesn't know whether a given
  // option is auto-typed → it passes the metadata via `kind`.
  const setOptionInComplementFromSummary = (optionId, isAuto, inComplement) => {
    if (isAuto) setAutoOptionInComplement(optionId, inComplement);
    else setOptionInComplement(optionId, inComplement);
  };
  const setCustomOptionInComplementFromSummary = (customKey, inComplement) => {
    updateCustomOption(customKey, { inComplement: Boolean(inComplement) });
  };

  const addCustomOption = () => {
    setForm((prev) => ({
      ...prev,
      customOptions: [
        ...(prev.customOptions || []),
        { customKey: `custom_${Date.now()}`, description: '', amount: 0, offered: false },
      ],
    }));
  };

  const updateCustomOption = (customKey, changes) => {
    setForm((prev) => ({
      ...prev,
      customOptions: (prev.customOptions || []).map((line) => (
        line.customKey === customKey ? { ...line, ...changes } : line
      )),
    }));
  };

  const removeCustomOption = (customKey) => {
    setForm((prev) => ({
      ...prev,
      customOptions: (prev.customOptions || []).filter((line) => line.customKey !== customKey),
    }));
  };

  // Payload builders thread `inComplement` (spec force-item-to-complement.md) to the server so
  // the engine routes the line correctly. They never send the captured contribs — those are
  // owned by the payment-flip code path; the server re-reads them from the DB-side snapshot.
  const buildSelectedOptionsPayload = () => {
    return (form.selectedOptions || [])
      // Same discriminator as the snapshot builder above: skip only engine-derived options
      // (autoEnabled = 1), not the typed-default linen options (autoOptionType set, autoEnabled = 0).
      .filter((item) => Number(propertyOptions.find((o) => o.id === Number(item.optionId))?.autoEnabled || 0) !== 1)
      .map((item) => {
        const line = { optionId: item.optionId, quantity: item.quantity, inComplement: item.inComplement == null ? null : (item.inComplement ? 1 : 0) };
        // Option-driven planning cards (specs/option-planning-card.md §3.4): send the CHECKED
        // occurrences ({date,time}). The server derives billedUnits from them (authoritative).
        if (Array.isArray(item.cardOccurrences)) line.cardOccurrences = toWireCardOccurrences(item.cardOccurrences);
        return line;
      });
  };

  const buildCustomOptionsPayload = () => {
    return (form.customOptions || [])
      .map((line, index) => ({
        customKey: String(line.customKey || `custom_${index + 1}`),
        customOptionId: line.customOptionId != null ? Number(line.customOptionId) : undefined,
        description: String(line.description || '').trim(),
        amount: Number(line.amount || 0),
        offered: Boolean(line.offered),
        inComplement: line.inComplement == null ? null : (line.inComplement ? 1 : 0),
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
        inComplement: item.inComplement == null ? null : (item.inComplement ? 1 : 0),
        // Hourly-scheduled sessions (specs/resource-hourly-scheduling.md) — drive the server pricer.
        sessions: Array.isArray(item.sessions) ? item.sessions : [],
      }))
      .filter((item) => Number(item.quantity || 0) > 0 || (Array.isArray(item.sessions) && item.sessions.length > 0));
  };

  // ==================== CLIENT CREATE / EDIT ====================
  const closeCreateClient = () => {
    setCreateClientOpen(false);
    setNewClient(EMPTY_CLIENT);
    setNewClientCityOptions([]);
    setClientDialogMode('create');
  };

  const openCreateClient = () => {
    setClientDialogMode('create');
    setNewClient(EMPTY_CLIENT);
    setNewClientCityOptions([]);
    setCreateClientOpen(true);
  };

  // Edit the attached client's record in the SAME dialog/fields as create. Prefill instantly from
  // the cached client, then refine with the full record from the API.
  const openEditClient = () => {
    if (!form.clientId) return;
    setClientDialogMode('edit');
    setNewClient({ ...EMPTY_CLIENT, ...(selectedClient || {}) });
    setNewClientCityOptions([]);
    setCreateClientOpen(true);
    api.getClient(form.clientId).then((c) => { if (c) setNewClient({ ...EMPTY_CLIENT, ...c }); }).catch(() => {});
  };

  const handleSaveClient = async () => {
    if (newClientEmailError || newClientPhoneError) {
      await alert({ title: 'Client invalide', message: 'Veuillez corriger le format du mail ou du téléphone.' });
      return;
    }

    const payload = {
      ...newClient,
      address: [newClient.streetNumber, newClient.street].filter(Boolean).join(' ').trim(),
      phone: String(newClient.phone || '').trim(),
    };

    if (clientDialogMode === 'edit' && form.clientId) {
      const updatedRow = await api.updateClient(form.clientId, payload);
      const updated = updatedRow && updatedRow.id ? updatedRow : { ...(selectedClient || {}), ...payload, id: form.clientId };
      setSelectedClient(updated);
      setClients(prev => prev.map(client => (client.id === updated.id ? updated : client)));
    } else {
      const c = await api.createClient(payload);
      setForm(prev => ({ ...prev, clientId: c.id }));
      setClients(prev => prev.some(client => client.id === c.id) ? prev : [...prev, c]);
      setClientSearchOpen(false);
    }
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
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
      }),
      api.getReservations({ propertyId: nextPropertyId }),
    ]);

    const availableOpts = opts.filter(o => (o.propertyIds || []).includes(nextPropertyId));

    setSelectedProp(nextPropertyId);
    setSelectedProperty(prop);
    setReservations(allRes || []);
    setPropertyOptions(Array.isArray(prop?.options) ? prop.options : availableOpts);
    setPropertyOptionGroups(prop?.optionGroups || null);
    if (Array.isArray(prop?.resources)) {
      setAvailableResources(prop.resources.map((r) => ({
        ...r,
        available: Number(r.available ?? r.quantity ?? 0),
      })));
    }
    setPricingQuote(calc);
    applyQuoteMinNights(calc);
    setUseCurrentPricing(false);
    setForm(prev => ({
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
    // §3.7 — re-apply defaults for the NEW property. We skip this when the user is editing an
    // existing reservation BUT switched property: per rule 30 the historical state stays frozen
    // — except the operator just reset their option list by changing property, so re-applying
    // the new property's defaults is the only sane behaviour. The `editingReservationId`
    // discriminator is intentionally NOT used here: changing property is an explicit reset.
    await applyPropertyDefaultsAsync(nextPropertyId);
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
        complementPaid: form.complementPaid,
        depositAmount: form.depositAmount,
        depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
        balanceAmount: form.balanceAmount,
        depositDisabled: Boolean(form.depositDisabled),
        selectedOptions: buildSelectedOptionsPayload(),
        customOptions: buildCustomOptionsPayload(),
        selectedResources: buildSelectedResourcesPayload(),
        offeredOptionIds: Array.from(offeredOptionIds),
        platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
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

    // specs/edit-reservation-blocked-by-overlap.md — on an EXISTING reservation, don't re-block on a
    // pre-existing overlap / capacity conflict the edit didn't introduce (mirrors the server guard).
    // Compare the current form against the loaded snapshot (initialSnapshot = JSON of { selectedProp, form }).
    let loadedSnapshot = null;
    try { loadedSnapshot = initialSnapshot ? JSON.parse(initialSnapshot) : null; } catch { loadedSnapshot = null; }
    const loadedForm = loadedSnapshot && loadedSnapshot.form;
    const placementUnchanged = Boolean(reservationId && loadedForm
      && Number(loadedSnapshot.selectedProp) === Number(selectedProp)
      && loadedForm.startDate === form.startDate && loadedForm.endDate === form.endDate);
    const occupancyUnchanged = Boolean(reservationId && loadedForm
      && Number(loadedSnapshot.selectedProp) === Number(selectedProp)
      && Number(loadedForm.adults || 0) === Number(form.adults || 0)
      && Number(loadedForm.children || 0) === Number(form.children || 0)
      && Number(loadedForm.teens || 0) === Number(form.teens || 0)
      && Number(loadedForm.babies || 0) === Number(form.babies || 0));

    if (!placementUnchanged) {
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
    }

    if (exceedsGuestCapacity && !forceCapacity && !occupancyUnchanged) {
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
        complementPaid: form.complementPaid,
        depositAmount: form.depositAmount,
        depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
        balanceAmount: form.balanceAmount,
        depositDisabled: Boolean(form.depositDisabled),
        selectedOptions: buildSelectedOptionsPayload(),
        customOptions: buildCustomOptionsPayload(),
        selectedResources: buildSelectedResourcesPayload(),
        offeredOptionIds: Array.from(offeredOptionIds),
        lockedOptionUnits: shouldLockExistingPricing ? frozenOptionUnitByQuantityRef.current : {},
        lockedResourceUnits: shouldLockExistingPricing ? frozenResourceUnitByQuantityRef.current : {},
        forceCurrentPricing: useCurrentPricing,
        platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
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
          breakfastTime: form.breakfastTime || null,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
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
          // 2026-06-06 — bilingual devis PDF (specs/devis-english-language.md §3 rule 1).
          // Defaults to 'fr' for new devis; persists whatever the operator picked.
          pdfLanguage: form.pdfLanguage || 'fr',
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
          // '' = keep the existing number; a non-empty value is an override (unique-checked server-side).
          reservationNumber: form.reservationNumber || '',
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          babies: form.babies,
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
          breakfastTime: form.breakfastTime || null,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          // Per-reservation deposit opt-out (specs/disable-deposit-per-reservation.md).
          // When ON, depositPaid + depositPaidDate are force-zeroed both client-side here
          // and server-side in reservationsController.update.
          depositDisabled: Boolean(form.depositDisabled),
          depositPaid: form.depositDisabled ? false : form.depositPaid,
          depositPaidDate: form.depositDisabled ? null : (form.depositPaidDate || null),
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          balancePaid: form.balancePaid,
          balancePaidDate: form.balancePaidDate || null,
          complementPaid: form.complementPaid,
          complementPaidDate: form.complementPaidDate || null,
          complementAmount: quote.complementAmount,
          platformCommissionAmount: form.platformCommissionAmount === '' ? null : form.platformCommissionAmount,
          acompteCommissionAmount: form.acompteCommissionAmount === '' ? null : form.acompteCommissionAmount,
          platformGrossAmount: form.platformGrossAmount === '' ? null : form.platformGrossAmount,
          platformPayoutAmount: form.platformPayoutAmount === '' ? null : form.platformPayoutAmount,
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
          // Optional override; blank → the server generates the AAAA-MM-### number.
          reservationNumber: form.reservationNumber || '',
          startDate: form.startDate,
          endDate: form.endDate,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          babies: form.babies,
          singleBeds: form.singleBeds === '' ? null : Number(form.singleBeds),
          doubleBeds: form.doubleBeds === '' ? null : Number(form.doubleBeds),
          babyBeds: form.babyBeds === '' ? null : Number(form.babyBeds),
          breakfastTime: form.breakfastTime || null,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        freezeTouristTax,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          platformCommissionAmount: form.platformCommissionAmount === '' ? null : form.platformCommissionAmount,
          acompteCommissionAmount: form.acompteCommissionAmount === '' ? null : form.acompteCommissionAmount,
          platformGrossAmount: form.platformGrossAmount === '' ? null : form.platformGrossAmount,
          platformPayoutAmount: form.platformPayoutAmount === '' ? null : form.platformPayoutAmount,
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

  // Bar-button entry point: toggles the `saving` flag around the (recursive) save so the bar Save
  // shows a spinner and can't be double-submitted. The internal recursion stays on
  // handleSaveReservation (no nested toggle). specs/ds-sweep-reservations.md rule 1.
  const handleSaveClick = async () => {
    setSaving(true);
    try {
      await handleSaveReservation();
    } finally {
      setSaving(false);
    }
  };

  // specs/mid-stay-notes.md §4.2 — a note validated with a catalogue addition must go through the
  // STANDARD save (pricing engine, planning cards, laundry counts…) before it can be settled: the
  // note never bypasses the normal pipeline. `handleSaveReservation(action)` runs the action instead
  // of navigating away, so the operator stays on the fiche.
  const saveThenRun = useCallback((action) => handleSaveReservation(action), [handleSaveReservation]);

  // Re-read the money the server owns after a note was settled / cancelled. Only the finance fields
  // are patched: the rest of the form is the operator's (possibly dirty) draft and must not move.
  const reloadReservationFinance = useCallback(async () => {
    if (!editingReservationId) return;
    const res = await api.getReservation(editingReservationId);
    setForm((prev) => ({
      ...prev,
      endOfStayComplementAmount: Number(res.endOfStayComplementAmount || 0),
      endOfStayComplementPaid: Boolean(res.endOfStayComplementPaid),
      endOfStayComplementPaidDate: res.endOfStayComplementPaidDate || '',
      endOfStayComplementPaidCash: Boolean(res.endOfStayComplementPaidCash),
      endOfStayComplementDetail: res.endOfStayComplementDetail || null,
      midStaySettledNotes: res.midStaySettledNotes || null,
      checkoutComplement: res.checkoutComplement || null,
    }));
  }, [editingReservationId]);

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

  if (initError) {
    return (
      <Box>
        <PageActionBar title="Réservation" onBack={() => navigate(-1)} />
        <ErrorAlert message="Impossible de charger la réservation." onRetry={() => window.location.reload()} />
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingState label="Chargement de la réservation…" />
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

  // Online payments (specs/online-payments-qonto.md §3.4): create + open the deposit payment link for
  // this devis, then offer to poll for the payment (which converts the devis on success).
  const handleSendDepositRequest = async () => {
    if (!editingDevisId) {
      await alert({ title: 'Enregistre d’abord', message: 'Enregistre le devis avant de générer une demande d’acompte.' });
      return;
    }
    try {
      // Persist current edits first so the link amount matches the acompte shown on the fiche
      // (the server recomputes from the SAVED devis).
      const saved = await handleSaveReservation(() => {});
      if (!saved) return;
      // The server creates/reuses the Qonto deposit link AND emails it to the client in one action.
      const r = await api.sendDepositRequestEmail(editingDevisId);
      const euros = formatCurrency(Number(r.amountCents || 0) / 100);
      const check = await confirm({
        title: 'Demande d’acompte envoyée ✓',
        message: `Un email avec le lien de paiement de l’acompte (${euros}) a été envoyé à ${r.recipientEmail}. Le règlement bloquera les dates. Une fois payé, clique « Vérifier le paiement ».`,
        confirmLabel: 'Vérifier le paiement',
        cancelLabel: 'Fermer',
        confirmColor: 'primary',
      });
      if (check) await handleCheckDepositPayment();
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible d’envoyer la demande d’acompte (Qonto connecté ? email client renseigné ?).' });
    }
  };

  // Online-deposit flow (specs/public-online-deposit.md §3 rule 8): manually send / re-send the balance
  // payment request for a reservation whose deposit was collected online but whose solde is still due.
  const handleSendBalanceRequest = async () => {
    if (!editingReservationId) return;
    try {
      // Persist current edits first so the link amount matches the solde shown on the fiche.
      const saved = await handleSaveReservation(() => {});
      if (!saved) return;
      const r = await api.sendBalanceRequestEmail(editingReservationId);
      const euros = formatCurrency(Number(r.amountCents || 0) / 100);
      showSuccess(`Demande de solde envoyée — email avec le lien de paiement (${euros}) envoyé à ${r.recipientEmail || 'le client'}.`);
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible d’envoyer la demande de solde (Qonto connecté ? email client renseigné ?).' });
    }
  };

  const handleCheckDepositPayment = async () => {
    try {
      const summary = await api.pollPayments();
      const conv = (summary.results || []).find((x) => Number(x.reservationId) === Number(editingDevisId) && x.status === 'paid');
      if (conv && (conv.effect === 'converted' || conv.effect === 'already-converted')) {
        await alert({ title: 'Acompte reçu ✓', message: 'Le devis a été converti en réservation (dates bloquées).' });
        navigate(`/reservations/${conv.reservationId}?from=${encodeURIComponent('/calendar')}`);
      } else if (conv) {
        await alert({ title: 'Acompte reçu ✓', message: 'Le paiement de l’acompte est enregistré.' });
      } else {
        await alert({ title: 'Pas encore payé', message: 'Aucun paiement détecté pour ce devis. Réessaie après avoir réglé le lien.' });
      }
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Vérification impossible.' });
    }
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
    bgcolor: 'background.paper',
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

  // specs/mid-stay-notes.md §3.5 rule 17 — « Nouvelle note » en TÊTE de barre : c'est l'action la
  // plus fréquente d'un séjour en cours (le client prend une consommation au comptoir), et le bloc
  // qui la portait se trouvait à 81 % du défilement d'une fiche de 4500 px. Même règle d'affichage
  // que le bloc, partagée via `midStayNoteAccess` pour que les deux ne divergent jamais.
  const midStayNote = midStayNoteAccess({
    editingReservationId,
    isDevisMode,
    startDate: form.startDate,
    notesCount: countMidStayNotes(form.midStaySettledNotes),
    endOfStaySettled: Boolean(form.endOfStayComplementPaid) || Boolean(form.endOfStayComplementPaidCash),
    today: todayStr,
  });

  const actionBarBefore = [
    ...(midStayNote.visible ? [{
      icon: <PointOfSaleIcon />,
      tooltip: midStayNote.disabled ? midStayNote.reason : 'Nouvelle note (encaissement en séjour)',
      onClick: () => setMidStayNoteOpen(true),
      color: 'success',
      disabled: midStayNote.disabled,
    }] : []),
    ...(!isDevisMode && !reservationId
      ? [{ icon: <DescriptionIcon />, tooltip: 'Créer un devis', onClick: handleCreateDevisFromForm, color: 'info' }] : []),
    // Réservation PLATEFORME → pas de devis : le tarif a été fixé par la plateforme, nous ne
    // devisons pas ce séjour. Le bouton n'a de sens que sur une réservation directe.
    ...(!isDevisMode && reservationId && !isPlatformReservation
      ? [{ icon: <DescriptionIcon />, tooltip: 'Transformer en devis', onClick: handleConvertToDevis, color: 'info' }] : []),
    // specs/email-automation.md §6.6 — manual email send on an existing reservation. Disabled
    // when the client has no email; the dialog otherwise surfaces SMTP / template errors clearly.
    ...(!isDevisMode && reservationId
      ? [{
          icon: <MailOutlineIcon />,
          tooltip: form.clientId ? 'Envoyer un email' : 'Pas de client lié',
          onClick: () => setEmailSendOpen(true),
          color: 'info',
          disabled: !form.clientId,
        }] : []),
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
    ...(isDevisMode ? [{
      // Bilingual devis PDF (specs/devis-english-language.md §3 rule 1 + §6.1) — FR / EN toggle
      // beside the Statut Select. Default 'fr'. Marking the form dirty is handled by `updateForm`.
      node: (
        <Tooltip title="Langue du PDF de devis">
          <ToggleButtonGroup
            size="small"
            value={form.pdfLanguage || 'fr'}
            exclusive
            onChange={(e, next) => { if (next) updateForm({ pdfLanguage: next }); }}
            aria-label="Langue du devis"
            sx={{ height: 36 }}
          >
            <ToggleButton value="fr" sx={{ px: 1.5 }}>FR</ToggleButton>
            <ToggleButton value="en" sx={{ px: 1.5 }}>EN</ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>
      ),
    }] : []),
    ...(isDevisMode
      ? [{ icon: <DescriptionIcon />, tooltip: 'Télécharger PDF', onClick: handleOpenDevisPdf, color: 'info', disabled: !editingDevisId }] : []),
    // specs/online-payments-qonto.md §3.4 — generate + send the Qonto deposit payment link for this devis.
    ...(isDevisMode && editingDevisId
      ? [{ icon: <PaymentsIcon />, tooltip: 'Envoyer la demande d\'acompte', onClick: handleSendDepositRequest, color: 'success' }] : []),
    // specs/public-online-deposit.md §3 rule 8 — send/re-send the balance link when the deposit was
    // collected online but the solde is still due (reservation, positive balance, not yet paid).
    // Réservation PLATEFORME exclue : le solde est encaissé par la plateforme et nous est reversé,
    // on ne le réclame jamais au client — envoyer ce lien serait une double demande de paiement.
    ...(!isDevisMode && editingReservationId && !isPlatformReservation
      && !form.balancePaid && Number(pricingQuote?.balanceAmount || 0) > 0
      ? [{ icon: <RequestQuoteIcon />, tooltip: 'Envoyer la demande de solde', onClick: handleSendBalanceRequest, color: 'info' }] : []),
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
    properties, propertyOptions, propertyOptionGroups, displayableResources,
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
    // specs/bed-config-in-linen-card.md — drives the bed-inputs sub-block in ExtrasSection
    // and suppresses the (now-removed) bed inputs from GuestsBedsSection.
    firstEnabledBedLinenOptionId, bedLinenOptionEnabled,
    // §3 rule 4.bis (hotfix follow-up) — bed-linen-flagged option IDs that are property
    // defaults. ExtrasSection forces the Switch ON + disabled for these.
    bedLinenForcedOptionIds,
    // extras
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setOptionEnabled, setOptionQuantity, setResourceEnabled, setResourceQuantity,
    addCustomOption, updateCustomOption, removeCustomOption,
    setOptionInComplement, setResourceInComplement, setAutoOptionInComplement,
    // Option-driven planning cards (specs/option-planning-card.md §3.2) — occurrence checklist.
    setOptionCardOccurrences,
    // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md §3.2).
    setResourceSessions,
    // finance
    isDevisMode, reservationId, refreshToCurrentPricing,
    accommodationBasePriceDisplay, pricingQuote,
    // specs/mid-stay-notes.md — the « Encaissements en séjour » block drives the save + reload
    // through the page (it owns the pipeline); the block itself holds no reservation logic.
    saveThenRun, reloadReservationFinance,
    // La fenêtre « Nouvelle note » s'ouvre depuis la barre d'actions ET depuis le bloc Finance :
    // l'état et la règle d'accès sont donc calculés ici, une seule fois.
    midStayNoteOpen, setMidStayNoteOpen, midStayNote,
  };

  return (
    <Box sx={{ pb: 4 }}>
      <PageActionBar
        title={computedTitle}
        onBack={goBackToOrigin}
        subtitle={(useCurrentPricing || form.bookingConflictAt)
          ? (
            <>
              {useCurrentPricing && <Chip size="small" color="warning" variant="outlined" label="Tarifs actuels appliqués (non sauvegardé)" />}
              <ReservationConflictBadge conflictAt={form.bookingConflictAt} />
            </>
          )
          : null}
        center={(selectedClient || form.reservationNumber) ? (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2, maxWidth: 340, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {`${selectedClient?.firstName || ''} ${selectedClient?.lastName || ''}`.trim() || 'Client'}
            </Typography>
            {form.reservationNumber && (
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                N° {form.reservationNumber}
              </Typography>
            )}
          </>
        ) : null}
        actionsBefore={actionBarBefore}
        onSave={handleSaveClick}
        saveTooltip={isDevisMode ? 'Enregistrer le devis' : 'Enregistrer'}
        saveDisabled={saving}
        saveBusy={saving}
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
            bgcolor: 'background.paper',
          },
          '& .MuiFilledInput-root': {
            bgcolor: 'background.paper',
          },
          '& .MuiInputBase-root.Mui-disabled': {
            bgcolor: 'background.paper',
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
              <Typography variant="sectionHeader" sx={{ mb: 2 }}>Client</Typography>
              <Stack spacing={1.25}>
                {selectedClient && !clientSearchOpen ? (
                  <>
                    {/* Attached client — bold name, click to edit the fiche (mirrors the inline
                        edit affordance). "Changer le client" reveals the search to attach another. */}
                    {/* Highlighted client card (specs/email-client-language-and-fiche-polish.md §3 rule 7):
                        soft primary tint + thin border so the guest's name stands out, harmonious with the theme. */}
                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={openEditClient}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditClient(); } }}
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.75, width: 'fit-content', maxWidth: '100%',
                        cursor: 'pointer', px: 1.25, py: 0.75, borderRadius: 2, mt: -0.25,
                        bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                        border: '1px solid',
                        borderColor: (t) => alpha(t.palette.primary.main, 0.22),
                        transition: 'background-color .15s ease, border-color .15s ease',
                        '&:hover': {
                          bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
                          borderColor: (t) => alpha(t.palette.primary.main, 0.35),
                        },
                      }}
                    >
                      <PersonOutlineIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                      <Typography sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.3, color: 'primary.dark' }}>
                        {`${selectedClient.firstName || ''} ${selectedClient.lastName || ''}`.trim() || 'Client'}
                      </Typography>
                      <EditOutlinedIcon sx={{ fontSize: 16, color: (t) => alpha(t.palette.primary.main, 0.6) }} />
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                      <Button size="small" variant="text" onClick={() => setClientSearchOpen(true)}>
                        Changer le client
                      </Button>
                      <Button size="small" variant="text" onClick={openCreateClient}>
                        + Créer un nouveau client
                      </Button>
                    </Box>
                  </>
                ) : (
                  <>
                    <Autocomplete
                      options={clients}
                      getOptionLabel={(c) => c.id ? `${c.lastName} ${c.firstName} — ${c.email}` : ''}
                      value={clients.find(c => c.id === form.clientId) || null}
                      onInputChange={(_, val, reason) => { if (reason === 'input') setClientSearch(val); }}
                      onChange={(_, val) => { if (val) { updateForm({ clientId: val.id }); setSelectedClient(val); setClientSearchOpen(false); } }}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      renderInput={(params) => <TextField {...params} label="Rechercher un client" autoFocus={clientSearchOpen} />}
                      noOptionsText={
                        <Button onClick={openCreateClient} size="small">Créer un nouveau client</Button>
                      }
                    />
                    <Box>
                      <Button size="small" variant="text" onClick={openCreateClient}>
                        + Créer un nouveau client
                      </Button>
                    </Box>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>

          <GuestsBedsSection />

          <Card variant="outlined" sx={formSectionCardSx}>
            <CardContent sx={formSectionContentSx}>
              <Typography variant="sectionHeader" sx={{ mb: 2 }}>Canal</Typography>
              <FormControl fullWidth>
                <InputLabel>Plateforme</InputLabel>
                <Select value={form.platform} label="Plateforme" onChange={(e) => updateForm({ platform: e.target.value })}>
                  {platformOptions.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </FormControl>
            </CardContent>
          </Card>

          {hasExtrasSection && <ExtrasSection />}

          <FinanceSection />

          <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
            <CardContent sx={formSectionContentSx}>
              <Typography variant="sectionHeader" sx={{ mb: 2 }}>Notes</Typography>
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
          onToggleOptionInComplement={setOptionInComplementFromSummary}
          onToggleCustomOptionInComplement={setCustomOptionInComplementFromSummary}
          onToggleResourceInComplement={setResourceInComplement}
          onToggleTouristTaxInComplement={(next) => setForm((prev) => ({ ...prev, touristTaxInComplement: Boolean(next) }))}
          isPastReservation={isPastReservation}
          onRefreshTouristTax={() => setTouristTaxRefreshRequested(true)}
        />

        {editingReservationId && (
          <Box sx={{ gridColumn: { xs: '1 / -1', md: '1 / 2' } }}>
            <ReservationHistoryPanel
              entries={historyEntries}
              loading={historyLoading}
              open={historyOpen}
              onToggle={toggleHistory}
            />
          </Box>
        )}
      </Box>

      {/* Client create / edit dialog (shared fields, mode-driven) */}
      <FormDialog
        open={createClientOpen}
        onClose={closeCreateClient}
        title={clientDialogMode === 'edit' ? 'Modifier la fiche client' : 'Créer un nouveau client'}
        onSubmit={handleSaveClient}
        submitDisabled={!newClient.lastName || !newClient.firstName || newClientEmailError || newClientPhoneError}
        submitLabel="Enregistrer"
        maxWidth="md"
      >
        <ClientFormFields
          form={newClient}
          setForm={setNewClient}
          cityOptions={newClientCityOptions}
          emailError={newClientEmailError}
          phoneError={newClientPhoneError}
        />
      </FormDialog>

      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        onStay={() => setUnsavedDialogOpen(false)}
        onDiscard={handleDiscardChanges}
        onSaveAndQuit={handleSaveAndLeave}
      />

      <EmailManualSendDialog
        open={emailSendOpen}
        reservationId={editingReservationId || null}
        reservationStartDate={form.startDate || null}
        onClose={() => setEmailSendOpen(false)}
      />
    </Box>
  );
}
