/**
 * ReservationSasDialog — guided check-in / check-out wizard (specs/arrival-departure-sas.md).
 *
 * Launched from the Planning (arrival card → mode 'arrival', departure row → mode 'departure').
 * A forward-only sequence of single-purpose pages; every page has « Quitter » (closes, writes
 * NOTHING). All decisions are accumulated in memory and committed in ONE call at the final recap.
 *
 * Props: { open, reservationId, mode: 'arrival'|'departure', onClose, onCommitted }
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Button, Box, Typography, Stack,
  CircularProgress, TextField, Link, Divider, Chip, Switch, useMediaQuery,
  LinearProgress, IconButton,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import WheatIcon from '../WheatIcon';
import BaguetteIcon from '../BaguetteIcon';
import CloseIcon from '@mui/icons-material/Close';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import LogoutIcon from '@mui/icons-material/Logout';
import DialpadIcon from '@mui/icons-material/Dialpad';
import SavingsIcon from '@mui/icons-material/Savings';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import HotTubIcon from '@mui/icons-material/HotTub';
import SasResourceSchedulingPage from './SasResourceSchedulingPage';
import KingBedIcon from '@mui/icons-material/KingBed';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import DryCleaningIcon from '@mui/icons-material/DryCleaning';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import FireExtinguisherIcon from '@mui/icons-material/FireExtinguisher';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import PeopleIcon from '@mui/icons-material/People';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import LockIcon from '@mui/icons-material/Lock';
import { useNavigate } from 'react-router';
import api from '../../api';
import { getPlatformColor, formatPlatformLabel } from '../../constants/platforms';
import ConfirmDialog from '../ConfirmDialog';
import OccurrenceGrid from '../OccurrenceGrid';
import LoadingState from '../LoadingState';
import ErrorAlert from '../ErrorAlert';
import { useToast } from '../DialogProvider';
import SasWeatherAlertPage from './SasWeatherAlertPage';
import OfferableLine from './OfferableLine';
import { formatCurrency, displayDate, displayDateLong } from '../../utils/formatters';
import { PRICE_TYPE_LABELS } from '../reservation/extrasLabels';
import { sasLockTitle, sasLockMessage } from '../../constants/receptionSasLock';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
// The real price of a stored end-of-stay line: what it is billed at, or what it WOULD be billed at
// once offered. The server stores that total verbatim (`originalAmount`), so there is no price to
// rebuild here — specs/sas-offer-complement-lines.md §3.1 rule 3.bis. The `qty × unitPrice` branch is
// only for rows written before that field shipped; production carries none (checked 2026-08-29).
const realOfStoredLine = (l) => (Number(l?.offered || 0) === 1
  ? round2(l.originalAmount != null ? l.originalAmount : (Number(l.qty) || 1) * Number(l.unitPrice || 0))
  : round2(l?.amount));

// French display for stepper values: integers as-is, halves with a comma (« 1,5 »).
function formatStepperValue(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

// Stepper for a labelled breakfast item (icon + label, no price). `step` defaults to 1
// (integer counts); bread uses 0.5 (half-baguette steps — spec sas-breakfast-bread-and-push.md).
// Module-level so it keeps a stable identity across parent re-renders (an inline component
// would remount on every keystroke/click and detach its DOM nodes mid-interaction).
function CountStepper({ icon, label, value, onChange, step = 1, min = 0, max = null }) {
  const snap = (v) => {
    const snapped = Math.max(min, Math.round((Number(v) || 0) / step) * step);
    return max != null ? Math.min(max, snapped) : snapped;
  };
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => onChange(snap(value - step))} disabled={value <= min} sx={{ minWidth: 36 }}>−</Button>
        <TextField value={formatStepperValue(value)} onChange={(e) => onChange(snap(String(e.target.value).replace(',', '.')))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
        <Button size="small" variant="outlined" onClick={() => onChange(snap(value + step))} disabled={max != null && value >= max} sx={{ minWidth: 36 }}>+</Button>
      </Stack>
    </Stack>
  );
}

// Mode accent colours for the header band + the big step icon (specs/arrival-departure-sas.md §6
// refonte) — from the « Maison » palette: warm ochre arrival / slate-blue departure.
const modeColorFor = (theme, mode) => (mode === 'arrival' ? theme.palette.warning.main : theme.palette.info.main);

// Short band title + the meaningful icon for each step.
function stepMeta(key, mode) {
  switch (key) {
    case 'intro': return { title: mode === 'arrival' ? 'Arrivée' : 'Départ', Icon: mode === 'arrival' ? MeetingRoomIcon : LogoutIcon };
    case 'portal': return { title: 'Portail', Icon: DialpadIcon };
    case 'caution':
    case 'cautionReport': return { title: 'Caution', Icon: SavingsIcon };
    case 'options': return { title: 'Prestations', Icon: RoomServiceIcon };
    case 'resourceScheduling': return { title: 'Planifier', Icon: HotTubIcon };
    case 'breakfast': return { title: 'Petit déjeuner', Icon: FreeBreakfastIcon };
    // specs/sas-breakfast-and-catering-upsell.md — the two sale steps at the end of the check-in.
    case 'breakfastSale':
    case 'breakfastMornings': return { title: 'Petit déjeuner', Icon: BakeryDiningIcon };
    case 'cateringAsk':
    case 'cateringItems': return { title: 'Restauration', Icon: RestaurantIcon };
    case 'linen':
    case 'linenItems': return { title: 'Linge de lit', Icon: KingBedIcon };
    case 'cleaning': return { title: 'Ménage', Icon: CleaningServicesIcon };
    case 'bathLinen': return { title: 'Linge de toilette', Icon: DryCleaningIcon };
    case 'missingAsk':
    case 'missingItems': return { title: 'Serviettes / draps', Icon: DryCleaningIcon };
    case 'keys': return { title: 'Clés', Icon: VpnKeyIcon };
    case 'cautionReturn': return { title: 'Retour caution', Icon: SavingsIcon };
    case 'extinguisher':
    case 'extinguisherItems': return { title: 'Extincteur', Icon: FireExtinguisherIcon };
    case 'weather': return { title: 'Alerte météo', Icon: ReportProblemIcon };
    case 'recap': return { title: 'Récapitulatif', Icon: FactCheckIcon };
    default: return { title: '', Icon: null };
  }
}

// Big centred step icon above the page content + a slightly larger body type scale (refonte §6).
function StepLayout({ Icon, color, children }) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'center' }}>
      {Icon && (
        <Box sx={{ width: 84, height: 84, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(color, 0.1), color, flexShrink: 0 }}>
          <Icon sx={{ fontSize: 48 }} />
        </Box>
      )}
      <Box sx={{ width: '100%', '& .MuiTypography-body1': { fontSize: '1.1rem' }, '& .MuiTypography-body2': { fontSize: '0.95rem' } }}>{children}</Box>
    </Stack>
  );
}

// Yes/No answer buttons with the shared SAS colour code (specs/arrival-departure-sas.md §6):
// the reassuring answer is white-on-blue and sits ON TOP, the problem answer is black-on-red below.
// `bad` is rendered first so the mobile column-reverse footer lands it BENEATH `good`.
function AnswerButtons({ goodLabel, onGood, badLabel, onBad }) {
  return (
    <>
      <Button variant="contained" color="error" sx={{ color: 'common.black' }} onClick={onBad}>{badLabel}</Button>
      <Button variant="contained" onClick={onGood}>{goodLabel}</Button>
    </>
  );
}

// Settlement mode on the recap page (specs/sas-recap-payment-buttons.md). A single-select set of
// buttons replacing the former « encaissé » + « caisse interne » checkboxes:
//   - 'card' → « CB / Chèque »   (encaissé, compta normale)
//   - 'cash' → « Payé en liquide » (caisse interne, hors compta)
//   - 'defer' → « En fin de séjour » (arrival only: leave unpaid → recalled at check-out)
// Clicking the active mode again clears it — on the arrival recap that falls back to 'defer' (the
// default) rather than to nothing, since an unsettled complement is collected at check-out anyway.
function PaymentModeButtons({ value, onChange, showDefer }) {
  const optButton = (key, label) => (
    <Button
      variant={value === key ? 'contained' : 'outlined'}
      color={key === 'defer' ? 'inherit' : 'primary'}
      onClick={() => onChange(value === key ? (showDefer ? 'defer' : null) : key)}
      sx={{ flex: 1, minHeight: 44 }}
    >
      {label}
    </Button>
  );
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }}>
      {optButton('card', 'CB / Chèque')}
      {optButton('cash', 'Payé en liquide')}
      {showDefer && optButton('defer', 'En fin de séjour')}
    </Stack>
  );
}

// Arrival / departure line in the SAS intro — same visual language as the planning cards:
// a coloured ARRIVÉE/DÉPART chip (FlightLand/FlightTakeoff) + the date + a time pill, left-aligned.
function IntroDateRow({ kind, date, time }) {
  const isArrival = kind === 'arrival';
  const bg = isArrival ? 'warning.main' : 'info.main'; // ochre arrival / slate departure (mode palette)
  const Icon = isArrival ? FlightLandIcon : FlightTakeoffIcon;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip
        icon={<Icon sx={{ fontSize: 16 }} />}
        label={isArrival ? 'ARRIVÉE' : 'DÉPART'}
        size="small"
        sx={{ height: 24, fontSize: 11, fontWeight: 800, color: 'common.white', bgcolor: bg, '& .MuiChip-icon': { ml: 1, mr: -0.25, color: 'common.white' } }}
      />
      <Typography variant="body1" sx={{ fontWeight: 600 }}>{displayDateLong(date)}</Typography>
      <Chip
        icon={<AccessTimeIcon sx={{ fontSize: 14 }} />}
        label={time}
        size="small"
        sx={{ height: 20, fontSize: 12, fontWeight: 800, borderRadius: 1.5, color: 'common.white', bgcolor: bg, '& .MuiChip-icon': { ml: 0.5, mr: -0.25, color: 'common.white' } }}
      />
    </Stack>
  );
}

export default function ReservationSasDialog({ open, reservationId, mode = 'arrival', onClose, onCommitted, canOpenReservation = true }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { showError } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [stepKey, setStepKey] = useState(null);

  // Decisions (in memory until commit)
  const [caution, setCaution] = useState(null);           // arrival: 'fait' | 'reporte'
  const [linenOk, setLinenOk] = useState(null);           // arrival linen verify: true | false
  const [missingBed, setMissingBed] = useState({});       // arrival: { itemId: qty }
  const [cleaningAdded, setCleaningAdded] = useState(false);
  // Hours the operator placed on real slots during this run. In-memory only until the single commit
  // at the recap (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 24).
  const [resourceBlocks, setResourceBlocks] = useState([]);
  // specs/sas-bath-linen-upsell.md — arrival bath-linen upsell: add it or not. Settlement (incl. « en
  // fin de séjour ») is chosen once, for the whole complement, on the recap — never at option selection.
  const [bathLinenAdded, setBathLinenAdded] = useState(false);
  const [cleaningOk, setCleaningOk] = useState(null);     // departure: true | false
  const [missingAsk, setMissingAsk] = useState(null);     // departure: true | false
  const [missingDep, setMissingDep] = useState({});       // departure: { itemId: qty }
  const [keysReceived, setKeysReceived] = useState(null); // departure
  const [cautionReturned, setCautionReturned] = useState(null); // departure
  const [extinguisherOk, setExtinguisherOk] = useState(true);   // fire-extinguisher — default GOOD CONDITION
  const [extinguisherQty, setExtinguisherQty] = useState({});   // departure: { repairKey: qty } when not OK
  // arrival breakfast page (specs/sas-breakfast-and-handover-note.md + sas-breakfast-milk-and-food.md
  // + sas-breakfast-bread-and-push.md — bread in half-baguette steps; the server pre-fills the
  // defaults while the SAS was never committed)
  const [breakfast, setBreakfast] = useState({ coffee: 0, tea: 0, chocolate: 0, milk: 0 });
  const [breakfastFood, setBreakfastFood] = useState({ pastries: 0, cereals: 0, bread: 0 });
  const [breakfastTime, setBreakfastTime] = useState('');
  const [breakfastNote, setBreakfastNote] = useState('');
  const [handoverNote, setHandoverNote] = useState(''); // arrival recap → shown at departure
  const [breakfastWarnOpen, setBreakfastWarnOpen] = useState(false);
  // specs/sas-breakfast-and-catering-upsell.md — prestations SOLD at the end of the check-in. The
  // server ships the offer (candidate mornings / moments, per-property prices); these hold the
  // operator's choice until the single commit, like every other SAS decision.
  const [breakfastSold, setBreakfastSold] = useState(false);
  const [breakfastMornings, setBreakfastMornings] = useState([]); // [{ date, time, slot, checked }]
  const [cateringWanted, setCateringWanted] = useState(null);     // true | false | null
  const [cateringUnits, setCateringUnits] = useState({});         // { [optionId]: billed units }
  // specs/card-option-served-persons.md §3.3 — covers served on each moment of a card option: the
  // whole party unless the operator says the children aren't eating.
  const [breakfastServed, setBreakfastServed] = useState(0);      // 0 until the offer is loaded
  const autoSeededFoodRef = useRef(null);                         // pre-fill still owned by the wizard
  const [cateringServed, setCateringServed] = useState({});       // { [optionId]: persons }
  const [cateringGrids, setCateringGrids] = useState({});         // { [optionId]: [{ date, time, slot, checked }] }
  // Re-edit (specs/reopen-completed-sas.md): complement lines from a PRIOR commit whose label no
  // longer maps to a priced item (renamed / deleted since) — carried verbatim into the re-commit so
  // they're never lost or duplicated.
  const [preservedArrival, setPreservedArrival] = useState([]);
  const [preservedDeparture, setPreservedDeparture] = useState([]);
  // specs/recall-unpaid-arrival-complement-at-checkout.md — explicit « encaissé » confirmations on the
  // recaps (+ caisse-interne flag). Arrival: settles the arrival complement. Departure: settles every
  // positive complement (end-of-stay + recalled arrival).
  // specs/sas-recap-payment-buttons.md — settlement mode on the recap page (single-select buttons).
  // Arrival: 'card' | 'cash' | 'defer', pre-selected on 'defer' (« En fin de séjour ») so not choosing
  // anything reads as « encaissé au check-out », which is what the commit already does.
  // Departure: null | 'card' | 'cash' (no defer at check-out).
  const [arrivalPayMode, setArrivalPayMode] = useState('defer');
  const [departurePayMode, setDeparturePayMode] = useState(null);
  // specs/sas-offer-complement-lines.md — the lines the operator offers on the recap (geste
  // commercial), as a set of line keys: `option:<id>` / `resource:<id>` / `custom:<id>` for the rows of
  // the complement, `bed:<itemId>` / `cleaning` / `bathLinen` for what the arrival SAS adds,
  // `dep:<itemId>` / `depCleaning` / `ext:<repairKey>` / `carried:<i>` for the check-out lines. In
  // memory until the single commit, like every other SAS decision.
  const [offered, setOffered] = useState(() => new Set());
  const toggleOffered = useCallback((key) => {
    setOffered((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // Weather alerts (specs/checkin-weather-alerts.md) — fetched in the background when the arrival SAS
  // opens; empty until (and unless) a qualifying Orange/Red vigilance overlaps the stay.
  const [weatherAlerts, setWeatherAlerts] = useState([]);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let cancelled = false;
    setLoading(true); setError(''); setData(null); setStepKey(null);
    setCaution(null); setLinenOk(null); setMissingBed({}); setCleaningAdded(false); setBathLinenAdded(false);
    setCleaningOk(null); setMissingAsk(null); setMissingDep({}); setKeysReceived(null); setCautionReturned(null); setExtinguisherOk(true); setExtinguisherQty({});
    setBreakfast({ coffee: 0, tea: 0, chocolate: 0, milk: 0 }); setBreakfastFood({ pastries: 0, cereals: 0, bread: 0 }); setBreakfastTime(''); setBreakfastNote(''); setHandoverNote(''); setBreakfastWarnOpen(false);
    setBreakfastSold(false); setBreakfastMornings([]); setCateringWanted(null); setCateringUnits({}); setCateringGrids({});
    setPreservedArrival([]); setPreservedDeparture([]);
    setArrivalPayMode('defer'); setDeparturePayMode(null);
    setWeatherAlerts([]); setOffered(new Set());
    // The mode is part of the QUESTION, not just of the rendering (specs/sas-departure-mode-param.md):
    // the server resolves « le ménage est-il déjà vendu ? » differently at check-in (where the SAS may
    // still undo its own upsell) and at check-out (where it can never be billed twice).
    api.getReservationSas(reservationId, mode)
      .then((d) => {
        if (cancelled) return;
        setData(d); setStepKey('intro');
        const res = d?.reservation || {};
        const b = d?.breakfast;
        if (b?.applicable) {
          setBreakfast({ coffee: Number(b.coffee) || 0, tea: Number(b.tea) || 0, chocolate: Number(b.chocolate) || 0, milk: Number(b.milk) || 0 });
          setBreakfastFood({ pastries: Number(b.pastries) || 0, cereals: Number(b.cereals) || 0, bread: Number(b.bread) || 0 });
          setBreakfastTime(b.time || '');
          setBreakfastNote(b.note || '');
        }
        // specs/sas-breakfast-and-catering-upsell.md §3.1-§3.2 — seed the two sale steps from the
        // server offer. A fresh check-in opens with every morning pre-selected (the natural upsell is
        // « le petit déjeuner pour tout le séjour ») and nothing pre-selected on the catering (a meal
        // is picked moment by moment). A SAS that already sold something reopens on its own choice.
        const sales = d?.sasSales;
        if (sales?.breakfast?.available) {
          const sold = sales.breakfast.selected || [];
          setBreakfastSold(sold.length > 0);
          setBreakfastServed(Number(sales.breakfast.selectedPersons) || Number(sales.breakfast.defaultPersons) || 0);
          setBreakfastMornings((sales.breakfast.mornings || []).map((m) => ({
            ...m,
            slot: m.slot ?? 0,
            checked: sold.length === 0 || sold.some((s) => s.date === m.date && String(s.time || '') === String(m.time || '')),
          })));
        }
        if (sales?.catering?.available) {
          const units = {}; const grids = {}; const served = {}; let anySold = false;
          for (const opt of (sales.catering.options || [])) {
            served[opt.optionId] = Number(opt.selectedPersons) || Number(opt.defaultPersons) || 0;
            if (opt.showsPlanningCard) {
              const sold = opt.selectedOccurrences || [];
              if (sold.length > 0) anySold = true;
              grids[opt.optionId] = (opt.occurrences || []).map((o) => ({
                ...o,
                slot: o.slot ?? 0,
                checked: sold.some((s) => s.date === o.date && String(s.time || '') === String(o.time || '')),
              }));
            } else {
              const sold = Number(opt.selectedUnits) || 0;
              if (sold > 0) anySold = true;
              units[opt.optionId] = sold;
            }
          }
          setCateringUnits(units); setCateringGrids(grids); setCateringServed(served);
          setCateringWanted(anySold ? true : null);
        }
        // specs/sas-offer-complement-lines.md §3.4 rule 13 — the gestes commerciaux already recorded on
        // the reservation reopen as « ✓ Offert », so they stay visible and undoable. Seeded whether or
        // not the SAS was committed: an offered extra may come from the fiche, or from the other SAS.
        const seed = new Set();
        if (mode === 'arrival') {
          for (const o of (res.options || [])) {
            if (Number(o.inComplement || 0) !== 1 || Number(o.offered || 0) !== 1) continue;
            if (Number(o.sasArrivalOrigin || 0) === 1) continue; // seeded below, on its own SAS key
            seed.add(Number(o.isCustom || 0) === 1 ? `custom:${o.customOptionId}` : `option:${o.optionId}`);
          }
          for (const rs of (res.resources || [])) {
            if (Number(rs.inComplement || 0) === 1 && Number(rs.offered || 0) === 1) seed.add(`resource:${rs.resourceId}`);
          }
        } else {
          // At check-out the recalled arrival lines arrive itemised with their `ref` — offered included.
          for (const l of ((d.arrivalComplement && d.arrivalComplement.detail) || [])) {
            if (Number(l.offered || 0) === 1 && l.ref) seed.add(`${l.ref.kind}:${l.ref.id}`);
          }
          let carried = [];
          try { carried = JSON.parse(res.endOfStayComplementDetail || '[]') || []; } catch { carried = []; }
          carried.filter((l) => l && l.source).forEach((l, i) => {
            if (Number(l.offered || 0) === 1) seed.add(`carried:${i}`);
          });
        }

        // Re-edit pre-fill (specs/reopen-completed-sas.md §2): a SAS already committed reopens with
        // every decision seeded from the persisted reservation. A fresh SAS keeps the blank defaults.
        const editing = mode === 'arrival' ? !!res.arrivalSasDoneAt : !!res.departureSasDoneAt;
        if (!editing) { setOffered(seed); return; }
        const sealToBool = (v) => (v == null ? true : Number(v) === 1);
        if (mode === 'arrival') {
          setCaution(res.cautionReceived ? 'fait' : null);
          // Reconstruct the settlement mode from the stored paid flags (specs/sas-recap-payment-buttons.md):
          // paid + cash → 'cash' (caisse interne); paid non-cash → 'card'; unpaid → 'defer' (an unpaid
          // complement IS collected at check-out, so it reopens on the same default as a fresh SAS).
          setArrivalPayMode(Number(res.complementPaid) === 1 ? (Number(res.complementPaidCash) === 1 ? 'cash' : 'card') : 'defer');
          setHandoverNote(res.departureHandoverNote || '');
          // Reconstruct the bed-linen complement + cleaning charge from the SAS-origin lines (§5).
          const bedByLabel = new Map((d.linenItems || []).filter((i) => i.category === 'bed').map((i) => [String(i.label), i]));
          const nextBed = {}; const keep = [];
          // specs/sas-upsells-activate-catalogue-option.md §3.2 rule 7 — the ménage and the linge de
          // toilette are now CATALOGUE options; the server says whether the row is the SAS's own, so
          // the step reopens pre-selected « ajouté » (and « Non merci » removes it).
          let nextCleaning = Boolean(d.cleaning?.sasOrigin);
          let nextBathLinen = Boolean(d.bathLinen?.sasOrigin);
          // An upsell the SAS sold and the operator offered reopens « ✓ Offert » on the recap.
          const sasUpsellRow = (type) => (res.options || []).find((o) => !o.isCustom
            && String(o.autoOptionType || '') === type && Number(o.sasArrivalOrigin || 0) === 1);
          if (Number(sasUpsellRow('cleaning')?.offered || 0) === 1) seed.add('cleaning');
          if (Number(sasUpsellRow('bathroom_linen')?.offered || 0) === 1) seed.add('bathLinen');
          (res.options || []).filter((o) => o.isCustom && Number(o.sasArrivalOrigin) === 1).forEach((o) => {
            const label = String(o.description || o.title || '');
            const amount = Number(o.unitPrice ?? o.amount ?? o.totalPrice ?? 0);
            const lineOffered = Number(o.offered || 0) === 1;
            const item = bedByLabel.get(label);
            if (item && Number(item.price) > 0) {
              nextBed[item.id] = Math.max(1, Math.round(amount / Number(item.price)));
              if (lineOffered) seed.add(`bed:${item.id}`);
            } else {
              if (lineOffered) seed.add(`preserved:${keep.length}`);
              keep.push({ label, amount });
            }
          });
          setMissingBed(nextBed); setCleaningAdded(nextCleaning); setBathLinenAdded(nextBathLinen); setPreservedArrival(keep);
          if (res.bedLinenAlert) setLinenOk(Object.keys(nextBed).length === 0);
        } else {
          setCautionReturned(res.cautionReturned ? true : false);
          setDeparturePayMode(Number(res.endOfStayComplementPaid) === 1 ? (Number(res.endOfStayComplementPaidCash) === 1 ? 'cash' : 'card') : null);
          setExtinguisherOk(sealToBool(res.extinguisherSealOkAtDeparture));
          let detail = [];
          try { detail = JSON.parse(res.endOfStayComplementDetail || '[]') || []; } catch { detail = []; }
          const byLabel = new Map((d.linenItems || []).map((i) => [String(i.label), i]));
          const nextDep = {}; const nextExtinguisher = {}; let charged = false; const keep = [];
          detail.forEach((line) => {
            const label = String(line.label || '');
            // specs/sas-bath-linen-upsell.md §3.3 — arrival-origin lines (tagged `source`) are carried +
            // displayed separately (carriedEndOfStayLines); skip them here so they aren't also duplicated
            // into preservedDeparture.
            if (line.source) return;
            // Extinguisher lines carry a repairKey → recomputed server-side from the quantities below.
            const lineOffered = Number(line.offered || 0) === 1;
            if (line.repairKey && String(line.repairKey).startsWith('extinguisher')) {
              nextExtinguisher[String(line.repairKey)] = Math.max(1, Number(line.qty) || 1);
              if (lineOffered) seed.add(`ext:${String(line.repairKey)}`);
              return;
            }
            if (label === 'Ménage de fin de séjour') {
              charged = true;
              if (lineOffered) seed.add('depCleaning');
              return;
            }
            const item = byLabel.get(label);
            if (item) {
              nextDep[item.id] = Number(line.qty) || Math.max(1, Math.round(Number(line.amount) / Number(item.price || 1)));
              if (lineOffered) seed.add(`dep:${item.id}`);
            } else {
              // specs/sas-offer-complement-lines.md §3.1 rule 3 — offering is lossless, so a preserved
              // line must come back with its REAL price, not the 0 € it is stored at. Same reader as
              // `carriedEndOfStayLines`. Quantity and unit price are carried too, so a re-commit
              // re-sends them instead of flattening the line to « 1 × 0 € ».
              if (lineOffered) seed.add(`preservedDep:${keep.length}`);
              keep.push({
                label,
                amount: realOfStoredLine(line),
                qty: Number(line.qty) || 1,
                unitPrice: Number(line.unitPrice) || 0,
              });
            }
          });
          setMissingDep(nextDep); setExtinguisherQty(nextExtinguisher); setPreservedDeparture(keep);
          // A stored « Ménage de fin de séjour » line billed before the cleaning was sold must not be
          // re-sent: with the page hidden the answer is forced back to « fait »
          // (specs/defer-arrival-complement-to-checkout.md §3.1 rule 4 — re-running the SAS is how an
          // over-billed stay is corrected).
          setCleaningOk(d.cleaning?.included ? true : !charged);
          setMissingAsk(Object.keys(nextDep).length > 0 ? true : null);
        }
        setOffered(seed);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Erreur de chargement.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reservationId, mode]);

  // Weather alerts (specs/checkin-weather-alerts.md) — background fetch on open, arrival SAS only.
  // Non-blocking: the wizard renders normally; the weather page appears (before recap) once/if the
  // response carries ≥1 alert. Any error degrades to no page.
  useEffect(() => {
    if (!open || !reservationId || mode !== 'arrival') return undefined;
    let cancelled = false;
    setWeatherAlerts([]);
    api.getReservationWeatherAlerts(reservationId)
      .then((res) => { if (!cancelled) setWeatherAlerts(Array.isArray(res?.alerts) ? res.alerts : []); })
      .catch(() => { if (!cancelled) setWeatherAlerts([]); });
    return () => { cancelled = true; };
  }, [open, reservationId, mode]);

  const r = data?.reservation;
  const modeColor = modeColorFor(theme, mode);
  // specs/reception-sas-today-only.md §3.3 rule 13 — the reception role reaches this dialog on a locked
  // SAS only through a deep-link (Dashboard row / push notification), since the planning ✓ is disabled
  // for them. The server resolves the reason and ships it in `receptionLock` (null for an admin); the
  // wizard then renders a short locked panel instead of the steps. The commit is refused server-side
  // regardless (403 SAS_LOCKED).
  const sasLock = data?.receptionLock ? data.receptionLock[mode] || null : null;
  // The date the sentence refers to: when the SAS was committed for 'done', the SAS day otherwise.
  const lockDateSource = (() => {
    if (!r) return null;
    if (sasLock === 'done') return mode === 'arrival' ? r.arrivalSasDoneAt : r.departureSasDoneAt;
    return mode === 'arrival' ? r.startDate : r.endDate;
  })();
  const lockDateLabel = (() => {
    const label = displayDate(String(lockDateSource || '').slice(0, 10));
    return label === '—' ? '' : label;
  })();
  const lockedTitle = sasLockTitle(mode, sasLock);
  const lockedMessage = sasLockMessage(mode, sasLock, lockDateLabel);
  const bedItems = useMemo(() => (data?.linenItems || []).filter((i) => i.category === 'bed'), [data]);
  const allItems = useMemo(() => (data?.linenItems || []), [data]);

  // Ordered list of active page keys, given the data + current decisions.
  const activeKeys = useMemo(() => {
    if (!data) return [];
    // Locked (reception on a committed SAS): no page at all — the body renders the locked panel and
    // the header drops its progress bar / « Précédent ».
    if (sasLock) return [];
    // On departure, the caution-RETURN step stays reachable when re-editing a completed SAS
    // (specs/reopen-completed-sas.md §3 rule 3), so a mis-marked return can be corrected.
    const isEditing = mode === 'arrival' ? !!r.arrivalSasDoneAt : !!r.departureSasDoneAt;
    const sales = data.sasSales || {};
    if (mode === 'arrival') {
      // Arrival caution is hidden as soon as it's received, even in re-edit (specs/sas-hide-settled-steps.md §3).
      const cautionStep = Number(r.cautionAmount || 0) > 0 && !r.cautionReceived;
      const hasOptions = (r.options || []).length > 0 || (r.resources || []).length > 0;
      return [
        'intro',
        data.portalCode ? 'portal' : null,
        cautionStep ? 'caution' : null,
        hasOptions ? 'options' : null,
        // Place the hours bought by the hour on real slots, right after the read-only prestations
        // list (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 17). Skipped once
        // everything is scheduled.
        data.resourceScheduling?.applicable ? 'resourceScheduling' : null,
        data.breakfast?.applicable ? 'breakfast' : null,
        r.bedLinenAlert ? 'linen' : null,
        (r.bedLinenAlert && linenOk === false) ? 'linenItems' : null,
        // Ménage step is hidden when the cleaning is already included (specs/sas-hide-settled-steps.md §3);
        // the vaisselle/poubelles reminder then moves to the recap.
        data.cleaning?.included ? null : 'cleaning',
        // specs/sas-bath-linen-upsell.md §3.1 — offer bath linen when the guest didn't take it.
        data.bathLinen?.available ? 'bathLinen' : null,
        // specs/sas-breakfast-and-catering-upsell.md §3.1 — the sale steps close the check-in: the
        // breakfast (offer → mornings → composition) then the « Restauration » catalogue.
        sales.breakfast?.available ? 'breakfastSale' : null,
        (sales.breakfast?.available && breakfastSold) ? 'breakfastMornings' : null,
        // Composing a breakfast sold in THIS run: a breakfast the guest had already booked keeps its
        // own page, higher up, so the key can never appear twice.
        (!data.breakfast?.applicable && sales.breakfast?.available && breakfastSold) ? 'breakfast' : null,
        sales.catering?.available ? 'cateringAsk' : null,
        (sales.catering?.available && cateringWanted === true) ? 'cateringItems' : null,
        (cautionStep && caution === 'reporte') ? 'cautionReport' : null,
        // Weather alert (specs/checkin-weather-alerts.md): last page before the recap, only when a
        // qualifying alert overlaps the stay.
        weatherAlerts.length > 0 ? 'weather' : null,
        'recap',
      ].filter(Boolean);
    }
    const cautionReturnStep = Number(r.cautionAmount || 0) > 0 && r.cautionReceived && (!r.cautionReturned || isEditing);
    return [
      'intro',
      // specs/defer-arrival-complement-to-checkout.md §3.1 rule 1 — the end-of-stay ménage page is
      // dropped when the cleaning is already sold (booked option, « Ménage » added at check-in, or
      // property default), exactly like the arrival one: the host does it, so there is nothing to
      // assess and nothing to bill. Otherwise a « Non » would charge the cleaning a second time.
      data.cleaning?.included ? null : 'cleaning',
      'missingAsk',
      missingAsk === true ? 'missingItems' : null,
      'keys',
      cautionReturnStep ? 'cautionReturn' : null,
      'extinguisher',
      extinguisherOk === false ? 'extinguisherItems' : null,
      'recap',
    ].filter(Boolean);
  }, [data, mode, r, linenOk, caution, missingAsk, extinguisherOk, weatherAlerts, sasLock,
    breakfastSold, cateringWanted]);

  const goNext = useCallback(() => {
    const i = activeKeys.indexOf(stepKey);
    if (i >= 0 && i < activeKeys.length - 1) setStepKey(activeKeys[i + 1]);
  }, [activeKeys, stepKey]);
  // Same forward move, but SKIPPING the pages the answer just closed. `activeKeys` is memoised on the
  // decisions, so it still lists them when the handler runs (the setState has not landed yet) and a
  // plain `goNext()` would land on a page about to disappear — a dead end, since the next `Suivant`
  // reads an index of -1. Used by the « Non merci » of the sale steps, which is the only case where
  // re-opening a committed SAS starts with those sub-pages already active.
  const goPast = useCallback((from, skipped) => {
    const i = activeKeys.indexOf(from);
    const next = activeKeys.slice(i + 1).find((key) => !skipped.includes(key));
    setStepKey(next || 'recap');
  }, [activeKeys]);
  // « Précédent » — go back one active page (specs/arrival-departure-sas.md §3.0; in-memory
  // decisions persist, so revisiting a page shows the prior answer).
  const goBack = useCallback(() => {
    const i = activeKeys.indexOf(stepKey);
    if (i > 0) setStepKey(activeKeys[i - 1]);
  }, [activeKeys, stepKey]);

  // ---- totals ----
  // specs/sas-offer-complement-lines.md §3.1 — every billable line carries `offerKey` (its identity in
  // the `offered` set) and `real` (the price it would be billed at). `amount` is what the total counts:
  // 0 € as soon as the line is offered. `isOffered` reads the live in-memory decision.
  const isOffered = useCallback((key) => Boolean(key) && offered.has(key), [offered]);
  const billed = useCallback((key, real) => (offered.has(key) ? 0 : round2(real)), [offered]);
  const bedLines = useMemo(() => bedItems
    .filter((it) => Number(missingBed[it.id]) > 0)
    .map((it) => {
      const real = round2(Number(it.price) * Number(missingBed[it.id]));
      return {
        label: it.label, unitPrice: Number(it.price) || 0, qty: Number(missingBed[it.id]),
        offerKey: `bed:${it.id}`, real, amount: billed(`bed:${it.id}`, real),
      };
    }), [bedItems, missingBed, billed]);
  const cleaningLine = (mode === 'arrival' && cleaningAdded && data?.cleaning?.price)
    ? {
      label: 'Ménage', unitPrice: round2(data.cleaning.price), qty: 1, offerKey: 'cleaning',
      real: round2(data.cleaning.price), amount: billed('cleaning', data.cleaning.price),
    } : null;
  // specs/sas-bath-linen-upsell.md §3.2 — adding the bath linen puts it in the arrival complement, like
  // the cleaning charge. Its settlement (incl. « en fin de séjour ») is chosen on the recap, not here.
  const bathLinenLine = (mode === 'arrival' && bathLinenAdded && data?.bathLinen?.available)
    ? {
      label: data.bathLinen.label, unitPrice: round2(data.bathLinen.unitPrice),
      qty: Number(data.bathLinen.persons) || 1, offerKey: 'bathLinen',
      real: round2(data.bathLinen.amount), amount: billed('bathLinen', data.bathLinen.amount),
    } : null;
  // specs/sas-breakfast-and-catering-upsell.md §3.3 — what the two sale steps are selling right now.
  // `units` are the BILLED units (moments × personnes, or the quantity the operator picked), i.e. the
  // very number the fiche shows; the amounts here are a recap PREVIEW — the server re-prices every
  // line authoritatively at commit, from the option and its per-property price.
  const salesOffer = data?.sasSales || null;
  const salesPersons = Number(salesOffer?.persons || 0);
  // Covers of one card option: the operator's number, falling back to the party the server announced
  // (specs/card-option-served-persons.md §3.3 rule 11).
  const servedFor = (offer, picked) => Math.max(1, Number(picked) || Number(offer?.defaultPersons) || salesPersons || 1);
  const soldSelections = useMemo(() => {
    if (mode !== 'arrival' || !salesOffer) return [];
    const out = [];
    const bf = salesOffer.breakfast;
    if (bf?.available && breakfastSold) {
      const occurrences = breakfastMornings.filter((m) => m.checked).map(({ date, time }) => ({ date, time }));
      if (occurrences.length > 0) {
        const persons = servedFor(bf, breakfastServed);
        out.push({ offer: bf, occurrences, persons, units: occurrences.length * (bf.perPerson ? persons : 1) });
      }
    }
    if (salesOffer.catering?.available && cateringWanted === true) {
      for (const opt of (salesOffer.catering.options || [])) {
        if (opt.showsPlanningCard) {
          const occurrences = (cateringGrids[opt.optionId] || []).filter((o) => o.checked).map(({ date, time }) => ({ date, time }));
          if (occurrences.length > 0) {
            const persons = servedFor(opt, cateringServed[opt.optionId]);
            out.push({ offer: opt, occurrences, persons, units: occurrences.length * (opt.perPerson ? persons : 1) });
          }
        } else {
          const units = Number(cateringUnits[opt.optionId]) || 0;
          if (units > 0) out.push({ offer: opt, occurrences: null, persons: null, units });
        }
      }
    }
    return out;
  }, [mode, salesOffer, salesPersons, breakfastSold, breakfastMornings, breakfastServed,
    cateringWanted, cateringGrids, cateringUnits, cateringServed]);
  // No `offerKey` here, deliberately: « Offrir » (specs/sas-offer-complement-lines.md) can only zero a
  // line the server knows how to store at 0 €, and `writeSoldOptions` inserts every sold prestation
  // with `offered = 0`. Offering a freshly-sold breakfast would need a server-side flag that does not
  // exist yet — the operator's lever remains not selling it (or selling fewer units).
  const soldOptionLines = useMemo(() => soldSelections.map((s) => ({
    label: s.offer.title,
    unitPrice: Math.round(Number(s.offer.unitPrice) * 100) / 100,
    qty: s.units,
    amount: Math.round(Number(s.offer.unitPrice) * s.units * 100) / 100,
  })), [soldSelections]);
  const arrivalAddedLines = [...bedLines, ...(cleaningLine ? [cleaningLine] : []), ...(bathLinenLine ? [bathLinenLine] : []), ...soldOptionLines];
  const arrivalAdded = arrivalAddedLines.reduce((s, l) => s + l.amount, 0);
  // On re-edit, the SAS-origin complement lines from the prior commit are REPLACED, not added — so
  // the recap must exclude their amount from « déjà dû » (specs/reopen-completed-sas.md §4), else it
  // would double-count the very lines we re-show. 0 on a fresh SAS (no SAS-origin lines yet).
  // Covers BOTH kinds of SAS-origin line: the custom ones (linen elements) and, since
  // specs/sas-upsells-activate-catalogue-option.md, the catalogue options the SAS sells. An offered
  // line is worth 0 € here too — `complementAmount` never carried it.
  const sasOriginSum = useMemo(() => (r?.options || [])
    .filter((o) => Number(o.sasArrivalOrigin) === 1 && Number(o.offered || 0) !== 1)
    .reduce((s, o) => s + Number(o.isCustom ? (o.unitPrice ?? o.amount ?? o.totalPrice ?? 0) : (o.totalPrice ?? 0)), 0), [r]);
  const preservedArrivalLines = preservedArrival.map((l, i) => ({
    ...l, offerKey: `preserved:${i}`, real: round2(l.amount), amount: billed(`preserved:${i}`, l.amount),
  }));
  const preservedArrivalSum = preservedArrivalLines.reduce((s, l) => s + l.amount, 0);

  // Detail of the PRE-EXISTING complement (the « déjà dû »): every extra routed to the complément
  // (options / resources / custom — `inComplement`), with its quantity + unit price, EXCLUDING the
  // SAS-origin lines (those are re-shown as the « + » added lines). Lets the operator see exactly what
  // makes up the complement to settle, not just the lump sum. Sum == `existing` in the recap.
  // specs/sas-offer-complement-lines.md §3.2 rule 5 + §3.4 rule 14 — the ALREADY-offered extras are
  // listed too (at 0 €, real price struck through): a gesture that can't be seen can't be undone.
  const complementDetailLines = useMemo(() => {
    const extras = [
      ...((r?.options) || []).map((x) => ({ ...x, refKind: Number(x.isCustom || 0) === 1 ? 'custom' : 'option', refId: Number(x.isCustom || 0) === 1 ? x.customOptionId : x.optionId })),
      ...((r?.resources) || []).map((x) => ({ ...x, refKind: 'resource', refId: x.resourceId })),
    ];
    const lines = extras
      .filter((x) => Number(x.inComplement) === 1 && Number(x.sasArrivalOrigin || 0) !== 1
        && Number(x.originalTotalPrice ?? x.totalPrice ?? 0) > 0)
      .map((x) => {
        const storedOffered = Number(x.offered || 0) === 1;
        const real = round2(storedOffered ? (x.originalTotalPrice ?? x.totalPrice) : (x.totalPrice ?? x.originalTotalPrice));
        const offerKey = `${x.refKind}:${Number(x.refId)}`;
        return {
          label: x.title || x.name || 'Prestation',
          qty: Number(x.billedUnits || x.quantity || 1),
          unitPrice: Number(x.unitPrice || 0),
          offerKey, storedOffered, real, amount: billed(offerKey, real),
        };
      });
    // specs/per-platform-tourist-tax-three-way.md §3 rule 7 — when the tourist tax is collected at
    // arrival it's part of `complementAmount` but isn't an option/resource line; itemise it explicitly
    // (server-computed amount) so the detail reconciles with the « existing » total. Never offerable
    // (§3.2 rule 7): the tax is reversed to the commune, it can't be a geste commercial.
    const taxAmount = round2(r?.touristTaxInComplementAmount);
    if (taxAmount > 0) lines.push({ label: 'Taxe de séjour', qty: 1, unitPrice: taxAmount, amount: taxAmount, real: taxAmount });
    return lines;
  }, [r, billed]);

  // How much the live « Offrir » decisions move the stored complement: what is offered now and wasn't,
  // minus what was offered and no longer is. Mirrors exactly what the commit will do server-side.
  const preExistingOfferDelta = useMemo(() => round2(complementDetailLines.reduce((s, l) => {
    if (!l.offerKey) return s;
    return s + (isOffered(l.offerKey) ? l.real : 0) - (l.storedOffered ? l.real : 0);
  }, 0)), [complementDetailLines, isOffered]);

  // « label : qty × unitPrice € = total € » when there is a meaningful quantity, else « label : total € ».
  // Always the REAL price (specs/sas-offer-complement-lines.md §3.1 rule 2): an offered line shows what
  // the guest would have paid, struck through by `OfferableLine` — never a bare 0 €.
  const lineText = (l) => {
    const qty = Number(l.qty || 0);
    const unit = Number(l.unitPrice || 0);
    const total = l.real != null ? l.real : l.amount;
    if (qty > 1 && unit > 0) return `${l.label} : ${qty} × ${formatCurrency(unit)} = ${formatCurrency(total)}`;
    return `${l.label} : ${formatCurrency(total)}`;
  };

  const depMissingLines = useMemo(() => allItems
    .filter((it) => Number(missingDep[it.id]) > 0)
    .map((it) => {
      const real = round2(Number(it.price) * Number(missingDep[it.id]));
      return {
        label: it.label, unitPrice: Number(it.price) || 0, qty: Number(missingDep[it.id]),
        offerKey: `dep:${it.id}`, real, amount: billed(`dep:${it.id}`, real),
      };
    }), [allItems, missingDep, billed]);
  // Never billable when the cleaning is already sold (specs/defer-arrival-complement-to-checkout.md
  // §3.1 rule 1) — the page is hidden, and a line stored by an earlier commit is dropped on re-commit.
  const depCleaningLine = (cleaningOk === false && !data?.cleaning?.included && data?.cleaning?.price)
    ? {
      label: 'Ménage de fin de séjour', unitPrice: round2(data.cleaning.price), qty: 1,
      offerKey: 'depCleaning', real: round2(data.cleaning.price), amount: billed('depCleaning', data.cleaning.price),
    } : null;
  // Fire-extinguisher tariffs (specs/extinguisher-seal-and-repair-amounts.md §3.2): at DEPARTURE, if the
  // extinguisher is not in good condition, the operator enters a quantity for each extinguisher_* tariff.
  // The bill is computed server-side from the quantities; these are PREVIEW lines for the recap only.
  const extinguisherTariffs = useMemo(
    () => (data?.repairAmounts || []).filter((x) => String(x.repairKey || '').startsWith('extinguisher')),
    [data],
  );
  const extinguisherLines = useMemo(() => extinguisherTariffs
    .filter((t) => Number(extinguisherQty[t.repairKey]) > 0)
    .map((t) => {
      const real = round2(Number(t.price) * Number(extinguisherQty[t.repairKey]));
      const offerKey = `ext:${t.repairKey}`;
      return {
        repairKey: t.repairKey, label: t.label, unitPrice: Number(t.price) || 0,
        qty: Number(extinguisherQty[t.repairKey]), offerKey, real, amount: billed(offerKey, real),
      };
    }), [extinguisherTariffs, extinguisherQty, billed]);
  const extinguisherBilled = mode === 'departure' && extinguisherOk === false;
  const previewExtinguisherLines = extinguisherBilled ? extinguisherLines : [];
  // specs/sas-bath-linen-upsell.md §3.3 — end-of-stay lines the ARRIVAL SAS wrote (tagged `source`,
  // e.g. deferred bath linen). They must be DISPLAYED in the check-out recap AND counted in the total
  // AND re-sent verbatim on the departure commit (which rebuilds the whole detail) — else running the
  // departure SAS would silently drop them. Carried whether or not the departure SAS was already
  // committed (a fresh departure SAS must preserve them too). Non-editable here.
  const carriedEndOfStayLines = useMemo(() => {
    if (mode !== 'departure') return [];
    let detail = [];
    try { detail = JSON.parse(r?.endOfStayComplementDetail || '[]') || []; } catch { detail = []; }
    // `key` identifies the extra a mid-stay line came from (specs/mid-stay-extras-to-end-of-stay-
    // complement.md) — carried like `source` so the server keeps routing that money out of the
    // acompte/solde/complément d'arrivée after a check-out commit rewrote the detail.
    return detail
      .filter((l) => l && l.source)
      .map((l, i) => {
        const real = realOfStoredLine(l);
        const offerKey = `carried:${i}`;
        return {
          label: l.label, unitPrice: Number(l.unitPrice) || 0,
          qty: Number(l.qty) || 1, source: l.source, ...(l.key ? { key: l.key } : {}),
          offerKey, real, amount: billed(offerKey, real),
        };
      });
  }, [mode, r, billed]);
  // Lines billed by the laundry/cleaning flow (sent to the server verbatim). The extinguisher lines are
  // sent as quantities (extinguisherCharges) — the server prices them — so they're excluded here.
  const preservedDepartureLines = preservedDeparture.map((l, i) => ({
    ...l, offerKey: `preservedDep:${i}`, real: round2(l.amount), amount: billed(`preservedDep:${i}`, l.amount),
  }));
  const endOfStaySentLines = [...(depCleaningLine ? [depCleaningLine] : []), ...depMissingLines];
  const endOfStayLines = [...endOfStaySentLines, ...carriedEndOfStayLines, ...previewExtinguisherLines, ...preservedDepartureLines];
  const endOfStayTotal = endOfStayLines.reduce((s, l) => s + l.amount, 0);
  // specs/recall-unpaid-arrival-complement-at-checkout.md — at departure, recall the arrival complement
  // when it was never settled (amount > 0 AND not paid). The amount stays separate in the DB; here it's
  // only the combined total to collect + the detail to show.
  const arrivalRecall = (mode === 'departure'
    && data?.arrivalComplement
    && Number(data.arrivalComplement.amount) > 0
    && Number(data.arrivalComplement.paid) !== 1)
    ? data.arrivalComplement : null;
  // specs/sas-offer-complement-lines.md §3.2 rule 6 — the recalled lines are offerable at the door. Each
  // one carries the `ref` of the row behind it (that's the offer key) and its real price; the tax and the
  // un-itemised remainder have no ref → no toggle.
  const arrivalRecallLines = useMemo(() => ((arrivalRecall && arrivalRecall.detail) || []).map((l) => {
    const storedOffered = Number(l.offered || 0) === 1;
    const real = realOfStoredLine(l);
    const offerKey = l.ref ? `${l.ref.kind}:${l.ref.id}` : null;
    return {
      label: l.label, qty: Number(l.qty || 1), unitPrice: Number(l.unitPrice || 0),
      offerKey, storedOffered, real, amount: offerKey ? billed(offerKey, real) : round2(l.amount),
    };
  }), [arrivalRecall, billed]);
  const recalledArrivalAmount = arrivalRecall
    ? Math.max(0, round2(Number(arrivalRecall.amount) - arrivalRecallLines.reduce((s, l) => (
      l.offerKey ? s + (isOffered(l.offerKey) ? l.real : 0) - (l.storedOffered ? l.real : 0) : s
    ), 0)))
    : 0;
  // specs/mid-stay-notes.md §3.5 rule 20 — what the « notes en séjour » already collected. Purely
  // informational at check-out: it never enters the total to collect (it's in the till already).
  const midStayAlreadySettled = useMemo(() => {
    if (mode !== 'departure') return 0;
    let notes = [];
    try { notes = JSON.parse(r?.midStaySettledNotes || '[]') || []; } catch { notes = []; }
    return Math.round(notes.reduce((s, n) => s + (Number(n?.total) || 0), 0) * 100) / 100;
  }, [mode, r]);
  const departureGrandTotal = Math.round((endOfStayTotal + recalledArrivalAmount) * 100) / 100;

  // What the guest bought but nobody placed on a slot — the hours the server still owed, minus the
  // ones placed during this run. Recalled on the recap so a skipped step never loses them.
  const unplacedResourceHours = useMemo(() => (
    (data?.resourceScheduling?.resources || [])
      .map((resource) => {
        const placedMinutes = resourceBlocks
          .filter((b) => Number(b.resourceId) === Number(resource.resourceId))
          .reduce((sum, b) => sum + Number(b.durationMinutes || 0), 0);
        const hours = Math.max(0, Math.round((resource.hoursRemaining - placedMinutes / 60) * 100) / 100);
        return { resourceId: resource.resourceId, name: resource.name, hours };
      })
      .filter((u) => u.hours > 0)
  ), [data, resourceBlocks]);

  // specs/sas-breakfast-and-catering-upsell.md §3.1 — selling the breakfast seeds the composition the
  // operator is about to fill in: the option's serving hour and the defaults a never-committed
  // check-in gets (one viennoiserie per person, half a baguette each). Without it the commit would
  // store zeros and the kitchen would prepare nothing. An already-filled composition is left alone.
  // The server hands the rule PER PERSON SERVED (1 viennoiserie, ½ baguette); the number of
  // breakfasts sold turns it into the pre-fill (specs/card-option-served-persons.md §3.4 rule 17).
  const breakfastFoodFor = useCallback((served) => {
    const perPerson = data?.sasSales?.breakfast?.compositionPerPerson || {};
    const forServed = (key) => round2((Number(perPerson[key]) || 0) * Math.max(0, Number(served) || 0));
    return { pastries: forServed('pastries'), cereals: forServed('cereals'), bread: forServed('bread') };
  }, [data]);
  const sellBreakfast = () => {
    setBreakfastSold(true);
    const bf = data?.sasSales?.breakfast;
    if (!bf || data?.breakfast?.applicable) return;
    const seeded = breakfastFoodFor(servedFor(bf, breakfastServed));
    setBreakfastFood((f) => {
      if (f.pastries || f.cereals || f.bread) return f;
      autoSeededFoodRef.current = seeded;
      return seeded;
    });
    setBreakfastTime((t) => t || String((bf.mornings || [])[0]?.time || ''));
  };
  // Lowering the covers on the mornings page must move the pre-fill with it — the operator sets the
  // number of breakfasts AFTER accepting the sale. Only an untouched pre-fill is re-seeded: as soon as
  // the operator types their own counts, they own them.
  useEffect(() => {
    const bf = data?.sasSales?.breakfast;
    if (!breakfastSold || !bf || data?.breakfast?.applicable) return;
    const seeded = autoSeededFoodRef.current;
    if (!seeded) return;
    setBreakfastFood((f) => {
      if (Object.keys(seeded).some((k) => Number(f[k]) !== Number(seeded[k]))) return f;
      const next = breakfastFoodFor(servedFor(bf, breakfastServed));
      autoSeededFoodRef.current = next;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakfastServed, breakfastSold, breakfastFoodFor]);
  // specs/sas-offer-complement-lines.md §4.3 — the offered keys `kind:id` become the refs the commit
  // sends; a line with no ref (tax, remainder) can never be in the set.
  const offeredRefsOf = (lines) => lines
    .filter((l) => l.offerKey && isOffered(l.offerKey) && l.offerKey.includes(':'))
    .map((l) => {
      const [kind, id] = l.offerKey.split(':');
      return { kind, id: Number(id) };
    })
    .filter((ref) => ['option', 'resource', 'custom'].includes(ref.kind) && Number.isFinite(ref.id));
  // A recap line as the server stores it: the REAL price plus the gesture, never the netted amount —
  // the server is what puts an offered line at 0 €.
  const toDetailLine = (l) => ({
    label: l.label,
    qty: Number(l.qty || 1),
    unitPrice: Number(l.unitPrice || 0),
    amount: l.real,
    ...(l.source ? { source: l.source } : {}),
    ...(l.key ? { key: l.key } : {}),
    ...(isOffered(l.offerKey) ? { offered: true } : {}),
  });

  const commit = async () => {
    setCommitting(true); setError('');
    try {
      if (mode === 'arrival') {
        const payload = {
          // undefined when the caution step isn't shown → server leaves the marker untouched
          // (specs/reopen-completed-sas.md §6); otherwise faithful set/clear from the answer.
          cautionReceived: activeKeys.includes('caution') ? (caution === 'fait') : undefined,
          // specs/sas-upsells-activate-catalogue-option.md §3.1 rule 3 — only the LINEN elements stay
          // custom lines (they come from Blanchisserie, not from the catalogue). The ménage and the
          // linge de toilette ride the two booleans below and land on their catalogue option.
          // specs/sas-offer-complement-lines.md §3.3 — an offered line is sent at its REAL price with
          // `offered: true`: the server is what stores it at 0 €, so the gesture stays undoable.
          complementItems: [
            ...bedLines.map((l) => ({ label: l.label, amount: l.real, offered: isOffered(l.offerKey) })),
            ...preservedArrivalLines.map((l) => ({ label: l.label, amount: l.real, offered: isOffered(l.offerKey) })),
          ],
          // Intent only — the server resolves the option + its price (tri-state: undefined = step not shown).
          cleaningAdded: activeKeys.includes('cleaning') ? cleaningAdded : undefined,
          bathLinenAdded: activeKeys.includes('bathLinen') ? bathLinenAdded : undefined,
          // specs/sas-breakfast-and-catering-upsell.md §3.3 — the prestations sold at check-in, as
          // intent (moments, or billed units). The array is the WHOLE selection: an option dropped on
          // a re-run is simply absent and the server removes it. `undefined` = neither sale step ran.
          soldOptions: (activeKeys.includes('breakfastSale') || activeKeys.includes('cateringAsk'))
            ? soldSelections.map((s) => (s.occurrences
              ? { optionId: s.offer.optionId, occurrences: s.occurrences, persons: s.persons }
              : { optionId: s.offer.optionId, units: s.units }))
            : undefined,
          // « Offrir » on an upsell keeps its option activated (laundry + linen stock) but bills 0 €.
          cleaningOffered: isOffered('cleaning'),
          bathLinenOffered: isOffered('bathLinen'),
          // Authoritative offered set of the PRE-EXISTING complement lines (absent from it = billed).
          offeredExtras: offeredRefsOf(complementDetailLines),
          departureHandoverNote: handoverNote,
          // specs/sas-recap-payment-buttons.md — settlement mode → paid flags. 'card'/'cash' settle the
          // arrival complement now ('cash' = caisse interne); 'defer'/null leave it unpaid → recalled at
          // check-out (specs/recall-unpaid-arrival-complement-at-checkout.md).
          complementSettled: arrivalPayMode === 'card' || arrivalPayMode === 'cash',
          complementPaidCash: arrivalPayMode === 'cash',
          // Hours placed on real slots. `undefined` when the step never ran, so a SAS that does not
          // touch scheduling leaves the stored sessions exactly as they were
          // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rules 23-24). The server
          // re-validates every block and refuses the whole commit on a conflict.
          resourceBlocks: activeKeys.includes('resourceScheduling')
            ? resourceBlocks.map((b) => ({ resourceId: b.resourceId, date: b.date, start: b.start, end: b.end }))
            : undefined,
        };
        // The composition page ran — either for a booked breakfast or for one just sold (its counts
        // would otherwise be written back as zeros).
        if (activeKeys.includes('breakfast')) {
          payload.breakfastTime = breakfastTime;
          payload.breakfastCoffee = breakfast.coffee;
          payload.breakfastTea = breakfast.tea;
          payload.breakfastChocolate = breakfast.chocolate;
          payload.breakfastMilk = breakfast.milk;
          payload.breakfastPastries = breakfastFood.pastries;
          payload.breakfastCereals = breakfastFood.cereals;
          payload.breakfastBread = breakfastFood.bread;
          payload.breakfastNote = breakfastNote;
        }
        await api.commitArrivalSas(reservationId, payload);
      } else {
        await api.commitDepartureSas(reservationId, {
          cautionReturned: activeKeys.includes('cautionReturn') ? (cautionReturned === true) : undefined,
          // The extinguisher lines are NOT sent here — the server prices the quantities below and appends
          // them, then recomputes the authoritative total (specs/extinguisher-seal-and-repair-amounts.md §3.2).
          // Carried arrival-origin lines (e.g. deferred bath linen) are re-sent verbatim WITH their
          // `source` tag so the departure commit (which rebuilds the whole detail) never drops them
          // (specs/sas-bath-linen-upsell.md §3.3).
          endOfStayComplementDetail: [...endOfStaySentLines, ...carriedEndOfStayLines, ...preservedDepartureLines]
            .map(toDetailLine),
          extinguisherSealOkAtDeparture: extinguisherOk ? 1 : 0,
          extinguisherCharges: extinguisherBilled
            ? extinguisherTariffs.map((t) => ({
              repairKey: t.repairKey,
              qty: Number(extinguisherQty[t.repairKey]) || 0,
              offered: isOffered(`ext:${t.repairKey}`),
            }))
            : [],
          // specs/sas-recap-payment-buttons.md — settlement mode → mark every positive complement paid
          // (end-of-stay + recalled arrival); 'cash' = caisse interne. No « defer » at check-out.
          complementsSettled: departurePayMode === 'card' || departurePayMode === 'cash',
          complementsPaidCash: departurePayMode === 'cash',
          // specs/sas-offer-complement-lines.md §3.2 rule 6 — gestes commerciaux on the recalled lines.
          // The set is AUTHORITATIVE, so it is only sent when the recap actually showed those lines:
          // no recall, no toggle rendered, nothing to say about their offered flags (rule 6.ter).
          offeredArrivalExtras: arrivalRecall ? offeredRefsOf(arrivalRecallLines) : undefined,
        });
      }
      if (onCommitted) onCommitted();
      if (onClose) onClose();
    } catch (e) {
      // specs/reception-sas-today-only.md §3.3 rule 14 — the SAS left the reception edit window while
      // this wizard was open (committed elsewhere, or the 04:00 boundary crossed): the server refuses
      // with a reason and the raw code would otherwise surface as-is.
      const message = e?.error === 'SAS_LOCKED'
        ? sasLockMessage(mode, e.reason)
        : e?.message;
      // Inline (visible in the fullscreen dialog) + toast (app-wide feedback channel).
      setError(message || "Échec de l'enregistrement.");
      showError(message || "Échec de l'enregistrement du SAS.");
    } finally {
      setCommitting(false);
    }
  };

  // ---- quantity stepper for a linen item row ----
  const QtyRow = ({ item, qtyMap, setQtyMap }) => {
    const qty = Number(qtyMap[item.id] || 0);
    const set = (v) => setQtyMap({ ...qtyMap, [item.id]: Math.max(0, v) });
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography>
          <Typography variant="caption" color="text.secondary">{formatCurrency(item.price)} / unité</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" onClick={() => set(qty - 1)} disabled={qty <= 0} sx={{ minWidth: 36 }}>−</Button>
          <TextField value={qty} onChange={(e) => set(Math.floor(Number(e.target.value) || 0))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
          <Button size="small" variant="outlined" onClick={() => set(qty + 1)} sx={{ minWidth: 36 }}>+</Button>
        </Stack>
      </Stack>
    );
  };

  // Breakfast coherence: drink and food totals vs the server-resolved morning person count
  // (soft warnings — specs/sas-breakfast-milk-and-food.md rule 3).
  const breakfastTotal = Number(breakfast.coffee) + Number(breakfast.tea) + Number(breakfast.chocolate) + Number(breakfast.milk);
  const breakfastFoodTotal = Number(breakfastFood.pastries) + Number(breakfastFood.cereals);
  // The morning head count: the server-resolved one for a booked breakfast, the party of the sale for
  // one just sold at check-in (the `breakfast` payload block is not applicable yet on that run).
  // Who the composition is for: the mornings already booked serve the count the server resolved
  // (which honours `cardPersons` too), a breakfast sold right here serves the covers the operator
  // picked (specs/card-option-served-persons.md §3.4 rules 16-17) — so the coherence warning compares
  // against the number of breakfasts, never against a table half of which isn't having any.
  const breakfastPersons = Number(data?.breakfast?.applicable
    ? data.breakfast.persons
    : (breakfastSold ? servedFor(salesOffer?.breakfast, breakfastServed) : salesPersons)) || 0;
  const breakfastMismatch = breakfastTotal !== breakfastPersons;
  const breakfastFoodMismatch = breakfastFoodTotal !== breakfastPersons;
  const breakfastAnyMismatch = breakfastMismatch || breakfastFoodMismatch;
  // Confirm-dialog message names only the mismatching category(ies).
  const breakfastWarnMessage = [
    breakfastMismatch ? `le nombre de boissons (${breakfastTotal})` : null,
    breakfastFoodMismatch ? `le nombre d'aliments (${breakfastFoodTotal})` : null,
  ].filter(Boolean).join(' et ')
    .replace(/^le/, 'Le')
    + ` ne correspond${breakfastMismatch && breakfastFoodMismatch ? 'ent' : ''} pas au nombre de personnes (${breakfastPersons}). Continuer quand même ?`;

  // ---- page renderers ----
  function renderStepContent() {
    if (loading) return <LoadingState py={5} />;
    if (error && !data) return <ErrorAlert message={error} />;
    if (!data) return null;

    switch (stepKey) {
      case 'intro': {
        const personsCount = Number(r.adults || 0) + Number(r.teens || 0) + Number(r.children || 0) + Number(r.babies || 0);
        return (
          <Stack spacing={1.5}>
            {/* 1. Property photo (same image as Réglages → logement). */}
            {r.propertyPhoto && (
              <Box component="img" src={r.propertyPhoto} alt={r.propertyName}
                sx={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 2 }} />
            )}
            {/* 2. Property name, centred — serif section-header role, sized up for the guest-facing intro. */}
            <Typography variant="sectionHeader" sx={{ textAlign: 'center', fontSize: '1.2rem', lineHeight: 1.2 }}>{r.propertyName}</Typography>
            {/* 3. Client name — the intro's hero line: serif title role (component=p — no heading
                semantics inside the dialog), sized like the old h4. */}
            <Typography variant="pageTitle" component="p" sx={{ textAlign: 'center', color: 'primary.main', fontSize: '1.6rem', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
              {r.firstName} {r.lastName}
            </Typography>
            {/* 4. Platform badge — exactly like the planning (outlined, platform colour). */}
            {r.platform && (
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Box component="span" sx={{ px: 1, py: 0.5, border: '1.5px solid', borderColor: getPlatformColor(r.platform), color: getPlatformColor(r.platform), bgcolor: 'transparent', borderRadius: 1, fontSize: 14, fontWeight: 800, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                  {formatPlatformLabel(r.platform)}
                </Box>
              </Box>
            )}
            {/* 5. Arrival + departure — planning format, left-aligned. */}
            <Stack spacing={0.75} sx={{ alignItems: 'flex-start', mt: 0.5 }}>
              <IntroDateRow kind="arrival" date={r.startDate} time={r.checkInTime || '15:00'} />
              <IntroDateRow kind="departure" date={r.endDate} time={r.checkOutTime || '10:00'} />
            </Stack>
            {/* 6. People count. */}
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <PeopleIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="body1">{personsCount} personne{personsCount > 1 ? 's' : ''}</Typography>
            </Stack>
            {mode === 'departure' && r.departureHandoverNote && (
              <Box sx={(t) => ({ mt: 1, p: 1, borderRadius: 1, bgcolor: alpha(t.palette.warning.main, 0.12), border: '1px solid', borderColor: 'warning.light' })}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark', display: 'block' }}>Note laissée à l'arrivée</Typography>
                <Typography variant="body2">{r.departureHandoverNote}</Typography>
              </Box>
            )}
          </Stack>
        );
      }
      case 'portal':
        return (
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
            <Typography variant="body1">Code du portail à communiquer au client :</Typography>
            {/* Portal code = digits → kpiValue role (sans, tabular — amounts/codes never serif), h3-sized. */}
            <Typography variant="kpiValue" sx={{ fontSize: '2.6rem', letterSpacing: 2 }}>{data.portalCode}</Typography>
          </Stack>
        );
      case 'weather':
        return <SasWeatherAlertPage alerts={weatherAlerts} />;
      case 'caution':
      case 'cautionReport':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Caution à percevoir : <strong>{formatCurrency(r.cautionAmount)}</strong></Typography>
            <Typography variant="body2" color="text.secondary">Encaisser la caution (chèque / empreinte) avant de continuer.</Typography>
            {caution === 'fait' && <Chip label="Marquée comme perçue" color="success" sx={{ alignSelf: 'flex-start' }} />}
            {caution === 'reporte' && stepKey === 'caution' && <Chip label="Reportée — réaffichée à la fin" color="warning" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'options': {
        const opts = (r.options || []);
        const reslist = (r.resources || []);
        return (
          <Stack spacing={1}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Prestations réservées</Typography>
            {opts.length === 0 && reslist.length === 0 && <Typography variant="body2" color="text.secondary">Aucune.</Typography>}
            {opts.map((o, i) => <Typography key={`o${i}`} variant="body2">• {o.title}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</Typography>)}
            {reslist.map((o, i) => <Typography key={`r${i}`} variant="body2">• {o.name}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</Typography>)}
          </Stack>
        );
      }
      case 'resourceScheduling':
        return (
          <SasResourceSchedulingPage
            reservationId={r.id}
            scheduling={data.resourceScheduling}
            blocks={resourceBlocks}
            onAdd={(block) => setResourceBlocks((prev) => [...prev, block])}
            onRemove={(idx, block) => setResourceBlocks((prev) => prev.filter((b) => (
              !(b.resourceId === block.resourceId && b.date === block.date && b.start === block.start)
            )))}
          />
        );
      case 'breakfast':
        return (
          <Stack spacing={1.5}>
            {/* Big readable hour (specs/sas-breakfast-milk-and-food.md rule 4). */}
            <TextField
              label="Heure du petit déjeuner"
              type="time"
              value={breakfastTime}
              onChange={(e) => setBreakfastTime(e.target.value)}
              sx={{ width: { xs: '100%', sm: 260 } }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { sx: { fontSize: '1.7rem', fontWeight: 700, textAlign: 'center' } },
              }}
            />
            <Divider />
            <Stack spacing={0.5} divider={<Divider />}>
              <CountStepper icon={<LocalCafeIcon color="action" />} label="Café" value={Number(breakfast.coffee)} onChange={(v) => setBreakfast((b) => ({ ...b, coffee: v }))} />
              <CountStepper icon={<EmojiFoodBeverageIcon color="action" />} label="Thé" value={Number(breakfast.tea)} onChange={(v) => setBreakfast((b) => ({ ...b, tea: v }))} />
              <CountStepper icon={<FreeBreakfastIcon sx={{ color: 'secondary.dark' }} />} label="Chocolat chaud" value={Number(breakfast.chocolate)} onChange={(v) => setBreakfast((b) => ({ ...b, chocolate: v }))} />
              <CountStepper icon={<LocalDrinkIcon color="action" />} label="Lait" value={Number(breakfast.milk)} onChange={(v) => setBreakfast((b) => ({ ...b, milk: v }))} />
            </Stack>
            <Typography variant="caption" sx={{ color: breakfastMismatch ? 'warning.main' : 'text.secondary', fontWeight: breakfastMismatch ? 700 : 400 }}>
              {breakfastTotal} boisson{breakfastTotal > 1 ? 's' : ''} pour {breakfastPersons} personne{breakfastPersons > 1 ? 's' : ''}
            </Typography>
            {/* Stronger separator instead of an « À manger » heading (spec rule 1). */}
            <Divider sx={{ borderBottomWidth: 3, borderColor: 'text.disabled' }} />
            <Stack spacing={0.5} divider={<Divider />}>
              <CountStepper icon={<BakeryDiningIcon color="action" />} label="Viennoiseries" value={Number(breakfastFood.pastries)} onChange={(v) => setBreakfastFood((f) => ({ ...f, pastries: v }))} />
              <CountStepper icon={<WheatIcon color="action" />} label="Céréales" value={Number(breakfastFood.cereals)} onChange={(v) => setBreakfastFood((f) => ({ ...f, cereals: v }))} />
              <CountStepper icon={<BaguetteIcon color="action" />} label="Pain (baguette)" value={Number(breakfastFood.bread)} onChange={(v) => setBreakfastFood((f) => ({ ...f, bread: v }))} step={0.5} />
            </Stack>
            <Typography variant="caption" sx={{ color: breakfastFoodMismatch ? 'warning.main' : 'text.secondary', fontWeight: breakfastFoodMismatch ? 700 : 400 }}>
              {breakfastFoodTotal} à manger pour {breakfastPersons} personne{breakfastPersons > 1 ? 's' : ''}
            </Typography>
            <TextField
              label="Note petit déjeuner (optionnel)"
              value={breakfastNote}
              onChange={(e) => setBreakfastNote(e.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        );
      case 'linen':
        return (
          <Stack spacing={1.5}>
            {r.bedLinenAlert?.type === 'capacity' ? (
              <Typography variant="body1">Le linge de lit prévu ne couvre pas le nombre de personnes ({r.bedLinenAlert.capacity} couchage(s) pour {r.bedLinenAlert.required} pers.). <strong>Vérifier les draps avec le client.</strong></Typography>
            ) : (
              <Typography variant="body1">Le client n'a pas pris le linge de lit. <strong>Vérifier avec lui.</strong></Typography>
            )}
            <Typography variant="body2" color="text.secondary">« Pas OK » → sélectionner les éléments manquants à facturer.</Typography>
          </Stack>
        );
      case 'linenItems':
        return (
          <Stack spacing={0.5} divider={<Divider />}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Éléments de linge manquants</Typography>
            {bedItems.length === 0 && <Typography variant="body2" color="text.secondary">Aucun tarif configuré (Réglages → Blanchisserie).</Typography>}
            {bedItems.map((it) => <QtyRow key={it.id} item={it} qtyMap={missingBed} setQtyMap={setMissingBed} />)}
          </Stack>
        );
      case 'cleaning':
        if (mode === 'departure') {
          return (
            <Stack spacing={1}>
              <Typography variant="body1">Le ménage de fin de séjour a-t-il été fait correctement ?</Typography>
              {cleaningOk === false && data.cleaning.price != null && (
                <Typography variant="body2" color="warning.main">Ménage à facturer : {formatCurrency(data.cleaning.price)}.</Typography>
              )}
            </Stack>
          );
        }
        if (data.cleaning.included) {
          return (
            <Stack spacing={1}>
              <Typography variant="body1">✅ Le ménage est inclus.</Typography>
              <Typography variant="body2" color="text.secondary">Rappeler au client : la vaisselle doit être faite et rangée, et les poubelles vidées.</Typography>
            </Stack>
          );
        }
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Le ménage n'a pas été pris.</Typography>
            {data.cleaning.price != null
              ? <Typography variant="body2">Tarif ménage pour ce logement : <strong>{formatCurrency(data.cleaning.price)}</strong>. Proposer au client ?</Typography>
              : <Typography variant="body2" color="text.secondary">Aucun tarif de ménage configuré pour ce logement.</Typography>}
            {cleaningAdded && <Chip label={`Ménage ajouté (${formatCurrency(data.cleaning.price)})`} color="info" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'bathLinen': {
        const bl = data.bathLinen || {};
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Le client n'a pas pris le linge de toilette.</Typography>
            <Typography variant="body2">Tarif : <strong>{formatCurrency(bl.amount)}</strong> ({bl.persons} pers × {formatCurrency(bl.unitPrice)}). Proposer au client ?</Typography>
            {bathLinenAdded && <Chip label={`Linge ajouté (${formatCurrency(bl.amount)})`} color="info" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      }
      case 'breakfastSale': {
        const bf = salesOffer.breakfast;
        const perMorning = Math.round(Number(bf.unitPrice) * (bf.perPerson ? salesPersons : 1) * 100) / 100;
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Le client n'a pas pris le petit déjeuner.</Typography>
            <Typography variant="body2">
              Tarif : <strong>{formatCurrency(bf.unitPrice)}</strong> {bf.perPerson ? 'par personne et par matin' : 'par matin'}
              {bf.perPerson ? ` — ${formatCurrency(perMorning)} le matin pour ${salesPersons} pers.` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {bf.mornings.length} matin{bf.mornings.length > 1 ? 's' : ''} possible{bf.mornings.length > 1 ? 's' : ''} sur ce séjour.
            </Typography>
            {breakfastSold && <Chip label="Petit déjeuner ajouté" color="info" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      }
      case 'breakfastMornings': {
        const bf = salesOffer.breakfast;
        const chosen = breakfastMornings.filter((m) => m.checked).length;
        const served = servedFor(bf, breakfastServed);
        const units = chosen * (bf.perPerson ? served : 1);
        return (
          <Stack spacing={1}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Quels matins ?</Typography>
            <OccurrenceGrid
              grid={breakfastMornings}
              onToggle={(date, slot, checked) => setBreakfastMornings((prev) => prev.map((m) => (
                m.date === date && (m.slot ?? 0) === slot ? { ...m, checked } : m
              )))}
              quantityText={(
                <>
                  Quantité&nbsp;: <strong>{units}</strong>
                  {bf.perPerson ? ` (${chosen} × ${served} pers. servies)` : ''}
                </>
              )}
            />
            {/* specs/card-option-served-persons.md §3.3 — tout le monde ne prend pas le petit
                déjeuner : les enfants souvent pas. */}
            {bf.perPerson && (
              <CountStepper
                icon={<PeopleIcon color="action" />}
                label="Personnes servies"
                value={served}
                min={1}
                max={Number(bf.maxPersons) || undefined}
                onChange={setBreakfastServed}
              />
            )}
            <Divider />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {units} petit{units > 1 ? 's' : ''} déjeuner{units > 1 ? 's' : ''} — {formatCurrency(Math.round(Number(bf.unitPrice) * units * 100) / 100)}
            </Typography>
            {chosen === 0 && (
              <Typography variant="body2" color="warning.main">Aucun matin sélectionné — le petit déjeuner ne sera pas ajouté.</Typography>
            )}
          </Stack>
        );
      }
      case 'cateringAsk':
        return (
          <Stack spacing={1}>
            <Typography variant="body1">Le client souhaite-t-il de la restauration ?</Typography>
            <Typography variant="body2" color="text.secondary">
              Repas, planches apéro… ajoutés au complément à percevoir.
            </Typography>
          </Stack>
        );
      case 'cateringItems': {
        const options = salesOffer.catering?.options || [];
        const total = soldOptionLines
          .filter((l) => l.label !== salesOffer.breakfast?.title)
          .reduce((s, l) => s + l.amount, 0);
        return (
          <Stack spacing={0.5} divider={<Divider />}>
            {options.map((o) => {
              const grid = cateringGrids[o.optionId] || [];
              const chosen = grid.filter((x) => x.checked).length;
              const served = servedFor(o, cateringServed[o.optionId]);
              const units = o.showsPlanningCard
                ? chosen * (o.perPerson ? served : 1)
                : Number(cateringUnits[o.optionId]) || 0;
              const amount = Math.round(Number(o.unitPrice) * units * 100) / 100;
              return (
                <Box key={o.optionId} sx={{ py: 0.5 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatCurrency(o.unitPrice)} {PRICE_TYPE_LABELS[o.priceType] || ''}
                      </Typography>
                    </Box>
                    {/* A card option is taken by picking its moments; everything else works like the
                        fiche: the switch fills the quantity in for you, the stepper adjusts it. */}
                    {!o.showsPlanningCard && (
                      <Switch
                        checked={units > 0}
                        slotProps={{ input: { 'aria-label': o.title } }}
                        onChange={(e) => setCateringUnits((prev) => ({
                          ...prev, [o.optionId]: e.target.checked ? Number(o.defaultUnits) || 1 : 0,
                        }))}
                      />
                    )}
                  </Stack>
                  {o.showsPlanningCard ? (
                    <>
                      <OccurrenceGrid
                        grid={grid}
                        onToggle={(date, slot, checked) => setCateringGrids((prev) => ({
                          ...prev,
                          [o.optionId]: (prev[o.optionId] || []).map((x) => (
                            x.date === date && (x.slot ?? 0) === slot ? { ...x, checked } : x
                          )),
                        }))}
                        quantityText={units > 0 ? (
                          <>
                            Quantité&nbsp;: <strong>{units}</strong>
                            {o.perPerson ? ` (${chosen} × ${served} pers. servies)` : ''} = {formatCurrency(amount)}
                          </>
                        ) : null}
                      />
                      {/* specs/card-option-served-persons.md §3.3 — le nombre de couverts, quand les
                          enfants ne mangent pas. Affiché dès qu'un moment est coché. */}
                      {o.perPerson && chosen > 0 && (
                        <CountStepper
                          icon={<PeopleIcon color="action" />}
                          label="Personnes servies"
                          value={served}
                          min={1}
                          max={Number(o.maxPersons) || undefined}
                          onChange={(v) => setCateringServed((prev) => ({ ...prev, [o.optionId]: v }))}
                        />
                      )}
                    </>
                  ) : units > 0 && (
                    <CountStepper
                      icon={<RestaurantIcon color="action" />}
                      label={`Quantité — ${formatCurrency(amount)}`}
                      value={units}
                      onChange={(v) => setCateringUnits((prev) => ({ ...prev, [o.optionId]: v }))}
                    />
                  )}
                </Box>
              );
            })}
            <Typography variant="body2" sx={{ fontWeight: 700, pt: 1 }}>
              Total restauration : {formatCurrency(Math.round(total * 100) / 100)}
            </Typography>
          </Stack>
        );
      }
      case 'missingAsk':
        return <Typography variant="body1">Des serviettes ou des draps sont-ils manquants ?</Typography>;
      case 'missingItems':
        return (
          <Stack spacing={0.5} divider={<Divider />}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Éléments manquants</Typography>
            {allItems.length === 0 && <Typography variant="body2" color="text.secondary">Aucun tarif configuré (Réglages → Blanchisserie).</Typography>}
            {allItems.map((it) => <QtyRow key={it.id} item={it} qtyMap={missingDep} setQtyMap={setMissingDep} />)}
          </Stack>
        );
      case 'keys':
        return (
          <Stack spacing={1}>
            <Typography variant="body1">Avez-vous récupéré les clés du logement ?</Typography>
            {keysReceived === false && <Chip label="Clés non récupérées" color="warning" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'cautionReturn':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Rendre la caution de <strong>{formatCurrency(r.cautionAmount)}</strong>.</Typography>
            {cautionReturned === true && <Chip label="Caution rendue" color="success" sx={{ alignSelf: 'flex-start' }} />}
            {cautionReturned === false && <Chip label="Litige / dégât — caution conservée" color="error" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'extinguisher':
        return (
          <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body1" sx={{ textAlign: 'center', fontWeight: 700, fontSize: '1.15rem' }}>L'extincteur est-il en bon état ?</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              Si non, vous pourrez ajouter les frais (plomb manquant, utilisation) au complément de fin de séjour.
            </Typography>
          </Stack>
        );
      case 'extinguisherItems':
        return (
          <Stack spacing={1}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Frais extincteur à facturer</Typography>
            {extinguisherTariffs.length === 0 && (
              <Typography variant="body2" color="text.secondary">Aucun tarif extincteur configuré (Réglages → Tarifs facturables).</Typography>
            )}
            <Stack divider={<Divider />}>
              {extinguisherTariffs.map((t) => (
                <QtyRow key={t.repairKey} item={{ id: t.repairKey, label: t.label, price: t.price }} qtyMap={extinguisherQty} setQtyMap={setExtinguisherQty} />
              ))}
            </Stack>
            {extinguisherLines.length > 0 && (
              <>
                <Divider />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Sous-total : {formatCurrency(extinguisherLines.reduce((s, l) => s + l.amount, 0))}</Typography>
              </>
            )}
          </Stack>
        );
      case 'recap':
        if (mode === 'arrival') {
          // `preExistingOfferDelta` is what the gestes commerciaux decided during THIS run take out of
          // (or give back to) the stored complement — the recap total must follow them live.
          const existing = Math.max(0, round2(Number(r.complementAmount || 0) - sasOriginSum - preExistingOfferDelta));
          const total = round2(existing + arrivalAdded + preservedArrivalSum);
          return (
            <Stack spacing={1}>
              <Typography variant="sectionHeader">Récapitulatif — complément à percevoir</Typography>
              {/* specs/sas-hide-settled-steps.md §3 rule 4 — when the ménage page is hidden (cleaning
                  included), its client reminder is carried here so it's not lost. */}
              {data.cleaning?.included && (
                <Typography variant="body2" color="text.secondary">
                  Ménage inclus — rappeler au client : la vaisselle doit être faite et rangée, et les poubelles vidées.
                </Typography>
              )}
              {/* Detail of what's already due (each complement line with quantity + price), instead of a
                  lump « Déjà dû ». Falls back to the total if the breakdown isn't available. Each line
                  can be offered (specs/sas-offer-complement-lines.md §3.2) — except the taxe de séjour
                  and the un-itemised lump, which carry no `offerKey`. */}
              {complementDetailLines.length > 0
                ? complementDetailLines.map((l, i) => (
                  <OfferableLine
                    key={`d${i}`}
                    text={lineText(l)}
                    offered={isOffered(l.offerKey)}
                    onToggle={l.offerKey ? () => toggleOffered(l.offerKey) : undefined}
                  />
                ))
                : existing > 0 && <Typography variant="body2">Déjà dû : <strong>{formatCurrency(existing)}</strong></Typography>}
              {arrivalAddedLines.map((l, i) => (
                <OfferableLine
                  key={i}
                  prefix="+ "
                  text={lineText(l)}
                  offered={isOffered(l.offerKey)}
                  onToggle={() => toggleOffered(l.offerKey)}
                />
              ))}
              {preservedArrivalLines.map((l, i) => (
                <OfferableLine
                  key={`p${i}`}
                  prefix="+ "
                  text={`${l.label} : ${formatCurrency(l.real)}`}
                  offered={isOffered(l.offerKey)}
                  onToggle={() => toggleOffered(l.offerKey)}
                />
              ))}
              <Divider />
              {/* Amounts never render in serif → bold sans body, not sectionHeader. */}
              <Typography variant="body1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>Total : {formatCurrency(total)}</Typography>
              {caution === 'fait' && <Typography variant="body2" color="success.main">Caution marquée comme perçue.</Typography>}
              {/* Hours sold but never placed on a slot. The step is skippable on purpose, so the recap
                  is what keeps them from being forgotten
                  (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 23). */}
              {unplacedResourceHours.map((u) => (
                <Typography key={u.resourceId} variant="body2" color="warning.main">
                  {u.name} : {u.hours} h non planifiée{u.hours > 1 ? 's' : ''}.
                </Typography>
              ))}
              {Number(r.complementPaid || 0) === 1 && arrivalAdded > 0 && (
                <Typography variant="body2" color="warning.main">⚠ Le complément était déjà marqué payé : encaisser le supplément ({formatCurrency(arrivalAdded)}) manuellement.</Typography>
              )}
              {total > 0 && Number(r.complementPaid || 0) !== 1 && (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Règlement du complément</Typography>
                  <PaymentModeButtons value={arrivalPayMode} onChange={setArrivalPayMode} showDefer />
                  {arrivalPayMode === 'defer' && (
                    <Typography variant="body2" color="text.secondary">Reporté au check-out (rappelé dans le SAS de départ).</Typography>
                  )}
                </>
              )}
              <Divider />
              <TextField
                label="Note pour le départ (optionnel)"
                value={handoverNote}
                onChange={(e) => setHandoverNote(e.target.value)}
                size="small"
                multiline
                minRows={2}
                fullWidth
                helperText="Affichée au check-out (SAS départ + carte planning)."
              />
            </Stack>
          );
        }
        return (
          <Stack spacing={1}>
            <Typography variant="sectionHeader">Récapitulatif fin de séjour</Typography>
            {/* specs/defer-arrival-complement-to-checkout.md §3.1 rule 2 — the ménage page is hidden
                when the cleaning is already sold; say so instead of leaving a silent gap. */}
            {data.cleaning?.included && (
              <Typography variant="body2" color="text.secondary">Ménage déjà réglé — aucune facturation de fin de séjour.</Typography>
            )}
            {/* specs/mid-stay-notes.md §3.5 rule 20 — read-only reminder: these prestations were
                already collected during the stay, they are NOT part of the total to collect here. */}
            {midStayAlreadySettled > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Déjà réglé en séjour : {formatCurrency(midStayAlreadySettled)}
              </Typography>
            )}
            {endOfStayLines.length === 0 && arrivalRecallLines.length === 0 && <Typography variant="body2" color="text.secondary">Aucun complément de fin de séjour.</Typography>}
            {/* Every check-out line is offerable (specs/sas-offer-complement-lines.md §3.2 rule 6). */}
            {endOfStayLines.map((l, i) => (
              <OfferableLine
                key={i}
                text={lineText(l)}
                offered={isOffered(l.offerKey)}
                onToggle={l.offerKey ? () => toggleOffered(l.offerKey) : undefined}
              />
            ))}
            {/* specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement was never
                settled: recall its full detail. When there is ALSO an end-of-stay complement (services
                taken during the stay), the arrival lines are merged plainly into the same « à percevoir »
                list — NOT flagged « non perçus » — since the amount is just part of what's collected at
                check-out (2026-07-20). Alone (no end-of-stay complement) it keeps the warning framing, as it
                then genuinely signals a forgotten arrival collection. */}
            {arrivalRecall && endOfStayLines.length > 0 && arrivalRecallLines.map((l, i) => (
              <OfferableLine
                key={`ar${i}`}
                text={`${l.label} : ${formatCurrency(l.real)}`}
                offered={isOffered(l.offerKey)}
                onToggle={l.offerKey ? () => toggleOffered(l.offerKey) : undefined}
              />
            ))}
            {arrivalRecall && endOfStayLines.length === 0 && (
              <>
                <Divider />
                <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', color: 'warning.main' }}>Compléments d'arrivée non perçus</Typography>
                {arrivalRecallLines.map((l, i) => (
                  <OfferableLine
                    key={`ar${i}`}
                    text={`${l.label} : ${formatCurrency(l.real)}`}
                    offered={isOffered(l.offerKey)}
                    onToggle={l.offerKey ? () => toggleOffered(l.offerKey) : undefined}
                  />
                ))}
                <Typography variant="body2">Sous-total arrivée : <strong>{formatCurrency(recalledArrivalAmount)}</strong></Typography>
              </>
            )}
            {departureGrandTotal > 0 && (<><Divider /><Typography variant="body1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>Total à percevoir : {formatCurrency(departureGrandTotal)}</Typography></>)}
            {departureGrandTotal > 0 && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Règlement</Typography>
                <PaymentModeButtons value={departurePayMode} onChange={setDeparturePayMode} showDefer={false} />
              </>
            )}
            {cautionReturned === true && <Typography variant="body2" color="success.main">Caution rendue.</Typography>}
            {keysReceived === false && <Typography variant="body2" color="warning.main">⚠ Clés non récupérées.</Typography>}
          </Stack>
        );
      default:
        return null;
    }
  }

  // ---- footer (page-specific forward actions) ----
  function renderActions() {
    if (loading || !data) return null;
    if (sasLock) return <Button variant="contained" onClick={onClose}>Fermer</Button>;
    const quit = null;
    const next = (label = 'Suivant') => <Button variant="contained" onClick={goNext}>{label}</Button>;

    switch (stepKey) {
      case 'intro': return <>{quit}{next('Commencer')}</>;
      case 'portal': return <>{quit}{next()}</>;
      case 'caution':
      case 'cautionReport':
        return <>{quit}
          <AnswerButtons
            goodLabel="Fait" onGood={() => { setCaution('fait'); goNext(); }}
            badLabel="Reporté" onBad={() => { setCaution('reporte'); goNext(); }}
          />
        </>;
      case 'options': return <>{quit}{next()}</>;
      // Not a yes/no safety question → neutral styling, like the ménage upsell. A check-in is never
      // blocked by scheduling: « Planifier plus tard » moves on and the recap recalls what is left
      // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 23).
      case 'resourceScheduling':
        return <>{quit}
          <Button onClick={goNext} sx={{ color: 'text.secondary' }}>Planifier plus tard</Button>
          <Button variant="contained" onClick={goNext}>Suivant</Button>
        </>;
      case 'breakfast':
        return <>{quit}
          <Button variant="contained" onClick={() => { if (breakfastAnyMismatch) setBreakfastWarnOpen(true); else goNext(); }}>Suivant</Button>
        </>;
      case 'linen':
        // « Pas OK » opens the conditional linen-items page — navigate to it explicitly (the activeKeys
        // goNext() reads is computed before this setState lands). « OK » = linen fine → clear any
        // (re-edit) pre-filled missing items so they aren't billed.
        return <>{quit}
          <AnswerButtons
            goodLabel="OK" onGood={() => { setLinenOk(true); setMissingBed({}); goNext(); }}
            badLabel="Pas OK" onBad={() => { setLinenOk(false); setStepKey('linenItems'); }}
          />
        </>;
      case 'linenItems': return <>{quit}{next()}</>;
      case 'cleaning':
        if (mode === 'departure') {
          return <>{quit}
            <AnswerButtons
              goodLabel="OK" onGood={() => { setCleaningOk(true); goNext(); }}
              badLabel="Pas OK" onBad={() => { setCleaningOk(false); goNext(); }}
            />
          </>;
        }
        if (data.cleaning.included) return <>{quit}{next()}</>;
        // Cleaning NOT included → « Non merci » is the default (highlighted) button; adding it is secondary.
        return <>{quit}
          <Button variant="outlined" disabled={data.cleaning.price == null} onClick={() => { setCleaningAdded(true); goNext(); }}>Ajouter le ménage</Button>
          <Button variant="contained" onClick={() => { setCleaningAdded(false); goNext(); }}>Non merci</Button>
        </>;
      case 'bathLinen':
        // specs/sas-bath-linen-upsell.md §3.2 — neutral upsell, mirroring the « Ménage » step: add it or
        // decline. No payment question here — settlement is chosen once, for the whole complement, on the recap.
        return <>{quit}
          <Button variant="outlined" onClick={() => { setBathLinenAdded(true); goNext(); }}>Ajouter le linge de toilette</Button>
          <Button variant="contained" onClick={() => { setBathLinenAdded(false); goNext(); }}>Non merci</Button>
        </>;
      // specs/sas-breakfast-and-catering-upsell.md §3.1 — same neutral upsell shape as the ménage.
      // « Ajouter » opens the mornings page (navigate explicitly: activeKeys is recomputed after the
      // setState) and seeds the composition the operator is about to fill in.
      case 'breakfastSale':
        return <>{quit}
          <Button variant="outlined" onClick={() => { sellBreakfast(); setStepKey('breakfastMornings'); }}>Ajouter le petit déjeuner</Button>
          <Button variant="contained" onClick={() => { setBreakfastSold(false); goPast('breakfastSale', ['breakfastMornings', 'breakfast']); }}>Non merci</Button>
        </>;
      case 'breakfastMornings': return <>{quit}{next()}</>;
      case 'cateringAsk':
        // « Non merci » sells nothing (the selection is simply never sent), and « Oui » opens the
        // catalogue page — navigated explicitly, like the other conditional pages.
        return <>{quit}
          <Button variant="outlined" onClick={() => { setCateringWanted(true); setStepKey('cateringItems'); }}>Oui, proposer</Button>
          <Button variant="contained" onClick={() => { setCateringWanted(false); goPast('cateringAsk', ['cateringItems']); }}>Non merci</Button>
        </>;
      case 'cateringItems': return <>{quit}{next()}</>;
      case 'missingAsk':
        // « Non » = nothing missing → clear any (re-edit) pre-filled items so they aren't billed.
        // « Oui » opens the conditional missing-items page — navigate explicitly (see linen above).
        return <>{quit}
          <AnswerButtons
            goodLabel="Non" onGood={() => { setMissingAsk(false); setMissingDep({}); goNext(); }}
            badLabel="Oui" onBad={() => { setMissingAsk(true); setStepKey('missingItems'); }}
          />
        </>;
      case 'missingItems': return <>{quit}{next()}</>;
      case 'keys':
        return <>{quit}
          <AnswerButtons
            goodLabel="Oui" onGood={() => { setKeysReceived(true); goNext(); }}
            badLabel="Non" onBad={() => { setKeysReceived(false); goNext(); }}
          />
        </>;
      case 'cautionReturn':
        return <>{quit}
          <AnswerButtons
            goodLabel="Rendue" onGood={() => { setCautionReturned(true); goNext(); }}
            badLabel="Dégât / litige" onBad={() => { setCautionReturned(false); goNext(); }}
          />
        </>;
      case 'extinguisher':
        // « Oui » = bon état → clear any (re-edit) charges so nothing is billed. « Non » opens the
        // tariff-quantity page — navigate explicitly (activeKeys is recomputed after this setState).
        return <>{quit}
          <AnswerButtons
            goodLabel="Oui" onGood={() => { setExtinguisherOk(true); setExtinguisherQty({}); goNext(); }}
            badLabel="Non" onBad={() => { setExtinguisherOk(false); setStepKey('extinguisherItems'); }}
          />
        </>;
      case 'extinguisherItems': return <>{quit}{next()}</>;
      case 'weather': return <>{quit}{next()}</>;
      case 'recap':
        return <>{quit}
          <Button variant="contained" onClick={commit} disabled={committing} startIcon={committing ? <CircularProgress size={16} color="inherit" /> : null}>Valider et terminer</Button>
        </>;
      default: return quit;
    }
  }

  function renderBody() {
    if (loading) return <LoadingState />;
    if (error && !data) return <ErrorAlert message={error} />;
    if (!data) return null;
    if (sasLock) {
      return (
        <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
          <LockIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
          <Typography variant="body1">{lockedMessage}</Typography>
        </Stack>
      );
    }
    // Intro leads with the property photo, so suppress the big centred step icon there.
    const bodyIcon = stepKey === 'intro' ? null : stepMeta(stepKey, mode).Icon;
    return <StepLayout Icon={bodyIcon} color={modeColor}>{renderStepContent()}</StepLayout>;
  }

  const meta = stepMeta(stepKey, mode);
  const StepIcon = sasLock ? LockIcon : meta.Icon;
  const stepIdx = activeKeys.indexOf(stepKey);
  const bandTitle = sasLock ? lockedTitle : (meta.title || (mode === 'arrival' ? 'Arrivée' : 'Départ'));
  return (
    <>
    {/* Focus trap fully relinquished (disableAutoFocus + disableEnforceFocus + disableRestoreFocus):
        on mobile Safari / an installed iOS PWA, MUI's focus trap intermittently re-steals focus on
        open / re-render, leaving the « Suivant » & answer buttons unresponsive (taps do nothing, then
        a burst registers and skips steps — random per step). Disabling auto-focus too stops the trap
        from grabbing focus at all, so taps stay reliable. A SAS wizard needs no auto-focus.
        (specs/arrival-departure-sas.md §6 — extends the 2026-06-12 "buttons dead after wake" fix.) */}
    <Dialog open={open} onClose={committing ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}
      disableAutoFocus disableEnforceFocus disableRestoreFocus>
      {/* Mode-coloured header band (specs/arrival-departure-sas.md §6 refonte). The ✕ IS the Quitter. */}
      <Box sx={{ bgcolor: modeColor, color: 'common.white', px: { xs: 2, sm: 3 }, pt: 1.5, pb: stepIdx >= 0 ? 1 : 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {stepIdx > 0 && (
            <IconButton onClick={goBack} disabled={committing} sx={{ color: 'common.white', ml: -0.5 }} aria-label="Précédent"><ArrowBackIcon /></IconButton>
          )}
          {StepIcon && <StepIcon sx={{ fontSize: 28 }} />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="sectionHeader" sx={{ display: 'block', lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: 0.5, color: 'inherit' }}>{bandTitle}</Typography>
            {r && <Typography variant="caption" noWrap sx={{ display: 'block', opacity: 0.9 }}>{r.firstName} {r.lastName} · {r.propertyName}</Typography>}
          </Box>
          {/* specs/reception-role-checkin-only.md §3.4 — hidden for the reception role (no reservation
              sheet access); the SAS itself stays fully usable. */}
          {r && canOpenReservation && (
            <Link component="button" type="button" variant="caption" underline="hover"
              sx={{ color: 'common.white', whiteSpace: 'nowrap' }}
              onClick={() => navigate(`/reservations/${reservationId}`)}>Fiche</Link>
          )}
          <IconButton onClick={onClose} disabled={committing} sx={{ color: 'common.white', ml: 0.5 }} aria-label="Quitter"><CloseIcon /></IconButton>
        </Stack>
        {stepIdx >= 0 && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress variant="determinate" value={((stepIdx + 1) / activeKeys.length) * 100}
              sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: alpha(t.palette.common.white, 0.3), '& .MuiLinearProgress-bar': { bgcolor: 'common.white' } })} />
            <Typography variant="caption" sx={{ opacity: 0.9, mt: 0.5, display: 'block' }}>Étape {stepIdx + 1}/{activeKeys.length}</Typography>
          </Box>
        )}
      </Box>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 }, minHeight: 240 }}>
        {renderBody()}
        {error && data && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ p: { xs: 2, sm: 2 }, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, justifyContent: { sm: 'flex-end' }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, py: 1.5, fontSize: '1rem', minHeight: 48 } }}>
        {renderActions()}
      </DialogActions>
    </Dialog>
    <ConfirmDialog
      open={breakfastWarnOpen}
      onClose={() => setBreakfastWarnOpen(false)}
      onConfirm={() => { setBreakfastWarnOpen(false); goNext(); }}
      title="Quantités ≠ personnes"
      message={breakfastWarnMessage}
      confirmLabel="Continuer"
      cancelLabel="Modifier"
      confirmColor="warning"
    />
    </>
  );
}
