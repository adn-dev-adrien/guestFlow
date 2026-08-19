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
import EventBusyIcon from '@mui/icons-material/EventBusy';
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
import ReservationCancelDialog from '../components/ReservationCancelDialog';
import api from '../api';
import { getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { getFromParam, navigateBackWithFrom } from '../utils/navigation';
import { applyQuoteToForm as applyQuoteToFormPure } from '../utils/applyQuoteToForm';
import { midStayNoteAccess, countMidStayNotes } from '../utils/midStayNoteAccess';
import useWelcomePack from '../hooks/useWelcomePack';
import { applyWelcomePack, releaseWelcomePackLine } from '../utils/welcomePackApply';
import {
  hydrateSelectedOptions, hydrateCustomOptions, hydrateSelectedResources,
  hydrateOfferedOptionIds, frozenUnitPrices,
} from '../utils/bookingFormHydration';
import {
  buildInitialGrid as buildInitialCardGrid,
  buildGridFromStored as buildCardGridFromStored,
  reconcileGrid as reconcileCardGrid,
  toWireOccurrences as toWireCardOccurrences,
  isDailyCard,
} from '../utils/cardOccurrences';
import { formatCurrency, displayDate } from '../utils/formatters';
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

// specs/reservation-refunds.md — an empty refund register: what a devis, a creation form or a
// reservation without any refund reads.
const EMPTY_REFUND_REGISTER = {
  refunds: [],
  refundableLines: [],
  refundTotals: { book: 0, withCash: 0 },
  collectedTtc: 0,
};

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
  // specs/welcome-pack-auto-options.md §3.2 rules 4-5 — the pack is applied to a booking being
  // created from scratch and to nothing else: a saved reservation or devis carries its own option
  // set (history), and a fiche prefilled from a devis carries the devis'. A blank DEVIS is a
  // creation like any other and gets the pack too: same channel, same rate, same promise
  // (specs/devis-extras-parity-and-price-lock.md §3 rule 5).
  const isBlankNewBooking = !editingReservationId && !editingDevisId && !prefillDevis;

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
  // specs/payment-schedule-and-cancellation.md §3.5 rule 21 — « Annuler le séjour » from the bar.
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  // specs/mid-stay-notes.md §3.5 rule 17 — l'état vit ICI et non dans FinanceSection : la fenêtre
  // s'ouvre depuis deux endroits, la barre d'actions collante (point d'entrée principal) et le bloc
  // « Encaissements en séjour » plus bas dans la carte Finance.
  const [midStayNoteOpen, setMidStayNoteOpen] = useState(false);
  // specs/reservation-refunds.md — the refund register is SERVER-OWNED: it never joins `form` (which is
  // the operator's editable draft), it is replaced wholesale by whatever the API returns.
  const [refundRegister, setRefundRegister] = useState(EMPTY_REFUND_REGISTER);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  // Bumped after a refund mutation so the live-quote effect re-runs and the « total de séjour »
  // (net of refunds, computed server-side) refreshes.
  const [refundsVersion, setRefundsVersion] = useState(0);
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
  // specs/welcome-pack-auto-options.md rule 11 — options the operator took out of the pack's hands.
  // Unticking a pack line deletes it, tag included, so the tag alone cannot remember the refusal:
  // without this set the next context change (platform, dates, guests) would put the line back.
  const [welcomePackOptOut, setWelcomePackOptOut] = useState(() => new Set());
  const releaseFromWelcomePack = useCallback((optionId) => {
    setWelcomePackOptOut((prev) => (prev.has(Number(optionId)) ? prev : new Set(prev).add(Number(optionId))));
  }, []);

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

  // The ONE way this page populates « what this logement offers »: catalogue options (with their
  // per-property price + card config), the server-computed category grouping, and the resources.
  // Every entry point goes through it — edit a reservation, edit a devis, create from the calendar
  // with dates, create blank (« Nouveau devis », Dashboard « + »), or switch the Logement select.
  // Before that, the blank path deliberately emptied the catalogue and no branch ever refilled it,
  // so a new devis showed a fiche with no option at all (specs/devis-extras-parity-and-price-lock.md
  // §1 root cause 1). Returns the effective option list so callers can read an option's config
  // without re-fetching the catalogue.
  const loadPropertyContext = useCallback(async (propertyId, propertiesList = []) => {
    const numId = Number(propertyId);
    if (!numId) return { property: null, options: [] };
    const [propDetails, catalogue] = await Promise.all([api.getProperty(numId), api.getOptions()]);
    // `propDetails.options` is the property-scoped, priced, grouped list; the flat catalogue filtered
    // by `propertyIds` is the fallback for a payload that predates it.
    const options = Array.isArray(propDetails?.options)
      ? propDetails.options
      : (catalogue || []).filter((o) => (o.propertyIds || []).includes(numId));
    setSelectedProp(numId);
    setSelectedProperty(propDetails || propertiesList.find((p) => p.id === numId) || null);
    setPropertyOptions(options);
    setPropertyOptionGroups(propDetails?.optionGroups || null);
    if (Array.isArray(propDetails?.resources)) {
      setAvailableResources(propDetails.resources.map((r) => ({
        ...r,
        available: Number(r.available ?? r.quantity ?? 0),
      })));
    }
    return { property: propDetails, options };
  }, []);

  // Validity state of the devis being edited, straight from the server (`validUntil` + `expired`).
  // Drives the action-bar chip and the price lock — the fiche decides nothing here.
  const [devisValidity, setDevisValidity] = useState({ validUntil: null, expired: false });

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
    // specs/payment-schedule-and-cancellation.md §3.5 — set once the stay was cancelled for
    // non-payment. The fiche then opens read-only: the dates are back on sale and the amounts are
    // history the accounting still reads.
    cancelledAt: null,
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
  // A cancelled stay is read-only (specs/payment-schedule-and-cancellation.md §3.5 rule 25): the
  // server refuses every write on it, so the fiche must not offer any.
  const isCancelledReservation = Boolean(form.cancelledAt);
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
  // A saved booking keeps the prices it was sold at as long as its placement doesn't move. For a devis
  // that promise has an end date: while the quote is valid its prices are frozen exactly like a
  // reservation's, once expired everything re-prices (specs/devis-extras-parity-and-price-lock.md §3
  // rules 13-14). The server applies the same rule on save — this only keeps the preview honest.
  const isExistingReservationPricingLocked = Boolean(
    (editingReservationId || (editingDevisId && !devisValidity.expired))
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
            await loadPropertyContext(prefillPropertyId, props);

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
          const { options: catalogueOptions } = await loadPropertyContext(res.propertyId, props);

          // Load all reservations for this property to check conflicts
          const allRes = await api.getReservations({ propertyId: res.propertyId });
          setReservations(allRes);
          setExcludeReservationIdForDevis(null);

          const importedBlankPrice = res.sourceType === 'ical' && res.totalPrice == null && res.finalPrice == null;
          setForm({
            clientId: res.clientId,
            reservationNumber: res.reservationNumber || '',
            bookingConflictAt: res.bookingConflictAt || null,
            cancelledAt: res.cancelledAt || null,
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
            // where current totalPrice > acompteContribTtc + soldeContribTtc. Shared with the devis
            // branch below — one mapper, so neither can drift again.
            selectedOptions: hydrateSelectedOptions(res.options, res, catalogueOptions, buildCardGridFromStored),
            customOptions: hydrateCustomOptions(res.options),
            selectedResources: hydrateSelectedResources(res.resources),
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
          // specs/reservation-refunds.md §4.3 — the register rides the fiche payload.
          setRefundRegister({
            refunds: res.refunds || [],
            refundableLines: res.refundableLines || [],
            refundTotals: res.refundTotals || { book: 0, withCash: 0 },
            collectedTtc: Number(res.collectedTtc || 0),
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
          setOfferedOptionIds(hydrateOfferedOptionIds(res.options));

          setUseCurrentPricing(false);
          frozenOptionUnitByQuantityRef.current = frozenUnitPrices(res.options, 'optionId');
          frozenResourceUnitByQuantityRef.current = frozenUnitPrices(res.resources, 'resourceId');

          // Load resources
          await loadResourcesAvailability(res.startDate, res.endDate, res.propertyId, res.id);
          await loadBabyBedAvailability(res.startDate, res.endDate, res.propertyId, res.id);
        } else if (editingDevisId) {
          const devis = await api.getDevisById(editingDevisId);
          const { options: catalogueOptions } = await loadPropertyContext(devis.propertyId, props);

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
            extraGuestSurchargeOffered: Boolean(devis.extraGuestSurchargeOffered),
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
            // Same mapper as the reservation branch above — occurrences, sessions, routing and
            // custom-option ids all come back (specs/devis-extras-parity-and-price-lock.md §3 rule 12).
            selectedOptions: hydrateSelectedOptions(devis.options, devis, catalogueOptions, buildCardGridFromStored),
            customOptions: hydrateCustomOptions(devis.options),
            selectedResources: hydrateSelectedResources(devis.resources),
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
            touristTaxInComplement: Boolean(devis.touristTaxInComplement),
            autoOptionsInComplement: (devis.options || [])
              .filter((o) => !o.isCustom && Number(o.autoEnabled || 0) === 1 && Number(o.inComplement || 0) === 1)
              .map((o) => Number(o.optionId)),
          });

          setOfferedOptionIds(hydrateOfferedOptionIds(devis.options));
          // A devis carries no money movement, so it can carry no refund either.
          setRefundRegister(EMPTY_REFUND_REGISTER);
          setPricingQuote(null);
          setIsIcalImportedBlankPrice(false);
          setIsIcalSource(false);
          setUseCurrentPricing(false);
          // The server replays the quoted prices while the devis is valid; the fiche mirrors that by
          // pinning the same unit prices in its live preview (§3 rule 13).
          setDevisValidity({ validUntil: devis.validUntil || null, expired: Boolean(devis.expired) });
          frozenOptionUnitByQuantityRef.current = frozenUnitPrices(devis.options, 'optionId');
          frozenResourceUnitByQuantityRef.current = frozenUnitPrices(devis.resources, 'resourceId');
          initialPricingContextRef.current = {
            propertyId: devis.propertyId,
            startDate: devis.startDate,
            endDate: devis.endDate,
          };

          await loadResourcesAvailability(devis.startDate, devis.endDate, devis.propertyId, null);
          await loadBabyBedAvailability(devis.startDate, devis.endDate, devis.propertyId, null);
        } else if (initialPropId) {
          // A brand-new booking — reservation OR devis. One branch for the three entry points
          // (specs/devis-extras-parity-and-price-lock.md §3 rule 2): the calendar (propertyId +
          // both dates), the dashboard « + » (a start date only) and the blank forms
          // (« Nouvelle réservation », « Nouveau devis »). Whatever the URL carries, the logement's
          // context — catalogue, categories, resources, defaults, caution, horaires — is loaded the
          // same way; only the pricing quote needs a complete stay range.
          const { property: prop } = await loadPropertyContext(initialPropId, props);
          const hasStayRange = Boolean(startDate && endDate);
          const defaultCheckIn = prop?.defaultCheckIn || '15:00';
          const defaultCheckOut = prop?.defaultCheckOut || '10:00';

          const calc = hasStayRange
            ? await api.calculatePrice({
              propertyId: initialPropId,
              startDate,
              endDate,
              checkInTime: defaultCheckIn,
              checkOutTime: defaultCheckOut,
              adults: 1,
              children: 0,
              teens: 0,
              extraGuestSurchargeOffered: false,
              offeredOptionIds: [],
              platform: 'direct',
            })
            : null;
          if (calc) {
            setPricingQuote(calc);
            setNightlyBreakdown(calc.nightlyBreakdown || []);
            applyQuoteMinNights(calc);
          }

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
            totalPrice: calc ? calc.totalPrice : 0,
            touristTaxRate: calc?.touristTaxRate || 0,
            touristTaxTotal: calc?.touristTaxTotal || 0,
            discountPercent: 0,
            finalPrice: calc ? calc.totalPrice : 0,
            customPrice: '',
            depositAmount: calc ? calc.depositAmount : 0,
            depositDueDate: calc ? calc.depositDueDate : '',
            balanceAmount: calc ? calc.balanceAmount : 0,
            balanceDueDate: calc ? calc.balanceDueDate : '',
            cautionAmount: prop?.defaultCautionAmount ?? 500,
            cautionReceived: false,
            cautionReceivedDate: '',
            cautionReturned: false,
            cautionReturnedDate: '',
            notes: '',
            selectedOptions: [],
            customOptions: [],
            selectedResources: [],
            checkInTime: calc?.defaultCheckIn || defaultCheckIn,
            checkOutTime: calc?.defaultCheckOut || defaultCheckOut,
            // A lone `?startDate=` (dashboard / calendar « + ») is honoured too — it used to be
            // dropped on the floor because only the complete-range branch read the URL.
            startDate: startDate || '',
            endDate: hasStayRange ? endDate : '',
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
    // No stay range yet (blank fiche, « Nouveau devis », a half-filled date pair): the availability
    // endpoint has nothing to answer, but the resources themselves are already known — they came with
    // the property context. Leave them alone instead of blanking the Ressources block; the refinement
    // (« déjà réservée », remaining quantity) lands as soon as both dates are set.
    if (!propertyId || !startDate || !endDate) return;
    const resources = await api.getResourcesAvailability({
      propertyId,
      startDate,
      endDate,
      ...(excludeReservationId ? { excludeReservationId } : {}),
    });
    setAvailableResources(resources);
  };

  // The availability used to refresh only at init and when the Logement select changed — so typing
  // the dates on a blank fiche never triggered it, and « déjà réservée » / the remaining quantity
  // stayed stale (specs/hourly-resource-quantity-and-sas-scheduling.md §3.2 rule 9). Until both dates
  // are set the catalogue from the property context stands in, so the block is never empty.
  useEffect(() => {
    if (loading || !selectedProp || !form.startDate || !form.endDate) return;
    loadResourcesAvailability(
      form.startDate,
      form.endDate,
      selectedProp,
      editingReservationId || excludeReservationIdForDevis || null,
    ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedProp, form.startDate, form.endDate, editingReservationId, excludeReservationIdForDevis]);

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
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
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
  }, [selectedProp, pricingQuoteSignature, shouldLockExistingPricing, applyQuoteToForm, applyQuoteMinNights, useCurrentPricing, offeredOptionIds, refundsVersion]);

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
  const maxGuestsAllowed = selectedProperty ? Number(selectedProperty.maxGuests ?? 0) : null;
  const maxBabiesAllowed = selectedProperty ? Number(selectedProperty.maxBabies ?? 0) : null;

  const bedsEntered = form.singleBeds !== '' || form.doubleBeds !== '' || form.babyBeds !== '';
  const adultsCount = Number(form.adults) || 0;
  const childrenCount = Number(form.children) || 0;
  const teensCount = Number(form.teens) || 0;
  const babiesCount = Number(form.babies) || 0;
  // ONE total for everyone over 2, babies apart (specs/property-capacity-single-total.md §3).
  // Mirrors server/src/utils/capacity.js for the inline warning only — the server decides.
  const guestsCount = adultsCount + childrenCount + teensCount;
  // maxGuests 0 = capacity not configured (guard off); maxBabies 0 = no babies accepted (enforced).
  const exceedsGuestsCapacity = Boolean(maxGuestsAllowed) && guestsCount > maxGuestsAllowed;
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
  const exceedsGuestCapacity = exceedsGuestsCapacity || exceedsBabiesCapacity;
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
    let didReleasePack = false;
    setForm(prev => {
      const parsed = Number(quantity);
      const normalizedQty = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
      // specs/welcome-pack-auto-options.md rule 11 — the operator just took ownership of this
      // option: the pack stops managing it (no removal on a platform change, no rebuild).
      const selected = releaseWelcomePackLine(prev.selectedOptions, optionId);
      if (selected !== prev.selectedOptions) didReleasePack = true;
      const exists = selected.find(so => so.optionId === optionId);
      let newOpts;
      if (normalizedQty <= 0) {
        newOpts = selected.filter(so => so.optionId !== optionId);
      } else if (exists) {
        newOpts = selected.map(so =>
          so.optionId === optionId ? { ...so, quantity: normalizedQty } : so
        );
      } else {
        // Absent → present transition. Mark for the offered-mirror side effect below.
        didAdd = true;
        newOpts = [...selected, { optionId, quantity: normalizedQty, totalPrice: 0 }];
      }
      return { ...prev, selectedOptions: newOpts };
    });
    // §3.7 fix — when the operator toggles an option BACK ON on an existing reservation,
    // inherit the offered flag from the property's default. Without this, the option keeps
    // whatever the offeredOptionIds had at load time, ignoring the property contract.
    // Only fires on a fresh add AND when a default actually exists for this option — no
    // default → leave the historical state alone.
    if (didReleasePack) releaseFromWelcomePack(optionId);
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
    let didReleasePack = false;
    setForm((prev) => {
      // Rule 11 again: editing the occurrences is an operator act, so the line leaves the pack's hands.
      const selected = releaseWelcomePackLine(prev.selectedOptions || [], optionId);
      if (selected !== (prev.selectedOptions || [])) didReleasePack = true;
      const exists = selected.some((so) => Number(so.optionId) === Number(optionId));
      const next = exists
        ? selected.map((so) => (Number(so.optionId) === Number(optionId) ? { ...so, cardOccurrences: occurrences } : so))
        : [...selected, { optionId: Number(optionId), quantity: 1, totalPrice: 0, cardOccurrences: occurrences }];
      return { ...prev, selectedOptions: next };
    });
    if (didReleasePack) releaseFromWelcomePack(optionId);
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

  // Welcome pack (specs/welcome-pack-auto-options.md). The server answers « what does the rate
  // already cover for THIS context » — own channel, party size, stay dates — and returns lines that
  // are safe to apply as-is; the effect below is the only thing the client decides: put them in,
  // take them back out. It is declared AFTER the grid reconcile above so that, on a date change,
  // the pack's single morning wins over the reconcile's « new day ⇒ pre-checked » rule.
  const welcomePackLines = useWelcomePack({
    enabled: isBlankNewBooking,
    propertyId: selectedProp || null,
    platform: form.platform,
    startDate: form.startDate,
    endDate: form.endDate,
    checkInTime: form.checkInTime,
    checkOutTime: form.checkOutTime,
    adults: form.adults,
    children: form.children,
    teens: form.teens,
  });

  useEffect(() => {
    if (!isBlankNewBooking) return;
    setForm((prev) => {
      const nextOptions = applyWelcomePack(prev.selectedOptions, welcomePackLines, {
        options: propertyOptions,
        excludedOptionIds: welcomePackOptOut,
        startDate: prev.startDate,
        endDate: prev.endDate,
        checkInTime: prev.checkInTime,
        checkOutTime: prev.checkOutTime,
      });
      return nextOptions === prev.selectedOptions ? prev : { ...prev, selectedOptions: nextOptions };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcomePackLines, propertyOptions, isBlankNewBooking, welcomePackOptOut]);

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

    const [{ property: prop }, calc, allRes] = await Promise.all([
      loadPropertyContext(nextPropertyId, properties),
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
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
      }),
      api.getReservations({ propertyId: nextPropertyId }),
    ]);

    // A different logement is a different pack — the refusals of the previous one mean nothing here.
    setWelcomePackOptOut(new Set());
    setReservations(allRes || []);
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
      cautionAmount: prop?.defaultCautionAmount ?? 500,
      checkInTime: prev.checkInTime || calc.defaultCheckIn || prop?.defaultCheckIn || '15:00',
      checkOutTime: prev.checkOutTime || calc.defaultCheckOut || prop?.defaultCheckOut || '10:00',
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
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
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

  const handleSaveReservation = async (afterSaveAction = null, forceMinNights = false, forceCapacity = false, forceChangeover = false, forceMaxNights = false) => {
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
      if (exceedsGuestsCapacity) capacityParts.push(`voyageurs: ${guestsCount}/${maxGuestsAllowed}`);
      if (exceedsBabiesCapacity) capacityParts.push(`bébés: ${babiesCount}/${maxBabiesAllowed}`);
      const proceed = await confirm({
        title: 'Capacité du logement dépassée',
        message: `Le nombre de personnes dépasse la capacité configurée (${capacityParts.join(' • ')}). Voulez-vous forcer l'enregistrement ?`,
        confirmLabel: 'Forcer l\'enregistrement',
        cancelLabel: 'Annuler',
        confirmColor: 'warning',
      });
      if (proceed) {
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, true, forceChangeover, forceMaxNights);
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
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
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
        return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity, forceChangeover, forceMaxNights);
      }

      // specs/tariff-recipes/spec.md §3.4 rule 23 — changeover breach: same confirm + force-override
      // pattern as the minimum-nights guard just above.
      if (quote.changeoverBreached && !forceChangeover) {
        const parts = [];
        if (quote.changeoverArrivalBreached) parts.push(`une arrivée le ${quote.requiredArrivalDayLabel}`);
        if (quote.changeoverDepartureBreached) parts.push(`un départ le ${quote.requiredDepartureDayLabel}`);
        const proceed = await confirm({
          title: 'Jour de changement non respecté',
          message: `Ces dates imposent ${parts.join(' et ')}. Voulez-vous forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, true, forceMaxNights);
      }

      // specs/tariff-recipes/spec.md §3.4 rule 20bis — maximum stay, mirror of the minimum guard.
      if (quote.maxNightsBreached && !forceMaxNights) {
        const proceed = await confirm({
          title: 'Durée maximale dépassée',
          message: `Cette réservation contient ${quote.nights} nuit(s), au-delà du maximum autorisé de ${quote.requiredMaxNights} nuit(s). Voulez-vous forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, forceChangeover, true);
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
          // Engine output, exactly like `resources` on a reservation save: it already carries the
          // hourly sessions, the billed units and the routing.
          selectedResources: quote.resourceLines,
          // « Actualiser les tarifs » is the one way to re-price a devis that is still valid — the
          // server otherwise replays the prices it was quoted at (specs/devis-extras-parity-and-price-lock.md
          // §3 rules 13 + 15).
          refreshPricingToCurrent: useCurrentPricing,
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
          forceChangeover,
          forceMaxNights,
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
          forceChangeover,
          forceMaxNights,
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
          return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity, forceChangeover, forceMaxNights);
        }
        return false;
      }
      if (err?.code === 'CHANGEOVER' && !forceChangeover) {
        const proceed = await confirm({
          title: 'Jour de changement non respecté',
          message: err.message || 'Le jour d\'arrivée ou de départ imposé pour ces dates n\'est pas respecté. Voulez-vous forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, true, forceMaxNights);
        }
        return false;
      }
      if (err?.code === 'MAX_NIGHTS' && !forceMaxNights) {
        const proceed = await confirm({
          title: 'Durée maximale dépassée',
          message: err.message || 'La durée maximale configurée pour cette saison est dépassée. Voulez-vous forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, forceChangeover, true);
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

  // specs/payment-schedule-and-cancellation.md §3.5 — cancelling for non-payment. Unlike a delete,
  // the reservation survives: its dates go back on sale, its acompte is requalified into an
  // indemnity, and the fiche stays readable. So we reload rather than navigate away.
  const handleCancelReservation = async ({ reason, notifyClient }) => {
    if (!reservationId) return;
    setCancelBusy(true);
    try {
      const result = await api.cancelReservation(reservationId, { reason, notifyClient });
      setCancelDialogOpen(false);
      await alert({
        title: 'Séjour annulé',
        message: result?.retainedDepositAmount > 0
          ? `Les dates sont remises à la vente. L'acompte de ${formatCurrency(result.retainedDepositAmount)} est conservé à titre d'indemnité (hors TVA).`
          : 'Les dates sont remises à la vente. Aucun acompte n\'avait été encaissé : rien n\'est conservé.',
      });
      navigateBackWithFrom(navigate, from);
    } catch (err) {
      await alert({ title: 'Annulation impossible', message: err.message });
    } finally {
      setCancelBusy(false);
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

  // specs/reservation-refunds.md §4.3 — the two mutations. Both replace the whole register with the
  // server's answer and bump `refundsVersion` so the quote (and thus the fiche's « total de séjour »)
  // is recomputed. `createRefund` lets the API error bubble up: the dialog renders it inline.
  const applyRefundPayload = useCallback((payload) => {
    if (!payload) return;
    setRefundRegister({
      refunds: payload.refunds || [],
      refundableLines: payload.refundableLines || [],
      refundTotals: payload.refundTotals || { book: 0, withCash: 0 },
      collectedTtc: Number(payload.collectedTtc || 0),
    });
    setRefundsVersion((v) => v + 1);
  }, []);

  const createRefund = useCallback(async (payload) => {
    const res = await api.createReservationRefund(editingReservationId, payload);
    applyRefundPayload(res);
  }, [editingReservationId, applyRefundPayload]);

  const deleteRefund = useCallback(async (refundId) => {
    try {
      applyRefundPayload(await api.deleteReservationRefund(editingReservationId, refundId));
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible de supprimer ce remboursement.' });
    }
  }, [editingReservationId, applyRefundPayload, alert]);

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
  // Nights of the stay, used for the « ×N j. » hint on per-night options. A fiche can now show its
  // options BEFORE the dates are entered (« Nouveau devis » lands on a dateless form), so an invalid
  // range must read 1, not NaN.
  const quantityNights = (() => {
    const span = Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000);
    return Number.isFinite(span) ? Math.max(1, span) : 1;
  })();
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

  // Which promise this quote still carries (specs/devis-extras-parity-and-price-lock.md §3 rule 16).
  // Both the date and the expiry verdict come from the server; the fiche only picks the wording — a
  // terser one on xs, where the bar shares its row with the language toggle and the action buttons.
  const devisValidityChip = (editingDevisId && devisValidity.validUntil)
    ? (devisValidity.expired
      ? (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={downSm ? 'Périmé' : 'Devis périmé — tarifs actualisés'}
        />
      )
      : (
        <Chip
          size="small"
          color="info"
          variant="outlined"
          label={`${downSm ? 'Valide' : 'Valide jusqu\'au'} ${displayDate(devisValidity.validUntil)}`}
        />
      ))
    : null;

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
    // specs/payment-schedule-and-cancellation.md §3.5 rule 21 — cancelling from the fiche, for the
    // phone call that never turns into a payment. Direct channels only: a platform booking is
    // cancelled through the iCal alert flow (specs/cancellation-compensation.md).
    ...(!isDevisMode && reservationId && !isPlatformReservation && !isCancelledReservation
      ? [{ icon: <EventBusyIcon />, tooltip: 'Annuler le séjour', onClick: () => setCancelDialogOpen(true), color: 'error', disabled: isReservationLocked }] : []),
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
    maxGuestsAllowed, maxBabiesAllowed, maxSingleBeds, maxDoubleBeds,
    exceedsGuestsCapacity, exceedsBabiesCapacity,
    exceedsSingleBedsLimit, exceedsDoubleBedsLimit, bedsCapacityMismatch,
    guestsCount, reservationBedCapacity, requiredRegularBeds,
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
    // specs/reservation-refunds.md — server-owned register + the two mutations, consumed by the
    // « Remboursements » block of the Finance card.
    refunds: refundRegister.refunds,
    refundableLines: refundRegister.refundableLines,
    refundTotals: refundRegister.refundTotals,
    refundCollectedTtc: refundRegister.collectedTtc,
    refundDialogOpen, setRefundDialogOpen, createRefund, deleteRefund,
  };

  return (
    <Box sx={{ pb: 4 }}>
      <PageActionBar
        title={computedTitle}
        onBack={goBackToOrigin}
        subtitle={(useCurrentPricing || form.bookingConflictAt || devisValidityChip || isCancelledReservation)
          ? (
            <>
              {isCancelledReservation && (
                <Chip size="small" color="error" label={`Annulée le ${displayDate(form.cancelledAt)}`} />
              )}
              {useCurrentPricing && <Chip size="small" color="warning" variant="outlined" label="Tarifs actuels appliqués (non sauvegardé)" />}
              {devisValidityChip}
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
        onSave={isCancelledReservation ? undefined : handleSaveClick}
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

      <ReservationCancelDialog
        open={cancelDialogOpen}
        busy={cancelBusy}
        row={{
          reservationId: editingReservationId || null,
          reservationNumber: form.reservationNumber || '',
          clientName: `${selectedClient?.firstName || ''} ${selectedClient?.lastName || ''}`.trim(),
          clientEmail: selectedClient?.email || '',
          propertyName: properties.find((p) => p.id === Number(form.propertyId))?.name || '',
          startDate: form.startDate,
          endDate: form.endDate,
          // What the server would keep / write off, from the stored payment state.
          retainedDepositAmount: form.depositPaid ? Number(pricingQuote?.depositAmount || 0) : 0,
          balanceDue: form.balancePaid ? 0 : Number(pricingQuote?.balanceAmount || 0),
        }}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={handleCancelReservation}
      />
    </Box>
  );
}
