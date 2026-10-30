import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';
import { versionAfterOwnWrite } from '../utils/ficheVersion';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router';
import {
  Box, TextField, Autocomplete, Button, FormControl, InputLabel, Select,
  MenuItem, Typography, Chip, Stack, Card, CardContent,
  useMediaQuery,
  ToggleButton, ToggleButtonGroup, Tooltip, Alert, Link
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import DescriptionIcon from '@mui/icons-material/Description';
import MailOutlineIcon from '@mui/icons-material/MailOutlined';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PaymentsIcon from '@mui/icons-material/Payments';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import LanguageIcon from '@mui/icons-material/Language';
import PageActionBar from '../components/PageActionBar';
import OriginBadge from '../components/OriginBadge';
import StatusBadge from '../components/StatusBadge';
import LanguageBadge from '../components/LanguageBadge';
import ReservationConflictBadge from '../components/ReservationConflictBadge';
import EmailManualSendDialog from '../components/EmailManualSendDialog';
import PricingSummary from '../components/PricingSummary';
import StickyTotalBar from '../components/StickyTotalBar';
import PlatformPriceAlert from '../components/reservation/PlatformPriceAlert';
import PricingNotices from '../components/reservation/PricingNotices';
import DevisValidityChip from '../components/reservation/DevisValidityChip';
import DevisExtensionSummary from '../components/reservation/DevisExtensionSummary';
import ClientFormFields from '../components/ClientFormFields';
import FormDialog from '../components/FormDialog';
import { ReservationFormProvider } from '../components/reservation/ReservationFormContext';
import StaySection from '../components/reservation/StaySection';
import GuestsBedsSection from '../components/reservation/GuestsBedsSection';
import ExtrasSection from '../components/reservation/ExtrasSection';
import FinanceSection from '../components/reservation/FinanceSection';
import Slot from '../plugins/sdk/Slot';
import ReservationHistoryPanel from '../components/reservation/ReservationHistoryPanel';
import TermsAcceptanceLine from '../components/reservation/TermsAcceptanceLine';
import usePlatforms from '../hooks/usePlatforms';
import { formatPlatformLabel } from '../constants/platforms';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import PluginGate from '../components/PluginGate';
import { WEBSITE_BOOKING } from '../constants/plugins';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import ReservationCancelDialog from '../components/ReservationCancelDialog';
import api from '../api';
import { expandOptionGroups } from '../utils/optionGroups';
import { getRangeOccupancyConflictInfo, isPlacementUnchanged } from '../utils/reservationConflicts';
import { isValidEmail, isValidPhone } from '../utils/validation';
import { DEFAULT_BACK_PATH, getFromParam, navigateBack, navigateBackWithFrom } from '../utils/navigation';
import { applyQuoteToForm as applyQuoteToFormPure } from '../utils/applyQuoteToForm';
import { resolvePlatformTouristTaxPrefill } from '../utils/platformTouristTaxPrefill';
import { COARSE_POINTER, TOUCH_TARGET } from '../utils/touchHitArea';
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
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';
import { optionLineKey, resourceLineKey } from '../utils/arrivalLineKey';
import { LOCKED_FICHE_BANNER, MID_STAY_EXTRAS_BANNER } from '../constants/reservationLock';

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
const NO_ARRIVAL_LINES = {};
const NO_FROZEN_CUSTOM_IDS = [];

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
  notes: '',
  // Without this the dialog sends no emailLanguage, and the model used to read that silence as
  // « français » — editing a phone number reset an English guest. The server keeps the stored value
  // now, but the form must still carry what it displays.
  emailLanguage: 'fr',
};

// Only the 404 of the fiche or quote being opened means « introuvable »; a 404 on a side lookup (the
// property of a new stay) is an ordinary load failure.
function markMissingLookup(err) {
  if (err && err.status === 404) err.missingLookup = true;
  throw err;
}

