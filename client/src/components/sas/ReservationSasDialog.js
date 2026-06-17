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
  LinearProgress, IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
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
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { getPlatformColor, formatPlatformLabel } from '../../constants/platforms';
import ConfirmDialog from '../ConfirmDialog';

function euro(n) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
}
function frDate(iso) {
  if (!iso) return '';
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}

// Integer stepper for a labelled breakfast drink (icon + label, no price). Module-level so it
// keeps a stable identity across parent re-renders (an inline component would remount on every
// keystroke/click and detach its DOM nodes mid-interaction).
function CountStepper({ icon, label, value, onChange }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} sx={{ minWidth: 36 }}>−</Button>
        <TextField value={value} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
        <Button size="small" variant="outlined" onClick={() => onChange(value + 1)} sx={{ minWidth: 36 }}>+</Button>
      </Stack>
    </Stack>
  );
}

// Mode accent colours for the header band + the big step icon (specs/arrival-departure-sas.md §6 refonte).
const MODE_COLOR = { arrival: '#ef6c00', departure: '#455a64' };

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
    case 'missingAsk':
    case 'missingItems': return { title: 'Serviettes / draps', Icon: DryCleaningIcon };
    case 'keys': return { title: 'Clés', Icon: VpnKeyIcon };
    case 'cautionReturn': return { title: 'Retour caution', Icon: SavingsIcon };
    case 'extinguisher':
    case 'extinguisherItems': return { title: 'Extincteur', Icon: FireExtinguisherIcon };
    case 'recap': return { title: 'Récapitulatif', Icon: FactCheckIcon };
    default: return { title: '', Icon: null };
  }
}

