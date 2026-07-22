import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Chip, Divider,
  TextField, Button, IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import TodayIcon from '@mui/icons-material/Today';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import LaundryDayCard from '../components/LaundryDayCard';
import LaundryManualAdditionsDialog from '../components/LaundryManualAdditionsDialog';
import OptionDayCard from '../components/OptionDayCard';
import BreakfastPrepDialog from '../components/BreakfastPrepDialog';
import ReservationCard from '../components/ReservationCard';
import DepartureMiniRow from '../components/DepartureMiniRow';
import ReservationSasDialog from '../components/sas/ReservationSasDialog';
import { readSasDeepLink, readBreakfastDeepLink } from '../utils/sasDeepLink';
import { displayDate } from '../utils/formatters';
import { cleaningTurnoverConflict } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, RECEPTION, userHasRole } from '../constants/roles';
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

// Shared item shape for the breakfast card AND the preparation popup — the popup deep-link
// (push notification) maps the API item exactly like the card does
// (specs/planning-breakfast-prep-popup.md + sas-breakfast-bread-and-push.md rule 10).
function mapBreakfastItem(i, date) {
  return {
    reservationId: i.reservationId,
    optionId: i.optionId,
    date: i.date || date,
    title: 'Petit déjeuner',
    time: i.breakfastTime,
    propertyName: i.propertyName,
    clientName: i.clientName,
    breakfastPersons: i.persons,
    done: i.done,
    coffee: i.coffee,
    tea: i.tea,
    chocolate: i.chocolate,
    milk: i.milk,
    pastries: i.pastries,
    cereals: i.cereals,
    bread: i.bread,
    note: i.note,
  };
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
          <Card key={b.id} variant="outlined" sx={(t) => ({ mb: 1.5, borderRadius: 2, borderColor: 'info.light', bgcolor: alpha(t.palette.info.main, 0.04) })}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
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
                <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700, mt: 1, display: 'block' }}>
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
  // Post-action failures surface through the shared toasts — the page used raw window.alert
  // (specs/ds-components.md §3.2).
  const { showError } = useToast();
  const { user } = useAuth();
  // specs/reception-role-checkin-only.md §3.4 — a reception-only user runs the SAS on the Planning
  // but has no client / reservation sheet access: the card body + client-name links are inert and
  // the SAS « Fiche » link is hidden. Everything else (SAS, caution/complement) is unchanged.
  const receptionMode = userHasRole(user, RECEPTION) && !userHasRole(user, ADMIN);
  // Reused by every "card / row click → open reservation" handler below (arrivals,
  // departures, breakfast items). `withFrom('/planning')` makes the reservation page's
  // back button return here. No-op in reception mode (no reservation sheet access).
  const openReservation = useCallback((reservationId) => {
    if (!reservationId || receptionMode) return;
    navigate(withFrom(`/reservations/${reservationId}`, '/planning'));
  }, [navigate, receptionMode]);

  // Option-driven planning card « préparé » toggle (specs/option-planning-card.md §3.5). Optimistic:
  // flip the matching occurrence in state, persist, revert on failure.
  const handleToggleOptionCardDone = useCallback(async (item, nextDone) => {
    if (!item) return;
    const matches = (it) => it.reservationId === item.reservationId && it.optionId === item.optionId
      && it.date === item.date && it.time === item.time;
    const apply = (value) => setOptionCardsByDate((prev) => {
      const day = prev[item.date];
      if (!day) return prev;
      return { ...prev, [item.date]: { ...day, items: day.items.map((it) => (matches(it) ? { ...it, done: value } : it)) } };
    });
    apply(nextDone);
    try {
      await api.setPlanningOptionCardDone({
        reservationId: item.reservationId, optionId: item.optionId, date: item.date, time: item.time, done: nextDone,
      });
    } catch (e) {
      apply(!nextDone); // revert
      showError(e.message || 'Impossible de mettre à jour la préparation.');
    }
  }, [showError]);

  // The breakfast card shares the « fait » toggle (specs/breakfast-option-planning-card.md) — same
  // generic occurrence endpoint, but optimistic state lives in breakfastByDate (matched by reservation
  // + hour on the day). No-op revert if the occurrence isn't found (legacy / un-migrated fallback).
  const handleToggleBreakfastDone = useCallback(async (item, nextDone) => {
    if (!item || !item.optionId) return;
    const apply = (value) => setBreakfastByDate((prev) => {
      const day = prev[item.date];
      if (!day) return prev;
      return { ...prev, [item.date]: { ...day, items: day.items.map((it) => (
        it.reservationId === item.reservationId && (it.breakfastTime || '') === (item.time || '')
          ? { ...it, done: value } : it)) } };
    });
    apply(nextDone);
    try {
      await api.setPlanningOptionCardDone({
        reservationId: item.reservationId, optionId: item.optionId, date: item.date, time: item.time, done: nextDone,
      });
    } catch (e) {
      apply(!nextDone);
      showError(e.message || 'Impossible de mettre à jour le petit déjeuner.');
    }
  }, [showError]);

  // Resource session card « fait » toggle (specs/resource-hourly-scheduling.md §3.4). Matched by
  // reservationId + resourceId + date + start; optimistic with revert on failure.
  const handleToggleResourceCardDone = useCallback(async (item, nextDone) => {
    if (!item) return;
    const matches = (it) => it.reservationId === item.reservationId && it.resourceId === item.resourceId
      && it.date === item.date && it.start === item.start;
    const apply = (value) => setResourceCardsByDate((prev) => {
      const day = prev[item.date];
      if (!day) return prev;
      return { ...prev, [item.date]: { ...day, items: day.items.map((it) => (matches(it) ? { ...it, done: value } : it)) } };
    });
    apply(nextDone);
    try {
      await api.setPlanningResourceCardDone({
        reservationId: item.reservationId, resourceId: item.resourceId, date: item.date, start: item.start, done: nextDone,
      });
    } catch (e) {
      apply(!nextDone); // revert
      showError(e.message || 'Impossible de mettre à jour la session.');
    }
  }, [showError]);

  // Arrival / departure SAS (specs/arrival-departure-sas.md). Clicking an arrival card opens the
  // arrival SAS, a departure row the departure SAS. `{ reservationId, mode }` drives the dialog.
  const [sas, setSas] = useState(null);
  const openArrivalSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'arrival' }); }, []);
  const openDepartureSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'departure' }); }, []);

  // Deep-link from a push notification (specs/pwa-push-notifications.md §3.3 rule 10):
  // /planning?sas=arrival|departure&reservationId=:id opens the matching SAS, then the params are
  // cleared (history replace) so a refresh / back doesn't reopen it. The dialog loads the reservation
  // by id, independent of the week currently shown.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const link = readSasDeepLink(searchParams);
    if (!link) return;
    if (link.mode === 'arrival') openArrivalSas(link.reservationId);
    else openDepartureSas(link.reservationId);
    const next = new URLSearchParams(searchParams);
    next.delete('sas');
    next.delete('reservationId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, openArrivalSas, openDepartureSas]);
  const openClient = useCallback((clientId) => { if (clientId && !receptionMode) navigate(withFrom(`/clients?clientId=${clientId}`, '/planning')); }, [navigate, receptionMode]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
  // Option-driven planning cards (specs/option-planning-card.md §3.3). Map ISO date →
  // `{ items: [{ reservationId, optionId, title, clientName, propertyName, date, time }] }`.
  // Empty days are absent; `OptionDayCard` hides itself if data is missing.
  const [optionCardsByDate, setOptionCardsByDate] = useState({});
  // Resource-driven planning cards (specs/resource-hourly-scheduling.md §3.4). Map ISO date →
  // `{ items: [{ reservationId, resourceId, name, clientName, propertyName, date, start, end, done }] }`.
  const [resourceCardsByDate, setResourceCardsByDate] = useState({});
  // Linen inventory projection (specs/linen-inventory-shortage-tracking.md §6.2). Map ISO date
  // → per-type clean snapshot to display as the 3rd block on each laundry day.
  const [inventoryByDate, setInventoryByDate] = useState({});
  // specs/skip-laundry-trip.md §4.2 — global set of ISO dates the operator marked as
  // not-made. Loaded once on mount + kept in sync by the toggle handler. Empty Set on
  // initial render so the cards default to "not skipped" while the request is in flight.
  const [skippedLaundryDates, setSkippedLaundryDates] = useState(() => new Set());
  // specs/manual-laundry-additions.md — per-trip manual linen (date → {6 counts}, only non-empty
  // trips) + the date of the open editor (null = closed) + its in-flight save flag.
  const [manualAdditionsByDate, setManualAdditionsByDate] = useState({});
  const [editManualDate, setEditManualDate] = useState(null);
  const [manualSaving, setManualSaving] = useState(false);

  // specs/planning-breakfast-prep-popup.md — the breakfast card item whose preparation popup
  // is open (null = closed). The fiche stays reachable from the popup's « Fiche » button.
  const [breakfastPrepItem, setBreakfastPrepItem] = useState(null);

  // Deep-link from a breakfast push (specs/sas-breakfast-bread-and-push.md rule 10):
  // /planning?breakfast=:id&date=YYYY-MM-DD opens the preparation popup for that day's item,
  // independent of the week shown; params cleaned first (history replace, SAS deep-link idiom).
  useEffect(() => {
    const link = readBreakfastDeepLink(searchParams);
    if (!link) return;
    const next = new URLSearchParams(searchParams);
    next.delete('breakfast');
    next.delete('date');
    setSearchParams(next, { replace: true });
    api.getBreakfastPlanningSummary({ from: link.date, to: link.date })
      .then((r) => {
        const item = r?.breakfastByDate?.[link.date]?.items?.find((i) => Number(i.reservationId) === link.reservationId);
        if (item) setBreakfastPrepItem(mapBreakfastItem(item, link.date));
      })
      .catch(() => {});
  }, [searchParams, setSearchParams]);

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
      showError(`Impossible d'enregistrer le voyage non réalisé. ${err?.message || ''}`);
    }
  }, [skippedLaundryDates, startDate]);

  // specs/manual-laundry-additions.md — save a trip's manual linen, then refetch the laundry summary
  // + inventory + additions (from the business horizon, scroll-independent — same discipline as the
  // skip handler) so the À apporter / disponible-après totals and the « dont ajout manuel » caption
  // update together. Closes the editor on success.
  const handleSaveManualAddition = useCallback(async (date, counts) => {
    setManualSaving(true);
    try {
      await api.setLaundryManualAddition(date, counts);
      const [summary, inventory, additions] = await Promise.all([
        api.getLaundryPlanningSummary({ from: startDate }).catch(() => ({ laundryDays: [] })),
        api.getLinenInventory().catch(() => ({ byLaundryDay: {} })),
        api.getLaundryManualAdditions().catch(() => ({ additions: {} })),
      ]);
      const lByDate = {};
      for (const ld of (summary?.laundryDays || [])) lByDate[ld.date] = { dropOff: ld.dropOff, pickUp: ld.pickUp };
      setLaundryByDate(lByDate);
      setInventoryByDate(inventory?.byLaundryDay || {});
      setManualAdditionsByDate(additions?.additions || {});
      setEditManualDate(null);
    } catch (err) {
      showError(`Impossible d'enregistrer l'ajout manuel. ${err?.message || ''}`);
    } finally {
      setManualSaving(false);
    }
  }, [startDate]);

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

  const loadPlanning = async (from) => {
    setLoading(true);
    setLoadError(false);
    try {
      const to = addDays(from, DAYS_AHEAD - 1);
      const [reservationsBase, rbEvents, laundrySummary, inventoryProjection, breakfastSummary, optionCardsSummary, resourceCardsSummary, manualAdditions] = await Promise.all([
        api.getReservations({ from, to }),
        api.getResourceBookingPlanningEvents(from, to).catch(() => []),
        // Non-blocking: a 500 here must not break the planning. Silent fallback to empty.
        api.getLaundryPlanningSummary({ from, to }).catch(() => ({ laundryDays: [] })),
        // §3.7 follow-up — linen inventory projection. Same non-blocking discipline.
        api.getLinenInventory().catch(() => ({ byLaundryDay: {} })),
        // specs/breakfast-option-and-planning-card.md §4.2 — per-day breakfast list.
        // Non-blocking like the others; an empty map keeps the planning fully functional.
        api.getBreakfastPlanningSummary({ from, to }).catch(() => ({ breakfastByDate: {} })),
        // specs/option-planning-card.md §3.3 — option-driven planning cards. Non-blocking.
        api.getPlanningOptionCards({ from, to }).catch(() => ({ optionCardsByDate: {} })),
        // specs/resource-hourly-scheduling.md §3.4 — resource session cards. Non-blocking.
        api.getPlanningResourceCards({ from, to }).catch(() => ({ resourceCardsByDate: {} })),
        // specs/manual-laundry-additions.md — per-trip manual linen, for the « dont ajout manuel »
        // caption + the editor's pre-fill. Already folded into the summary/inventory server-side.
        api.getLaundryManualAdditions().catch(() => ({ additions: {} })),
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
      setManualAdditionsByDate(manualAdditions?.additions || {});
      // Breakfast map (date → { items, totalPersons }) directly from the server payload.
      setBreakfastByDate(breakfastSummary?.breakfastByDate || {});
      // Option-driven planning cards (specs/option-planning-card.md §3.3).
      setOptionCardsByDate(optionCardsSummary?.optionCardsByDate || {});
      // Resource session cards (specs/resource-hourly-scheduling.md §3.4).
      setResourceCardsByDate(resourceCardsSummary?.resourceCardsByDate || {});

      // Inventory map (date → per-type clean snapshot). Hydrated for every laundry day in the
      // horizon; LaundryDayCard filters the types it actually renders.
      setInventoryByDate(inventoryProjection?.byLaundryDay || {});

      detectAlerts(days, properties);
      lastLoadedRef.current = to;
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlanning(startDate);
  }, [startDate, properties]); // eslint-disable-line

  // Infinite scroll listener — bound to the WINDOW: the page has no scroll container of its own
  // anymore (specs/ds-sweep-planning.md rule 6 — the sticky bar must survive scrolling).
  useEffect(() => {
    const handleScroll = () => {
      const doc = document.documentElement;
      if (doc.scrollHeight - window.scrollY - window.innerHeight < 200 && !loading && lastLoadedRef.current) {
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
        // Same incremental pattern for the option-driven cards (specs/option-planning-card.md §3.3).
        api.getPlanningOptionCards({ from: nextStart, to: nextEnd })
          .then((summary) => {
            const next = summary?.optionCardsByDate || {};
            setOptionCardsByDate((prev) => ({ ...prev, ...next }));
          })
          .catch(() => {});
        // Same incremental pattern for resource session cards (specs/resource-hourly-scheduling.md §3.4).
        api.getPlanningResourceCards({ from: nextStart, to: nextEnd })
          .then((summary) => {
            const next = summary?.resourceCardsByDate || {};
            setResourceCardsByDate((prev) => ({ ...prev, ...next }));
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

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, planningDays, detectAlerts, properties]); // eslint-disable-line

  const handleToggleReady = async (r) => {
    const newReady = !r.checkInReady;
    try {
      await api.markPayment(r.id, { checkInReady: newReady });
      setPlanningDays((prev) =>
        prev.map((day) => ({
          ...day,
          reservations: day.reservations.map((res) =>
            res.id === r.id ? { ...res, checkInReady: newReady } : res
          ),
        }))
      );
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  };

  const handleToggleDepartureDone = async (reservation) => {
    const newValue = !reservation.checkOutDone;
    try {
      await api.markPayment(reservation.id, { checkOutDone: newValue });
      setDeparturesMap((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((date) => {
          next[date] = next[date].map((r) => (r.id === reservation.id ? { ...r, checkOutDone: newValue } : r));
        });
        return next;
      });
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  };

  // Date cluster — bar `center` on sm+, compact strip under the bar on xs
  // (specs/ds-sweep-planning.md rule 2). Color legend removed 2026-06-06.
  const renderDateNav = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
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
          htmlInput: { style: { padding: '6px 10px' }, 'aria-label': 'Date de début' }
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
  );

  return (
    <Box>
      <PageActionBar title="Planning" titleOnXs center={renderDateNav()} />
      {/* xs fallback for the bar's hidden `center` — same date cluster, compact strip. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {renderDateNav()}
      </Box>

      {loadError && (
        <ErrorAlert message="Impossible de charger le planning." onRetry={() => loadPlanning(startDate)} sx={{ mb: 3 }} />
      )}
      {loading && <LoadingState variant="skeleton" rows={3} />}
      {/* Day list — normally-flowing content scrolled by the window (rule 6): no page-owned
          scroll container, so the sticky bar stays visible and the page opens at the top. */}
      <Box>
        {!loading && !loadError && planningDays.length === 0 && (
          <EmptyState message={`Aucune arrivée ni créneau ressource sur les ${DAYS_AHEAD} prochains jours.`} />
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
          // specs/option-planning-card.md §3.3 — a date with ONLY an option card must still render.
          ...Object.keys(optionCardsByDate).filter((d) => (optionCardsByDate[d]?.items?.length || 0) > 0),
          // specs/resource-hourly-scheduling.md §3.4 — a date with ONLY a resource card must still render.
          ...Object.keys(resourceCardsByDate).filter((d) => (resourceCardsByDate[d]?.items?.length || 0) > 0),
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
                    color: isToday || allReady ? 'common.white' : 'text.primary',
                    borderRadius: 2,
                    px: 2,
                    py: 1,
                    flexGrow: 1,
                  }}
                >
                  <TodayIcon sx={{ fontSize: 20 }} />
                  <Typography variant="sectionHeader" sx={{ textTransform: 'capitalize' }}>
                    {frenchWeekday(date)}
                    {isToday && ' — Aujourd\'hui'}
                  </Typography>
                  <Chip
                    label={`${reservations.filter((r) => r.checkInReady).length}/${reservations.length}`}
                    size="small"
                    sx={(t) => ({
                      ml: 'auto',
                      bgcolor: alpha(t.palette.common.white, 0.25),
                      color: isToday || allReady ? 'common.white' : 'text.primary',
                      fontWeight: 700,
                      height: 22,
                    })}
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
                manualAddition={manualAdditionsByDate[date]}
                onEditManual={setEditManualDate}
              />

              {/* Breakfast card (specs/breakfast-option-planning-card.md +
                  sas-breakfast-milk-and-food.md): now rendered through the shared OptionDayCard in
                  the « breakfast » theme (amber) so it matches the other option cards — title + time
                  pill, property, person + the morning headcount + café/thé/chocolat/lait +
                  viennoiseries/céréales — with the « fait » circle. Driven by the breakfast option's
                  selected occurrences. Clicking the card opens the preparation popup
                  (specs/planning-breakfast-prep-popup.md); the fiche is reachable from it. */}
              <OptionDayCard
                theme="breakfast"
                data={breakfastByDate[date] ? {
                  items: breakfastByDate[date].items.map((i) => mapBreakfastItem(i, date)),
                } : null}
                onItemClick={(reservationId, item) => setBreakfastPrepItem(item)}
                onToggleDone={handleToggleBreakfastDone}
              />

              {/* Option-driven planning cards (specs/option-planning-card.md §3.3). Sits with the
                  other day cards; hides itself when no occurrence falls on this date. Each row is
                  clickable and opens the corresponding reservation fiche. */}
              <OptionDayCard data={optionCardsByDate[date]} onItemClick={openReservation} onToggleDone={handleToggleOptionCardDone} />

              {/* Resource session cards (specs/resource-hourly-scheduling.md §3.4) — one per session,
                  teal theme, time range pill. Maps the resource fields onto the shared card shape. */}
              <OptionDayCard
                theme="resource"
                data={resourceCardsByDate[date] ? {
                  items: resourceCardsByDate[date].items.map((i) => ({
                    ...i,
                    optionId: i.resourceId,
                    title: i.name,
                    time: i.end ? `${i.start}–${i.end}` : i.start,
                  })),
                } : null}
                onItemClick={openReservation}
                onToggleDone={handleToggleResourceCardDone}
              />

              {dayDepartures.length > 0 && (
                <Box sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {dayDepartures.map((r) => (
                      <DepartureMiniRow
                        key={`dep-${r.id}`}
                        reservation={r}
                        onToggleDone={handleToggleDepartureDone}
                        onOpenReservation={receptionMode ? undefined : openReservation}
                        onOpenSas={openDepartureSas}
                        onOpenClient={receptionMode ? undefined : openClient}
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
                  onOpenReservation={receptionMode ? undefined : openReservation}
                  onOpenSas={openArrivalSas}
                  onOpenClient={receptionMode ? undefined : openClient}
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
        canOpenReservation={!receptionMode}
      />

      <LaundryManualAdditionsDialog
        open={!!editManualDate}
        date={editManualDate}
        current={editManualDate ? manualAdditionsByDate[editManualDate] : null}
        saving={manualSaving}
        onClose={() => setEditManualDate(null)}
        onSave={handleSaveManualAddition}
      />

      <BreakfastPrepDialog
        open={!!breakfastPrepItem}
        item={breakfastPrepItem}
        onClose={() => setBreakfastPrepItem(null)}
        onOpenFiche={() => {
          const id = breakfastPrepItem?.reservationId;
          setBreakfastPrepItem(null);
          if (id) openReservation(id);
        }}
      />
    </Box>
  );
}
