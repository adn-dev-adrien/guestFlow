import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  Box, Typography, Chip,
  useMediaQuery, useTheme,
} from '@mui/material';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import SegmentedSelect from '../components/SegmentedSelect';
import CumulativeMonthCalendar, { CALENDAR_MIN_WIDTH } from '../components/CumulativeMonthCalendar';
import InfiniteMonthScroller from '../components/InfiniteMonthScroller';
import CalendarMonthGrid from '../components/CalendarMonthGrid';
import CalendarDayAgenda from '../components/CalendarDayAgenda';
import CalendarDayCell from '../components/CalendarDayCell';
import CalendarNoteDialog from '../components/CalendarNoteDialog';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import api from '../api';
import useDayMarkers from '../hooks/useDayMarkers';
import useMonthDataCache from '../hooks/useMonthDataCache';
import useServerToday from '../hooks/useServerToday';
import { getDayOccupancyConflictMessage, getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import { formatDate, shiftDate, CLEANING_COLOR } from '../utils/calendarVisuals';
import { monthGridRange } from '../utils/calendarLayout';
import { localIsoToday } from '../utils/isoDay';

const NOTE_MAX_LENGTH = 50;

const ALL = 'all';

// The month a deep link asks for: `?focusStartDate=…` (the middle of the stay), else `?year=&month=`.
function monthFromParams(searchParams) {
  const focusStartDate = searchParams.get('focusStartDate');
  const focusEndDate = searchParams.get('focusEndDate');
  if (focusStartDate) {
    const start = new Date(`${focusStartDate}T00:00:00`);
    const end = focusEndDate ? new Date(`${focusEndDate}T00:00:00`) : null;
    if (!Number.isNaN(start.getTime())) {
      let focus = start;
      if (end && !Number.isNaN(end.getTime()) && end > start) {
        focus = new Date(start);
        focus.setDate(focus.getDate() + Math.floor((end.getTime() - start.getTime()) / (2 * 86400000)));
      }
      return { year: focus.getFullYear(), month: focus.getMonth() };
    }
  }
  const y = searchParams.get('year');
  const m = searchParams.get('month');
  if (y && m !== null && Number.isFinite(Number(y)) && Number.isFinite(Number(m))) return { year: Number(y), month: Number(m) };
  return null;
}

export default function CalendarPage() {
  const { alert } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [searchParams] = useSearchParams();
  // The day dots and their legend come from plugin modules — the school-holiday zones
  // (specs/plugins-phase-1-sdk.md rule 13).
  const { markersFor, legend: markerLegend } = useDayMarkers();
  const navigate = useNavigate();

  const [loadError, setLoadError] = useState(false);
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState(() => {
    const fromLink = searchParams.get('propertyId');
    return fromLink ? Number(fromLink) : '';
  });
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [publicHolidays, setPublicHolidays] = useState(() => new Set());
  const [noteEdits, setNoteEdits] = useState({});

  const [dragStartDate, setDragStartDate] = useState(null);
  const [dragEndDate, setDragEndDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState('');
  const [noteDialogText, setNoteDialogText] = useState('');

  const blockedSelectionMessageRef = useRef('');
  // The month under the sticky title: the new-reservation / fiche links come back to it, and switching
  // between « Tous » and a logement opens on it.
  const visibleMonthRef = useRef(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const today = useServerToday() || localIsoToday();

  // ---------- DATA LOADING ----------
  const loadProperties = async () => {
    try {
      setProperties(await api.getProperties());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  // One month of one logement: the shared calendar read (stays + closures), its notes, its devis
  // (a cosmetic overlay: a failure degrades silently) and its occupied dates. Occupied dates are an
  // ANTI-OVERBOOKING input (drag-select guards) — a failure must surface as a failed month, not silently
  // allow selecting an actually-blocked range (specs/ds-sweep-planning.md rule 9).
  const loadPropertyMonth = useCallback(async (year, month, signal) => {
    const { from, to } = monthGridRange(year, month);
    const [calendar, notes, devis, occupied] = await Promise.all([
      api.getCalendar({ from, to, propertyId: selectedProp, signal }),
      api.getCalendarNotes(selectedProp, from, to),
      api.getDevis({ propertyId: selectedProp, from, to }).catch(() => []),
      api.getOccupiedDates(selectedProp, from, to),
    ]);
    return {
      ...calendar,
      notes: Object.fromEntries((notes || []).map((n) => [n.date, n.note])),
      devis: (devis || []).filter((d) => d.status !== 'converted'),
      occupiedDates: occupied || [],
    };
  }, [selectedProp]);
  const cache = useMonthDataCache(selectedProp || ALL, loadPropertyMonth);

  // Everything the loaded months know, merged: the cells, the drag guards and the conflict hints read it.
  const loaded = useMemo(() => {
    const stays = new Map();
    const closures = new Map();
    const devis = new Map();
    const notes = {};
    const occupied = new Set();
    Object.values(cache.entries).forEach((entry) => {
      if (entry.status !== 'ready') return;
      entry.data.stays.forEach((st) => stays.set(st.id, st));
      entry.data.closures.forEach((c) => closures.set(c.id, c));
      entry.data.devis.forEach((d) => devis.set(d.id, d));
      Object.assign(notes, entry.data.notes);
      entry.data.occupiedDates.forEach((d) => occupied.add(d));
    });
    return {
      reservations: [...stays.values()],
      closures: [...closures.values()],
      devisList: [...devis.values()],
      calendarNotes: notes,
      occupiedDates: [...occupied],
    };
  }, [cache.entries]);
  const { reservations, closures, devisList, occupiedDates } = loaded;
  const calendarNotes = useMemo(() => {
    const merged = { ...loaded.calendarNotes };
    Object.entries(noteEdits).forEach(([date, text]) => { if (text) merged[date] = text; else delete merged[date]; });
    return merged;
  }, [loaded.calendarNotes, noteEdits]);

  // Public holidays are server-computed; fetch them for the years of the loaded months.
  const visibleYearsKey = useMemo(() => {
    const years = new Set();
    Object.values(cache.entries).forEach((entry) => {
      if (entry.status === 'ready') { years.add(entry.data.from.slice(0, 4)); years.add(entry.data.to.slice(0, 4)); }
    });
    return [...years].sort().join(',');
  }, [cache.entries]);
  useEffect(() => {
    let cancelled = false;
    const years = visibleYearsKey.split(',').filter(Boolean).map(Number);
    if (years.length === 0) return undefined;
    api.getPublicHolidays(years)
      .then((list) => { if (!cancelled) setPublicHolidays(new Set((list || []).map((h) => h.date))); })
      .catch(() => { if (!cancelled) setPublicHolidays(new Set()); });
    return () => { cancelled = true; };
  }, [visibleYearsKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProp) { setSelectedProperty(null); return undefined; }
    api.getProperty(selectedProp)
      .then((prop) => { if (!cancelled) setSelectedProperty(prop); })
      .catch(() => { if (!cancelled) setSelectedProperty(null); });
    return () => { cancelled = true; };
  }, [selectedProp]);

  // ---------- PROPERTY SELECTION / NAVIGATION ----------
  const handleSelectProperty = (propertyId) => {
    setSelectedProp(propertyId);
    setNoteEdits({});
  };

  useEffect(() => { loadProperties(); }, []);

  // Read URL params for navigation from dashboard
  useEffect(() => {
    const propId = searchParams.get('propertyId');
    const resId = searchParams.get('reservationId');
    if (propId) handleSelectProperty(Number(propId));
    else { setSelectedProp(''); setSelectedProperty(null); }
    // If reservationId param is present, open the edit dialog after property is loaded
    if (resId) window.pendingReservationId = resId;
  }, [searchParams]);

  // Handle opening reservation edit when coming from dashboard
  useEffect(() => {
    if (!selectedProp || !window.pendingReservationId) return;
    const resId = window.pendingReservationId;
    delete window.pendingReservationId;
    handleReservationClick(resId);
  }, [selectedProp]);

  // ---------- DERIVED RENDER INPUTS ----------
  const cleaningHours = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;
  const urlMonth = useMemo(() => monthFromParams(searchParams), [searchParams]);
  // A link that names a month moves the view there; otherwise the month in view stays across a switch.
  const scrollerKey = searchParams.toString();
  const openingMonth = urlMonth || visibleMonthRef.current || undefined;

  // ---------- DRAG-TO-SELECT ----------
  const getDaySelectionConflictMessage = (dateStr) =>
    getDayOccupancyConflictMessage({ dateStr, today, occupiedDates, reservations });

  const getRangeSelectionConflictMessage = (startDate, endDate) =>
    getRangeOccupancyConflictInfo({ startDate, endDate, occupiedDates, reservations })?.message || '';

  const isInDragRange = (day, y, m) => {
    if (!dragStartDate || !dragEndDate) return false;
    const dateStr = formatDate(y, m, day);
    const min = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const max = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    return dateStr >= min && dateStr <= max;
  };

  const isDayFullyBlocked = (day, y, m) => occupiedDates.includes(formatDate(y, m, day));
  const hasArrivalOnDay = (day, y, m) => reservations.some((r) => r.startDate === formatDate(y, m, day));

  const handleMouseDown = async (day, y, m) => {
    const dateStr = formatDate(y, m, day);
    const conflictMessage = getDaySelectionConflictMessage(dateStr);
    if (conflictMessage) {
      await alert({ title: 'Conflit de réservation', message: conflictMessage });
      return;
    }
    blockedSelectionMessageRef.current = '';
    setDragStartDate(dateStr);
    setDragEndDate(dateStr);
    setIsDragging(true);
  };

  const handleMouseEnter = (day, y, m) => {
    if (!isDragging || !dragStartDate) return;
    const dateStr = formatDate(y, m, day);
    // Walk from dragStartDate to dateStr, clamping at obstacles
    const start = new Date(dragStartDate);
    const target = new Date(dateStr);
    let clamped = dateStr;
    if (target >= start) {
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor <= target) {
        const cy = cursor.getFullYear(), cm = cursor.getMonth(), cd = cursor.getDate();
        if (isDayFullyBlocked(cd, cy, cm)) {
          blockedSelectionMessageRef.current = getDaySelectionConflictMessage(formatDate(cy, cm, cd));
          cursor.setDate(cursor.getDate() - 1);
          clamped = formatDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
          break;
        }
        if (hasArrivalOnDay(cd, cy, cm)) {
          blockedSelectionMessageRef.current = 'Ce logement est déjà réservé pour ces dates.';
          clamped = formatDate(cy, cm, cd);
          break;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() - 1);
      while (cursor >= target) {
        const cy = cursor.getFullYear(), cm = cursor.getMonth(), cd = cursor.getDate();
        if (isDayFullyBlocked(cd, cy, cm) || hasArrivalOnDay(cd, cy, cm)) {
          blockedSelectionMessageRef.current = getDaySelectionConflictMessage(formatDate(cy, cm, cd)) || 'Ce logement est déjà réservé pour ces dates.';
          cursor.setDate(cursor.getDate() + 1);
          clamped = formatDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
          break;
        }
        cursor.setDate(cursor.getDate() - 1);
      }
    }
    setDragEndDate(clamped);
  };

  // The link back to this page from a fiche: same logement, same month.
  const backUrl = () => {
    const month = visibleMonthRef.current || { year: new Date().getFullYear(), month: new Date().getMonth() };
    const fromParams = new URLSearchParams();
    if (selectedProp) fromParams.set('propertyId', String(selectedProp));
    fromParams.set('year', String(month.year));
    fromParams.set('month', String(month.month));
    return `/calendar?${fromParams.toString()}`;
  };

  const openNewReservation = async (startDate, endDate) => {
    const conflictMessage = getRangeSelectionConflictMessage(startDate, endDate);
    if (conflictMessage) {
      await alert({ title: 'Conflit de réservation', message: conflictMessage });
      return;
    }
    navigate(withFrom(`/reservations/new?propertyId=${selectedProp}&startDate=${startDate}&endDate=${endDate}`, backUrl()));
  };

  const handleMouseUp = async () => {
    if (!isDragging || !dragStartDate || !dragEndDate) return;
    setIsDragging(false);
    const minDate = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const maxDate = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    const endDate = minDate === maxDate ? shiftDate(maxDate, 1) : maxDate;
    if (blockedSelectionMessageRef.current) {
      const message = blockedSelectionMessageRef.current;
      blockedSelectionMessageRef.current = '';
      await alert({ title: 'Conflit de réservation', message });
      return;
    }
    await openNewReservation(minDate, endDate);
  };

  const handleReservationClick = (rawResId) => {
    if (isDragging) return;
    navigate(withFrom(`/reservations/${rawResId}`, backUrl()));
  };

  // ---------- CALENDAR NOTES ----------
  const handleOpenNoteDialog = (dateStr) => {
    setNoteDialogDate(dateStr);
    setNoteDialogText(calendarNotes[dateStr] || '');
    setNoteDialogOpen(true);
  };

  const handleSaveNote = async () => {
    if (!selectedProp || !noteDialogDate) return;
    try {
      await api.upsertCalendarNote(selectedProp, noteDialogDate, noteDialogText);
      setNoteEdits((prev) => ({ ...prev, [noteDialogDate]: noteDialogText.trim() }));
      setNoteDialogOpen(false);
      showSuccess('Note enregistrée.');
    } catch (e) {
      showError(e.message || "Impossible d'enregistrer la note.");
    }
  };

  const handleDeleteNote = async () => {
    try {
      await api.deleteCalendarNote(selectedProp, noteDialogDate);
      setNoteEdits((prev) => ({ ...prev, [noteDialogDate]: '' }));
      setNoteDialogOpen(false);
      showSuccess('Note supprimée.');
    } catch (e) {
      showError(e.message || 'Impossible de supprimer la note.');
    }
  };

  // ---------- RENDER ----------
  const goToDevis = (devisId) => navigate(`/reservations/new?mode=devis&devisId=${devisId}`);

  const renderCell = (d, y, m, outside) => (
    <CalendarDayCell
      key={formatDate(y, m, d)}
      day={d} y={y} m={m} outside={outside}
      reservations={reservations}
      devisList={devisList}
      closures={closures}
      selectedProp={selectedProp}
      calendarNotes={calendarNotes}
      publicHolidays={publicHolidays}
      markersFor={markersFor}
      today={today}
      cleaningHours={cleaningHours}
      inDrag={isInDragRange(d, y, m)}
      isDragging={isDragging}
      onReservationClick={handleReservationClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onOpenNote={handleOpenNoteDialog}
      onOpenNewReservation={openNewReservation}
      onDevisClick={goToDevis}
    />
  );

  const renderPropertyMonth = ({ year, month, data }) => (isMobile ? (
    <CalendarDayAgenda
      year={year}
      month={month}
      today={today}
      stays={data ? data.stays : []}
      closures={data ? data.closures : []}
      devisList={data ? data.devis : []}
      selectedProp={selectedProp}
      calendarNotes={calendarNotes}
      publicHolidays={publicHolidays}
      markersFor={markersFor}
      onReservationClick={handleReservationClick}
      onDevisClick={goToDevis}
      onOpenNewReservation={openNewReservation}
      onOpenNote={handleOpenNoteDialog}
    />
  ) : (
    <CalendarMonthGrid
      year={year}
      month={month}
      stays={data ? data.stays : []}
      renderCell={renderCell}
      onReservationClick={handleReservationClick}
    />
  ));

  // Property filter — bar `center` on sm+, a full-width strip under the bar on xs (specs/ds-sweep-planning.md
  // rule 3). « Tous » is the all-logements calendar; with three logements or fewer it is a segmented
  // control, past that a select (specs/ui-review-2026-10-19-operations.md rule 16).
  const renderPropertyPicker = () => (
    <SegmentedSelect
      label="Logement"
      value={properties.length && selectedProp ? selectedProp : ALL}
      options={[{ value: ALL, label: 'Tous' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
      maxSegments={4}
      onChange={(next) => (next === ALL ? setSelectedProp('') : handleSelectProperty(next))}
    />
  );

  return (
    <Box>
      <PageActionBar
        title="Calendrier"
        center={renderPropertyPicker()}
      />
      {/* xs fallback for the bar's hidden `center` — the same filter, full width. */}
      <Box sx={{ display: { xs: 'block', sm: 'none' }, px: 1.5, mb: 2 }}>
        {renderPropertyPicker()}
      </Box>

      {loadError && (
        <ErrorAlert
          message="La liste des logements n'a pas pu être chargée."
          onRetry={loadProperties}
          sx={{ mb: 2 }}
        />
      )}

      {/* Colour legend (cleaning + the plugins' day dots) — informational, stays next to the grid. */}
      {selectedProp && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          {!isMobile && <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'common.white' }} />}
          {markerLegend.map(({ key, color, label }) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {selectedProp ? (
        <Box
          onMouseUp={handleMouseUp}
          onMouseLeave={() => isDragging && setIsDragging(false)}
        >
          <InfiniteMonthScroller
            key={scrollerKey}
            cache={cache}
            initialMonth={openingMonth}
            onVisibleMonthChange={(month) => { visibleMonthRef.current = month; }}
            todaySelector="[data-today='true']"
            minWidth={{ xs: 'auto', sm: CALENDAR_MIN_WIDTH }}
            renderMonth={renderPropertyMonth}
          />
        </Box>
      ) : (
        <CumulativeMonthCalendar
          key={scrollerKey}
          initialMonth={openingMonth}
          onVisibleMonthChange={(month) => { visibleMonthRef.current = month; }}
          onReservationClick={handleReservationClick}
          onCreateReservation={(startDate) => {
            navigate(withFrom(`/reservations/new?startDate=${startDate}`, '/calendar'));
          }}
        />
      )}

      <CalendarNoteDialog
        open={noteDialogOpen}
        date={noteDialogDate}
        text={noteDialogText}
        maxLength={NOTE_MAX_LENGTH}
        hasNote={!!calendarNotes[noteDialogDate]}
        onChangeText={setNoteDialogText}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        onClose={() => setNoteDialogOpen(false)}
      />
    </Box>
  );
}
