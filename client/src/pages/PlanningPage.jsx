import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Box, Typography } from '@mui/material';
import TodayIcon from '@mui/icons-material/Today';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import OptionDayCard from '../components/OptionDayCard';
import BreakfastPrepDialog from '../components/BreakfastPrepDialog';
import ReservationCard from '../components/ReservationCard';
import DepartureMiniRow from '../components/DepartureMiniRow';
import PlanningDayHeader from '../components/PlanningDayHeader';
import Slot from '../plugins/sdk/Slot';
import { readSasDeepLink, readBreakfastDeepLink } from '../utils/sasDeepLink';
import { orderDayEntries } from '../utils/planningDayOrder';
import { buildTimeline } from '../utils/planningTimeline';
import { withFrom } from '../utils/navigation';
import { countDayTasks } from '../utils/planningDayTasks';
import { useAuth } from '../hooks/useAuth';
import { isReceptionOnly } from '../constants/roles';
import api from '../api';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { useSlot } from '../plugins/sdk/useSlot';
import { Contribution } from '../plugins/sdk/Slot';
import useServerToday from '../hooks/useServerToday';
import useInfiniteEdgeScroll from '../hooks/useInfiniteEdgeScroll';
import usePlanningTimeline, { contributionId } from '../hooks/usePlanningTimeline';
import {
  EDGE_ERROR, RELOAD_ERROR, NOTHING_PLANNED, NOTHING_PLANNED_TODAY, TODAY_ACTION,
} from '../constants/planningCopy';

// Day-card palette (PlanningPage). Tuned 2026-06-02 to make arrivals stand out from departures
// without going flashy; a plugin's card (e.g. the laundry) carries its own tone.
//   - Arrivals: warm peach (MUI orange[50]) — welcoming, attention-grabbing. See
//     `components/ReservationCard.js` for the canonical ARRIVAL_BG constant.
//   - Departures: very pale grey (MUI grey[100]) — fades into the page on purpose. See
//     `components/DepartureMiniRow.js` for the canonical DEPARTURE_BG constant.
//   - "Done" green + alert overlays still take priority (each card's sx handles them).

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

// How close today's header must be to its resting place under the bar to count as « there ».
const AT_TODAY_TOLERANCE_PX = 8;
const PAST_LOADING = 'Chargement des jours précédents';

