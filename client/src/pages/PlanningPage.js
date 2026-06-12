import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Chip, Divider,
  LinearProgress, TextField, Button, IconButton,
} from '@mui/material';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import TodayIcon from '@mui/icons-material/Today';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageHeader from '../components/PageHeader';
import LaundryDayCard from '../components/LaundryDayCard';
import BreakfastDayCard from '../components/BreakfastDayCard';
import ReservationCard from '../components/ReservationCard';
import DepartureMiniRow from '../components/DepartureMiniRow';
import ReservationSasDialog from '../components/sas/ReservationSasDialog';
import { displayDate } from '../utils/formatters';
import { cleaningTurnoverConflict } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import api from '../api';

const DAYS_AHEAD = 14;

// Day-card palette (PlanningPage). Tuned 2026-06-02 to make arrivals stand out from departures
// without going flashy, with the laundry card carrying its own laundry-themed tone (see the
// matching constant in LaundryDayCard).
//   - Arrivals: warm peach (MUI orange[50]) — welcoming, attention-grabbing. See
//     `components/ReservationCard.js` for the canonical ARRIVAL_BG constant.
//   - Departures: very pale grey (MUI grey[100]) — fades into the page on purpose. See
//     `components/DepartureMiniRow.js` for the canonical DEPARTURE_BG constant.
//   - "Done" green + alert overlays still take priority (each card's sx handles them).

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

// `BedVisual` was inlined here until 2026-06-06; it now lives co-located with
// `components/ReservationCard.js`, the only consumer.

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

// `ReservationCard` and `DepartureMiniRow` lived inline here until 2026-06-06. They
// were extracted to `components/ReservationCard.js` and `components/DepartureMiniRow.js`
// to enable direct Vitest coverage of the per-tile rules (time pill, Famille
// zero-filter, Lits gate, cleaning block, etc.).

