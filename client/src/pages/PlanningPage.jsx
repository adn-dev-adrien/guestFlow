import React, { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Box, Typography, Card, CardContent, Chip, Divider,
  TextField, Button, IconButton, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
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
import { withFrom } from '../utils/navigation';
import { countDayTasks } from '../utils/planningDayTasks';
import { useAuth } from '../hooks/useAuth';
import { isReceptionOnly } from '../constants/roles';
import api from '../api';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { useSlot } from '../plugins/sdk/useSlot';
import useServerToday from '../hooks/useServerToday';
import { addIsoDays } from '../utils/isoDay';

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

const addDays = addIsoDays;

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
  // On a phone the bar's title lives in the top bar and its date navigation is hidden: the plugin
  // buttons ride with the date strip instead, so the bar is not drawn as an empty band around a lone
  // laundry icon (2026-10-27 audit; specs/shell-and-home-day-first.md rule 23).
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
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
    } catch {
      apply(!nextDone); // revert
      // The server answers a code (OCCURRENCE_NOT_FOUND…): the operator reads a sentence, never the code.
      showError('Impossible de mettre à jour la préparation.');
    }
  }, [showError]);

  // The breakfast card shares the « fait » toggle (specs/breakfast-option-planning-card.md) — same
  // generic occurrence endpoint, but optimistic state lives in breakfastByDate (matched by reservation
  // + hour on the day). A breakfast without chosen mornings ticks the same way: the server keeps that
  // morning's flag apart (2026-10-27 spec review).
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
    } catch {
      apply(!nextDone);
      showError('Impossible de mettre à jour le petit déjeuner.');
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
  // The server's date (specs/ds-sweep-planning.md rule 28); the page waits for it before loading.
  const todayStr = useServerToday();
  const [pickedStart, setStartDate] = useState(null);
  const startDate = pickedStart || todayStr;
  // Cleaning alerts of the cards, computed by the server and keyed by card kind
  // (specs/planning-arrival-alerts.md rules 7–10): an arrival card reads `arrivals`, a departure row
  // reads `departures` — a stay's two cards never share an alert.
  const [alerts, setAlerts] = useState({ arrivals: {}, departures: {} });
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

  const loadPlanning = async (from) => {
    setLoading(true);
    setLoadError(false);
    try {
      const to = addDays(from, DAYS_AHEAD - 1);
      contributedUntilRef.current = to;
      const [reservationsBase, breakfastSummary, optionCardsSummary, alertsSummary] = await Promise.all([
        api.getReservations({ from, to }),
        // specs/breakfast-option-and-planning-card.md §4.2 — per-day breakfast list.
        // Non-blocking like the others; an empty map keeps the planning fully functional.
        api.getBreakfastPlanningSummary({ from, to }).catch(() => ({ breakfastByDate: {} })),
        // specs/option-planning-card.md §3.3 — option-driven planning cards. Non-blocking.
        api.getPlanningOptionCards({ from, to }).catch(() => ({ optionCardsByDate: {} })),
        // specs/planning-arrival-alerts.md rule 7 — the cards' cleaning alerts. Non-blocking.
        api.getPlanningAlerts({ from, to }).catch(() => null),
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

      setAlerts({ arrivals: alertsSummary?.arrivals || {}, departures: alertsSummary?.departures || {} });
      lastLoadedRef.current = to;
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (startDate) loadPlanning(startDate);
  }, [startDate]); // eslint-disable-line

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
        // The next window's cleaning alerts, merged per card kind (specs/planning-arrival-alerts.md).
        api.getPlanningAlerts({ from: nextStart, to: nextEnd })
          .then((next) => setAlerts((prev) => ({
            arrivals: { ...prev.arrivals, ...(next?.arrivals || {}) },
            departures: { ...prev.departures, ...(next?.departures || {}) },
          })))
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
            lastLoadedRef.current = nextEnd;
          });
        });
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, planningDays]); // eslint-disable-line

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
      <IconButton size="small" onClick={() => setStartDate(addDays(startDate, -1))} disabled={!startDate} aria-label="Jour précédent">
        <NavigateBeforeIcon />
      </IconButton>
      <TextField
        type="date"
        size="small"
        value={startDate || ''}
        onChange={(e) => setStartDate(e.target.value)}
        sx={{ width: 155 }}
        slotProps={{
          htmlInput: { style: { padding: '6px 10px' }, 'aria-label': 'Date de début' }
        }}
      />
      <IconButton size="small" onClick={() => setStartDate(addDays(startDate, 1))} disabled={!startDate} aria-label="Jour suivant">
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

  // Buttons plugins add to the bar (slot `planning.actions`, specs/plugins-phase-2-hosts.md rule 6);
  // `reload()` reloads that plugin's day cards.
  const actionNodes = actionContributions.map((c) => (
    <Suspense key={contributionId(c)} fallback={null}>
      <c.Component reload={() => reloadContributions(dayContributions.filter((d) => d.pluginId === c.pluginId))} />
    </Suspense>
  ));

  return (
    <Box>
      <PageActionBar
        title="Planning"
        center={renderDateNav()}
        actionsBefore={isPhone ? [] : actionNodes.map((node) => ({ node }))}
      />
      {/* xs fallback for the bar's hidden `center` — same date cluster, compact strip, with the
          plugin buttons the bar would otherwise hold alone. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', alignItems: 'center', gap: 1, mb: 2 }}>
        {renderDateNav()}
        {isPhone && actionNodes}
      </Box>

      {loadError && (
        <ErrorAlert message="Impossible de charger le planning." onRetry={() => loadPlanning(startDate)} sx={{ mb: 3 }} />
      )}
      {loading && <LoadingState variant="skeleton" rows={3} />}
      {/* Day list — normally-flowing content scrolled by the window (rule 6): no page-owned
          scroll container, so the sticky bar stays visible and the page opens at the top. */}
      <Box>
        {/* Names no plugin's cards: an instance without them reads it too (specs/plugins-phase-0-foundation.md rule 30). */}
        {!loading && !loadError && planningDays.length === 0 && (
          <EmptyState message={`Rien de prévu sur les ${DAYS_AHEAD} prochains jours.`} />
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
                alertInfo={alerts.departures[r.id]}
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
                alertInfo={alerts.arrivals[r.id]}
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