// Big centred step icon above the page content + a slightly larger body type scale (refonte §6).
function StepLayout({ Icon, color, children }) {
  return (
    <Stack spacing={2.5} sx={{ alignItems: 'center' }}>
      {Icon && (
        <Box sx={{ width: 84, height: 84, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${color}1A`, color, flexShrink: 0 }}>
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
      <Button variant="contained" color="error" sx={{ color: '#000' }} onClick={onBad}>{badLabel}</Button>
      <Button variant="contained" onClick={onGood}>{goodLabel}</Button>
    </>
  );
}

// Arrival / departure line in the SAS intro — same visual language as the planning cards:
// a coloured ARRIVÉE/DÉPART chip (FlightLand/FlightTakeoff) + the date + a time pill, left-aligned.
function IntroDateRow({ kind, date, time }) {
  const isArrival = kind === 'arrival';
  const bg = isArrival ? 'warning.main' : '#455a64'; // orange arrival / slate departure (planning palette)
  const Icon = isArrival ? FlightLandIcon : FlightTakeoffIcon;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip
        icon={<Icon sx={{ fontSize: 16, color: 'white !important' }} />}
        label={isArrival ? 'ARRIVÉE' : 'DÉPART'}
        size="small"
        sx={{ height: 24, fontSize: 11, fontWeight: 800, color: 'white', bgcolor: bg, '& .MuiChip-icon': { ml: 0.75, mr: -0.25 } }}
      />
      <Typography variant="body1" sx={{ fontWeight: 600 }}>{frDate(date)}</Typography>
      <Chip
        icon={<AccessTimeIcon sx={{ fontSize: 14, color: 'white !important' }} />}
        label={time}
        size="small"
        sx={{ height: 20, fontSize: 12, fontWeight: 800, borderRadius: 1.5, color: 'white', bgcolor: bg, '& .MuiChip-icon': { ml: 0.5, mr: -0.25 } }}
      />
    </Stack>
  );
}

export default function ReservationSasDialog({ open, reservationId, mode = 'arrival', onClose, onCommitted }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

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
  const [cleaningOk, setCleaningOk] = useState(null);     // departure: true | false
  const [missingAsk, setMissingAsk] = useState(null);     // departure: true | false
  const [missingDep, setMissingDep] = useState({});       // departure: { itemId: qty }
  const [keysReceived, setKeysReceived] = useState(null); // departure
  const [cautionReturned, setCautionReturned] = useState(null); // departure
  const [extinguisherOk, setExtinguisherOk] = useState(true);   // fire-extinguisher — default GOOD CONDITION
  const [extinguisherQty, setExtinguisherQty] = useState({});   // departure: { repairKey: qty } when not OK
  // arrival breakfast page (specs/sas-breakfast-and-handover-note.md)
  const [breakfast, setBreakfast] = useState({ coffee: 0, tea: 0, chocolate: 0 });
  const [breakfastTime, setBreakfastTime] = useState('');
  const [breakfastNote, setBreakfastNote] = useState('');
  const [handoverNote, setHandoverNote] = useState(''); // arrival recap → shown at departure
  const [breakfastWarnOpen, setBreakfastWarnOpen] = useState(false);
  // Re-edit (specs/reopen-completed-sas.md): complement lines from a PRIOR commit whose label no
  // longer maps to a priced item (renamed / deleted since) — carried verbatim into the re-commit so
  // they're never lost or duplicated.
  const [preservedArrival, setPreservedArrival] = useState([]);
  const [preservedDeparture, setPreservedDeparture] = useState([]);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let cancelled = false;
    setLoading(true); setError(''); setData(null); setStepKey(null);
    setCaution(null); setLinenOk(null); setMissingBed({}); setCleaningAdded(false);
    setCleaningOk(null); setMissingAsk(null); setMissingDep({}); setKeysReceived(null); setCautionReturned(null); setExtinguisherOk(true); setExtinguisherQty({});
    setBreakfast({ coffee: 0, tea: 0, chocolate: 0 }); setBreakfastTime(''); setBreakfastNote(''); setHandoverNote(''); setBreakfastWarnOpen(false);
    setPreservedArrival([]); setPreservedDeparture([]);
    api.getReservationSas(reservationId)
      .then((d) => {
        if (cancelled) return;
        setData(d); setStepKey('intro');
        const res = d?.reservation || {};
        const b = d?.breakfast;
        if (b?.applicable) {
          setBreakfast({ coffee: Number(b.coffee) || 0, tea: Number(b.tea) || 0, chocolate: Number(b.chocolate) || 0 });
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
          setHandoverNote(res.departureHandoverNote || '');
          // Reconstruct the bed-linen complement + cleaning charge from the SAS-origin lines (§5).
          const bedByLabel = new Map((d.linenItems || []).filter((i) => i.category === 'bed').map((i) => [String(i.label), i]));
          const nextBed = {}; let nextCleaning = false; const keep = [];
          (res.options || []).filter((o) => o.isCustom && Number(o.sasArrivalOrigin) === 1).forEach((o) => {
            const label = String(o.description || o.title || '');
            const amount = Number(o.unitPrice ?? o.amount ?? o.totalPrice ?? 0);
            if (label === 'Ménage') { nextCleaning = true; return; }
            const item = bedByLabel.get(label);
            if (item && Number(item.price) > 0) nextBed[item.id] = Math.max(1, Math.round(amount / Number(item.price)));
            else keep.push({ label, amount });
          });
          setMissingBed(nextBed); setCleaningAdded(nextCleaning); setPreservedArrival(keep);
          if (res.bedLinenAlert) setLinenOk(Object.keys(nextBed).length === 0);
        } else {
          setCautionReturned(res.cautionReturned ? true : false);
          setExtinguisherOk(sealToBool(res.extinguisherSealOkAtDeparture));
          let detail = [];
          try { detail = JSON.parse(res.endOfStayComplementDetail || '[]') || []; } catch { detail = []; }
          const byLabel = new Map((d.linenItems || []).map((i) => [String(i.label), i]));
          const nextDep = {}; const nextExtinguisher = {}; let charged = false; const keep = [];
          detail.forEach((line) => {
            const label = String(line.label || '');
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

  const r = data?.reservation;
  const modeColor = MODE_COLOR[mode] || MODE_COLOR.arrival;
  const bedItems = useMemo(() => (data?.linenItems || []).filter((i) => i.category === 'bed'), [data]);
  const allItems = useMemo(() => (data?.linenItems || []), [data]);

  // Ordered list of active page keys, given the data + current decisions.
  const activeKeys = useMemo(() => {
    if (!data) return [];
    // When re-editing a completed SAS (specs/reopen-completed-sas.md §3 rule 3), the caution steps
    // stay reachable even if already received / returned, so they can be reviewed or corrected.
    const isEditing = mode === 'arrival' ? !!r.arrivalSasDoneAt : !!r.departureSasDoneAt;
    if (mode === 'arrival') {
      const cautionStep = Number(r.cautionAmount || 0) > 0 && (!r.cautionReceived || isEditing);
      const hasOptions = (r.options || []).length > 0 || (r.resources || []).length > 0;
      return [
        'intro',
        data.portalCode ? 'portal' : null,
        cautionStep ? 'caution' : null,
        hasOptions ? 'options' : null,
        data.breakfast?.applicable ? 'breakfast' : null,
        r.bedLinenAlert ? 'linen' : null,
        (r.bedLinenAlert && linenOk === false) ? 'linenItems' : null,
        'cleaning',
        (cautionStep && caution === 'reporte') ? 'cautionReport' : null,
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
  }, [data, mode, r, linenOk, caution, missingAsk, extinguisherOk]);

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
    .map((it) => ({ label: it.label, amount: Math.round(Number(it.price) * Number(missingBed[it.id]) * 100) / 100, qty: Number(missingBed[it.id]) })), [bedItems, missingBed]);
  const cleaningLine = (mode === 'arrival' && cleaningAdded && data?.cleaning?.price)
    ? { label: 'Ménage', amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  const arrivalAddedLines = [...bedLines, ...(cleaningLine ? [cleaningLine] : [])];
  const arrivalAdded = arrivalAddedLines.reduce((s, l) => s + l.amount, 0);
  // On re-edit, the SAS-origin complement lines from the prior commit are REPLACED, not added — so
  // the recap must exclude their amount from « déjà dû » (specs/reopen-completed-sas.md §4), else it
  // would double-count the very lines we re-show. 0 on a fresh SAS (no SAS-origin lines yet).
  const sasOriginSum = useMemo(() => (r?.options || [])
    .filter((o) => o.isCustom && Number(o.sasArrivalOrigin) === 1)
    .reduce((s, o) => s + Number(o.unitPrice ?? o.amount ?? o.totalPrice ?? 0), 0), [r]);
  const preservedArrivalSum = preservedArrival.reduce((s, l) => s + Number(l.amount || 0), 0);

  const depMissingLines = useMemo(() => allItems
    .filter((it) => Number(missingDep[it.id]) > 0)
    .map((it) => ({ label: it.label, amount: Math.round(Number(it.price) * Number(missingDep[it.id]) * 100) / 100, qty: Number(missingDep[it.id]) })), [allItems, missingDep]);
  const depCleaningLine = (cleaningOk === false && data?.cleaning?.price)
    ? { label: 'Ménage de fin de séjour', amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  // Fire-extinguisher tariffs (specs/extinguisher-seal-and-repair-amounts.md §3.2): at DEPARTURE, if the
  // extinguisher is not in good condition, the operator enters a quantity for each extinguisher_* tariff.
  // The bill is computed server-side from the quantities; these are PREVIEW lines for the recap only.
  const extinguisherTariffs = useMemo(
    () => (data?.repairAmounts || []).filter((x) => String(x.repairKey || '').startsWith('extinguisher')),
    [data],
  );
  const extinguisherLines = useMemo(() => extinguisherTariffs
    .filter((t) => Number(extinguisherQty[t.repairKey]) > 0)
    .map((t) => ({ repairKey: t.repairKey, label: t.label, qty: Number(extinguisherQty[t.repairKey]), amount: Math.round(Number(t.price) * Number(extinguisherQty[t.repairKey]) * 100) / 100 })), [extinguisherTariffs, extinguisherQty]);
  const extinguisherBilled = mode === 'departure' && extinguisherOk === false;
  const previewExtinguisherLines = extinguisherBilled ? extinguisherLines : [];
  // Lines billed by the laundry/cleaning flow (sent to the server verbatim). The extinguisher lines are
  // sent as quantities (extinguisherCharges) — the server prices them — so they're excluded here.
  const endOfStaySentLines = [...(depCleaningLine ? [depCleaningLine] : []), ...depMissingLines];
  const endOfStayLines = [...endOfStaySentLines, ...previewExtinguisherLines];
  const endOfStayTotal = endOfStayLines.reduce((s, l) => s + l.amount, 0);

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
        };
        if (data.breakfast?.applicable) {
          payload.breakfastTime = breakfastTime;
          payload.breakfastCoffee = breakfast.coffee;
          payload.breakfastTea = breakfast.tea;
          payload.breakfastChocolate = breakfast.chocolate;
          payload.breakfastNote = breakfastNote;
        }
        await api.commitArrivalSas(reservationId, payload);
      } else {
        await api.commitDepartureSas(reservationId, {
          cautionReturned: activeKeys.includes('cautionReturn') ? (cautionReturned === true) : undefined,
          // The extinguisher lines are NOT sent here — the server prices the quantities below and appends
          // them, then recomputes the authoritative total (specs/extinguisher-seal-and-repair-amounts.md §3.2).
          endOfStayComplementDetail: [...endOfStaySentLines, ...preservedDeparture],
          extinguisherSealOkAtDeparture: extinguisherOk ? 1 : 0,
          extinguisherCharges: extinguisherBilled
            ? extinguisherTariffs.map((t) => ({ repairKey: t.repairKey, qty: Number(extinguisherQty[t.repairKey]) || 0 }))
            : [],
        });
      }
      if (onCommitted) onCommitted();
      if (onClose) onClose();
    } catch (e) {
      setError(e?.message || "Échec de l'enregistrement.");
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
          <Typography variant="caption" color="text.secondary">{euro(item.price)} / unité</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" onClick={() => set(qty - 1)} disabled={qty <= 0} sx={{ minWidth: 36 }}>−</Button>
          <TextField value={qty} onChange={(e) => set(Math.floor(Number(e.target.value) || 0))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
          <Button size="small" variant="outlined" onClick={() => set(qty + 1)} sx={{ minWidth: 36 }}>+</Button>
        </Stack>
      </Stack>
    );
  };

  // Breakfast coherence: total drinks vs the server-resolved morning person count (soft warning, rule 4b).
  const breakfastTotal = Number(breakfast.coffee) + Number(breakfast.tea) + Number(breakfast.chocolate);
  const breakfastPersons = Number(data?.breakfast?.persons || 0);
  const breakfastMismatch = breakfastTotal !== breakfastPersons;

  // ---- page renderers ----
  function renderStepContent() {
    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>;
    if (error && !data) return <Typography color="error">{error}</Typography>;
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
            {/* 2. Property name, centred. */}
            <Typography variant="h6" sx={{ textAlign: 'center', fontWeight: 700, lineHeight: 1.2 }}>{r.propertyName}</Typography>
            {/* 3. Client name — centred, blue, larger, wraps onto 2 lines if needed. */}
            <Typography variant="h4" sx={{ textAlign: 'center', color: 'primary.main', fontWeight: 800, lineHeight: 1.15, overflowWrap: 'anywhere' }}>
              {r.firstName} {r.lastName}
            </Typography>
            {/* 4. Platform badge — exactly like the planning (outlined, platform colour). */}
            {r.platform && (
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Box component="span" sx={{ px: 1, py: 0.375, border: '1.5px solid', borderColor: getPlatformColor(r.platform), color: getPlatformColor(r.platform), bgcolor: 'transparent', borderRadius: 1, fontSize: 14, fontWeight: 800, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
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
              <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'rgba(255, 193, 7, 0.12)', border: '1px solid', borderColor: 'warning.light' }}>
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
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: 2 }}>{data.portalCode}</Typography>
          </Stack>
        );
      case 'caution':
      case 'cautionReport':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Caution à percevoir : <strong>{euro(r.cautionAmount)}</strong></Typography>
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
            <TextField
              label="Heure du petit déjeuner"
              type="time"
              value={breakfastTime}
              onChange={(e) => setBreakfastTime(e.target.value)}
              size="small"
              sx={{ maxWidth: 200 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Divider />
            <Stack spacing={0.5} divider={<Divider />}>
              <CountStepper icon={<LocalCafeIcon color="action" />} label="Café" value={Number(breakfast.coffee)} onChange={(v) => setBreakfast((b) => ({ ...b, coffee: v }))} />
              <CountStepper icon={<EmojiFoodBeverageIcon color="action" />} label="Thé" value={Number(breakfast.tea)} onChange={(v) => setBreakfast((b) => ({ ...b, tea: v }))} />
              <CountStepper icon={<FreeBreakfastIcon sx={{ color: '#795548' }} />} label="Chocolat chaud" value={Number(breakfast.chocolate)} onChange={(v) => setBreakfast((b) => ({ ...b, chocolate: v }))} />
            </Stack>
            <Typography variant="caption" sx={{ color: breakfastMismatch ? 'warning.main' : 'text.secondary', fontWeight: breakfastMismatch ? 700 : 400 }}>
              {breakfastTotal} boisson{breakfastTotal > 1 ? 's' : ''} pour {breakfastPersons} personne{breakfastPersons > 1 ? 's' : ''}
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
                <Typography variant="body2" color="warning.main">Ménage à facturer : {euro(data.cleaning.price)}.</Typography>
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
              ? <Typography variant="body2">Tarif ménage pour ce logement : <strong>{euro(data.cleaning.price)}</strong>. Proposer au client ?</Typography>
              : <Typography variant="body2" color="text.secondary">Aucun tarif de ménage configuré pour ce logement.</Typography>}
            {cleaningAdded && <Chip label={`Ménage ajouté (${euro(data.cleaning.price)})`} color="info" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
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
            <Typography variant="body1">Rendre la caution de <strong>{euro(r.cautionAmount)}</strong>.</Typography>
            {cautionReturned === true && <Chip label="Caution rendue" color="success" sx={{ alignSelf: 'flex-start' }} />}
            {cautionReturned === false && <Chip label="Litige / dégât — caution conservée" color="error" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'extinguisher':
        return (
          <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ textAlign: 'center' }}>L'extincteur est-il en bon état ?</Typography>
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
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Sous-total : {euro(extinguisherLines.reduce((s, l) => s + l.amount, 0))}</Typography>
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
              <Typography variant="h6">Récapitulatif — complément à percevoir</Typography>
              {existing > 0 && <Typography variant="body2">Déjà dû : <strong>{euro(existing)}</strong></Typography>}
              {arrivalAddedLines.map((l, i) => <Typography key={i} variant="body2">+ {l.label}{l.qty > 1 ? ` × ${l.qty}` : ''} : {euro(l.amount)}</Typography>)}
              {preservedArrival.map((l, i) => <Typography key={`p${i}`} variant="body2">+ {l.label} : {euro(l.amount)}</Typography>)}
              <Divider />
              <Typography variant="h6">Total : {euro(total)}</Typography>
              {caution === 'fait' && <Typography variant="body2" color="success.main">Caution marquée comme perçue.</Typography>}
              {Number(r.complementPaid || 0) === 1 && arrivalAdded > 0 && (
                <Typography variant="body2" color="warning.main">⚠ Le complément était déjà marqué payé : encaisser le supplément ({euro(arrivalAdded)}) manuellement.</Typography>
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
            <Typography variant="h6">Récapitulatif fin de séjour</Typography>
            {endOfStayLines.length === 0 && <Typography variant="body2" color="text.secondary">Aucun complément de fin de séjour.</Typography>}
            {endOfStayLines.map((l, i) => <Typography key={i} variant="body2">{l.label}{l.qty > 1 ? ` × ${l.qty}` : ''} : {euro(l.amount)}</Typography>)}
            {endOfStayTotal > 0 && (<><Divider /><Typography variant="h6">Total à percevoir : {euro(endOfStayTotal)}</Typography></>)}
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
          <Button variant="contained" onClick={() => { if (breakfastMismatch) setBreakfastWarnOpen(true); else goNext(); }}>Suivant</Button>
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
        return <>{quit}
          <Button onClick={() => { setCleaningAdded(false); goNext(); }}>Non merci</Button>
          <Button variant="contained" disabled={data.cleaning.price == null} onClick={() => { setCleaningAdded(true); goNext(); }}>Ajouter le ménage</Button>
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
      case 'recap':
        return <>{quit}
          <Button variant="contained" onClick={commit} disabled={committing} startIcon={committing ? <CircularProgress size={16} color="inherit" /> : null}>Valider et terminer</Button>
        </>;
      default: return quit;
    }
  }

  function renderBody() {
    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    if (error && !data) return <Typography color="error">{error}</Typography>;
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
    {/* disableEnforceFocus/RestoreFocus: on an installed iOS PWA, the page is frozen on screen-lock /
        app-switch; on resume MUI's focus trap can keep re-stealing focus from the dialog and leave its
        buttons unresponsive. Relaxing the trap fixes the "answer buttons dead after wake" report
        (specs/arrival-departure-sas.md §6). */}
    <Dialog open={open} onClose={committing ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}
      disableEnforceFocus disableRestoreFocus>
      {/* Mode-coloured header band (specs/arrival-departure-sas.md §6 refonte). The ✕ IS the Quitter. */}
      <Box sx={{ bgcolor: modeColor, color: '#fff', px: { xs: 2, sm: 3 }, pt: 1.5, pb: stepIdx >= 0 ? 1 : 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {stepIdx > 0 && (
            <IconButton onClick={goBack} disabled={committing} sx={{ color: '#fff', ml: -0.5 }} aria-label="Précédent"><ArrowBackIcon /></IconButton>
          )}
          {StepIcon && <StepIcon sx={{ fontSize: 28 }} />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{bandTitle}</Typography>
            {r && <Typography variant="caption" noWrap sx={{ display: 'block', opacity: 0.9 }}>{r.firstName} {r.lastName} · {r.propertyName}</Typography>}
          </Box>
          {r && (
            <Link component="button" type="button" variant="caption" underline="hover"
              sx={{ color: '#fff', whiteSpace: 'nowrap' }}
              onClick={() => navigate(`/reservations/${reservationId}`)}>Fiche</Link>
          )}
          <IconButton onClick={onClose} disabled={committing} sx={{ color: '#fff', ml: 0.5 }} aria-label="Quitter"><CloseIcon /></IconButton>
        </Stack>
        {stepIdx >= 0 && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress variant="determinate" value={((stepIdx + 1) / activeKeys.length) * 100}
              sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.3)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
            <Typography variant="caption" sx={{ opacity: 0.9, mt: 0.5, display: 'block' }}>Étape {stepIdx + 1}/{activeKeys.length}</Typography>
          </Box>
        )}
      </Box>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 }, minHeight: 240 }}>
        {renderBody()}
        {error && data && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ p: { xs: 2, sm: 2 }, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, justifyContent: { sm: 'flex-end' }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, py: 1.25, fontSize: '1rem', minHeight: 48 } }}>
        {renderActions()}
      </DialogActions>
    </Dialog>
    <ConfirmDialog
      open={breakfastWarnOpen}
      onClose={() => setBreakfastWarnOpen(false)}
      onConfirm={() => { setBreakfastWarnOpen(false); goNext(); }}
      title="Boissons ≠ personnes"
      message={`Le nombre de boissons (${breakfastTotal}) ne correspond pas au nombre de personnes (${breakfastPersons}). Continuer quand même ?`}
      confirmLabel="Continuer"
      cancelLabel="Modifier"
      confirmColor="warning"
    />
    </>
  );
}
