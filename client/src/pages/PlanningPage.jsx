import React, { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Box, Typography, Card, CardContent, Chip, Divider,
  TextField, Button, IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import TodayIcon from '@mui/icons-material/Today';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import OptionDayCard from '../components/OptionDayCard';
import BreakfastPrepDialog from '../components/BreakfastPrepDialog';
import ReservationCard from '../components/ReservationCard';
import DepartureMiniRow from '../components/DepartureMiniRow';
import Slot from '../plugins/sdk/Slot';
import { readSasDeepLink, readBreakfastDeepLink } from '../utils/sasDeepLink';
import { orderDayEntries } from '../utils/planningDayOrder';
import { displayDate } from '../utils/formatters';
import { cleaningTurnoverConflict } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import { countDayTasks } from '../utils/planningDayTasks';
import { useAuth } from '../hooks/useAuth';
import { isReceptionOnly } from '../constants/roles';
import api from '../api';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { useSlot } from '../plugins/sdk/useSlot';

const DAYS_AHEAD = 14;

// A `planning.days` contribution is identified by its plugin and its key.
const contributionId = (c) => `${c.pluginId}:${c.key}`;

// Day-card palette (PlanningPage). Tuned 2026-06-02 to make arrivals stand out from departures
// without going flashy; a plugin's card (e.g. the laundry) carries its own tone.
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
  // The SAS locks themselves (specs/reception-sas-today-only.md) ride along in the reservation
  // payload — the cards read them directly, nothing to pass down from here.
  const receptionMode = isReceptionOnly(user);
  const sasOn = usePlugin(SAS);
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
    if (sasOn && link.mode === 'arrival') openArrivalSas(link.reservationId);
    else if (sasOn) openDepartureSas(link.reservationId);
    const next = new URLSearchParams(searchParams);
    next.delete('sas');
    next.delete('reservationId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, openArrivalSas, openDepartureSas, sasOn]);
  const openClient = useCallback((clientId) => { if (clientId && !receptionMode) navigate(withFrom(`/clients?clientId=${clientId}`, '/planning')); }, [navigate, receptionMode]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [planningDays, setPlanningDays] = useState([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [alertMap, setAlertMap] = useState({});
  const [properties, setProperties] = useState([]);
  const [departuresMap, setDeparturesMap] = useState({});
  // Cards plugins add to the days (slot `planning.days`, specs/plugins-phase-2-hosts.md rule 5):
  // contribution id → { [date]: entry }, each loaded by the contribution's own `load`.
  const dayContributions = useSlot('planning.days');
  const actionContributions = useSlot('planning.actions');
  const [contributedByDate, setContributedByDate] = useState({});
  // Per-day breakfast list (specs/breakfast-option-and-planning-card.md §4.2). Map ISO date
  // → `{ items: [{ reservationId, clientName, propertyName, persons }], totalPersons }`.
  // Empty days are not included; `BreakfastDayCard` hides itself if data is missing.
  const [breakfastByDate, setBreakfastByDate] = useState({});
  // Option-driven planning cards (specs/option-planning-card.md §3.3). Map ISO date →
  // `{ items: [{ reservationId, optionId, title, clientName, propertyName, date, time }] }`.
  // Empty days are absent; `OptionDayCard` hides itself if data is missing.
  const [optionCardsByDate, setOptionCardsByDate] = useState({});

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

  // Loads the contributed day cards of [from, to]. `merge` adds a window the infinite scroll reached;
  // otherwise the contribution's dates are replaced. A failed load leaves that contribution's cards
  // out and says so; the other cards render.
  // The last date the contributions were loaded for. Kept apart from `lastLoadedRef`, which the
  // infinite scroll clears when no reservation follows: a reload must still cover every day shown.
  const contributedUntilRef = useRef(null);
  // The window the infinite scroll already asked for: every scroll event near the bottom fires the
  // handler, and `lastLoadedRef` only moves once the reservations are back.
  const requestedFromRef = useRef(null);
  const loadContributions = useCallback((contributions, range, { merge = false } = {}) => Promise.all(
    contributions.map((c) => Promise.resolve()
      .then(() => c.load(range))
      .then((byDate) => setContributedByDate((prev) => ({
        ...prev,
        [contributionId(c)]: merge ? { ...(prev[contributionId(c)] || {}), ...(byDate || {}) } : (byDate || {}),
      })))
      .catch(() => showError(c.errorMessage || 'Une partie du planning n’a pas pu être chargée.'))),
  ), [showError]);

  // `reload()` of a contribution: its cards over the whole window shown, the others untouched.
  const reloadContributions = useCallback((contributions) => loadContributions(contributions, {
    from: startDate,
    to: contributedUntilRef.current || addDays(startDate, DAYS_AHEAD - 1),
  }), [loadContributions, startDate]);

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
      contributedUntilRef.current = to;
      const [reservationsBase, breakfastSummary, optionCardsSummary] = await Promise.all([
        api.getReservations({ from, to }),
        // specs/breakfast-option-and-planning-card.md §4.2 — per-day breakfast list.
        // Non-blocking like the others; an empty map keeps the planning fully functional.
        api.getBreakfastPlanningSummary({ from, to }).catch(() => ({ breakfastByDate: {} })),
        // specs/option-planning-card.md §3.3 — option-driven planning cards. Non-blocking.
        api.getPlanningOptionCards({ from, to }).catch(() => ({ optionCardsByDate: {} })),
        // The plugins' day cards — non-blocking: a failed contribution only loses its own cards.
        loadContributions(dayContributions, { from, to }),
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

      // Breakfast map (date → { items, totalPersons }) directly from the server payload.
      setBreakfastByDate(breakfastSummary?.breakfastByDate || {});
      // Option-driven planning cards (specs/option-planning-card.md §3.3).
      setOptionCardsByDate(optionCardsSummary?.optionCardsByDate || {});

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
        if (requestedFromRef.current === nextStart) return;
        requestedFromRef.current = nextStart;
        const nextEnd = addDays(nextStart, DAYS_AHEAD - 1);
        // The plugins' day cards of the next window, merged into what is shown. Non-blocking; an
        // error here must not stop the infinite scroll.
        contributedUntilRef.current = nextEnd;
        loadContributions(dayContributions, { from: nextStart, to: nextEnd }, { merge: true });
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
      <PageActionBar
        title="Planning"
        titleOnXs
        center={renderDateNav()}
        // Buttons plugins add to the bar (slot `planning.actions`, specs/plugins-phase-2-hosts.md
        // rule 6); `reload()` reloads that plugin's day cards.
        actionsBefore={actionContributions.map((c) => ({
          node: (
            <Suspense key={contributionId(c)} fallback={null}>
              <c.Component reload={() => reloadContributions(dayContributions.filter((d) => d.pluginId === c.pluginId))} />
            </Suspense>
          ),
        }))}
      />
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

        {/* Merge reservation days + the dates the plugins' day cards
            return (specs/plugins-phase-2-hosts.md rule 5): a day with only a laundry card still
            renders. Each contribution decides which of its dates carry a card. */}
        {[...new Set([
          ...planningDays.map((d) => d.date),
          ...Object.keys(departuresMap),
          ...dayContributions.flatMap((c) => Object.keys(contributedByDate[contributionId(c)] || {})),
          // specs/breakfast-option-and-planning-card.md §3 rule 8 — a date that has ONLY a
          // breakfast card (no arrival/departure/laundry) must still render so the operator
          // sees it. Filter to days where there's actually at least one item.
          ...Object.keys(breakfastByDate).filter((d) => (breakfastByDate[d]?.items?.length || 0) > 0),
          // specs/option-planning-card.md §3.3 — a date with ONLY an option card must still render.
          ...Object.keys(optionCardsByDate).filter((d) => (optionCardsByDate[d]?.items?.length || 0) > 0),
        ])].sort().map((date, idx, arr) => {
          const day = planningDays.find((d) => d.date === date);
          const dayDepartures = departuresMap[date] || [];
          const reservations = day ? day.reservations : [];
          const isToday = date === todayStr;
          // specs/planning-day-task-count.md — the chip counts EVERY tickable card of the day
          // (arrivals + departures + resource sessions), not just the arrivals: a day of departures
          // used to read « 0/0 » and could never turn green.
          const dayTasks = countDayTasks({
            arrivals: reservations,
            departures: dayDepartures,
            // A plugin card counts only if its contribution says what it holds to tick (rule 7).
            contributed: dayContributions
              .filter((c) => c.countTasks && contributedByDate[contributionId(c)]?.[date])
              .map((c) => c.countTasks(contributedByDate[contributionId(c)][date])),
          });
          const allReady = dayTasks.allDone;

          // Build every card of the day as an orderable entry `{ key, time, node }`, then sort them
          // into a single chronological stream (specs/planning-chronological-day-ordering.md).
          // `time` is the card's HH:MM sort key; a null time sends the card to the bottom.
          const entries = [];
          // Departures (checkOutTime, fallback 11:00).
          dayDepartures.forEach((r) => entries.push({
            key: `dep-${r.id}`,
            time: r.checkOutTime || '11:00',
            node: (
              <DepartureMiniRow
                reservation={r}
                onToggleDone={handleToggleDepartureDone}
                onOpenReservation={receptionMode ? undefined : openReservation}
                onOpenSas={sasOn ? openDepartureSas : undefined}
                onOpenClient={receptionMode ? undefined : openClient}
                alertInfo={alertMap[r.id]}
              />
            ),
          }));
          // Arrivals (checkInTime, fallback 15:00).
          reservations.forEach((r) => entries.push({
            key: `arr-${r.id}`,
            time: r.checkInTime || '15:00',
            node: (
              <ReservationCard
                reservation={r}
                onToggleReady={handleToggleReady}
                alertInfo={alertMap[r.id]}
                onOpenReservation={receptionMode ? undefined : openReservation}
                onOpenSas={sasOn ? openArrivalSas : undefined}
                onOpenClient={receptionMode ? undefined : openClient}
              />
            ),
          }));
          // Breakfast cards (breakfastTime) — one card per morning item.
          (breakfastByDate[date]?.items || []).forEach((i) => {
            const item = mapBreakfastItem(i, date);
            entries.push({
              key: `bf-${item.reservationId}-${item.time || ''}`,
              time: item.time,
              node: (
                <OptionDayCard
                  theme="breakfast"
                  data={{ items: [item] }}
                  onItemClick={(reservationId, it) => setBreakfastPrepItem(it)}
                  onToggleDone={handleToggleBreakfastDone}
                />
              ),
            });
          });
          // Option / meal cards (item.time; null → time-less → bottom).
          (optionCardsByDate[date]?.items || []).forEach((i) => entries.push({
            key: `opt-${i.reservationId}-${i.optionId}-${i.time || ''}`,
            time: i.time,
            node: (
              <OptionDayCard
                data={{ items: [i] }}
                onItemClick={openReservation}
                onToggleDone={handleToggleOptionCardDone}
              />
            ),
          }));
          // The plugins' day cards (slot `planning.days`). A `timed` contribution gives a list of cards
          // for the day, each with its `time`, sorted among the day's own timed cards
          // (specs/plugins-phase-3c-hourly-resources.md rule 22); the others give one time-less
          // card, placed among the day's other time-less cards by its `rank`.
          dayContributions.forEach((c) => {
            const entry = contributedByDate[contributionId(c)]?.[date];
            if (!entry) return;
            if (c.timed) {
              (Array.isArray(entry) ? entry : []).forEach((card) => entries.push({
                key: `${contributionId(c)}-${card.key}`,
                time: card.time || null,
                rank: c.rank,
                node: (
                  <Suspense fallback={null}>
                    <c.Component
                      date={date}
                      entry={card}
                      reload={() => reloadContributions([c])}
                      onOpenReservation={receptionMode ? undefined : openReservation}
                    />
                  </Suspense>
                ),
              }));
              return;
            }
            entries.push({
              key: `${contributionId(c)}-${date}`,
              time: null,
              rank: c.rank,
              node: (
                <Suspense fallback={null}>
                  <c.Component date={date} entry={entry} reload={() => reloadContributions([c])} />
                </Suspense>
              ),
            });
          });
          const orderedEntries = orderDayEntries(entries);

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
                    label={`${dayTasks.done}/${dayTasks.total}`}
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

              {/* All of the day's cards, interleaved into one chronological stream by time
                  (specs/planning-chronological-day-ordering.md). Each card keeps its own component
                  and behavior; only the vertical order changes. Departures stay grouped as a
                  vertical strip only implicitly, through their shared 11:00-ish checkout times. */}
              {orderedEntries.map((entry) => (
                <React.Fragment key={entry.key}>{entry.node}</React.Fragment>
              ))}

              {idx < arr.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          );
        })}
      </Box>

      <Slot
        name="sas.dialog"
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onDone={() => { setSas(null); loadPlanning(startDate); }}
        canOpenReservation={!receptionMode}
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