export default function PlanningPage() {
  const navigate = useNavigate();
  // Reused by every "card / row click → open reservation" handler below (arrivals,
  // departures, breakfast items). `withFrom('/planning')` makes the reservation page's
  // back button return here.
  const openReservation = useCallback((reservationId) => {
    if (!reservationId) return;
    navigate(withFrom(`/reservations/${reservationId}`, '/planning'));
  }, [navigate]);

  // Arrival / departure SAS (specs/arrival-departure-sas.md). Clicking an arrival card opens the
  // arrival SAS, a departure row the departure SAS. `{ reservationId, mode }` drives the dialog.
  const [sas, setSas] = useState(null);
  const openArrivalSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'arrival' }); }, []);
  const openDepartureSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'departure' }); }, []);
  const openClient = useCallback((clientId) => { if (clientId) navigate(withFrom(`/clients?clientId=${clientId}`, '/planning')); }, [navigate]);

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
  // Per-day breakfast list (specs/breakfast-option-and-planning-card.md §4.2). Map ISO date
  // → `{ items: [{ reservationId, clientName, propertyName, persons }], totalPersons }`.
  // Empty days are not included; `BreakfastDayCard` hides itself if data is missing.
  const [breakfastByDate, setBreakfastByDate] = useState({});
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
      // Refetch up to the BUSINESS horizon, not the UI horizon. The server knows the
      // inventory horizon (= last reservation endDate); we just ask for "everything from
      // today" and let it cap. This keeps the toggle handler independent from the scroll
      // position — Adrien specifically asked for this on 2026-06-05 (the previous fix
      // relied on `lastLoadedRef.current` which conflated business state with UI state and
      // broke when the user had scrolled past the affected cards).
      const [summary, inventory] = await Promise.all([
        api.getLaundryPlanningSummary({ from: startDate }).catch(() => ({ laundryDays: [] })),
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

          // Compare REAL datetimes (date + time + cleaning), not minutes-of-day: a 10:00 checkout
          // followed by a 10:00 arrival 9 days later is NOT a turnover conflict.
          if (cleaningTurnoverConflict({
            checkoutDate: prevRes.endDate,
            checkoutTime: prevCheckOut,
            cleaningMinutes,
            arrivalDate: r.startDate,
            arrivalTime: r.checkInTime || '15:00',
          })) {
            const cleaningDisplay = Number.isInteger(cleaningHours)
              ? `${cleaningHours}h`
              : `${String(cleaningHours).replace('.', 'h')}`;
            const departureDate = displayDate(prevRes.endDate);
            alerts[r.id] = {
              type: 'red',
              explanation: `${prevRes.firstName} ${prevRes.lastName} part le ${departureDate} à ${prevCheckOut}, ménage: ${cleaningDisplay}`,
              // No `cleaningDisplay` field on the arrival side — Adrien 2026-06-06 asked
              // for the standalone red "Ménage" badge to be removed from the arrival
              // card. The cleaning duration stays embedded in the explanation sentence
              // (rendered as a caption next to the property name). Only the departure
              // side carries the field, which `DepartureMiniRow` surfaces as a
              // prominent block in the place freed by the removed "Famille" row.
            };
            if (!alerts[prevRes.id]) {
              alerts[prevRes.id] = {
                type: 'red',
                explanation: `Arrivée de ${r.firstName} ${r.lastName} ${displayDate(r.startDate)} à ${r.checkInTime || '15:00'}, ménage: ${cleaningDisplay}`,
                cleaningDisplay,
              };
            }
          }
        }

        // Type 3: Arrival during another logement's cleaning (blue). Datetime-correct: only flag an
        // other-property checkout whose cleaning window actually overlaps this arrival (not merely a
        // same-time checkout on an earlier day).
        if (!alerts[r.id]) {
          const otherRes = allRess.find((rr) => {
            if (rr.id === r.id || rr.propertyId === r.propertyId || rr.endDate > r.startDate) return false;
            const otherProp = propMap[rr.propertyId];
            const otherCleaningMinutes = otherProp?.cleaning || 120;
            const otherCheckOut = rr.endDate === rr.startDate ? rr.checkOutTime || '11:00' : '11:00';
            return cleaningTurnoverConflict({
              checkoutDate: rr.endDate,
              checkoutTime: otherCheckOut,
              cleaningMinutes: otherCleaningMinutes,
              arrivalDate: r.startDate,
              arrivalTime: r.checkInTime || '15:00',
            });
          });
          if (otherRes) {
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
    const [reservationsBase, rbEvents, laundrySummary, inventoryProjection, breakfastSummary] = await Promise.all([
      api.getReservations({ from, to }),
      api.getResourceBookingPlanningEvents(from, to).catch(() => []),
      // Non-blocking: a 500 here must not break the planning. Silent fallback to empty.
      api.getLaundryPlanningSummary({ from, to }).catch(() => ({ laundryDays: [] })),
      // §3.7 follow-up — linen inventory projection. Same non-blocking discipline.
      api.getLinenInventory().catch(() => ({ byLaundryDay: {} })),
      // specs/breakfast-option-and-planning-card.md §4.2 — per-day breakfast list.
      // Non-blocking like the others; an empty map keeps the planning fully functional.
      api.getBreakfastPlanningSummary({ from, to }).catch(() => ({ breakfastByDate: {} })),
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
    // Breakfast map (date → { items, totalPersons }) directly from the server payload.
    setBreakfastByDate(breakfastSummary?.breakfastByDate || {});

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
        // Same incremental pattern for breakfast: fetch the next window and merge into
        // the existing map so the new days surface their BreakfastDayCard on scroll.
        api.getBreakfastPlanningSummary({ from: nextStart, to: nextEnd })
          .then((summary) => {
            const next = summary?.breakfastByDate || {};
            setBreakfastByDate((prev) => ({ ...prev, ...next }));
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

          {/* Color legend removed 2026-06-06 — the per-card alert explanation text is
              clear enough on its own; the legend block added clutter at the top of the
              page without surfacing actionable info. */}
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
          // specs/breakfast-option-and-planning-card.md §3 rule 8 — a date that has ONLY a
          // breakfast card (no arrival/departure/laundry) must still render so the operator
          // sees it. Filter to days where there's actually at least one item.
          ...Object.keys(breakfastByDate).filter((d) => (breakfastByDate[d]?.items?.length || 0) > 0),
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

              {/* Breakfast card (specs/breakfast-option-and-planning-card.md §6.1). Sits
                  between laundry and departures so the operator's morning scan is:
                  laundry → breakfasts → who's leaving today. The card hides itself when
                  no reservation contributes (rule 7). Each row is clickable and opens
                  the corresponding reservation form. */}
              <BreakfastDayCard data={breakfastByDate[date]} onItemClick={openReservation} />

              {dayDepartures.length > 0 && (
                <Box sx={{ mb: 1.25 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {dayDepartures.map((r) => (
                      <DepartureMiniRow
                        key={`dep-${r.id}`}
                        reservation={r}
                        onToggleDone={handleToggleDepartureDone}
                        onOpenReservation={openReservation}
                        onOpenSas={openDepartureSas}
                        onOpenClient={openClient}
                        alertInfo={alertMap[r.id]}
                      />
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
                  onOpenReservation={openReservation}
                  onOpenSas={openArrivalSas}
                  onOpenClient={openClient}
                />
              ))}

              <ResourceBookingsSection bookings={dayResourceBookings} />

              {idx < arr.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          );
        })}
      </Box>

      <ReservationSasDialog
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onCommitted={() => { setSas(null); loadPlanning(startDate); }}
      />
    </Box>
  );
}
