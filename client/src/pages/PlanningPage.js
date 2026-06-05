import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Checkbox, Chip, Divider,
  LinearProgress, TextField, Button, Tooltip, IconButton, Table, TableBody, TableCell, TableRow
} from '@mui/material';
import { orange, grey } from '@mui/material/colors';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonIcon from '@mui/icons-material/Person';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ExtensionIcon from '@mui/icons-material/Extension';
import NoteIcon from '@mui/icons-material/Note';
import TodayIcon from '@mui/icons-material/Today';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageHeader from '../components/PageHeader';
import LaundryDayCard from '../components/LaundryDayCard';
import { displayDate } from '../utils/formatters';
import api from '../api';

const DAYS_AHEAD = 14;

// Day-card palette (PlanningPage). Tuned 2026-06-02 to make arrivals stand out from departures
// without going flashy, with the laundry card carrying its own laundry-themed tone (see the
// matching constant in LaundryDayCard).
//   - Arrivals: warm peach (MUI orange[50]) — welcoming, attention-grabbing.
//   - Departures: very pale grey (MUI grey[100]) — fades into the page on purpose.
//   - "Done" green + alert overlays still take priority (see ReservationCard sx).
const ARRIVAL_BG = orange[50];   // #FFF3E0
const DEPARTURE_BG = grey[100];  // #F5F5F5

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function frenchWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function BedVisual({ doubleBeds, singleBeds, babyBeds }) {
  const dbl = Number(doubleBeds || 0);
  const sgl = Number(singleBeds || 0);
  const bby = Number(babyBeds || 0);
  if (dbl === 0 && sgl === 0 && bby === 0) return null;

  const beds = [];
  if (dbl > 0) beds.push({ type: 'double', count: dbl, color: '#1565c0', label: 'Lit double', bgColor: '#e3f2fd' });
  if (sgl > 0) beds.push({ type: 'single', count: sgl, color: '#6a1b9a', label: 'Lit simple', bgColor: '#f3e5f5' });
  if (bby > 0) beds.push({ type: 'baby', count: bby, color: '#e65100', label: 'Lit bébé', bgColor: '#fff8e1' });

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 0.5 }}>
      {beds.map((bed, idx) => {
        const labels = {
          double: 'DOUBLE',
          single: 'SIMPLE',
          baby: 'BÉBÉ'
        };
        return (
          <Tooltip key={idx} title={bed.label}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: bed.bgColor, borderRadius: 1, px: 1, py: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 900, color: bed.color, fontSize: '11px', letterSpacing: '0.5px' }}>
                {labels[bed.type]}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, color: bed.color }}>×{bed.count}</Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

