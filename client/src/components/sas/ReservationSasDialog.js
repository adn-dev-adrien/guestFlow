/**
 * ReservationSasDialog — guided check-in / check-out wizard (specs/arrival-departure-sas.md).
 *
 * Launched from the Planning (arrival card → mode 'arrival', departure row → mode 'departure').
 * A forward-only sequence of single-purpose pages; every page has « Quitter » (closes, writes
 * NOTHING). All decisions are accumulated in memory and committed in ONE call at the final recap.
 *
 * Props: { open, reservationId, mode: 'arrival'|'departure', onClose, onCommitted }
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Button, Box, Typography, Stack,
  CircularProgress, Checkbox, TextField, Link, Divider, Chip, useMediaQuery,
  LinearProgress, IconButton, FormControlLabel,
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
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { getPlatformColor, formatPlatformLabel } from '../../constants/platforms';
import ConfirmDialog from '../ConfirmDialog';
import LoadingState from '../LoadingState';
import ErrorAlert from '../ErrorAlert';
import { useToast } from '../DialogProvider';
import SasWeatherAlertPage from './SasWeatherAlertPage';
import { formatCurrency, displayDateLong } from '../../utils/formatters';

// French display for stepper values: integers as-is, halves with a comma (« 1,5 »).
function formatStepperValue(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

// Stepper for a labelled breakfast item (icon + label, no price). `step` defaults to 1
// (integer counts); bread uses 0.5 (half-baguette steps — spec sas-breakfast-bread-and-push.md).
// Module-level so it keeps a stable identity across parent re-renders (an inline component
// would remount on every keystroke/click and detach its DOM nodes mid-interaction).
function CountStepper({ icon, label, value, onChange, step = 1 }) {
  const snap = (v) => Math.max(0, Math.round((Number(v) || 0) / step) * step);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => onChange(snap(value - step))} disabled={value <= 0} sx={{ minWidth: 36 }}>−</Button>
        <TextField value={formatStepperValue(value)} onChange={(e) => onChange(snap(String(e.target.value).replace(',', '.')))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
        <Button size="small" variant="outlined" onClick={() => onChange(snap(value + step))} sx={{ minWidth: 36 }}>+</Button>
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
    case 'breakfast': return { title: 'Petit déjeuner', Icon: FreeBreakfastIcon };
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

export default function ReservationSasDialog({ open, reservationId, mode = 'arrival', onClose, onCommitted }) {
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
  // specs/sas-bath-linen-upsell.md — arrival bath-linen upsell: null | 'now' | 'endOfStay'.
  const [bathLinenChoice, setBathLinenChoice] = useState(null);
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
  // Re-edit (specs/reopen-completed-sas.md): complement lines from a PRIOR commit whose label no
  // longer maps to a priced item (renamed / deleted since) — carried verbatim into the re-commit so
  // they're never lost or duplicated.
  const [preservedArrival, setPreservedArrival] = useState([]);
  const [preservedDeparture, setPreservedDeparture] = useState([]);
  // specs/recall-unpaid-arrival-complement-at-checkout.md — explicit « encaissé » confirmations on the
  // recaps (+ caisse-interne flag). Arrival: settles the arrival complement. Departure: settles every
  // positive complement (end-of-stay + recalled arrival).
  const [complementSettled, setComplementSettled] = useState(false);
  const [complementPaidCash, setComplementPaidCash] = useState(false);
  const [complementsSettled, setComplementsSettled] = useState(false);
  const [complementsPaidCash, setComplementsPaidCash] = useState(false);
  // Weather alerts (specs/checkin-weather-alerts.md) — fetched in the background when the arrival SAS
  // opens; empty until (and unless) a qualifying Orange/Red vigilance overlaps the stay.
  const [weatherAlerts, setWeatherAlerts] = useState([]);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let cancelled = false;
    setLoading(true); setError(''); setData(null); setStepKey(null);
    setCaution(null); setLinenOk(null); setMissingBed({}); setCleaningAdded(false);
    setCleaningOk(null); setMissingAsk(null); setMissingDep({}); setKeysReceived(null); setCautionReturned(null); setExtinguisherOk(true); setExtinguisherQty({});
    setBreakfast({ coffee: 0, tea: 0, chocolate: 0, milk: 0 }); setBreakfastFood({ pastries: 0, cereals: 0, bread: 0 }); setBreakfastTime(''); setBreakfastNote(''); setHandoverNote(''); setBreakfastWarnOpen(false);
    setPreservedArrival([]); setPreservedDeparture([]);
    setComplementSettled(false); setComplementPaidCash(false); setComplementsSettled(false); setComplementsPaidCash(false);
    setWeatherAlerts([]);
    api.getReservationSas(reservationId)
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
        // Re-edit pre-fill (specs/reopen-completed-sas.md §2): a SAS already committed reopens with
        // every decision seeded from the persisted reservation. A fresh SAS keeps the blank defaults.
        const editing = mode === 'arrival' ? !!res.arrivalSasDoneAt : !!res.departureSasDoneAt;
        if (!editing) return;
        const sealToBool = (v) => (v == null ? true : Number(v) === 1);
        if (mode === 'arrival') {
          setCaution(res.cautionReceived ? 'fait' : null);
          setComplementSettled(Number(res.complementPaid) === 1);
          setComplementPaidCash(Number(res.complementPaidCash) === 1);
          setHandoverNote(res.departureHandoverNote || '');
          // Reconstruct the bed-linen complement + cleaning charge from the SAS-origin lines (§5).
          const bedByLabel = new Map((d.linenItems || []).filter((i) => i.category === 'bed').map((i) => [String(i.label), i]));
          const nextBed = {}; let nextCleaning = false; let nextBathLinen = null; const keep = [];
          const bathLinenLabel = String(d.bathLinen?.label || 'Linge de toilette');
          (res.options || []).filter((o) => o.isCustom && Number(o.sasArrivalOrigin) === 1).forEach((o) => {
            const label = String(o.description || o.title || '');
            const amount = Number(o.unitPrice ?? o.amount ?? o.totalPrice ?? 0);
            if (label === 'Ménage') { nextCleaning = true; return; }
            // specs/sas-bath-linen-upsell.md §3.2 rule 8 — the « réglé maintenant » bath-linen line.
            if (label === bathLinenLabel) { nextBathLinen = 'now'; return; }
            const item = bedByLabel.get(label);
            if (item && Number(item.price) > 0) nextBed[item.id] = Math.max(1, Math.round(amount / Number(item.price)));
            else keep.push({ label, amount });
          });
          // The « réglé en fin de séjour » bath-linen line lives in the end-of-stay complement detail.
          if (!nextBathLinen) {
            let eos = [];
            try { eos = JSON.parse(res.endOfStayComplementDetail || '[]') || []; } catch { eos = []; }
            if (eos.some((l) => l && l.source === 'arrivalBathLinen')) nextBathLinen = 'endOfStay';
          }
          setMissingBed(nextBed); setCleaningAdded(nextCleaning); setBathLinenChoice(nextBathLinen); setPreservedArrival(keep);
          if (res.bedLinenAlert) setLinenOk(Object.keys(nextBed).length === 0);
        } else {
          setCautionReturned(res.cautionReturned ? true : false);
          setComplementsSettled(Number(res.endOfStayComplementPaid) === 1);
          setComplementsPaidCash(Number(res.endOfStayComplementPaidCash) === 1);
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
            if (line.repairKey && String(line.repairKey).startsWith('extinguisher')) {
              nextExtinguisher[String(line.repairKey)] = Math.max(1, Number(line.qty) || 1);
              return;
            }
            if (label === 'Ménage de fin de séjour') { charged = true; return; }
            const item = byLabel.get(label);
            if (item) nextDep[item.id] = Number(line.qty) || Math.max(1, Math.round(Number(line.amount) / Number(item.price || 1)));
            else keep.push({ label, amount: Number(line.amount) || 0 });
          });
          setMissingDep(nextDep); setExtinguisherQty(nextExtinguisher); setPreservedDeparture(keep);
          setCleaningOk(!charged);
          setMissingAsk(Object.keys(nextDep).length > 0 ? true : null);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Erreur de chargement.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reservationId]);

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
  const bedItems = useMemo(() => (data?.linenItems || []).filter((i) => i.category === 'bed'), [data]);
  const allItems = useMemo(() => (data?.linenItems || []), [data]);

  // Ordered list of active page keys, given the data + current decisions.
  const activeKeys = useMemo(() => {
    if (!data) return [];
    // On departure, the caution-RETURN step stays reachable when re-editing a completed SAS
    // (specs/reopen-completed-sas.md §3 rule 3), so a mis-marked return can be corrected.
    const isEditing = mode === 'arrival' ? !!r.arrivalSasDoneAt : !!r.departureSasDoneAt;
    if (mode === 'arrival') {
      // Arrival caution is hidden as soon as it's received, even in re-edit (specs/sas-hide-settled-steps.md §3).
      const cautionStep = Number(r.cautionAmount || 0) > 0 && !r.cautionReceived;
      const hasOptions = (r.options || []).length > 0 || (r.resources || []).length > 0;
      return [
        'intro',
        data.portalCode ? 'portal' : null,
        cautionStep ? 'caution' : null,
        hasOptions ? 'options' : null,
        data.breakfast?.applicable ? 'breakfast' : null,
        r.bedLinenAlert ? 'linen' : null,
        (r.bedLinenAlert && linenOk === false) ? 'linenItems' : null,
        // Ménage step is hidden when the cleaning is already included (specs/sas-hide-settled-steps.md §3);
        // the vaisselle/poubelles reminder then moves to the recap.
        data.cleaning?.included ? null : 'cleaning',
        // specs/sas-bath-linen-upsell.md §3.1 — offer bath linen when the guest didn't take it.
        data.bathLinen?.available ? 'bathLinen' : null,
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
      'cleaning',
      'missingAsk',
      missingAsk === true ? 'missingItems' : null,
      'keys',
      cautionReturnStep ? 'cautionReturn' : null,
      'extinguisher',
      extinguisherOk === false ? 'extinguisherItems' : null,
      'recap',
    ].filter(Boolean);
  }, [data, mode, r, linenOk, caution, missingAsk, extinguisherOk, weatherAlerts]);

  const goNext = useCallback(() => {
    const i = activeKeys.indexOf(stepKey);
    if (i >= 0 && i < activeKeys.length - 1) setStepKey(activeKeys[i + 1]);
  }, [activeKeys, stepKey]);
  // « Précédent » — go back one active page (specs/arrival-departure-sas.md §3.0; in-memory
  // decisions persist, so revisiting a page shows the prior answer).
  const goBack = useCallback(() => {
    const i = activeKeys.indexOf(stepKey);
    if (i > 0) setStepKey(activeKeys[i - 1]);
  }, [activeKeys, stepKey]);

  // ---- totals ----
  const bedLines = useMemo(() => bedItems
    .filter((it) => Number(missingBed[it.id]) > 0)
    .map((it) => ({ label: it.label, unitPrice: Number(it.price) || 0, amount: Math.round(Number(it.price) * Number(missingBed[it.id]) * 100) / 100, qty: Number(missingBed[it.id]) })), [bedItems, missingBed]);
  const cleaningLine = (mode === 'arrival' && cleaningAdded && data?.cleaning?.price)
    ? { label: 'Ménage', unitPrice: Math.round(Number(data.cleaning.price) * 100) / 100, amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  // specs/sas-bath-linen-upsell.md §3.2 — « réglé maintenant » adds the bath linen to the arrival
  // complement (« réglé en fin de séjour » is sent as endOfStayBathLinen, priced server-side).
  const bathLinenNowLine = (mode === 'arrival' && bathLinenChoice === 'now' && data?.bathLinen?.available)
    ? { label: data.bathLinen.label, unitPrice: Math.round(Number(data.bathLinen.unitPrice) * 100) / 100, amount: Math.round(Number(data.bathLinen.amount) * 100) / 100, qty: Number(data.bathLinen.persons) || 1 } : null;
  const arrivalAddedLines = [...bedLines, ...(cleaningLine ? [cleaningLine] : []), ...(bathLinenNowLine ? [bathLinenNowLine] : [])];
  const arrivalAdded = arrivalAddedLines.reduce((s, l) => s + l.amount, 0);
  // On re-edit, the SAS-origin complement lines from the prior commit are REPLACED, not added — so
  // the recap must exclude their amount from « déjà dû » (specs/reopen-completed-sas.md §4), else it
  // would double-count the very lines we re-show. 0 on a fresh SAS (no SAS-origin lines yet).
  const sasOriginSum = useMemo(() => (r?.options || [])
    .filter((o) => o.isCustom && Number(o.sasArrivalOrigin) === 1)
    .reduce((s, o) => s + Number(o.unitPrice ?? o.amount ?? o.totalPrice ?? 0), 0), [r]);
  const preservedArrivalSum = preservedArrival.reduce((s, l) => s + Number(l.amount || 0), 0);

  // Detail of the PRE-EXISTING complement (the « déjà dû »): every extra routed to the complément
  // (options / resources / custom — `inComplement`), with its quantity + unit price, EXCLUDING the
  // SAS-origin lines (those are re-shown as the « + » added lines). Lets the operator see exactly what
  // makes up the complement to settle, not just the lump sum. Sum == `existing` in the recap.
  const complementDetailLines = useMemo(() => {
    const extras = [...((r?.options) || []), ...((r?.resources) || [])];
    const lines = extras
      .filter((x) => Number(x.inComplement) === 1 && Number(x.offered || 0) !== 1
        && Number(x.totalPrice || 0) > 0 && Number(x.sasArrivalOrigin || 0) !== 1)
      .map((x) => ({
        label: x.title || x.name || 'Prestation',
        qty: Number(x.billedUnits || x.quantity || 1),
        unitPrice: Number(x.unitPrice || 0),
        amount: Math.round(Number(x.totalPrice || 0) * 100) / 100,
      }));
    // specs/per-platform-tourist-tax-three-way.md §3 rule 7 — when the tourist tax is collected at
    // arrival it's part of `complementAmount` but isn't an option/resource line; itemise it explicitly
    // (server-computed amount) so the detail reconciles with the « existing » total.
    const taxAmount = Math.round(Number(r?.touristTaxInComplementAmount || 0) * 100) / 100;
    if (taxAmount > 0) lines.push({ label: 'Taxe de séjour', qty: 1, unitPrice: taxAmount, amount: taxAmount });
    return lines;
  }, [r]);

  // « label : qty × unitPrice € = total € » when there is a meaningful quantity, else « label : total € ».
  const lineText = (l) => {
    const qty = Number(l.qty || 0);
    const unit = Number(l.unitPrice || 0);
    if (qty > 1 && unit > 0) return `${l.label} : ${qty} × ${formatCurrency(unit)} = ${formatCurrency(l.amount)}`;
    return `${l.label} : ${formatCurrency(l.amount)}`;
  };

  const depMissingLines = useMemo(() => allItems
    .filter((it) => Number(missingDep[it.id]) > 0)
    .map((it) => ({ label: it.label, unitPrice: Number(it.price) || 0, amount: Math.round(Number(it.price) * Number(missingDep[it.id]) * 100) / 100, qty: Number(missingDep[it.id]) })), [allItems, missingDep]);
  const depCleaningLine = (cleaningOk === false && data?.cleaning?.price)
    ? { label: 'Ménage de fin de séjour', unitPrice: Math.round(Number(data.cleaning.price) * 100) / 100, amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  // Fire-extinguisher tariffs (specs/extinguisher-seal-and-repair-amounts.md §3.2): at DEPARTURE, if the
  // extinguisher is not in good condition, the operator enters a quantity for each extinguisher_* tariff.
  // The bill is computed server-side from the quantities; these are PREVIEW lines for the recap only.
  const extinguisherTariffs = useMemo(
    () => (data?.repairAmounts || []).filter((x) => String(x.repairKey || '').startsWith('extinguisher')),
    [data],
  );
  const extinguisherLines = useMemo(() => extinguisherTariffs
    .filter((t) => Number(extinguisherQty[t.repairKey]) > 0)
    .map((t) => ({ repairKey: t.repairKey, label: t.label, unitPrice: Number(t.price) || 0, qty: Number(extinguisherQty[t.repairKey]), amount: Math.round(Number(t.price) * Number(extinguisherQty[t.repairKey]) * 100) / 100 })), [extinguisherTariffs, extinguisherQty]);
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
    return detail
      .filter((l) => l && l.source)
      .map((l) => ({ label: l.label, unitPrice: Number(l.unitPrice) || 0, amount: Math.round(Number(l.amount || 0) * 100) / 100, qty: Number(l.qty) || 1, source: l.source }));
  }, [mode, r]);
  // Lines billed by the laundry/cleaning flow (sent to the server verbatim). The extinguisher lines are
  // sent as quantities (extinguisherCharges) — the server prices them — so they're excluded here.
  const endOfStaySentLines = [...(depCleaningLine ? [depCleaningLine] : []), ...depMissingLines];
  const endOfStayLines = [...endOfStaySentLines, ...carriedEndOfStayLines, ...previewExtinguisherLines];
  const endOfStayTotal = endOfStayLines.reduce((s, l) => s + l.amount, 0);
  // specs/recall-unpaid-arrival-complement-at-checkout.md — at departure, recall the arrival complement
  // when it was never settled (amount > 0 AND not paid). The amount stays separate in the DB; here it's
  // only the combined total to collect + the detail to show.
  const arrivalRecall = (mode === 'departure'
    && data?.arrivalComplement
    && Number(data.arrivalComplement.amount) > 0
    && Number(data.arrivalComplement.paid) !== 1)
    ? data.arrivalComplement : null;
  const recalledArrivalAmount = arrivalRecall ? Math.round(Number(arrivalRecall.amount) * 100) / 100 : 0;
  const departureGrandTotal = Math.round((endOfStayTotal + recalledArrivalAmount) * 100) / 100;

  const commit = async () => {
    setCommitting(true); setError('');
    try {
      if (mode === 'arrival') {
        const payload = {
          // undefined when the caution step isn't shown → server leaves the marker untouched
          // (specs/reopen-completed-sas.md §6); otherwise faithful set/clear from the answer.
          cautionReceived: activeKeys.includes('caution') ? (caution === 'fait') : undefined,
          complementItems: [...arrivalAddedLines.map((l) => ({ label: l.label, amount: l.amount })), ...preservedArrival],
          departureHandoverNote: handoverNote,
          // specs/recall-unpaid-arrival-complement-at-checkout.md — « Complément encaissé » confirmation.
          complementSettled,
          complementPaidCash,
          // specs/sas-bath-linen-upsell.md §3.2 — tri-state: undefined when the bath-linen step isn't
          // shown (server leaves the end-of-stay complement untouched); true = « réglé en fin de séjour »
          // (server prices it per person); false = « réglé maintenant » / « Non merci » (drops any prior line).
          endOfStayBathLinen: activeKeys.includes('bathLinen') ? (bathLinenChoice === 'endOfStay') : undefined,
        };
        if (data.breakfast?.applicable) {
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
          endOfStayComplementDetail: [...endOfStaySentLines, ...carriedEndOfStayLines, ...preservedDeparture],
          extinguisherSealOkAtDeparture: extinguisherOk ? 1 : 0,
          extinguisherCharges: extinguisherBilled
            ? extinguisherTariffs.map((t) => ({ repairKey: t.repairKey, qty: Number(extinguisherQty[t.repairKey]) || 0 }))
            : [],
          // specs/recall-unpaid-arrival-complement-at-checkout.md — « Compléments encaissés » → mark every
          // positive complement paid (end-of-stay + recalled arrival).
          complementsSettled,
          complementsPaidCash,
        });
      }
      if (onCommitted) onCommitted();
      if (onClose) onClose();
    } catch (e) {
      // Inline (visible in the fullscreen dialog) + toast (app-wide feedback channel).
      setError(e?.message || "Échec de l'enregistrement.");
      showError(e?.message || "Échec de l'enregistrement du SAS.");
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
  const breakfastPersons = Number(data?.breakfast?.persons || 0);
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
        const chip = bathLinenChoice === 'now' ? 'réglé maintenant'
          : bathLinenChoice === 'endOfStay' ? 'réglé en fin de séjour' : null;
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Le client n'a pas pris le linge de toilette.</Typography>
            <Typography variant="body2">Tarif : <strong>{formatCurrency(bl.amount)}</strong> ({bl.persons} pers × {formatCurrency(bl.unitPrice)}). Proposer au client ?</Typography>
            {chip && <Chip label={`Linge ajouté (${formatCurrency(bl.amount)}) — ${chip}`} color="info" sx={{ alignSelf: 'flex-start' }} />}
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
          const existing = Math.max(0, Math.round((Number(r.complementAmount || 0) - sasOriginSum) * 100) / 100);
          const total = Math.round((existing + arrivalAdded + preservedArrivalSum) * 100) / 100;
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
                  lump « Déjà dû ». Falls back to the total if the breakdown isn't available. */}
              {existing > 0 && (
                complementDetailLines.length > 0
                  ? complementDetailLines.map((l, i) => <Typography key={`d${i}`} variant="body2">{lineText(l)}</Typography>)
                  : <Typography variant="body2">Déjà dû : <strong>{formatCurrency(existing)}</strong></Typography>
              )}
              {arrivalAddedLines.map((l, i) => <Typography key={i} variant="body2">+ {lineText(l)}</Typography>)}
              {preservedArrival.map((l, i) => <Typography key={`p${i}`} variant="body2">+ {l.label} : {formatCurrency(l.amount)}</Typography>)}
              <Divider />
              {/* Amounts never render in serif → bold sans body, not sectionHeader. */}
              <Typography variant="body1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>Total : {formatCurrency(total)}</Typography>
              {caution === 'fait' && <Typography variant="body2" color="success.main">Caution marquée comme perçue.</Typography>}
              {Number(r.complementPaid || 0) === 1 && arrivalAdded > 0 && (
                <Typography variant="body2" color="warning.main">⚠ Le complément était déjà marqué payé : encaisser le supplément ({formatCurrency(arrivalAdded)}) manuellement.</Typography>
              )}
              {total > 0 && Number(r.complementPaid || 0) !== 1 && (
                <>
                  <FormControlLabel
                    control={<Checkbox checked={complementSettled} onChange={(e) => setComplementSettled(e.target.checked)} />}
                    label="Complément encaissé"
                  />
                  {complementSettled && (
                    <FormControlLabel
                      sx={{ ml: 2 }}
                      control={<Checkbox size="small" checked={complementPaidCash} onChange={(e) => setComplementPaidCash(e.target.checked)} />}
                      label="Caisse interne"
                    />
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
            {endOfStayLines.length === 0 && recalledArrivalAmount === 0 && <Typography variant="body2" color="text.secondary">Aucun complément de fin de séjour.</Typography>}
            {endOfStayLines.map((l, i) => <Typography key={i} variant="body2">{lineText(l)}</Typography>)}
            {/* specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement was never
                settled: recall it with its full detail, on top of the end-of-stay lines. */}
            {arrivalRecall && (
              <>
                <Divider />
                <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', color: 'warning.main' }}>Compléments d'arrivée non perçus</Typography>
                {(arrivalRecall.detail || []).map((l, i) => (
                  <Typography key={`ar${i}`} variant="body2">{l.label} : {formatCurrency(l.amount)}</Typography>
                ))}
                <Typography variant="body2">Sous-total arrivée : <strong>{formatCurrency(recalledArrivalAmount)}</strong></Typography>
              </>
            )}
            {departureGrandTotal > 0 && (<><Divider /><Typography variant="body1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>Total à percevoir : {formatCurrency(departureGrandTotal)}</Typography></>)}
            {departureGrandTotal > 0 && (
              <>
                <FormControlLabel
                  control={<Checkbox checked={complementsSettled} onChange={(e) => setComplementsSettled(e.target.checked)} />}
                  label="Compléments encaissés"
                />
                {complementsSettled && (
                  <FormControlLabel
                    sx={{ ml: 2 }}
                    control={<Checkbox size="small" checked={complementsPaidCash} onChange={(e) => setComplementsPaidCash(e.target.checked)} />}
                    label="Caisse interne"
                  />
                )}
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
        // specs/sas-bath-linen-upsell.md §3.2 — neutral upsell (not a yes/no safety question): two add
        // actions (defer / pay now) + a discreet decline.
        return <>{quit}
          <Button variant="contained" onClick={() => { setBathLinenChoice('endOfStay'); goNext(); }}>Réglé en fin de séjour</Button>
          <Button variant="contained" onClick={() => { setBathLinenChoice('now'); goNext(); }}>Réglé maintenant</Button>
          <Button variant="outlined" onClick={() => { setBathLinenChoice(null); goNext(); }}>Non merci</Button>
        </>;
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
    // Intro leads with the property photo, so suppress the big centred step icon there.
    const bodyIcon = stepKey === 'intro' ? null : stepMeta(stepKey, mode).Icon;
    return <StepLayout Icon={bodyIcon} color={modeColor}>{renderStepContent()}</StepLayout>;
  }

  const meta = stepMeta(stepKey, mode);
  const StepIcon = meta.Icon;
  const stepIdx = activeKeys.indexOf(stepKey);
  const bandTitle = meta.title || (mode === 'arrival' ? 'Arrivée' : 'Départ');
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
          {r && (
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