const barBottom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gf-page-bar-bottom')) || 0;
const todayKey = (today) => `day-${today}`;

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

  // The server's date (specs/ds-sweep-planning.md rule 28); the timeline waits for it.
  const todayStr = useServerToday();
  // Cards plugins add to the days (slot `planning.days`, specs/plugins-phase-2-hosts.md rule 5), each
  // loaded by the contribution's own `load` for every window; buttons they add to the bar (rule 6).
  const dayContributions = useSlot('planning.days');
  const actionContributions = useSlot('planning.actions');

  const holdAnchorRef = useRef(() => {});
  const timeline = usePlanningTimeline({
    today: todayStr,
    contributions: dayContributions,
    holdAnchor: () => holdAnchorRef.current(),
    onReloadError: () => showError(RELOAD_ERROR),
    onPluginError: (c) => showError(c.errorMessage || 'Une partie du planning n’a pas pu être chargée.'),
  });
  const { windows, phase, mapDays } = timeline;

  // The opening position (rule 12) is set once the first windows are drawn; the edges extend after it.
  const [positioned, setPositioned] = useState(false);
  const { holdAnchor, scrollToAnchor, pinAnchor } = useInfiniteEdgeScroll({
    enabled: phase === 'ready' && positioned,
    version: timeline.version,
    onNearStart: timeline.requestStart,
    onNearEnd: timeline.requestEnd,
    getTopOffset: barBottom,
  });
  holdAnchorRef.current = holdAnchor;

  useEffect(() => { if (phase !== 'ready') setPositioned(false); }, [phase]);
  useLayoutEffect(() => {
    if (phase !== 'ready' || positioned) return;
    pinAnchor(todayKey(todayStr));
    setPositioned(true);
  }, [phase, positioned, todayStr, pinAnchor]);

  const [atToday, setAtToday] = useState(false);
  // Set by « Aujourd'hui » while its smooth scroll runs: a window request that releases today's window
  // meanwhile leaves the scroll without a target, so the timeline is reopened on today instead.
  const wantsToday = useRef(false);
  useEffect(() => {
    if (!positioned) return undefined;
    const update = () => {
      const node = document.querySelector(`[data-scroll-anchor="${todayKey(todayStr)}"]`);
      const there = Boolean(node) && Math.abs(node.getBoundingClientRect().top - barBottom()) <= AT_TODAY_TOLERANCE_PX;
      if (there) wantsToday.current = false;
      setAtToday(there);
    };
    update();
    // A layout shift that moves today without a scroll event (cards settling, a window added above)
    // must not leave « Aujourd'hui » enabled while today sits under the bar.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (observer) observer.observe(document.body);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('scroll', update);
    };
  }, [positioned, todayStr, timeline.version]);

  useEffect(() => {
    const cancel = () => { wantsToday.current = false; };
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach((name) => window.addEventListener(name, cancel, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, cancel));
  }, []);

  useEffect(() => {
    if (!wantsToday.current || phase !== 'ready') return;
    if (windows.some((w) => w.k === 0 && w.status === 'loaded')) return;
    wantsToday.current = false;
    timeline.reopen();
  }, [timeline.version, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // « Aujourd'hui »: back under the bar; windows released since the opening are loaded first.
  const goToToday = () => {
    if (windows.some((w) => w.k === 0 && w.status === 'loaded')) {
      wantsToday.current = true;
      scrollToAnchor(todayKey(todayStr), { behavior: 'smooth' });
    } else {
      wantsToday.current = false;
      timeline.reopen();
    }
  };

  const { items } = useMemo(() => buildTimeline(windows.filter((w) => w.status === 'loaded')), [timeline.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cleaning alerts of the cards, computed by the server and keyed by card kind
  // (specs/planning-arrival-alerts.md rules 7–10): an arrival card reads `arrivals`, a departure row
  // reads `departures` — a stay's two cards never share an alert.
  const alerts = useMemo(() => windows.reduce((acc, w) => ({
    arrivals: { ...acc.arrivals, ...w.alerts.arrivals },
    departures: { ...acc.departures, ...w.alerts.departures },
  }), { arrivals: {}, departures: {} }), [timeline.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Option-driven planning card « préparé » toggle (specs/option-planning-card.md §3.5). Optimistic:
  // flip the matching occurrence in state, persist, revert on failure.
  const handleToggleOptionCardDone = useCallback(async (item, nextDone) => {
    if (!item) return;
    const matches = (it) => it.reservationId === item.reservationId && it.optionId === item.optionId
      && it.date === item.date && it.time === item.time;
    const apply = (value) => mapDays((day) => (day.date !== item.date || !day.optionCards ? day : {
      ...day, optionCards: { ...day.optionCards, items: day.optionCards.items.map((it) => (matches(it) ? { ...it, done: value } : it)) },
    }));
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
  }, [mapDays, showError]);

  // The breakfast card shares the « fait » toggle (specs/breakfast-option-and-planning-card.md) — same
  // generic occurrence endpoint, but optimistic state lives in the day's breakfast (matched by reservation
  // + hour on the day). A breakfast without chosen mornings ticks the same way: the server keeps that
  // morning's flag apart (2026-10-27 spec review).
  const handleToggleBreakfastDone = useCallback(async (item, nextDone) => {
    if (!item || !item.optionId) return;
    const apply = (value) => mapDays((day) => (day.date !== item.date || !day.breakfast ? day : {
      ...day,
      breakfast: {
        ...day.breakfast,
        items: day.breakfast.items.map((it) => (
          it.reservationId === item.reservationId && (it.breakfastTime || '') === (item.time || '')
            ? { ...it, done: value } : it)),
      },
    }));
    apply(nextDone);
    try {
      await api.setPlanningOptionCardDone({
        reservationId: item.reservationId, optionId: item.optionId, date: item.date, time: item.time, done: nextDone,
      });
    } catch {
      apply(!nextDone);
      showError('Impossible de mettre à jour le petit déjeuner.');
    }
  }, [mapDays, showError]);

  // Arrival / departure SAS (specs/arrival-departure-sas.md). Clicking an arrival card opens the
  // arrival SAS, a departure row the departure SAS. `{ reservationId, mode }` drives the dialog.
  const [sas, setSas] = useState(null);
  const openArrivalSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'arrival' }); }, []);
  const openDepartureSas = useCallback((reservationId) => { if (reservationId) setSas({ reservationId, mode: 'departure' }); }, []);

  // Deep-link from a push notification (specs/pwa-push-notifications.md §3.3 rule 10):
  // /planning?sas=arrival|departure&reservationId=:id opens the matching SAS, then the params are
  // cleared (history replace) so a refresh / back doesn't reopen it. The dialog loads the reservation
  // by id, independent of the days shown.
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

  // specs/planning-breakfast-prep-popup.md — the breakfast card item whose preparation popup
  // is open (null = closed). The fiche stays reachable from the popup's « Fiche » button.
  const [breakfastPrepItem, setBreakfastPrepItem] = useState(null);

  // Deep-link from a breakfast push (specs/sas-breakfast-bread-and-push.md rule 10):
  // /planning?breakfast=:id&date=YYYY-MM-DD opens the preparation popup for that day's item,
  // independent of the days shown; params cleaned first (history replace, SAS deep-link idiom).
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

  const handleToggleReady = async (r) => {
    const newReady = !r.checkInReady;
    try {
      await api.markPayment(r.id, { checkInReady: newReady });
      mapDays((day) => ({ ...day, arrivals: day.arrivals.map((res) => (res.id === r.id ? { ...res, checkInReady: newReady } : res)) }));
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  };

  const handleToggleDepartureDone = async (reservation) => {
    const newValue = !reservation.checkOutDone;
    try {
      await api.markPayment(reservation.id, { checkOutDone: newValue });
      mapDays((day) => ({ ...day, departures: day.departures.map((r) => (r.id === reservation.id ? { ...r, checkOutDone: newValue } : r)) }));
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  };

  // `reload()` of a contribution: its cards over every loaded window, each with its own range.
  const reloadContributions = timeline.reloadContributions;

  // Buttons plugins add to the bar (slot `planning.actions`); `reload()` reloads that plugin's day cards.
  const actionNodes = actionContributions.map((c) => (
    <Contribution key={contributionId(c)} pluginId={c.pluginId}>
      <c.Component reload={() => reloadContributions(dayContributions.filter((d) => d.pluginId === c.pluginId))} />
    </Contribution>
  ));

  // Every card of the day as an orderable entry `{ key, time, node }`, sorted into one chronological
  // stream (specs/planning-chronological-day-ordering.md). `time` is the card's HH:MM sort key; a null
  // time sends the card to the bottom.
  const dayEntries = (day, plugin) => {
    const entries = [];
    // Departures (checkOutTime, fallback 11:00).
    day.departures.forEach((r) => entries.push({
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
    day.arrivals.forEach((r) => entries.push({
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
    (day.breakfast?.items || []).forEach((i) => {
      const item = mapBreakfastItem(i, day.date);
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
    (day.optionCards?.items || []).forEach((i) => entries.push({
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
      const entry = plugin[contributionId(c)];
      if (!entry) return;
      if (c.timed) {
        (Array.isArray(entry) ? entry : []).forEach((card) => entries.push({
          key: `${contributionId(c)}-${card.key}`,
          time: card.time || null,
          rank: c.rank,
          node: (
            <Contribution pluginId={c.pluginId}>
              <c.Component
                date={day.date}
                entry={card}
                reload={() => reloadContributions([c])}
                onOpenReservation={receptionMode ? undefined : openReservation}
              />
            </Contribution>
          ),
        }));
        return;
      }
      entries.push({
        key: `${contributionId(c)}-${day.date}`,
        time: null,
        rank: c.rank,
        node: (
          <Contribution pluginId={c.pluginId}>
            <c.Component date={day.date} entry={entry} reload={() => reloadContributions([c])} />
          </Contribution>
        ),
      });
    });
    return orderDayEntries(entries);
  };

  const renderDay = ({ key, day, plugin }) => {
    const entries = dayEntries(day, plugin);
    // specs/planning-day-task-count.md — the chip counts EVERY tickable card of the day
    // (arrivals + departures + resource sessions), not just the arrivals: a day of departures
    // used to read « 0/0 » and could never turn green.
    const tasks = countDayTasks({
      arrivals: day.arrivals,
      departures: day.departures,
      // A plugin card counts only if its contribution says what it holds to tick (rule 7).
      contributed: dayContributions
        .filter((c) => c.countTasks && plugin[contributionId(c)])
        .map((c) => c.countTasks(plugin[contributionId(c)])),
    });
    return (
      <Box key={key} component="section" data-scroll-anchor={key} data-date={day.date} sx={{ mb: 2 }}>
        <PlanningDayHeader
          label={day.label}
          isToday={day.isToday}
          isPast={day.isPast}
          done={tasks.done}
          total={tasks.total}
          allDone={tasks.allDone}
        />
        {/* All of the day's cards, interleaved into one chronological stream by time
            (specs/planning-chronological-day-ordering.md). Each card keeps its own component
            and behavior; only the vertical order changes. */}
        {entries.map((entry) => (
          <React.Fragment key={entry.key}>{entry.node}</React.Fragment>
        ))}
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>{NOTHING_PLANNED_TODAY}</Typography>
        )}
      </Box>
    );
  };

  const renderFold = ({ key, label }) => (
    <Typography
      key={key}
      data-scroll-anchor={key}
      data-testid="planning-fold"
      variant="body2"
      color="text.secondary"
      sx={{ py: 1.5, px: 0.5, mb: 2, borderTop: '1px dashed', borderBottom: '1px dashed', borderColor: 'divider', textAlign: 'center' }}
    >
      {`${NOTHING_PLANNED} · ${label}`}
    </Typography>
  );

  // A window in flight shows a skeleton at its edge; a failed one says so and offers to retry.
  // At the start edge the loading shows as a thin progress bar glued under the page bar (`progress` below),
  // out of the layout: nothing is inserted above the viewport, so no card moves
  // (specs/dashboard-planning-scroll.md rule 20).
  const renderEdge = (window, atStart = false) => {
    if (!window || window.status === 'loaded') return null;
    if (window.status === 'loading' && atStart) return null;
    if (window.status === 'loading') return <LoadingState key={`edge-${window.k}`} variant="skeleton" rows={2} />;
    return (
      <ErrorAlert key={`edge-${window.k}`} message={EDGE_ERROR} onRetry={() => timeline.retry(window.k)} sx={{ my: 2 }} />
    );
  };

  return (
    <Box>
      <PageActionBar
        title="Planning"
        progress={phase === 'ready' && windows[0]?.status === 'loading' ? PAST_LOADING : false}
        actionsBefore={[
          { icon: <TodayIcon />, tooltip: TODAY_ACTION, onClick: goToToday, color: 'primary', ariaDisabled: atToday },
          ...actionNodes.map((node) => ({ node })),
        ]}
      />

      {phase === 'error' && (
        <ErrorAlert message="Impossible de charger le planning." onRetry={timeline.reopen} sx={{ mb: 3 }} />
      )}
      {phase === 'opening' && <LoadingState variant="skeleton" rows={3} />}
      {/* The timeline — normally-flowing content scrolled by the window (specs/ds-sweep-planning.md
          rule 6): no page-owned scroll container, so the sticky bar stays visible. Names no plugin's
          cards: an instance without them reads it too (specs/plugins-phase-0-foundation.md rule 30). */}
      {phase === 'ready' && (
        <Box data-testid="planning-timeline" sx={{ overflowAnchor: 'none' }}>
          {renderEdge(windows[0], true)}
          {items.map((item) => (item.kind === 'fold' ? renderFold(item) : renderDay(item)))}
          {renderEdge(windows[windows.length - 1])}
        </Box>
      )}

      <Slot
        name="sas.dialog"
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onDone={() => {
          const id = sas?.reservationId;
          setSas(null);
          if (id) timeline.reloadWindowsHolding(id);
        }}
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