function ResourceBookingsSection({ bookings }) {
  if (!bookings || bookings.length === 0) return null;
  return (
    <>
      {bookings.map((b) => {
        const turnover = Number(b.turnoverMinutes || 0);
        const turnoverEnd = turnover > 0
          ? minutesToTime(timeToMinutes(b.endTime) + turnover)
          : null;
        return (
          <Card key={b.id} variant="outlined" sx={{ mb: 1.5, borderRadius: 2, borderColor: 'info.light', bgcolor: 'rgba(2,136,209,0.04)' }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                <Inventory2Icon sx={{ fontSize: 16, color: 'info.main' }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.dark' }}>
                  {b.resourceName || 'Ressource'}
                </Typography>
                {b.paid && <Chip label="Payé" size="small" color="success" sx={{ height: 18, fontSize: 10 }} />}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Chip
                  label={`${b.startTime}–${b.endTime}`}
                  size="small"
                  sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: b.paid ? 'success.light' : 'info.light' }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{b.displayName}</Typography>
                {b.propertyName && (
                  <Typography variant="caption" color="text.secondary">· {b.propertyName}</Typography>
                )}
                {b.clientPhone && (
                  <Typography variant="caption" color="text.secondary">· {b.clientPhone}</Typography>
                )}
              </Box>

              {turnover > 0 && turnoverEnd && (
                <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700, mt: 0.75, display: 'block' }}>
                  Remise en état: +{turnover} min (jusqu'à {turnoverEnd})
                </Typography>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

function ReservationCard({ reservation, onToggleReady, alertInfo }) {
  const r = reservation;
  const done = !!r.checkInReady;
  const adults = Number(r.adults || 0);
  const children = Number(r.children || 0);
  const teens = Number(r.teens || 0);
  const babies = Number(r.babies || 0);
  // Effective billed quantity is computed server-side (billedUnits); the client only renders it.
  const formatQty = (item) => {
    const value = Number(item.billedUnits ?? item.quantity ?? 0);
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  };

  // Default bg = ARRIVAL_BG (warm peach so the arrival card stands out from the page).
  // Alert overlays still override — kept identical for visual continuity with prior screenshots.
  let alertBgColor = ARRIVAL_BG;
  if (alertInfo?.type === 'orange') {
    alertBgColor = 'rgba(244, 67, 54, 0.10)';
  } else if (alertInfo?.type === 'red') {
    alertBgColor = 'rgba(244, 67, 54, 0.14)';
  } else if (alertInfo?.type === 'blue') {
    alertBgColor = 'rgba(33, 150, 243, 0.08)';
  }

  const optionsText = (r.options || []).map((o) => `${o.title} ×${formatQty(o)}`);
  const resourcesText = (r.resources || []).map((rr) => `${rr.name} ×${formatQty(rr)}`);

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: done ? 'success.main' : 'divider',
        bgcolor: done ? 'rgba(76,175,80,0.06)' : alertBgColor,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        {/* Top row: checkbox + ARRIVÉE badge vertically centred */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Tooltip title={done ? 'Logement prêt ✓' : 'Marquer comme prêt'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleReady(r)}
              sx={{ p: 0, flexShrink: 0 }}
            />
          </Tooltip>
          <Chip
            label="ARRIVÉE"
            size="small"
            sx={{
              height: 18,
              fontSize: 10,
              fontWeight: 800,
              color: done ? 'success.dark' : 'warning.dark',
              bgcolor: done ? 'rgba(46,125,50,0.12)' : 'rgba(245,124,0,0.12)',
            }}
          />
          {done && <Chip label="Prêt" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />}
        </Box>

        {/* Detail block indented to align with the left edge of the ARRIVÉE badge (checkbox 32px + gap 8px) */}
        <Box sx={{ pl: '40px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
              {r.propertyName}
            </Typography>
            {alertInfo?.explanation && (
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: alertInfo.type === 'blue' ? 'info.dark' : 'error.dark',
                  lineHeight: 1.3,
                }}
              >
                {alertInfo.explanation}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {r.firstName} {r.lastName}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                Arrivée {r.checkInTime || '15:00'}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              Famille:
            </Typography>
            <Chip label={`Adultes: ${adults}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Enfants: ${children}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Ados: ${teens}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Bébés: ${babies}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              Lits:
            </Typography>
            <BedVisual doubleBeds={r.doubleBeds} singleBeds={r.singleBeds} babyBeds={r.babyBeds} />
          </Box>

          {optionsText.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ExtensionIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25, flexShrink: 0 }} />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {optionsText.map((label, i) => (
                  <Chip key={i} label={label} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
                ))}
              </Box>
            </Box>
          )}

          {resourcesText.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ExtensionIcon sx={{ fontSize: 16, color: 'info.main', mt: 0.25, flexShrink: 0 }} />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {resourcesText.map((label, i) => (
                  <Chip key={i} label={label} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
                ))}
              </Box>
            </Box>
          )}

          {r.notes && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1 }}>
              <NoteIcon sx={{ fontSize: 16, color: 'warning.main', mt: 0.25, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.4 }}>
                {r.notes}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function DepartureMiniRow({ reservation, onToggleDone }) {
  const done = Boolean(reservation.checkOutDone);
  const checkOutTime = reservation.checkOutTime || '10:00';
  const adults = Number(reservation.adults || 0);
  const children = Number(reservation.children || 0);
  const teens = Number(reservation.teens || 0);
  const babies = Number(reservation.babies || 0);
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderRadius: 2,
        borderColor: done ? 'success.main' : 'divider',
        // Default bg = DEPARTURE_BG (very soft grey — quieter than the arrival peach on purpose,
        // departures need less visual pull than incoming bookings).
        bgcolor: done ? 'rgba(76,175,80,0.06)' : DEPARTURE_BG,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        {/* Top row: checkbox + DÉPART badge vertically centred */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Tooltip title={done ? 'Départ validé' : 'Valider le départ'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleDone(reservation)}
              sx={{ p: 0, flexShrink: 0 }}
            />
          </Tooltip>
          <Chip
            label="DÉPART"
            size="small"
            sx={{
              height: 18,
              fontSize: 10,
              fontWeight: 800,
              color: done ? 'success.dark' : 'warning.dark',
              bgcolor: done ? 'rgba(46,125,50,0.12)' : 'rgba(245,124,0,0.12)',
            }}
          />
          {done && <Chip label="Effectué" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />}
        </Box>

        {/* Detail block indented to align with the left edge of the DÉPART badge */}
        <Box sx={{ pl: '40px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
              {reservation.propertyName}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {reservation.firstName} {reservation.lastName}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                Départ {checkOutTime}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              Famille:
            </Typography>
            <Chip label={`Adultes: ${adults}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Enfants: ${children}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Ados: ${teens}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
            <Chip label={`Bébés: ${babies}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 12 }} />
          </Box>

          {reservation.notes && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1 }}>
              <NoteIcon sx={{ fontSize: 16, color: 'warning.main', mt: 0.25, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.4 }}>
                {reservation.notes}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function PlanningPage() {
  const [loading, setLoading] = useState(true);
  const [planningDays, setPlanningDays] = useState([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [alertMap, setAlertMap] = useState({});
  const [properties, setProperties] = useState([]);
  const [resourceBookingsMap, setResourceBookingsMap] = useState({});
  const [departuresMap, setDeparturesMap] = useState({});
  // Weekly bed-linen tracking (specs/weekly-bed-linen-tracking.md). Map ISO date → laundry-day
  // payload `{ dropOff, pickUp }`. Server emits zero-everywhere days too; LaundryDayCard hides
  // them silently so we don't need to filter here.
  const [laundryByDate, setLaundryByDate] = useState({});
  // Linen inventory projection (specs/linen-inventory-shortage-tracking.md §6.2). Map ISO date
  // → per-type clean snapshot to display as the 3rd block on each laundry day.
  const [inventoryByDate, setInventoryByDate] = useState({});
  // specs/skip-laundry-trip.md §4.2 — global set of ISO dates the operator marked as
  // not-made. Loaded once on mount + kept in sync by the toggle handler. Empty Set on
  // initial render so the cards default to "not skipped" while the request is in flight.
  const [skippedLaundryDates, setSkippedLaundryDates] = useState(() => new Set());

  const scrollContainerRef = useRef(null);
  const lastLoadedRef = useRef(null);

  const todayStr = new Date().toISOString().split('T')[0];

  // Load properties once
  useEffect(() => {
    api.getProperties().then(setProperties);
  }, []);

  // specs/skip-laundry-trip.md §4.2 — load the global laundry-skip set once on mount. Silent
  // fallback to empty Set on failure: every LaundryDayCard then renders in its default
  // (non-skipped) state, the toggle still works, and a subsequent successful toggle/refetch
  // will hydrate the state. No user-visible error on this read.
  useEffect(() => {
    api.listLaundrySkips()
      .then((res) => setSkippedLaundryDates(new Set(res?.skips || [])))
      .catch(() => setSkippedLaundryDates(new Set()));
  }, []);

  // Per-card skip toggle. Optimistic update first (instant UI feedback), then API call. On
  // failure: revert to the previous Set + surface a snackbar (rule 12 in the spec). After
  // success: refetch BOTH the laundry summary AND the linen inventory.
  //
  // 2026-06-05 — fixed a regression: the previous version only refetched the inventory,
  // assuming the summary endpoint was "raw reservation aggregation, not affected by skips".
  // That assumption was true initially, then broke when the hotfix made
  // `planningController.laundrySummary` skip-aware (so the deferred drop-off / pick-up
  // counts surface on the next non-skipped card). Without this refetch, the À apporter /
  // À récupérer numbers stayed frozen on their pre-skip values — exactly the user-visible
  // bug "la carte blanchisserie suivante ne change pas".
  const handleToggleLaundrySkip = useCallback(async (date, nextValue) => {
    const previous = skippedLaundryDates;
    const next = new Set(previous);
    if (nextValue) next.add(date); else next.delete(date);
    setSkippedLaundryDates(next);
    try {
      if (nextValue) await api.addLaundrySkip(date);
      else await api.removeLaundrySkip(date);
      const from = startDate;
      const to = addDays(from, DAYS_AHEAD - 1);
      const [summary, inventory] = await Promise.all([
        api.getLaundryPlanningSummary({ from, to }).catch(() => ({ laundryDays: [] })),
        api.getLinenInventory().catch(() => ({ byLaundryDay: {} })),
      ]);
      const lByDate = {};
      for (const ld of (summary?.laundryDays || [])) {
        lByDate[ld.date] = { dropOff: ld.dropOff, pickUp: ld.pickUp };
      }
      setLaundryByDate(lByDate);
      setInventoryByDate(inventory?.byLaundryDay || {});
    } catch (err) {
      setSkippedLaundryDates(previous);
      // eslint-disable-next-line no-alert
      window.alert(`Impossible d'enregistrer le voyage non réalisé. ${err?.message || ''}`);
    }
  }, [skippedLaundryDates, startDate]);

  // Detect scheduling conflicts
  const detectAlerts = useCallback((days, props = []) => {
    const alerts = {};
    const propMap = Object.fromEntries(props.map((p) => [p.id, p]));

    // Flatten all reservations for cross-day/cross-day lookups
    const allRess = days.flatMap((d) => d.reservations);

    for (const day of days) {
      const ress = day.reservations;
      for (let i = 0; i < ress.length; i++) {
        const r = ress[i];

        // Type 1: Multiple logements with same checkout time (orange for simultaneity)
        const firstCheckout = ress[i].endDate === ress[i].startDate ? ress[i].checkOutTime || '11:00' : '11:00';
        const matchingCheckout = ress.filter(
          (rr) => rr.id !== r.id && rr.endDate === r.endDate && (rr.checkOutTime || '11:00') === firstCheckout
        );
        if (matchingCheckout.length > 0) {
          alerts[r.id] = { type: 'orange', explanation: 'Départs simultanés de plusieurs logements' };
        }

        // Type 2: previous checkout + cleaning time compared to current arrival
        const samePropertyPast = allRess.filter((rr) => rr.id !== r.id && rr.propertyId === r.propertyId);
        const prevRes = samePropertyPast
          .map((rr) => {
            const co = rr.checkOutTime || '10:00';
            return { rr, endStamp: `${rr.endDate}T${co}:00` };
          })
          .filter((x) => x.endStamp <= `${r.startDate}T${r.checkInTime || '15:00'}:00`)
          .sort((a, b) => b.endStamp.localeCompare(a.endStamp))[0]?.rr;
        if (prevRes) {
          const prop = propMap[r.propertyId];
          const cleaningHours = Number(prop?.cleaningHours ?? 3);
          const cleaningMinutes = Math.round(cleaningHours * 60);
          const prevCheckOut = prevRes.checkOutTime || '10:00';
          const prevCheckOutMin = timeToMinutes(prevCheckOut);
          const cleaningEndMin = prevCheckOutMin + cleaningMinutes;
          const arrivalMin = timeToMinutes(r.checkInTime || '15:00');

          if (cleaningEndMin > arrivalMin) {
            const cleaningDisplay = Number.isInteger(cleaningHours)
              ? `${cleaningHours}h`
              : `${String(cleaningHours).replace('.', 'h')}`;
            const departureDate = displayDate(prevRes.endDate);
            alerts[r.id] = {
              type: 'red',
              explanation: `${prevRes.firstName} ${prevRes.lastName} part le ${departureDate} à ${prevCheckOut}, ménage: ${cleaningDisplay}`,
            };
            if (!alerts[prevRes.id]) {
              alerts[prevRes.id] = {
                type: 'red',
                explanation: `Départ le ${departureDate} trop proche de l'arrivée de ${r.firstName} ${r.lastName}`,
              };
            }
          }
        }

        // Type 3: Arrival during another logement's cleaning (blue)
        const otherRes = allRess.find((rr) => rr.id !== r.id && rr.propertyId !== r.propertyId && rr.endDate <= r.startDate);
        if (otherRes && !alerts[r.id]) {
          const otherProp = propMap[otherRes.propertyId];
          const otherCleaningMinutes = otherProp?.cleaning || 120;
          const otherCheckOut = otherRes.endDate === otherRes.startDate ? otherRes.checkOutTime || '11:00' : '11:00';
          const otherCleaningEnd = timeToMinutes(otherCheckOut) + otherCleaningMinutes;
          const arrivalMin = timeToMinutes(r.checkInTime || '15:00');
          if (arrivalMin < otherCleaningEnd) {
            alerts[r.id] = {
              type: 'blue',
              explanation: `Arrivée pendant nettoyage d'un autre logement`,
            };
          }
        }
      }
    }

    setAlertMap(alerts);
  }, []);

  const getAlertColor = (alertType) => {
    if (alertType === 'orange') return 'rgba(255, 152, 0, 0.08)';
    if (alertType === 'red') return 'rgba(244, 67, 54, 0.08)';
    if (alertType === 'blue') return 'rgba(33, 150, 243, 0.08)';
    return 'background.paper';
  };

  const loadPlanning = async (from) => {
    setLoading(true);
    const to = addDays(from, DAYS_AHEAD - 1);
    const [reservationsBase, rbEvents, laundrySummary, inventoryProjection] = await Promise.all([
      api.getReservations({ from, to }),
      api.getResourceBookingPlanningEvents(from, to).catch(() => []),
      // Non-blocking: a 500 here must not break the planning. Silent fallback to empty.
      api.getLaundryPlanningSummary({ from, to }).catch(() => ({ laundryDays: [] })),
      // §3.7 follow-up — linen inventory projection. Same non-blocking discipline.
      api.getLinenInventory().catch(() => ({ byLaundryDay: {} })),
    ]);
    const arrivals = reservationsBase.filter((r) => r.startDate >= from && r.startDate <= to);
    const detailed = await Promise.all(arrivals.map((r) => api.getReservation(r.id)));

    const byDate = {};
    for (const r of detailed) {
      if (!byDate[r.startDate]) byDate[r.startDate] = [];
      byDate[r.startDate].push(r);
    }

    const days = Object.keys(byDate)
      .sort()
      .map((date) => ({
        date,
        reservations: byDate[date].sort((a, b) =>
          (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59')
        ),
      }));

    setPlanningDays(days);

    const departuresByDate = {};
    for (const reservation of reservationsBase) {
      if (reservation.endDate >= from && reservation.endDate <= to) {
        if (!departuresByDate[reservation.endDate]) departuresByDate[reservation.endDate] = [];
        departuresByDate[reservation.endDate].push(reservation);
      }
    }
    Object.keys(departuresByDate).forEach((date) => {
      departuresByDate[date].sort((a, b) => (a.checkOutTime || '10:00').localeCompare(b.checkOutTime || '10:00'));
    });
    setDeparturesMap(departuresByDate);

    // Group resource bookings by date
    const rbByDate = {};
    for (const rb of rbEvents) {
      if (!rbByDate[rb.date]) rbByDate[rb.date] = [];
      rbByDate[rb.date].push(rb);
    }
    setResourceBookingsMap(rbByDate);

    // Build laundryByDate from the new endpoint. Keys are ISO dates → LaundryDayCard props.
    const lByDate = {};
    for (const ld of (laundrySummary?.laundryDays || [])) {
      lByDate[ld.date] = { dropOff: ld.dropOff, pickUp: ld.pickUp };
    }
    setLaundryByDate(lByDate);

    // Inventory map (date → per-type clean snapshot). Hydrated for every laundry day in the
    // horizon; LaundryDayCard filters the types it actually renders.
    setInventoryByDate(inventoryProjection?.byLaundryDay || {});

    detectAlerts(days, properties);
    lastLoadedRef.current = to;
    setLoading(false);
  };

  useEffect(() => {
    loadPlanning(startDate);
  }, [startDate, properties]); // eslint-disable-line

  // Infinite scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200 && !loading && lastLoadedRef.current) {
        const nextStart = addDays(lastLoadedRef.current, 1);
        const nextEnd = addDays(nextStart, DAYS_AHEAD - 1);
        // Pull the next-window laundry summary alongside the reservations so the new days
        // surface their LaundryDayCard right after they scroll into view. Non-blocking; an
        // error here must not stop the infinite scroll.
        api.getLaundryPlanningSummary({ from: nextStart, to: nextEnd })
          .then((summary) => {
            setLaundryByDate((prev) => {
              const merged = { ...prev };
              for (const ld of (summary?.laundryDays || [])) {
                merged[ld.date] = { dropOff: ld.dropOff, pickUp: ld.pickUp };
              }
              return merged;
            });
          })
          .catch(() => {});
        api.getReservations({ from: nextStart, to: nextEnd }).then((newReservations) => {
          if (newReservations.length === 0) {
            lastLoadedRef.current = null;
            return;
          }
          Promise.all(newReservations.map((r) => api.getReservation(r.id))).then((ress) => {
            const byDate = {};
            for (const r of ress) {
              if (!byDate[r.startDate]) byDate[r.startDate] = [];
              byDate[r.startDate].push(r);
            }
            const newDays = Object.keys(byDate)
              .sort()
              .map((date) => ({
                date,
                reservations: byDate[date].sort((a, b) =>
                  (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59')
                ),
              }));

            const nextDepartures = {};
            for (const reservation of newReservations) {
              if (reservation.endDate >= nextStart && reservation.endDate <= nextEnd) {
                if (!nextDepartures[reservation.endDate]) nextDepartures[reservation.endDate] = [];
                nextDepartures[reservation.endDate].push(reservation);
              }
            }
            Object.keys(nextDepartures).forEach((date) => {
              nextDepartures[date].sort((a, b) => (a.checkOutTime || '10:00').localeCompare(b.checkOutTime || '10:00'));
            });

            setDeparturesMap((prev) => {
              const merged = { ...prev };
              Object.keys(nextDepartures).forEach((date) => {
                const existing = merged[date] || [];
                const existingIds = new Set(existing.map((r) => r.id));
                const appended = [...existing, ...nextDepartures[date].filter((r) => !existingIds.has(r.id))];
                appended.sort((a, b) => (a.checkOutTime || '10:00').localeCompare(b.checkOutTime || '10:00'));
                merged[date] = appended;
              });
              return merged;
            });

            setPlanningDays((prev) => [...prev, ...newDays]);
            detectAlerts([...planningDays, ...newDays], properties);
            lastLoadedRef.current = nextEnd;
          });
        });
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading, planningDays, detectAlerts, properties]); // eslint-disable-line

  const handleToggleReady = async (r) => {
    const newReady = !r.checkInReady;
    await api.markPayment(r.id, { checkInReady: newReady });
    setPlanningDays((prev) =>
      prev.map((day) => ({
        ...day,
        reservations: day.reservations.map((res) =>
          res.id === r.id ? { ...res, checkInReady: newReady } : res
        ),
      }))
    );
  };

  const handleToggleDepartureDone = async (reservation) => {
    const newValue = !reservation.checkOutDone;
    await api.markPayment(reservation.id, { checkOutDone: newValue });
    setDeparturesMap((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((date) => {
        next[date] = next[date].map((r) => (r.id === reservation.id ? { ...r, checkOutDone: newValue } : r));
      });
      return next;
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <PageHeader title="Planning" />
      {/* Controls */}
      <Card sx={{ mb: 2, mx: 2, mt: 2 }}>
        <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <IconButton size="small" onClick={() => setStartDate((d) => addDays(d, -1))} aria-label="Jour précédent">
              <NavigateBeforeIcon />
            </IconButton>
            <TextField
              type="date"
              size="small"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              sx={{ width: 155 }}
              slotProps={{
                htmlInput: { style: { padding: '6px 10px' } }
              }}
            />
            <IconButton size="small" onClick={() => setStartDate((d) => addDays(d, 1))} aria-label="Jour suivant">
              <NavigateNextIcon />
            </IconButton>
            {startDate !== todayStr && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<TodayIcon />}
                onClick={() => setStartDate(todayStr)}
              >
                Aujourd'hui
              </Button>
            )}
          </Box>

          {/* Legend */}
          {Object.values(alertMap).length > 0 && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                Alertes de conflit :
              </Typography>
              <Table size="small" sx={{ '& td': { border: 'none', px: 0.5, pt: 0, pb: 0.5 } }}>
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ width: 24 }}>
                      <Box sx={{ width: 20, height: 20, bgcolor: 'rgba(255, 152, 0, 0.2)', borderRadius: 0.5 }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">Départs simultanés (plusieurs logements)</Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ width: 24 }}>
                      <Box sx={{ width: 20, height: 20, bgcolor: 'rgba(244, 67, 54, 0.2)', borderRadius: 0.5 }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">Nettoyage insuffisant (même logement)</Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ width: 24 }}>
                      <Box sx={{ width: 20, height: 20, bgcolor: 'rgba(33, 150, 243, 0.2)', borderRadius: 0.5 }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">Arrivée pendant nettoyage (autre logement)</Typography>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>
      {loading && <LinearProgress />}
      {/* Scrollable content */}
      <Box
        ref={scrollContainerRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 2,
          pb: 2,
        }}
      >
        {!loading && planningDays.length === 0 && (
          <Card>
            <CardContent>
              <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                Aucune arrivée ni créneau ressource sur les {DAYS_AHEAD} prochains jours
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Merge reservation days + resource booking days + laundry days with content.
            §3.7 / 2026-06-03 fix: a Tuesday that has only a laundry card (no arrivals, no
            departures, no resource bookings) must STILL render. We add `laundryByDate` keys to
            the date set, filtered to days where the LaundryDayCard would render something
            (mirrors its rule-13 silence test — beds + towels > 0 on at least one side). */}
        {[...new Set([
          ...planningDays.map((d) => d.date),
          ...Object.keys(resourceBookingsMap),
          ...Object.keys(departuresMap),
          ...Object.keys(laundryByDate).filter((d) => {
            const data = laundryByDate[d];
            if (!data) return false;
            const sum = (side) => {
              if (!side) return 0;
              return Number(side.singleBeds || 0) + Number(side.doubleBeds || 0) + Number(side.babyBeds || 0)
                   + Number(side.largeTowels || 0) + Number(side.mediumTowels || 0) + Number(side.smallTowels || 0);
            };
            return sum(data.dropOff) + sum(data.pickUp) > 0;
          }),
          // specs/skip-laundry-trip.md §3.3 rule 11 — a skipped card is ALWAYS shown so the
          // operator can revert it. Add every skipped date to the date set; the LaundryDayCard
          // receives a {} placeholder for `data` below when laundryByDate has nothing.
          ...skippedLaundryDates,
        ])].sort().map((date, idx, arr) => {
          const day = planningDays.find((d) => d.date === date);
          const dayResourceBookings = resourceBookingsMap[date] || [];
          const dayDepartures = departuresMap[date] || [];
          const reservations = day ? day.reservations : [];
          const isToday = date === todayStr;
          const allReady = reservations.length > 0 && reservations.every((r) => r.checkInReady);
          return (
            <Box key={date} sx={{ mb: 3 }}>
              {/* Day header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: isToday ? 'primary.main' : allReady ? 'success.main' : 'grey.200',
                    color: isToday || allReady ? 'white' : 'text.primary',
                    borderRadius: 2,
                    px: 2,
                    py: 0.75,
                    flexGrow: 1,
                  }}
                >
                  <TodayIcon sx={{ fontSize: 20 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, textTransform: 'capitalize' }}>
                    {frenchWeekday(date)}
                    {isToday && ' — Aujourd\'hui'}
                  </Typography>
                  <Chip
                    label={`${reservations.filter((r) => r.checkInReady).length}/${reservations.length}`}
                    size="small"
                    sx={{
                      ml: 'auto',
                      bgcolor: 'rgba(255,255,255,0.25)',
                      color: isToday || allReady ? 'white' : 'text.primary',
                      fontWeight: 700,
                      height: 22,
                    }}
                  />
                </Box>
              </Box>

              {/* Weekly bed-linen card (specs/weekly-bed-linen-tracking.md). Renders only on
                  laundry days that actually have something to bring or pick up — unless the
                  operator marked it as skipped (specs/skip-laundry-trip.md §3.3 rule 11), in
                  which case it's always shown so the toggle can be reverted. */}
              <LaundryDayCard
                // Skipped date with no underlying laundry payload (e.g. a Tuesday with no
                // arrivals + no reservation ending in the prior week): pass an empty-shape
                // placeholder so the card renders, the IconButton appears, and the operator
                // can un-skip from the same place. The card's body shows the muted caption.
                data={laundryByDate[date] || (skippedLaundryDates.has(date) ? { dropOff: {}, pickUp: {} } : null)}
                inventoryAfter={inventoryByDate[date]}
                date={date}
                isSkipped={skippedLaundryDates.has(date)}
                onToggleSkip={handleToggleLaundrySkip}
              />

              {dayDepartures.length > 0 && (
                <Box sx={{ mb: 1.25 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {dayDepartures.map((r) => (
                      <DepartureMiniRow key={`dep-${r.id}`} reservation={r} onToggleDone={handleToggleDepartureDone} />
                    ))}
                  </Box>
                </Box>
              )}

              {reservations.map((r) => (
                <ReservationCard
                  key={r.id}
                  reservation={r}
                  onToggleReady={handleToggleReady}
                  alertInfo={alertMap[r.id]}
                />
              ))}

              <ResourceBookingsSection bookings={dayResourceBookings} />

              {idx < arr.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