export default function ReservationPage() {
  const { reservationId } = useParams();
  const { user: currentUser } = useAuth();
  const isAdmin = userHasRole(currentUser, ADMIN);
  // Per-fiche unlock of a past reservation (specs/settings-rationalization.md rule 17a): an admin
  // clicks « Déverrouiller cette fiche »; it lasts as long as this fiche is open and every write it
  // sends carries `unlockPast`. Leaving or reloading the fiche puts the lock back.
  const [pastUnlocked, setPastUnlocked] = useState(false);
  const unlockPayload = pastUnlocked ? { unlockPast: true } : {};
  const editingReservationId = reservationId ? Number(reservationId) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { confirm, alert } = useAppDialogs();
  // Pure-info confirmations toast instead of modaling (specs/ds-components.md §3.2).
  const { showSuccess, showError } = useToast();
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
  const [notFound, setNotFound] = useState(false);
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
  // specs/clients.md rule 13 — a client typed for a stay not saved yet: sent as `newClient` with the
  // first save, written with it, never before.
  const [pendingClient, setPendingClient] = useState(null);
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
  // specs/plugins-phase-3b-neat.md rule 12 — what live plugins show on this stay, by plugin id
  // (Neat: the subscription under the insurance line). Server-shaped; a plugin replaces its own.
  const [pluginBlocks, setPluginBlocks] = useState({});
  // Bumped by a plugin banner that changed the reservation server-side: re-runs the page load.
  const [reloadToken, setReloadToken] = useState(0);
  // The `updatedAt` this fiche was built on, sent back on save: the server refuses a save made on an
  // older version instead of reverting what an import, a mail or another tab wrote meanwhile.
  const loadedUpdatedAtRef = useRef(null);
  // « Enregistrer quand même » : the one save that goes without the version, an explicit overwrite.
  const overwriteOnceRef = useRef(false);
  useEffect(() => {
    const versionedId = reservationId || editingDevisId;
    if (!versionedId) return undefined;
    const adoptOwnWrites = (event) => {
      loadedUpdatedAtRef.current = versionAfterOwnWrite(versionedId, loadedUpdatedAtRef.current, event.detail);
    };
    window.addEventListener(DATA_CHANGED_EVENT, adoptOwnWrites);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, adoptOwnWrites);
  }, [reservationId, editingDevisId]);
  const [restoring, setRestoring] = useState(false);
  // Where a cancelled fiche keeps its « Nouveau remboursement » button, outside the disabled fieldset.
  const [refundHost, setRefundHost] = useState(null);
  const setPluginBlock = useCallback((pluginId, block) => {
    setPluginBlocks((prev) => ({ ...prev, [pluginId]: block }));
  }, []);
  // specs/terms-acceptance-record.md rules 21-22 — the CGV acceptance block, shaped by the server.
  const [cgvBlock, setCgvBlock] = useState(null);
  // specs/plugins-phase-3a-online-payment.md rule 18 — the payment buttons follow the server: null
  // while no payment provider is ready.
  const [onlinePayment, setOnlinePayment] = useState(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  // Bumped after any server-side finance mutation the live quote depends on — un remboursement, une
  // note en séjour, le report du complément en fin de séjour — pour que l'effet de devis re-tourne et
  // que le « total de séjour » et le split des compléments suivent.
  const [refundsVersion, setRefundsVersion] = useState(0);
  const [newClient, setNewClient] = useState(EMPTY_CLIENT);
  const [newClientCityOptions, setNewClientCityOptions] = useState([]);
  const [propertyOptions, setPropertyOptions] = useState([]);
  // Server-computed option grouping for the fiche (specs/option-categories.md §4.2) — `{ ungrouped,
  // groups }`, already visibility-filtered and ordered. null until a property is loaded, and on
  // payloads that predate the feature: ExtrasSection then falls back to the flat list.
  const [propertyOptionGroups, setPropertyOptionGroups] = useState(null);
  const [availableResources, setAvailableResources] = useState([]);
  // specs/plugins-phase-3c-hourly-resources.md rule 18 — the resources this stay carries that the
  // catalogue now hides (sold by the hour, plugin off), drawn read-only beside the others.
  const [frozenResources, setFrozenResources] = useState([]);
  const [nightlyBreakdown, setNightlyBreakdown] = useState([]);
  const [pricingQuote, setPricingQuote] = useState(null);
  const pricingQuoteRef = useRef(null);
  // What the last resource-availability read was for: the effect that follows the dates does not ask again
  // for the answer the init just got, and a new property context forgets it (specs/inte-performance.md rule 23).
  const availabilityKey = useRef('');
  pricingQuoteRef.current = pricingQuote;
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
    // The fiche reads no pricing season: `view=stay` leaves them out (specs/inte-performance.md rule 14).
    const propDetails = await api.getProperty(numId, 'stay');
    // `propDetails.options` is the property-scoped, priced, grouped list.
    const options = Array.isArray(propDetails?.options) ? propDetails.options : [];
    availabilityKey.current = '';
    setSelectedProp(numId);
    setSelectedProperty(propDetails || propertiesList.find((p) => p.id === numId) || null);
    setPropertyOptions(options);
    setPropertyOptionGroups(expandOptionGroups(propDetails?.optionGroups, options) || null);
    if (Array.isArray(propDetails?.resources)) {
      setAvailableResources(propDetails.resources.map((r) => ({
        ...r,
        available: Number(r.available ?? r.quantity ?? 0),
      })));
    }
    return { property: propDetails, options };
  }, []);

  // specs/plugins-phase-3b-neat.md rule 22 — the options this stay carries that the catalogue now
  // hides (the insurance without Neat), drawn read-only beside the others. Returns the full list.
  const addFrozenOptions = useCallback((options, frozen) => {
    const extra = (frozen || []).filter((f) => !options.some((o) => Number(o.id) === Number(f.id)));
    if (extra.length === 0) return options;
    setPropertyOptions((prev) => [...prev, ...extra]);
    setPropertyOptionGroups((prev) => (prev ? { ...prev, ungrouped: [...(prev.ungrouped || []), ...extra] } : prev));
    return [...options, ...extra];
  }, []);

  // Validity state of the devis being edited, straight from the server (`validUntil` + `expired`).
  // Drives the action-bar chip and the price lock — the fiche decides nothing here.
  const [devisValidity, setDevisValidity] = useState({ validUntil: null, expired: false, extendable: false, converted: false });

  const [babyBedAvailability, setBabyBedAvailability] = useState({ totalQuantity: 0, reserved: 0, available: null });
  const [existingReservationLocked, setExistingReservationLocked] = useState(false);
  // specs/mid-stay-extras-on-locked-fiche.md rule 13 — the lock as the server decided it: whether the
  // fiche is locked, whether its extras are still editable, and the floor of each line sold at arrival.
  const [editLock, setEditLock] = useState(null);
  const [isIcalImportedBlankPrice, setIsIcalImportedBlankPrice] = useState(false);
  const [isIcalSource, setIsIcalSource] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  // The form exactly as loaded (before any quote or edit): the clean baseline of an existing record starts here.
  const [loadedSnapshot, setLoadedSnapshot] = useState(null);
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
  // specs/reservation-payment-ledger.md — the body of the last live quote (the amount editors re-send
  // it with `ledgerEdit`) and the ledger edit the next save carries for the history (rule 23).
  const lastQuoteBodyRef = useRef(null);
  // specs/reservation-payment-ledger.md rule 7 — the STORED ledger (GET), outside the form so that
  // re-reading it never makes the fiche « modified ».
  const [storedLedger, setStoredLedger] = useState(null);
  const [storedHeadline, setStoredHeadline] = useState(null);
  const [storedSummary, setStoredSummary] = useState(null);
  // specs/disable-deposit-per-reservation.md rule 13 — why « Sans acompte » is locked, as the GET last said.
  const [storedDepositDisabledLockedReason, setStoredDepositDisabledLockedReason] = useState(null);
  // specs/direct-installments.md — the plan of a direct reservation, as the server last sent it.
  const [installmentPlan, setInstallmentPlan] = useState(null);
  const ledgerEditMarkerRef = useRef(null);

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
    // specs/calendar-property-parity.md rule 22 — a duplicate set aside opens read-only, naming the stay it
    // duplicates; an admin can put it back.
    kind: 'reservation', supersededByReservationId: null, supersededByReservationNumber: null,
    singleBeds: '', doubleBeds: '', babyBeds: '',
    extraGuestSurchargeOffered: false,
    totalPrice: 0, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 0, customPrice: '',
    depositAmount: 0, depositDueDate: '', balanceAmount: 0, balanceDueDate: '',
    // Manual deposit override (specs/editable-deposit-amount.md). '' = automatic (percentage);
    // a number freezes the deposit and lets the solde absorb tariff changes.
    depositAmountOverride: '',
    // Operator-set complement amounts (specs/adjustable-complement-amounts.md §3.1). '' = automatic;
    // a number freezes the bucket at what was announced to the guest.
    complementAmountOverride: '',
    endOfStayComplementAmountOverride: '',
    endOfStayComplementAmountAuto: 0,
    complementAdjustment: null,
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
    // specs/platform-tourist-tax-out-of-the-commission.md rule 2 — '' means « the brut carries no
    // tourist tax », which is what every reservation stored before this feature says. Never 0.
    platformTouristTaxAmount: '',
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
  // specs/plugins-phase-p-productisation.md rule 45 — whether the stay is a platform SALE is the
  // server's answer (a channel « Compté comme vente directe » is not one); before its first quote
  // comes back, any named channel reads as a platform so the panels do not flicker.
  const isPlatformReservation = pricingQuote
    ? Boolean(pricingQuote.platformSale)
    : Boolean(form.platform) && String(form.platform).toLowerCase() !== 'direct';
  // A cancelled stay is read-only (specs/payment-schedule-and-cancellation.md §3.5 rule 25): the
  // server refuses every write on it, so the fiche must not offer any.
  const isCancelledReservation = Boolean(form.cancelledAt);
  const isSupersededReservation = form.kind === 'superseded';
  // A cancelled stay and a duplicate set aside are history: the fiche only shows them (the server answers 409).
  const isClosedFiche = isCancelledReservation || isSupersededReservation;
  const formSnapshot = useMemo(() => JSON.stringify({
    selectedProp: selectedProp ? Number(selectedProp) : null,
    form,
  }), [selectedProp, form]);
  // specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — the freeze is the SERVER's
  // decision (has the instalment carrying the tax been collected? has the line been declared?), so the
  // page no longer derives it from the dates. It only ever asks for the opposite, through
  // « Recalculer la taxe de séjour », and reads back what the engine did in `quote.touristTaxFrozen`.
  const refreshTouristTax = touristTaxRefreshRequested;
  const isTouristTaxFrozen = Boolean(pricingQuote?.touristTaxFrozen);
  // Reset the manual refresh when switching to another reservation (the frozen value is re-loaded).
  useEffect(() => { setTouristTaxRefreshRequested(false); }, [editingReservationId]);

  const pricingQuoteSignature = useMemo(() => JSON.stringify({
    propertyId: selectedProp ? Number(selectedProp) : null,
    refreshTouristTax,
    startDate: form.startDate,
    endDate: form.endDate,
    checkInTime: form.checkInTime,
    checkOutTime: form.checkOutTime,
    adults: Number(form.adults || 0),
    children: Number(form.children || 0),
    teens: Number(form.teens || 0),
    // specs/tourist-tax-included-services-deduction.md rule 16 — a baby is not a paying guest, but it
    // IS an occupant, and the tourist tax divides the night by the occupants. Missing here, the live
    // preview divided by one head too few and announced a tax the save then contradicted.
    babies: Number(form.babies || 0),
    // specs/baby-bed-supplement.md — the cot count is a PRICING input (5 € per cot for the stay), so
    // the live quote must re-fire on it like it does on the guest counts.
    babyBeds: Number(form.babyBeds || 0),
    extraGuestSurchargeOffered: Boolean(form.extraGuestSurchargeOffered),
    discountPercent: Number(form.discountPercent || 0),
    customPrice: form.customPrice === '' ? '' : Number(form.customPrice),
    // specs/platform-commission-line.md — recompute when the platform commission changes (it drives the
    // « net perçu » line + the solde).
    platformCommissionAmount: form.platformCommissionAmount === '' ? '' : Number(form.platformCommissionAmount),
    acompteCommissionAmount: form.acompteCommissionAmount === '' ? '' : Number(form.acompteCommissionAmount),
    // specs/platform-payment-entry.md — the brut pins the total séjour (recompute when it changes).
    platformGrossAmount: form.platformGrossAmount === '' ? '' : Number(form.platformGrossAmount),
    platformTouristTaxAmount: form.platformTouristTaxAmount === '' ? '' : Number(form.platformTouristTaxAmount),
    depositPaid: Boolean(form.depositPaid),
    balancePaid: Boolean(form.balancePaid),
    complementPaid: Boolean(form.complementPaid),
    depositAmount: form.depositPaid ? Number(form.depositAmount || 0) : null,
    balanceAmount: form.depositPaid && form.balancePaid ? Number(form.balanceAmount || 0) : null,
    complementAmount: form.complementPaid ? Number(form.complementAmount || 0) : null,
    // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
    depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
    // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
    // every save, so the preview, the fiche total and the stored amount can never disagree.
    complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
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
        // …and how many covers they serve (specs/card-option-served-persons.md §3.2 rule 9).
        if (item.cardPersons != null) line.cardPersons = Number(item.cardPersons);
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
    // The explicit operator set only — on a platform sale the engine routes every auto-option to
    // Complément by itself, exactly as on save.
    autoOptionsInComplement: [...(form.autoOptionsInComplement || [])].map(Number).sort((a, b) => a - b),
    // specs/tourist-tax-matches-the-office-calculation.md — `refreshTouristTax` MUST be a dependency:
    // « Recalculer » flips it (via `touristTaxRefreshRequested`), and without it here the memo
    // stays stale, the live-preview effect never re-fires, and the tax only recomputes after a save.
  }), [selectedProp, form.startDate, form.endDate, form.checkInTime, form.checkOutTime, form.adults, form.children, form.teens, form.babies, form.babyBeds, form.extraGuestSurchargeOffered, form.discountPercent, form.customPrice, form.depositPaid, form.balancePaid, form.depositAmount, form.balanceAmount, form.depositAmountOverride, form.complementAmountOverride, form.selectedOptions, form.customOptions, form.selectedResources, propertyOptions, offeredOptionIds, form.platform, form.depositDisabled, form.touristTaxInComplement, form.autoOptionsInComplement, form.platformCommissionAmount, form.acompteCommissionAmount, form.platformGrossAmount, form.platformTouristTaxAmount, refreshTouristTax]);
  // The clean baseline of the unsaved-changes guard, derived in the render that needs it — never in an effect,
  // which would leave a render comparing the quoted form with no baseline (a flash of « modified »).
  // For an existing record it is the form AS LOADED, with what the quote writes into it once the quote is
  // there (the server recalc reshapes the loaded form once on mount: offered flags, derived amounts); never
  // the live form, so whatever the operator typed meanwhile stays an edit. New records snapshot at once.
  // Once the quote is in it is frozen into `initialSnapshot`; a save or a payment mark moves it from there.
  if (!loading && loadedSnapshot === null) setLoadedSnapshot(formSnapshot);
  let cleanBaseline = initialSnapshot;
  if (cleanBaseline === null && !loading) {
    const isExistingRecord = Boolean(editingReservationId || editingDevisId);
    cleanBaseline = loadedSnapshot !== null ? loadedSnapshot : formSnapshot;
    if (isExistingRecord && pricingQuote) {
      try {
        const loaded = JSON.parse(cleanBaseline);
        const preserveBlankPrice = isIcalImportedBlankPrice && loaded.form.customPrice === '' && loaded.form.totalPrice === '';
        cleanBaseline = JSON.stringify({ ...loaded, form: applyQuoteToFormPure(loaded.form, pricingQuote, { preserveBlankPrice }) });
      } catch { /* the loaded form stands */ }
    }
    if (!isExistingRecord || pricingQuote) setInitialSnapshot(cleanBaseline);
  }
  const isDirty = cleanBaseline !== null && formSnapshot !== cleanBaseline;
  // Review of #727 (H2) — a mark re-reads what the server wrote, then the quote re-prices the form on
  // that state: neither is an edit. A fiche that was clean takes its baseline again once that quote has
  // landed.
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  const resnapshotAfterQuoteRef = useRef(null);
  useEffect(() => {
    if (!resnapshotAfterQuoteRef.current || !pricingQuote) return;
    if (pricingQuote === resnapshotAfterQuoteRef.current.quote) return;
    resnapshotAfterQuoteRef.current = null;
    // The baseline takes what the quote wrote into the form, and nothing else: whatever the operator typed
    // while the quote was on its way (a note) stays an edit, so Enregistrer lights up.
    setInitialSnapshot((prevSnapshot) => {
      // Not frozen yet: the baseline is still derived from the loaded form and the quote, which is right.
      if (!prevSnapshot) return prevSnapshot;
      try {
        const snap = JSON.parse(prevSnapshot);
        return JSON.stringify({ ...snap, form: applyQuoteToFormPure(snap.form, pricingQuote, { preserveBlankPrice: false }) });
      } catch { return prevSnapshot; }
    });
  }, [pricingQuote, formSnapshot]);
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

  useEffect(() => {
    if (!isDirty) return;
    const pageState = window.history.state;

    const onPopState = () => {
      pendingLeaveActionRef.current = () => navigate(-1);
      setUnsavedDialogOpen(true);
      // Keep user on the current page until they confirm.
      // The page's own router state, not null: a null entry loses `idx`, and the next « Retour » would
      // think the page was opened directly (specs/ui-review-2026-10-19-operations.md rule 26).
      window.history.pushState(pageState, '', window.location.href);
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
        // A (re)load takes its clean baseline again, from what it loads (see the baseline effect).
        setInitialSnapshot(null);
        setLoadedSnapshot(null);
        setPricingQuote(null);
        resnapshotAfterQuoteRef.current = null;
        setNotFound(false);
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
        setFrozenResources([]);

        if (prefillDevis?.form) {
          const prefillPropertyId = Number(prefillDevis.propertyId || prefillDevis.form.propertyId || 0) || null;
          if (prefillPropertyId) {
            await loadPropertyContext(prefillPropertyId, props);

            const allRes = await api.getReservations({ propertyId: prefillPropertyId, view: 'occupancy' });
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
          const res = await api.getReservation(reservationId).catch(markMissingLookup);
          loadedUpdatedAtRef.current = res.updatedAt || null;
          setExistingReservationLocked(Boolean(res.editLock?.locked));
          setEditLock(res.editLock || null);
          setPastUnlocked(false);
          const loaded = await loadPropertyContext(res.propertyId, props);
          const catalogueOptions = addFrozenOptions(loaded.options, res.frozenOptions);
          setFrozenResources(Array.isArray(res.frozenResources) ? res.frozenResources : []);

          // Load all reservations for this property to check conflicts
          const allRes = await api.getReservations({ propertyId: res.propertyId, view: 'occupancy' });
          setReservations(allRes);
          setExcludeReservationIdForDevis(null);

          const importedBlankPrice = res.sourceType === 'ical' && res.totalPrice == null && res.finalPrice == null;
          setForm({
            clientId: res.clientId,
            reservationNumber: res.reservationNumber || '',
            // Where this booking came from. Read-only on the fiche — it is a fact about the past,
            // not a setting (specs/site-english-version.md rule 13).
            requestOrigin: res.requestOrigin || null,
            // …and from which source, labelled by the server (specs/site-traffic-analytics.md rule 19).
            originLabel: res.originLabel || null,
            originDetail: res.originDetail || null,
            bookingConflictAt: res.bookingConflictAt || null,
            cancelledAt: res.cancelledAt || null,
            kind: res.kind || 'reservation',
            supersededByReservationId: res.supersededByReservationId || null,
            supersededByReservationNumber: res.supersededByReservationNumber || null,
            adults: res.adults || 1,
            children: res.children || 0,
            teens: res.teens || 0,
            babies: res.babies || 0,
            platform: res.platform || 'direct',
            singleBeds: res.singleBeds ?? '',
            doubleBeds: res.doubleBeds ?? '',
            babyBeds: res.babyBeds ?? '',
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
            // specs/collect-stay-payment-at-check-in.md §3.4 rule 20 — read-only markers: the séjour
            // was collected at the door in the caisse interne. The choice is made in the SAS; the
            // fiche only says so (and the server clears the flag when a bucket is un-ticked here).
            depositPaidCash: Boolean(res.depositPaidCash),
            balancePaidCash: Boolean(res.balancePaidCash),
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
            // specs/single-payment-at-check-in.md §3.4 — the single payment made at the door, already
            // shaped by the server (amount, means, buckets covered). `null` when there was none.
            arrivalPayment: res.arrivalPayment || null,
            // specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » at check-in:
            // the fiche then shows ONE complement, built server-side (amount + lines + paid state).
            complementDeferredToCheckout: Boolean(res.complementDeferredToCheckout),
            checkoutComplement: res.checkoutComplement || null,
            // specs/adjustable-complement-amounts.md §3.1 — '' when the bucket is on automatic.
            complementAmountOverride: res.complementAmountOverride == null ? '' : res.complementAmountOverride,
            endOfStayComplementAmountOverride: res.endOfStayComplementAmountOverride == null ? '' : res.endOfStayComplementAmountOverride,
            endOfStayComplementAmountAuto: Number(res.endOfStayComplementAmountAuto || 0),
            // specs/adjustable-complement-amounts.md §3.6 — plancher + ventilation prêts à rendre.
            complementAdjustment: res.complementAdjustment || null,
            platformCommissionAmount: res.platformCommissionAmount == null || res.platformCommissionAmount === '' ? '' : res.platformCommissionAmount,
            acompteCommissionAmount: res.acompteCommissionAmount == null || res.acompteCommissionAmount === '' ? '' : res.acompteCommissionAmount,
            platformGrossAmount: res.platformGrossAmount == null || res.platformGrossAmount === '' ? '' : res.platformGrossAmount,
            platformPayoutAmount: res.platformPayoutAmount == null || res.platformPayoutAmount === '' ? '' : res.platformPayoutAmount,
            platformTouristTaxAmount: res.platformTouristTaxAmount == null || res.platformTouristTaxAmount === '' ? '' : res.platformTouristTaxAmount,
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
          setPluginBlocks(res.pluginBlocks || {});
          setCgvBlock(res.cgv || null);
          setOnlinePayment(res.onlinePayment || null);
          setStoredLedger(res.ledger || null);
          setStoredHeadline(res.storedHeadline || null);
          setStoredSummary(res.storedSummary || null);
          setStoredDepositDisabledLockedReason(res.depositDisabledLockedReason || null);
          setInstallmentPlan(res.installmentPlan || null);
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
          const devis = await api.getDevisById(editingDevisId).catch(markMissingLookup);
          loadedUpdatedAtRef.current = devis.updatedAt || null;
          setCgvBlock(devis.cgv || null);
          setOnlinePayment(devis.onlinePayment || null);
          const loaded = await loadPropertyContext(devis.propertyId, props);
          const catalogueOptions = addFrozenOptions(loaded.options, devis.frozenOptions);
          setFrozenResources(Array.isArray(devis.frozenResources) ? devis.frozenResources : []);

          const allRes = await api.getReservations({ propertyId: devis.propertyId, view: 'occupancy' });
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
            requestOrigin: devis.requestOrigin || null,
            publicUpdatedAfterSendAt: devis.publicUpdatedAfterSendAt || null,
            originLabel: devis.originLabel || null,
            originDetail: devis.originDetail || null,
            adults: devis.adults || 1,
            children: devis.children || 0,
            teens: devis.teens || 0,
            babies: devis.babies || 0,
            platform: devis.platform || 'direct',
            status: devis.status || 'draft',
            singleBeds: devis.singleBeds ?? '',
            doubleBeds: devis.doubleBeds ?? '',
            babyBeds: devis.babyBeds ?? '',
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
            arrivalPayment: null,
            complementDeferredToCheckout: false,
            checkoutComplement: null,
            complementAmountOverride: '',
            endOfStayComplementAmountOverride: '',
            endOfStayComplementAmountAuto: 0,
            complementAdjustment: null,
            platformCommissionAmount: '',
            acompteCommissionAmount: '',
            platformGrossAmount: '',
            platformPayoutAmount: '',
            platformTouristTaxAmount: '',
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
          setDevisValidity({
            validUntil: devis.validUntil || null,
            expired: Boolean(devis.expired),
            extendable: Boolean(devis.extendable),
            converted: devis.status === 'converted',
          });
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

          const allRes = await api.getReservations({ propertyId: initialPropId, view: 'occupancy' });
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
            cautionAmount: prop?.defaultCautionAmount ?? 0,
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
            arrivalPayment: null,
            complementDeferredToCheckout: false,
            checkoutComplement: null,
            complementAmountOverride: '',
            endOfStayComplementAmountOverride: '',
            endOfStayComplementAmountAuto: 0,
            complementAdjustment: null,
            platformCommissionAmount: '',
            acompteCommissionAmount: '',
            platformGrossAmount: '',
            platformPayoutAmount: '',
            platformTouristTaxAmount: '',
          });

          await loadResourcesAvailability(startDate, endDate, initialPropId);
          await loadBabyBedAvailability(startDate, endDate, initialPropId);
          // §3.7 — pre-populate selectedOptions with the property's defaults (linen options
          // typically). Soft-fail; awaiting so the form is consistent before the user can interact.
          await applyPropertyDefaultsAsync(initialPropId);
        }

        setLoading(false);
      } catch (err) {
        if (err && err.status === 404 && err.missingLookup) setNotFound(true);
        else setInitError(true);
        setLoading(false);
      }
    };

    initPage();
  }, [reservationId, editingDevisId, searchParams, prefillDevis, reloadToken]);

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
    availabilityKey.current = [propertyId, startDate, endDate, excludeReservationId || ''].join('|');
    setAvailableResources(resources);
  };


  // The availability used to refresh only at init and when the Logement select changed — so typing
  // the dates on a blank fiche never triggered it, and « déjà réservée » / the remaining quantity
  // stayed stale (specs/hourly-resource-quantity-and-sas-scheduling.md §3.2 rule 9). Until both dates
  // are set the catalogue from the property context stands in, so the block is never empty.
  useEffect(() => {
    if (loading || !selectedProp || !form.startDate || !form.endDate) return;
    const excludeId = editingReservationId || excludeReservationIdForDevis || null;
    if (availabilityKey.current === [selectedProp, form.startDate, form.endDate, excludeId || ''].join('|')) return;
    loadResourcesAvailability(form.startDate, form.endDate, selectedProp, excludeId).catch(() => {});
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

  // The list feeds the search box only: it is read when the box is what the page shows. An existing stay
  // shows its client by name until « changer » opens the search; while that client is being looked up
  // the box is not shown yet, and if the lookup fails it is (specs/inte-performance.md rule 15).
  const [clientLookupFailed, setClientLookupFailed] = useState(false);
  const clientLookupPending = Boolean(reservationId) && (loading || (Boolean(form.clientId) && !selectedClient && !clientLookupFailed));
  const clientSearchShown = !(selectedClient && !clientSearchOpen) && !clientLookupPending;
  useEffect(() => { if (clientSearchShown) loadClientsForSearch(clientSearch); }, [clientSearch, clientSearchShown]);
  // Keep `selectedClient` (the bold-name display) in sync with the attached clientId — from the
  // search list when present, otherwise fetched directly so it works on initial load / deep-links.
  useEffect(() => {
    if (!form.clientId) { setSelectedClient(pendingClient ? { ...pendingClient, id: null } : null); return undefined; }
    const inList = clients.find((c) => c.id === form.clientId);
    if (inList) { setSelectedClient(inList); return undefined; }
    let cancelled = false;
    setClientLookupFailed(false);
    api.getClient(form.clientId).then((c) => { if (!cancelled && c) setSelectedClient(c); }).catch(() => { if (!cancelled) setClientLookupFailed(true); });
    return () => { cancelled = true; };
  }, [form.clientId, clients, pendingClient]);
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
        const quoteBody = {
          propertyId: selectedProp,
          startDate: form.startDate,
          endDate: form.endDate,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
          adults: form.adults,
          children: form.children,
          teens: form.teens,
          babies: Number(form.babies || 0),
          babyBeds: Number(form.babyBeds || 0),
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          discountPercent: form.discountPercent,
          customPrice: form.customPrice,
          platformCommissionAmount: form.platformCommissionAmount, // specs/platform-commission-line.md (solde commission)
          acompteCommissionAmount: form.acompteCommissionAmount, // specs/platform-per-echeance-commission.md (acompte commission)
          platformGrossAmount: form.platformGrossAmount, // specs/platform-payment-entry.md (pins the total séjour)
          platformTouristTaxAmount: form.platformTouristTaxAmount, // specs/platform-tourist-tax-out-of-the-commission.md (comes back out of the brut)
          depositPaid: form.depositPaid,
          balancePaid: form.balancePaid,
          complementPaid: form.complementPaid,
          depositAmount: form.depositAmount,
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
          // every save, so the preview, the fiche total and the stored amount can never disagree.
          complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
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
        refreshTouristTax,
          ...(editingReservationId ? { reservationId: editingReservationId } : {}),
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
        // specs/reservation-payment-ledger.md rule 7 — the ledger follows the transfer typed on the fiche.
        platformPayoutAmount: form.platformPayoutAmount,
        };
        // specs/reservation-payment-ledger.md rule 21 — the amount editors re-ask this same quote.
        lastQuoteBodyRef.current = quoteBody;
        const calc = await api.calculatePrice(quoteBody);

        if (requestId !== pricingQuoteRequestRef.current) return;
        setPricingQuote(calc);
        setNightlyBreakdown(calc.nightlyBreakdown || []);
        applyQuoteMinNights(calc);

        const preserveBlankPrice = isIcalImportedBlankPrice && form.customPrice === '' && form.totalPrice === '';

        setForm(prev => {
          if (prev.startDate !== form.startDate || prev.endDate !== form.endDate || prev.adults !== form.adults || prev.children !== form.children || prev.teens !== form.teens) {
            return prev;
          }
          const next = applyQuoteToForm(prev, calc, preserveBlankPrice);
          // specs/platform-tourist-tax-out-of-the-commission.md rules 4 + 21 — a fiche whose brut has
          // not been entered yet starts from the engine's figure, so everything typed from now on
          // follows the tax-inclusive convention. An iCal-imported booking is already saved, so the
          // test is the brut, not the fiche's age. The decision itself lives in a pure helper.
          const seededTouristTax = resolvePlatformTouristTaxPrefill({
            grossEntered: next.platformGrossAmount !== '' && next.platformGrossAmount != null,
            currentValue: next.platformTouristTaxAmount,
            quote: calc,
          });
          if (seededTouristTax != null) return { ...next, platformTouristTaxAmount: seededTouristTax };
          return next;
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
  // specs/tourist-tax-included-services-deduction.md rule 4 — a service INCLUDED IN THE RATE (a
  // property default marked « offerte ») is not optional: it is sold inside the night, it leaves the
  // tourist-tax base, and its Switch reads ON and disabled. In EDIT mode the lock is limited to the
  // lines the reservation actually carries — one it never had stays a normal off Switch, or the
  // fiche would force an option onto a booking that predates the default
  // (specs/reservation-option-immutability.md rules 3-4, unchanged).
  const lockedIncludedOptionIds = (() => {
    const offeredDefaults = propertyOptionDefaults
      .filter((d) => d.offered)
      .map((d) => Number(d.optionId));
    if (!editingReservationId) return new Set(offeredDefaults);
    const carried = new Set((form.selectedOptions || []).map((so) => Number(so.optionId)));
    return new Set(offeredDefaults.filter((id) => carried.has(id)));
  })();
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

  // How many people a per-person card option actually serves (specs/card-option-served-persons.md
  // §3.2 rule 7). Same welcome-pack release as the occurrence grid: adjusting the covers is an
  // operator act, so the line leaves the pack's hands. The server clamps the value and decides what
  // to persist — this only carries the intent.
  const setOptionCardPersons = (optionId, persons) => {
    let didReleasePack = false;
    setForm((prev) => {
      const selected = releaseWelcomePackLine(prev.selectedOptions || [], optionId);
      if (selected !== (prev.selectedOptions || [])) didReleasePack = true;
      const value = Math.max(1, Number(persons) || 1);
      const exists = selected.some((so) => Number(so.optionId) === Number(optionId));
      const next = exists
        ? selected.map((so) => (Number(so.optionId) === Number(optionId) ? { ...so, cardPersons: value } : so))
        : [...selected, { optionId: Number(optionId), quantity: 1, totalPrice: 0, cardPersons: value }];
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
        // Served persons of that card option (specs/card-option-served-persons.md §3.2 rule 9): an
        // intent, never a price — the engine clamps it and decides whether to persist it.
        if (item.cardPersons != null) line.cardPersons = Number(item.cardPersons);
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
    if (!form.clientId && pendingClient) {
      setClientDialogMode('edit');
      setNewClient({ ...EMPTY_CLIENT, ...pendingClient });
      setNewClientCityOptions([]);
      setCreateClientOpen(true);
      return;
    }
    if (!form.clientId) return;
    setClientDialogMode('edit');
    setNewClient({ ...EMPTY_CLIENT, ...(selectedClient || {}) });
    setNewClientCityOptions([]);
    setCreateClientOpen(true);
    api.getClient(form.clientId).then((c) => { if (c) setNewClient({ ...EMPTY_CLIENT, ...c }); }).catch(() => {});
  };

  const handleSaveClient = async () => {
    if (newClientEmailError || newClientPhoneError) {
      await alert({ title: 'Client invalide', message: 'Format du mail ou du téléphone à corriger.' });
      return;
    }

    const payload = {
      ...newClient,
      address: [newClient.streetNumber, newClient.street].filter(Boolean).join(' ').trim(),
      phone: String(newClient.phone || '').trim(),
    };

    if (clientDialogMode === 'edit' && !form.clientId && pendingClient) {
      setPendingClient(pendingClient.allowDuplicate ? { ...payload, allowDuplicate: true } : payload);
      closeCreateClient();
      return;
    }

    if (clientDialogMode === 'edit' && form.clientId) {
      const updatedRow = await api.updateClient(form.clientId, payload);
      const updated = updatedRow && updatedRow.id ? updatedRow : { ...(selectedClient || {}), ...payload, id: form.clientId };
      setSelectedClient(updated);
      setClients(prev => prev.map(client => (client.id === updated.id ? updated : client)));
    } else {
      // specs/clients.md rule 12 — an email or phone already known: use that client, or — a couple or a
      // family sharing one phone — create a second one anyway (rule 14).
      const duplicate = await api.findDuplicateClient({ email: payload.email, phone: payload.phone }).catch(() => null);
      if (duplicate?.client) {
        const choice = await confirm({
          title: 'Client existant',
          message: duplicate.message,
          confirmLabel: 'Utiliser ce client',
          secondaryLabel: 'Créer quand même',
          cancelLabel: 'Modifier la saisie',
          confirmColor: 'primary',
        });
        if (!choice) return;
        if (choice === 'secondary') payload.allowDuplicate = true;
      }
      if (duplicate?.client && !payload.allowDuplicate) {
        const existing = await api.getClient(duplicate.client.id).catch(() => duplicate.client);
        setPendingClient(null);
        setForm(prev => ({ ...prev, clientId: existing.id }));
        setClients(prev => prev.some(client => client.id === existing.id) ? prev : [...prev, existing]);
        setClientSearchOpen(false);
        closeCreateClient();
        return;
      }
      if (!reservationId && !editingDevisId) {
        // specs/clients.md rule 13 — nothing is written until the stay is.
        setPendingClient(payload);
        setForm(prev => ({ ...prev, clientId: null }));
        setClientSearchOpen(false);
        closeCreateClient();
        return;
      }
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
        babyBeds: Number(form.babyBeds || 0),
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        offeredOptionIds: Array.from(offeredOptionIds),
        platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        refreshTouristTax,
        ...(editingReservationId ? { reservationId: editingReservationId } : {}),
        // A saved devis locks its prices while it is still valid — the server replays its stored
        // lines so this preview equals what the save will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
        ...(editingDevisId ? { devisId: editingDevisId } : {}),
      }),
      api.getReservations({ propertyId: nextPropertyId, view: 'occupancy' }),
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
      cautionAmount: prop?.defaultCautionAmount ?? 0,
      checkInTime: prev.checkInTime || calc.defaultCheckIn || prop?.defaultCheckIn || '15:00',
      checkOutTime: prev.checkOutTime || calc.defaultCheckOut || prop?.defaultCheckOut || '10:00',
    }));
    // specs/per-property-default-options.md rule 11 — the offered set belongs to the option list just
    // cleared: kept, the previous logement's « offert » defaults would make the same option free here.
    setOfferedOptionIds(new Set());

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
        const message = `Impossible : le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h de ménage). Heure d'arrivée possible à partir de ${availH}:${availM}.`;
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
    if (!selectedProp || !startDate || !endDate || isClosedFiche) return null;
    const excludeId = editingReservationId || excludeReservationIdForDevis;
    return getRangeOccupancyConflictInfo({
      startDate,
      endDate,
      occupiedDates,
      reservations,
      excludeReservationId: excludeId,
    });
  }, [selectedProp, occupiedDates, editingReservationId, excludeReservationIdForDevis, reservations, isClosedFiche]);

  // ==================== SAVE & DELETE ====================
  const refreshToCurrentPricing = async () => {
    if (isReservationLocked) return;
    if (!editingReservationId && !isDevisMode) return;
    const proceed = await confirm({
      title: 'Actualiser les tarifs',
      message: isDevisMode
        ? 'Recalculer ce devis avec les derniers tarifs en vigueur ? Le prix saisi manuellement sera réinitialisé.'
        : 'Recalculer cette réservation avec les derniers tarifs en vigueur ? Les anciens prix restent conservés tant que la fiche n\'est pas enregistrée.',
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
        babyBeds: Number(form.babyBeds || 0),
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        discountPercent: form.discountPercent,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        complementPaid: form.complementPaid,
        depositAmount: form.depositAmount,
        depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
        // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
        // every save, so the preview, the fiche total and the stored amount can never disagree.
        complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
        balanceAmount: form.balanceAmount,
        depositDisabled: Boolean(form.depositDisabled),
        selectedOptions: buildSelectedOptionsPayload(),
        customOptions: buildCustomOptionsPayload(),
        selectedResources: buildSelectedResourcesPayload(),
        offeredOptionIds: Array.from(offeredOptionIds),
        platform: form.platform,
        touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
        autoOptionsInComplement: form.autoOptionsInComplement || [],
        refreshTouristTax,
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

  const handleSaveReservation = async (afterSaveAction = null, forceMinNights = false, forceCapacity = false, forceChangeover = false, forceMaxNights = false, forceOverpayment = false) => {
    const safeAfterSaveAction = typeof afterSaveAction === 'function' ? afterSaveAction : null;
    
    if (!selectedProp) {
      await alert({ title: 'Erreur', message: 'Logement à sélectionner.' });
      return false;
    }

    if (!form.startDate || !form.endDate) {
      await alert({ title: 'Erreur', message: 'Dates à sélectionner.' });
      return false;
    }

    if (!form.clientId && !pendingClient) {
      await alert({ title: 'Erreur', message: 'Client à sélectionner.' });
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
      && isPlacementUnchanged({ loadedProp: loadedSnapshot.selectedProp, loadedForm, selectedProp, form }));
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
        message: `Le nombre de personnes dépasse la capacité configurée (${capacityParts.join(' • ')}). Forcer l'enregistrement ?`,
        confirmLabel: 'Forcer l\'enregistrement',
        cancelLabel: 'Annuler',
        confirmColor: 'warning',
      });
      if (proceed) {
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, true, forceChangeover, forceMaxNights, forceOverpayment);
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
        babyBeds: Number(form.babyBeds || 0),
        extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
        discountPercent: form.discountPercent,
        customPrice: form.customPrice,
        depositPaid: form.depositPaid,
        balancePaid: form.balancePaid,
        complementPaid: form.complementPaid,
        depositAmount: form.depositAmount,
        depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
        // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
        // every save, so the preview, the fiche total and the stored amount can never disagree.
        complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
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
        refreshTouristTax,
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
          message: `Cette réservation contient ${quote.nights} nuit(s), inférieur au minimum requis de ${quote.requiredMinNights} nuit(s). Forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity, forceChangeover, forceMaxNights, forceOverpayment);
      }

      // specs/tariff-recipes/spec.md §3.4 rule 23 — changeover breach: same confirm + force-override
      // pattern as the minimum-nights guard just above.
      if (quote.changeoverBreached && !forceChangeover) {
        const parts = [];
        if (quote.changeoverArrivalBreached) parts.push(`une arrivée le ${quote.requiredArrivalDayLabel}`);
        if (quote.changeoverDepartureBreached) parts.push(`un départ le ${quote.requiredDepartureDayLabel}`);
        const proceed = await confirm({
          title: 'Jour de changement non respecté',
          message: `Ces dates imposent ${parts.join(' et ')}. Forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, true, forceMaxNights, forceOverpayment);
      }

      // specs/tariff-recipes/spec.md §3.4 rule 20bis — maximum stay, mirror of the minimum guard.
      if (quote.maxNightsBreached && !forceMaxNights) {
        const proceed = await confirm({
          title: 'Durée maximale dépassée',
          message: `Cette réservation contient ${quote.nights} nuit(s), au-delà du maximum autorisé de ${quote.requiredMaxNights} nuit(s). Forcer l'enregistrement ?`,
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, forceChangeover, true, forceOverpayment);
      }

      if (isDevisMode) {
        const devisPayload = {
          propertyId: Number(selectedProp),
          clientId: form.clientId,
          ...(!form.clientId && pendingClient && !editingDevisId ? { newClient: pendingClient } : {}),
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
        refreshTouristTax,
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
          const savedDevis = await api.updateDevis(editingDevisId, {
            ...devisPayload,
            loadedUpdatedAt: overwriteOnceRef.current ? undefined : (loadedUpdatedAtRef.current || undefined),
          });
          if (overwriteOnceRef.current) loadedUpdatedAtRef.current = savedDevis?.updatedAt || null;
          overwriteOnceRef.current = false;
          if (savedDevis?.retiredPaymentLinks) showSuccess('Devis enregistré. Le lien de paiement en cours est retiré : le montant a changé.');
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
          ...unlockPayload,
          loadedUpdatedAt: overwriteOnceRef.current ? undefined : (loadedUpdatedAtRef.current || undefined),
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
        refreshTouristTax,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
          // every save, so the preview, the fiche total and the stored amount can never disagree.
          complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
          endOfStayComplementAmountOverride: form.endOfStayComplementAmountOverride === '' ? null : Number(form.endOfStayComplementAmountOverride),
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
          platformTouristTaxAmount: form.platformTouristTaxAmount === '' ? null : form.platformTouristTaxAmount,
          cautionAmount: form.cautionAmount,
          // specs/reservation-payment-ledger.md rule 13 — the caution columns are not sent: only the
          // payment PATCH changes them. Rule 23 — the ledger edit this save carries, for the history.
          ledgerAmountEdit: ledgerEditMarkerRef.current || undefined,
          notes: form.notes,
          refreshPricingToCurrent: useCurrentPricing,
          forceMinNights,
          forceCapacity,
          forceChangeover,
          forceMaxNights,
          forceOverpayment,
          offeredOptionIds: Array.from(offeredOptionIds),
          options: buildSelectedOptionsPayload(),
          customOptions: buildCustomOptionsPayload(),
          resources: quote.resourceLines,
        });
        setInitialSnapshot(formSnapshot);
        const overwritten = overwriteOnceRef.current;
        overwriteOnceRef.current = false;
        ledgerEditMarkerRef.current = null;
        // Rule 7 — the stored ledger is what the fiche shows once clean again: re-read it after a save.
        api.getReservation(reservationId).then((r) => { if (overwritten) loadedUpdatedAtRef.current = r.updatedAt || null; setStoredLedger(r.ledger || null); setStoredHeadline(r.storedHeadline || null); setStoredSummary(r.storedSummary || null); setStoredDepositDisabledLockedReason(r.depositDisabledLockedReason || null); setInstallmentPlan(r.installmentPlan || null); }).catch(() => {});
        if (safeAfterSaveAction) {
          safeAfterSaveAction();
          // The page stays open: refetch so the server's `editLock` (floors, window) is fresh. Only on a
          // locked fiche: elsewhere the after-save action is the ledger's mark, whose form must stay
          // open to show a refusal (specs/reservation-payment-ledger.md rules 9-10) — a full reload
          // would close it — and a locked fiche never saves whole to mark a payment.
          if (isReservationLocked) setReloadToken((token) => token + 1);
        } else {
          navigateBackWithFrom(navigate, buildBackUrlWithReservationFocus());
        }
        return true;
      } else {
        await api.createReservation({
          ...unlockPayload,
          propertyId: Number(selectedProp),
          clientId: form.clientId,
          ...(!form.clientId && pendingClient ? { newClient: pendingClient } : {}),
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
        refreshTouristTax,
          totalPrice: quote.totalPrice,
          discountPercent: form.discountPercent,
          finalPrice: quote.finalPrice,
          customPrice: form.customPrice,
          extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
          depositAmount: quote.depositAmount,
          depositDueDate: quote.depositDueDate,
          // Manual deposit override (specs/editable-deposit-amount.md): '' → null = automatic.
          depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
          // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and
          // every save, so the preview, the fiche total and the stored amount can never disagree.
          complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
          endOfStayComplementAmountOverride: form.endOfStayComplementAmountOverride === '' ? null : Number(form.endOfStayComplementAmountOverride),
          balanceAmount: quote.balanceAmount,
          balanceDueDate: quote.balanceDueDate,
          platformCommissionAmount: form.platformCommissionAmount === '' ? null : form.platformCommissionAmount,
          acompteCommissionAmount: form.acompteCommissionAmount === '' ? null : form.acompteCommissionAmount,
          platformGrossAmount: form.platformGrossAmount === '' ? null : form.platformGrossAmount,
          platformPayoutAmount: form.platformPayoutAmount === '' ? null : form.platformPayoutAmount,
          platformTouristTaxAmount: form.platformTouristTaxAmount === '' ? null : form.platformTouristTaxAmount,
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
          message: err.message || 'La durée minimale configurée pour cette saison n\'est pas respectée. Forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          return await handleSaveReservation(safeAfterSaveAction, true, forceCapacity, forceChangeover, forceMaxNights, forceOverpayment);
        }
        return false;
      }
      if (err?.code === 'CHANGEOVER' && !forceChangeover) {
        const proceed = await confirm({
          title: 'Jour de changement non respecté',
          message: err.message || 'Le jour d\'arrivée ou de départ imposé pour ces dates n\'est pas respecté. Forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, true, forceMaxNights, forceOverpayment);
        }
        return false;
      }
      // specs/reservation-refunds.md rule 34 — the save would leave more collected than the stay now
      // costs. Confirmed, it is saved, the fiche stays open and the refund dialog opens on the amount.
      if (err?.code === 'OVERPAID' && !forceOverpayment) {
        const proceed = await confirm({
          title: 'Trop-perçu',
          message: err.message || 'Le nouveau total est inférieur au montant encaissé.',
          confirmLabel: 'Enregistrer et rembourser',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) return false;
        return await handleSaveReservation(
          safeAfterSaveAction || (() => openOverpaymentRefund(Number(err.overpaymentTtc || 0), err.overpaymentLines, err.overpaymentMethod)),
          forceMinNights, forceCapacity, forceChangeover, forceMaxNights, true,
        );
      }
      if (err?.code === 'MAX_NIGHTS' && !forceMaxNights) {
        const proceed = await confirm({
          title: 'Durée maximale dépassée',
          message: err.message || 'La durée maximale configurée pour cette saison est dépassée. Forcer l\'enregistrement ?',
          confirmLabel: 'Forcer l\'enregistrement',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (proceed) {
          return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, forceChangeover, true, forceOverpayment);
        }
        return false;
      }
      if (err?.code === 'STALE_FICHE') {
        overwriteOnceRef.current = false;
        const choice = await confirm({
          title: 'Fiche modifiée entre-temps',
          message: 'Recharger efface la saisie en cours. Enregistrer écrase la version à jour.',
          confirmLabel: 'Recharger',
          secondaryLabel: 'Enregistrer quand même',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (choice === true) setReloadToken((token) => token + 1);
        if (choice === 'secondary') {
          overwriteOnceRef.current = true;
          try {
            return await handleSaveReservation(safeAfterSaveAction, forceMinNights, forceCapacity, forceChangeover, forceMaxNights, forceOverpayment);
          } finally {
            overwriteOnceRef.current = false;
          }
        }
        return false;
      }
      await alert({ title: 'Erreur', message: err.message });
      // The end-of-stay complement was collected elsewhere while this fiche was open: reload it so the
      // extras card shows its locked state (specs/mid-stay-extras-on-locked-fiche.md).
      if (err?.code === 'MID_STAY_EXTRAS_CLOSED') setReloadToken((token) => token + 1);
      return false;
    }
  };

  const handleDeleteReservation = async () => {
    if (!reservationId) return;
    const isLockedReservation = Boolean(existingReservationLocked && !pastUnlocked);
    if (isLockedReservation) {
      await alert({
        title: 'Suppression impossible',
        message: 'Cette réservation n\'est plus modifiable. Seules les réservations à venir peuvent être modifiées.',
      });
      return;
    }
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Supprimer cette réservation ? Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteReservation(reservationId, { unlockPast: pastUnlocked });
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
        message: [
          result?.retainedDepositAmount > 0
            ? `Les dates sont remises à la vente. L'acompte de ${formatCurrency(result.retainedDepositAmount)} est conservé à titre d'indemnité (hors TVA).`
            : 'Les dates sont remises à la vente. Aucun acompte n\'avait été encaissé : rien n\'est conservé.',
          // specs/plugins-phase-3a-online-payment.md rule 9 — worded by the server.
          result?.paymentLinksWarning,
          // specs/email-language-fr-en.md rule 12 — the notice asked for and not sent, worded by the server.
          result?.emailWarning,
        ].filter(Boolean).join(' '),
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
    setStoredLedger(res.ledger || null);
    // The sold lines moved with the write (specs/reservation-refunds.md rule 43): the refund dialog reads them.
    setRefundRegister({
      refunds: res.refunds || [],
      refundableLines: res.refundableLines || [],
      refundTotals: res.refundTotals || { book: 0, withCash: 0 },
      collectedTtc: Number(res.collectedTtc || 0),
    });
    // specs/qonto-bank-reconciliation.md rule 39 — the plugins' blocks follow a write that moved the money.
    setPluginBlocks(res.pluginBlocks || {});
    setStoredHeadline(res.storedHeadline || null);
    setStoredSummary(res.storedSummary || null);
    setStoredDepositDisabledLockedReason(res.depositDisabledLockedReason || null);
    setInstallmentPlan(res.installmentPlan || null);
    const serverWritten = {
      // L'état d'encaissement du complément d'arrivée est écrit par le serveur (les boutons de la
      // carte le PATCHent immédiatement) : le relire ici évite que le formulaire et la base ne
      // divergent, ce qui faisait échouer la fusion des cartes après un dé-marquage.
      complementPaid: Boolean(res.complementPaid),
      complementPaidDate: res.complementPaidDate || '',
      complementPaidCash: Boolean(res.complementPaidCash),
      // specs/single-payment-from-the-fiche.md rule 11bis — les deux échéances du séjour aussi.
      // « Encaisser en une fois » les marque payées côté serveur ; sans ce rafraîchissement le
      // formulaire gardait « non payé », l'affichage retombait dessus au premier re-rendu, et
      // l'enregistrement suivant renvoyait la valeur périmée — ce qui dissolvait le paiement unique.
      depositPaid: Boolean(res.depositPaid),
      depositPaidDate: res.depositPaidDate || '',
      depositPaidCash: Boolean(res.depositPaidCash),
      balancePaid: Boolean(res.balancePaid),
      balancePaidDate: res.balancePaidDate || '',
      balancePaidCash: Boolean(res.balancePaidCash),
      endOfStayComplementAmount: Number(res.endOfStayComplementAmount || 0),
      endOfStayComplementPaid: Boolean(res.endOfStayComplementPaid),
      endOfStayComplementPaidDate: res.endOfStayComplementPaidDate || '',
      endOfStayComplementPaidCash: Boolean(res.endOfStayComplementPaidCash),
      endOfStayComplementDetail: res.endOfStayComplementDetail || null,
      midStaySettledNotes: res.midStaySettledNotes || null,
      arrivalPayment: res.arrivalPayment || null,
      checkoutComplement: res.checkoutComplement || null,
      complementDeferredToCheckout: Boolean(res.complementDeferredToCheckout),
      // specs/reservation-payment-ledger.md — the caution is written by the PATCH only (rule 13), and
      // the ledger as stored (rule 1).
      cautionReceived: Boolean(res.cautionReceived),
      cautionReceivedDate: res.cautionReceivedDate || '',
      cautionReturned: Boolean(res.cautionReturned),
      cautionReturnedDate: res.cautionReturnedDate || '',
      cautionAmount: res.cautionAmount,
      platformPayoutAmount: res.platformPayoutAmount == null ? '' : res.platformPayoutAmount,
      platformCommissionAmount: res.platformCommissionAmount == null ? '' : res.platformCommissionAmount,
      // Rule 35 — undoing a received acompte freezes it server-side: the form must carry it on.
      depositAmountOverride: res.depositAmountOverride === '' || res.depositAmountOverride == null ? '' : Number(res.depositAmountOverride),
      endOfStayComplementAmountOverride: res.endOfStayComplementAmountOverride == null ? '' : res.endOfStayComplementAmountOverride,
      endOfStayComplementAmountAuto: Number(res.endOfStayComplementAmountAuto || 0),
      complementAdjustment: res.complementAdjustment || null,
    };
    if (!isDirtyRef.current) resnapshotAfterQuoteRef.current = { quote: pricingQuoteRef.current };
    setForm((prev) => ({ ...prev, ...serverWritten }));
    // Review of #727 (H2) — what the server just wrote is not an edit of the operator: the clean
    // baseline moves with it, so a mark never makes the fiche « modified ».
    // Both baselines: the frozen one (once the first quote has landed) and the loaded form the baseline is
    // derived from before that — whichever is current moves with what the server wrote.
    const withServerWritten = (prevSnapshot) => {
      if (!prevSnapshot) return prevSnapshot;
      try {
        const snap = JSON.parse(prevSnapshot);
        return JSON.stringify({ ...snap, form: { ...snap.form, ...serverWritten } });
      } catch { return prevSnapshot; }
    };
    setInitialSnapshot(withServerWritten);
    setLoadedSnapshot(withServerWritten);
    // Le devis live dépend de l'état serveur qu'on vient de changer (report du complément, note
    // encaissée / ajustée) : sans ce rafraîchissement, le panneau de droite garderait l'ancien split
    // pendant que la carte affiche déjà le nouveau (specs/defer-arrival-complement-to-checkout.md
    // §3.3 rule 16).
    setRefundsVersion((v) => v + 1);
  }, [editingReservationId]);

  // ── specs/reservation-payment-ledger.md — the ledger's round-trips ───────────────────────────────
  // Rule 21 — the amount editor asks the live quote; the server answers the refusal or the effects.
  const checkLedgerEdit = useCallback(async (row, amount) => {
    if (!lastQuoteBodyRef.current) return { ok: false, reason: 'Calcul en cours : réessayer.' };
    const quote = await api.calculatePrice({ ...lastQuoteBodyRef.current, ledgerEdit: { row, amount }, unlockPast: pastUnlocked });
    return quote.ledgerEdit || { ok: false, reason: 'Calcul impossible.' };
  }, [pastUnlocked]);
  // « Valider » applies the server's form fields verbatim; the save traces it (rule 23).
  const applyLedgerPatch = useCallback((patch) => {
    const { ledgerAmountEdit, ...fields } = patch || {};
    if (ledgerAmountEdit) ledgerEditMarkerRef.current = ledgerAmountEdit;
    if (Object.keys(fields).length > 0) setForm((prev) => ({ ...prev, ...fields }));
  }, []);

  // Rule 10 — a mark saves the fiche first only when the operator changed something, so it is never
  // recorded against an amount the server has not stored, and never forces a re-pricing on its own.
  const markFromLedger = (body) => new Promise((resolve) => {
    const action = async () => {
      try {
        const answer = await api.markPayment(editingReservationId, body);
        await reloadReservationFinance();
        // Rule 37 — recorded, but its accounting split falls back to the stored amounts.
        if (answer && answer.warning) showSuccess(answer.warning);
        resolve({ ok: true });
      } catch (err) {
        if (err && err.code === 'AMOUNT_CHANGED') await reloadReservationFinance();
        resolve({ ok: false, error: err?.message || 'Enregistrement impossible.', field: err?.field || null });
      }
    };
    if (!isDirty) { action(); return; }
    // A locked fiche is never saved whole to record a payment (review of #727, B1): the operator
    // saves or cancels his edits first.
    if (isReservationLocked) {
      resolve({ ok: false, error: 'Fiche modifiée : enregistrer ou annuler les modifications avant de marquer un paiement.' });
      return;
    }
    Promise.resolve(handleSaveReservation(action)).then((saved) => { if (saved === false) resolve({ ok: false }); });
  });

  // Rule 28 — « Renvoyer la demande » on a still-due row whose link was retired.
  const resendPaymentRequest = async (type) => {
    try {
      const r = await api.sendPaymentRequestOfType(editingReservationId, type);
      showSuccess(`Demande envoyée — lien de paiement de ${formatCurrency(Number(r.amountCents || 0) / 100)} envoyé à ${r.recipientEmail || 'le client'}.`);
      await reloadReservationFinance();
    } catch (e) {
      showError(e.message || 'Envoi impossible.');
    }
  };

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

  // specs/reservation-refunds.md rule 34 — after a save confirmed over a trop-perçu: re-read the paid
  // state and open the refund dialog on the amount the server announced.
  const openOverpaymentRefund = useCallback(async (overpaymentTtc, overpaymentLines, method) => {
    await reloadReservationFinance();
    if (overpaymentTtc > 0) setRefundDialogOpen({ overpaymentTtc, overpaymentLines: Array.isArray(overpaymentLines) ? overpaymentLines : null, method: method || undefined });
  }, [reloadReservationFinance]);

  const createRefund = useCallback(async (payload) => {
    const res = await api.createReservationRefund(editingReservationId, payload);
    applyRefundPayload(res);
    // The stored ledger moved with the refund (the trop-perçu row, the « Remboursement » row): re-read it, or a
    // second click refunds the same money again.
    await reloadReservationFinance().catch(() => {});
  }, [editingReservationId, applyRefundPayload, reloadReservationFinance]);

  const deleteRefund = useCallback(async (refundId) => {
    try {
      applyRefundPayload(await api.deleteReservationRefund(editingReservationId, refundId));
      await reloadReservationFinance();
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible de supprimer ce remboursement.' });
    }
  }, [editingReservationId, applyRefundPayload, reloadReservationFinance, alert]);

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

  if (notFound) {
    return (
      <Box>
        <PageActionBar title={isDevisMode ? 'Devis' : 'Réservation'} onBack={() => navigateBack(navigate, isDevisMode ? '/devis' : DEFAULT_BACK_PATH)} />
        <EmptyState
          icon={<SearchOffIcon />}
          title={isDevisMode ? 'Devis introuvable.' : 'Réservation introuvable.'}
          message="Le lien est périmé ou la fiche a été supprimée."
          actionLabel={isDevisMode ? 'Retour aux devis' : 'Retour au planning'}
          onAction={() => navigate(isDevisMode ? '/devis' : DEFAULT_BACK_PATH, { replace: true })}
        />
      </Box>
    );
  }

  if (initError) {
    return (
      <Box>
        <PageActionBar title="Réservation" onBack={() => navigateBack(navigate)} />
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
    ledgerEditMarkerRef.current = null;
    if (isDevisMode) {
      requestLeave(() => navigateBack(navigate, '/devis'));
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
      message: 'Créer un devis à partir de cette réservation ? La réservation actuelle ne sera pas modifiée.',
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
        message: 'En acceptant ce devis, il sera enregistré puis converti en réservation (les dates seront bloquées). Continuer ?',
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

  // Online payments (specs/online-payments-qonto.md §3.4): create + open the payment link for this
  // devis, then offer to poll for the payment (which converts the devis on success). What is asked
  // for — acompte or paiement intégral — is decided by the server and echoed back
  // (specs/deposit-blocks-the-dates.md rules 10 + 12).
  const handleSendPaymentRequest = async () => {
    if (!editingDevisId) {
      await alert({ title: 'Devis à enregistrer', message: 'Enregistrement requis avant la demande de paiement.' });
      return;
    }
    try {
      // Persist current edits first so the link amount matches what the fiche shows
      // (the server recomputes from the SAVED devis).
      const saved = await handleSaveReservation(() => {});
      if (!saved) return;
      // The server creates/reuses the provider's link AND emails it to the client in one action.
      const r = await api.sendPaymentRequestEmail(editingDevisId);
      const euros = formatCurrency(Number(r.amountCents || 0) / 100);
      const isDeposit = r.type === 'deposit';
      const check = await confirm({
        title: isDeposit ? 'Demande d’acompte envoyée ✓' : 'Demande de paiement envoyée ✓',
        message: `Un email avec le lien de paiement ${isDeposit ? 'de l’acompte' : 'du séjour'} (${euros}) a été envoyé à ${r.recipientEmail}. Le règlement bloquera les dates. Une fois payé : « Vérifier le paiement ».`,
        confirmLabel: 'Vérifier le paiement',
        cancelLabel: 'Fermer',
        confirmColor: 'primary',
      });
      if (check) await handleCheckDepositPayment();
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || `Impossible d’envoyer la demande de paiement (${onlinePayment?.label || 'paiement en ligne'} connecté ? email client renseigné ?).` });
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
      await alert({ title: 'Erreur', message: e.message || `Impossible d’envoyer la demande de solde (${onlinePayment?.label || 'paiement en ligne'} connecté ? email client renseigné ?).` });
    }
  };

  const handleCheckDepositPayment = async () => {
    try {
      const summary = await api.pollPayments();
      const conv = (summary.results || []).find((x) => Number(x.reservationId) === Number(editingDevisId) && x.status === 'paid');
      // The link type says what was actually collected — an acompte, or the whole stay on a
      // last-minute devis (specs/deposit-blocks-the-dates.md rule 12).
      const paidTitle = conv && conv.type === 'deposit' ? 'Acompte reçu ✓' : 'Paiement reçu ✓';
      if (conv && (conv.effect === 'converted' || conv.effect === 'already-converted')) {
        await alert({ title: paidTitle, message: 'Le devis a été converti en réservation (dates bloquées).' });
        navigate(`/reservations/${conv.reservationId}?from=${encodeURIComponent('/calendar')}`);
      } else if (conv) {
        await alert({ title: paidTitle, message: 'Le paiement est enregistré.' });
      } else {
        await alert({ title: 'Pas encore payé', message: 'Aucun paiement détecté pour ce devis. Lien pas encore réglé.' });
      }
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Vérification impossible.' });
    }
  };

  const handleDeleteDevis = async () => {
    if (!editingDevisId) return;
    const ok = await confirm({
      title: 'Supprimer le devis',
      message: 'Supprimer ce devis ? Cette action est irréversible.',
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
  const isReservationLocked = Boolean(reservationId && existingReservationLocked && !pastUnlocked);
  // specs/reservation-payment-ledger.md rules 7, 39 — the stored money (ledger and headline) until the
  // operator changes the fiche, never the live one on a locked fiche.
  const showLiveMoney = !storedLedger || (isDirty && !isReservationLocked);
  const headline = showLiveMoney ? pricingQuote?.headline : (storedHeadline || pricingQuote?.headline);
  // Rules 44-45 — while the stored ledger shows and today's quote differs from the stored money, the
  // pricing summary (desktop panel and phone sheet) is the stored one, whole: never live lines next to
  // stored totals. Without a difference the live summary already says the same.
  const showStoredSummary = !showLiveMoney && Boolean(storedSummary) && Boolean(pricingQuote?.storedDrift);
  const todayIso = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  // A new reservation dated in the past can only be recorded by an admin who unlocks it.
  const pastNewReservation = Boolean(!reservationId && !isDevisMode && form.startDate && form.startDate < todayIso);
  const lockedSectionSx = isReservationLocked ? { opacity: 0.55, pointerEvents: 'none' } : undefined;
  const extrasWindowOpen = Boolean(isReservationLocked && editLock?.extrasEditable);
  const arrivalLines = extrasWindowOpen ? (editLock.arrivalLines || {}) : NO_ARRIVAL_LINES;
  const frozenCustomOptionIds = extrasWindowOpen ? (editLock.frozenCustomOptionIds || []) : NO_FROZEN_CUSTOM_IDS;
  const isFrozenArrivalLine = (kind, line) => {
    if (kind === 'custom') return line.customOptionId != null && frozenCustomOptionIds.includes(Number(line.customOptionId));
    return Boolean(arrivalLines[kind === 'option' ? optionLineKey(line.optionId) : resourceLineKey(line.resourceId)]);
  };
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
  const displayableResources = [
    ...availableResources,
    ...frozenResources.filter((frozen) => !availableResources.some((r) => Number(r.id) === Number(frozen.id))),
  ].filter((resource) => {
    const name = String(resource?.name || '').toLowerCase();
    return !(name.includes('lit') && (name.includes('bébé') || name.includes('bebe')));
  });
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
  // specs/ui-review-2026-10-19-operations.md rule 20 — « prolonger » announces the new price and the
  // new schedule (the server's preview) before re-issuing the quote, then reloads the fiche from it.
  const handleExtendDevis = async () => {
    let preview;
    try {
      preview = await api.getDevisExtension(editingDevisId);
    } catch (e) {
      showError(e.message || 'Prolongation impossible.');
      return;
    }
    const ok = await confirm({
      title: 'Prolonger le devis',
      message: <DevisExtensionSummary preview={preview} unsavedChanges={isDirty} />,
      confirmLabel: 'Prolonger',
      confirmColor: 'primary',
    });
    if (!ok) return;
    try {
      const devis = await api.extendDevis(editingDevisId);
      setDevisValidity({
        validUntil: devis.validUntil || null,
        expired: Boolean(devis.expired),
        extendable: Boolean(devis.extendable),
        converted: devis.status === 'converted',
      });
      setReloadToken((token) => token + 1);
      showSuccess(`Devis prolongé jusqu'au ${displayDate(devis.validUntil)}.`);
    } catch (e) {
      showError(e.message || 'Prolongation impossible.');
    }
  };

  const devisValidityChip = (editingDevisId && devisValidity.validUntil && !devisValidity.converted) ? (
    <DevisValidityChip
      validUntil={devisValidity.validUntil}
      expired={devisValidity.expired}
      extendable={devisValidity.extendable}
      converted={devisValidity.converted}
      compact={downSm}
      onExtend={handleExtendDevis}
    />
  ) : null;

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

  const actionBarBefore = isClosedFiche ? [] : [
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
    // specs/online-payments-qonto.md §3.4 — generate + send the deposit payment link for this devis,
    // while a payment provider is ready (specs/plugins-phase-3a-online-payment.md rule 18).
    ...(onlinePayment && isDevisMode && editingDevisId
      ? [{ icon: <PaymentsIcon />, tooltip: 'Envoyer la demande de paiement', onClick: handleSendPaymentRequest, color: 'success' }] : []),
    // specs/public-online-deposit.md §3 rule 8 — send/re-send the balance link when the deposit was
    // collected online but the solde is still due (reservation, positive balance, not yet paid).
    // Réservation PLATEFORME exclue : le solde est encaissé par la plateforme et nous est reversé,
    // on ne le réclame jamais au client — envoyer ce lien serait une double demande de paiement.
    ...(onlinePayment && !isDevisMode && editingReservationId && !isPlatformReservation
      && !form.balancePaid && Number(pricingQuote?.balanceAmount || 0) > 0
      ? [{ icon: <RequestQuoteIcon />, tooltip: 'Envoyer la demande de solde', onClick: handleSendBalanceRequest, color: 'info' }] : []),
  ];

  // specs/calendar-property-parity.md rules 22, 24 — « Rétablir » a duplicate set aside; the server refuses
  // when its dates were booked since.
  const handleRestoreSuperseded = async () => {
    setRestoring(true);
    try {
      await api.restoreSupersededReservation(reservationId);
      setReloadToken((token) => token + 1);
      showSuccess('Réservation rétablie.');
    } catch (e) {
      showError(e.message || 'Rétablissement impossible.');
    } finally {
      setRestoring(false);
    }
  };

  const actionBarAfter = [
    // specs/payment-schedule-and-cancellation.md §3.5 rule 21 — cancelling from the fiche, for the
    // phone call that never turns into a payment. Direct channels only: a platform booking is
    // cancelled through the iCal alert flow (specs/cancellation-compensation.md).
    ...(!isDevisMode && reservationId && !isPlatformReservation && !isClosedFiche
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
    // specs/plugins-phase-p-productisation.md rule 45 — the server's « platform sale » answer.
    isPlatformSale: isPlatformReservation,
    // catalogs
    properties, propertyOptions, propertyOptionGroups, displayableResources,
    // stay
    selectedProp, handleReservationPropertyChange,
    miniCalendarStart, setMiniCalendarStart, miniVisibleDays, reservations,
    editingReservationId, handleMiniDateClick, centerMiniCalendarOnRange,
    arrivalMin, arrivalMax, departureMin, departureMax, handleManualDateInputChange,
    datesUnavailableForProperty, datesUnavailableMessage, minNightsState, minNightsWarning,
    liveTimeConflictState, liveTimeConflictMessage, defaultCheckInTime, defaultCheckOutTime,
    isReservationLocked, extrasWindowOpen, arrivalLines, frozenCustomOptionIds,
    refundHost: isCancelledReservation ? refundHost : null,
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
    // specs/tourist-tax-included-services-deduction.md rule 4 — the services included in the rate,
    // locked ON so they cannot be removed from the booking.
    lockedIncludedOptionIds,
    // extras
    quantityPersons, quantityNights, toDisplayedQuantity, toBaseQuantity, getQuantityMultiplier,
    setOptionEnabled, setOptionQuantity, setResourceEnabled, setResourceQuantity,
    addCustomOption, updateCustomOption, removeCustomOption,
    setOptionInComplement, setResourceInComplement, setAutoOptionInComplement,
    // Option-driven planning cards (specs/option-planning-card.md §3.2) — occurrence checklist.
    setOptionCardOccurrences,
    // specs/card-option-served-persons.md §3.2 — « Personnes servies » on a per-person card option.
    setOptionCardPersons,
    // Hourly-scheduled resource sessions (specs/resource-hourly-scheduling.md §3.2).
    setResourceSessions,
    // finance
    isDevisMode, reservationId, refreshToCurrentPricing,
    // Rule 45 — the brut card follows the stored summary when it shows.
    accommodationBasePriceDisplay: showStoredSummary && storedSummary.accommodationBase != null ? storedSummary.accommodationBase : accommodationBasePriceDisplay,
    pricingQuote,
    // The stored summary carries the stay's regime before the first live quote arrives.
    storedSummary,
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
    // specs/reservation-refunds.md rule 34 — the trop-perçu, computed by the server with the live quote.
    refundOverpaymentTtc: Number(pricingQuote?.overpaymentTtc || 0),
    refundOverpaymentLines: Array.isArray(pricingQuote?.overpaymentLines) ? pricingQuote.overpaymentLines : [],
    refundDialogOpen, setRefundDialogOpen, createRefund, deleteRefund,
    // specs/reservation-payment-ledger.md — the ledger (live quote first, the stored one until then)
    // and its round-trips.
    // Rule 7 (review of #727) — the stored ledger by default, the live one only once the operator has
    // changed the fiche, never on a locked one; a fiche never saved has only the live one.
    ledger: showLiveMoney ? (pricingQuote?.ledger || storedLedger) : storedLedger,
    checkLedgerEdit, applyLedgerPatch, markFromLedger, resendPaymentRequest,
    installmentPlan, setInstallmentPlan, fichePristine: !isDirty,
    // The live quote reads the stored payments afresh; the GET answers until it arrives.
    depositDisabledLockedReason: pricingQuote && pricingQuote.depositDisabledLockedReason !== undefined
      ? pricingQuote.depositDisabledLockedReason : storedDepositDisabledLockedReason,
    // specs/plugins-phase-3b-neat.md rule 16 — what plugins draw under an option line: their block,
    // its setter, and what they may need to know about the stay.
    pluginBlocks, setPluginBlock,
    pluginLineContext: {
      reservationId: editingReservationId,
      locked: Boolean(isReservationLocked),
      guestName: `${selectedClient?.firstName || ''} ${selectedClient?.lastName || ''}`.trim(),
    },
  };

  // « Prénom Nom · N° 6600000002 · 07/08 → 13/08 » — the bar's identity line below lg (rule 12).
  const stayIdentity = [
    `${selectedClient?.firstName || ''} ${selectedClient?.lastName || ''}`.trim(),
    form.reservationNumber ? `N° ${form.reservationNumber}` : '',
    form.startDate && form.endDate ? `${displayDate(form.startDate).slice(0, 5)} → ${displayDate(form.endDate).slice(0, 5)}` : '',
  ].filter(Boolean).join(' · ') || null;

  // Rule 50 — the stored amounts go through the very component the live quote does; the stored mode
  // leaves out the per-line controls (rule 52). The form carries the stored deposit and balance then.
  const pricingSummary = (
    <PricingSummary
      mode={showStoredSummary ? 'stored' : 'live'}
      topNotice={(
        <>
          <PricingNotices notices={pricingQuote?.notices} onAction={(action) => { if (action === 'refreshTouristTax') setTouristTaxRefreshRequested(true); }} />
          <PlatformPriceAlert check={pricingQuote?.platformPriceCheck} />
        </>
      )}
      quote={showStoredSummary ? storedSummary : pricingQuote}
      form={showStoredSummary ? {
        ...form,
        depositAmount: storedSummary.depositAmount,
        balanceAmount: storedSummary.balanceAmount,
        depositDueDate: storedSummary.depositDueDate,
        balanceDueDate: storedSummary.balanceDueDate,
      } : form}
      nightlyBreakdown={showStoredSummary ? storedSummary.nightlyBreakdown : nightlyBreakdown}
      offeredOptionIds={offeredOptionIds}
      propertyOptions={propertyOptions}
      availableResources={[...availableResources, ...frozenResources]}
      isIcalSource={isIcalSource}
      selectedProperty={selectedProperty}
      parsedTotalPrice={showStoredSummary ? null : parsedTotalPrice}
      accommodationDiscountedPriceDisplay={showStoredSummary ? storedSummary.accommodation : accommodationDiscountedPriceDisplay}
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
      routingLocked={extrasWindowOpen}
      isFrozenLine={isFrozenArrivalLine}
      isTouristTaxFrozen={isTouristTaxFrozen}
      onRefreshTouristTax={() => setTouristTaxRefreshRequested(true)}
    />
  );

  return (
    // Below lg the sticky total bar closes the page, flush with the bottom of the screen.
    <Box sx={{ pb: { xs: 0, lg: 4 } }}>
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
        // specs/review-2026-10-18-reservations.md rule 6 — at tablet width the centred client name
        // overlapped the title: it shows from lg only.
        centerFrom="lg"
        // specs/ui-review-2026-10-19-operations.md rule 12 — below lg, whose reservation is open.
        identity={stayIdentity}
        identityBelow="lg"
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
        onSave={isClosedFiche ? undefined : handleSaveClick}
        saveTooltip={isDevisMode ? 'Enregistrer le devis' : 'Enregistrer'}
        saveDisabled={saving || !(isDirty || touristTaxRefreshRequested)}
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
          // Two columns from lg only: at 900 px the form and the summary side by side overflowed the
          // page (specs/review-2026-10-18-reservations.md rule 6). minmax(0, …) lets a long value
          // ellipsise instead of widening the track.
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 320px' },
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
        {/* Banners of plugin modules, above everything the operator reads first
            (specs/gites-de-france-mail-intake.md §4.1). A plugin that changed the reservation asks
            for a reload through `onReservationChanged`. */}
        {editingReservationId && (
          <Slot
            name="reservation.banners"
            reservationId={editingReservationId}
            onReservationChanged={() => setReloadToken((token) => token + 1)}
          />
        )}
        {isSupersededReservation && (
          <Alert
            severity="warning"
            sx={{ mb: 1.5 }}
            action={isAdmin ? (
              <Button color="inherit" size="small" disabled={restoring} onClick={handleRestoreSuperseded}>Rétablir</Button>
            ) : undefined}
          >
            Doublon de la réservation{' '}
            {form.supersededByReservationId ? (
              <Link component="button" type="button" onClick={() => navigate(`/reservations/${form.supersededByReservationId}`)} sx={{ verticalAlign: 'baseline' }}>
                {form.supersededByReservationNumber ? `n° ${form.supersededByReservationNumber}` : `#${form.supersededByReservationId}`}
              </Link>
            ) : 'écartée'}
            .
          </Alert>
        )}
        {isReservationLocked && !isSupersededReservation && (
          <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1, mb: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Typography variant="body2" color="warning.main" sx={{ flex: 1 }}>
              {extrasWindowOpen ? MID_STAY_EXTRAS_BANNER : LOCKED_FICHE_BANNER}
            </Typography>
            {isAdmin && (
              <Button size="small" variant="outlined" color="warning" onClick={() => setPastUnlocked(true)}>
                Déverrouiller cette fiche
              </Button>
            )}
          </Box>
        )}
        {pastUnlocked && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Fiche déverrouillée : dates, logement et suppression sont modifiables. Le verrou revient dès la sortie de la fiche.
          </Alert>
        )}
        {pastNewReservation && isAdmin && !pastUnlocked && (
          <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1, mb: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Typography variant="body2" color="warning.main" sx={{ flex: 1 }}>
              L&apos;arrivée est dans le passé : pour enregistrer une réservation passée, déverrouillez la fiche.
            </Typography>
            <Button size="small" variant="outlined" color="warning" onClick={() => setPastUnlocked(true)}>
              Déverrouiller cette fiche
            </Button>
          </Box>
        )}

        {/* A closed fiche is shown, not edited: a disabled fieldset makes every field really read-only
            (keyboard included), not just unclickable. */}
        <Box
          component="fieldset"
          disabled={isClosedFiche}
          sx={{
            position: 'relative', border: 0, p: 0, m: 0, minWidth: 0,
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
                        // 35 px tall: a finger needs 44 (specs/ds-components.md rule 21, 2026-10-27 audit).
                        [COARSE_POINTER]: { minHeight: TOUCH_TARGET },
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
                    {/* What this guest is written to in, and where the booking came from
                        (specs/site-english-version.md §6). Both answer the same question at the
                        moment it is asked: before writing to them. */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
                      <LanguageBadge
                        lang={selectedClient.emailLanguage}
                        origin="fiche client — tous les e-mails partent dans cette langue"
                      />
                      {form.requestOrigin === 'public' && (
                        <Tooltip title="Demande de réservation reçue depuis le site internet">
                          <span>
                            <StatusBadge status="info" label="Site internet" icon={<LanguageIcon sx={{ fontSize: 14 }} />} />
                          </span>
                        </Tooltip>
                      )}
                      {/* specs/public-request-abuse-and-grouping.md rules 14, 21 — the guest wrote again after it was sent. */}
                      {form.publicUpdatedAfterSendAt && (
                        <Tooltip title="Le client a écrit depuis le site après l’envoi du devis : son message est dans les notes">
                          <span><StatusBadge status="warning" label="Message du client après envoi" /></span>
                        </Tooltip>
                      )}
                      <OriginBadge label={form.originLabel} detail={form.originDetail} />
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                      <Button size="small" variant="text" onClick={() => setClientSearchOpen(true)}>
                        Changer le client
                      </Button>
                      <Button size="small" variant="text" onClick={openCreateClient}>
                        + Créer un nouveau client
                      </Button>
                    </Box>
                    <PluginGate id={WEBSITE_BOOKING}><TermsAcceptanceLine block={cgvBlock} /></PluginGate>
                  </>
                ) : (
                  <>
                    <Autocomplete
                      options={clients}
                      getOptionLabel={(c) => c.id ? `${c.lastName} ${c.firstName} — ${c.email}` : ''}
                      value={clients.find(c => c.id === form.clientId) || null}
                      onInputChange={(_, val, reason) => { if (reason === 'input') setClientSearch(val); }}
                      onChange={(_, val) => { if (val) { setPendingClient(null); updateForm({ clientId: val.id }); setSelectedClient(val); setClientSearchOpen(false); } }}
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
              <Typography variant="sectionHeader" sx={{ mb: 2 }}>Plateforme</Typography>
              <FormControl fullWidth>
                <InputLabel id="reservation-platform-label">Plateforme</InputLabel>
                <Select labelId="reservation-platform-label" value={form.platform} label="Plateforme" onChange={(e) => updateForm({ platform: e.target.value })}>
                  {platformOptions.map(p => <MenuItem key={p} value={p}>{formatPlatformLabel(p)}</MenuItem>)}
                </Select>
              </FormControl>
            </CardContent>
          </Card>

          {hasExtrasSection && <ExtrasSection />}

          <FinanceSection />

          {/* Cards of plugin modules (specs/plugins-phase-1-sdk.md rule 13) — e.g. the key Sowel
              reported for this stay (specs/gate-access-sowel-connector.md §3.5 rule 26). */}
          <Slot
            name="reservation.cards"
            reservationId={editingReservationId}
            cardSx={formSectionCardSx}
            contentSx={formSectionContentSx}
            pluginBlocks={pluginBlocks}
            reloadFinance={reloadReservationFinance}
            formDirty={isDirty}
          />

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
        {isCancelledReservation && <Box ref={setRefundHost} sx={{ mt: 1 }} />}
        </Box>

        {/* Panneau latéral droit : Résumé des prix */}
        {pricingSummary}

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

      {/* specs/ui-review-2026-10-19-operations.md rules 10-11 — below lg the server's headline figure
          stays on screen and opens the full summary in a sheet (decision 6: « Vous percevez » for a
          platform stay). */}
      {headline && (
        <StickyTotalBar
          label={headline.label}
          amount={headline.amount}
          secondary={headline.secondary}
          sheetTitle="Résumé tarifaire"
          showBelow="lg"
          // The page padding of the app's main area (App.jsx): flush with the screen's edges and bottom.
          bleed={{ x: { xs: 1.5, sm: 2, md: 3 }, bottom: { xs: 2, md: 3 } }}
        >
          {pricingSummary}
        </StickyTotalBar>
      )}

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
