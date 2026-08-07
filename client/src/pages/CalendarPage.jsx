import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  Box, Typography, Chip, Button, FormControl, InputLabel, Select, MenuItem,
  useMediaQuery, useTheme,
} from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import TodayIcon from '@mui/icons-material/Today';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import CumulativeMonthCalendar from '../components/CumulativeMonthCalendar';
import CalendarMonthGrid from '../components/CalendarMonthGrid';
import CalendarWeekView from '../components/CalendarWeekView';
import CalendarDayCell from '../components/CalendarDayCell';
import CalendarNoteDialog from '../components/CalendarNoteDialog';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import api from '../api';
import { getDayOccupancyConflictMessage, getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import { formatDate, shiftDate, getDaysInMonth, CLEANING_COLOR, ZONE_COLORS } from '../utils/calendarVisuals';
import useInfiniteMonthScroll from '../hooks/useInfiniteMonthScroll';

const NOTE_MAX_LENGTH = 50;

export default function CalendarPage() {
  const { alert } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loadError, setLoadError] = useState(false);
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [devisList, setDevisList] = useState([]);
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [publicHolidays, setPublicHolidays] = useState(() => new Set());
  const [calendarNotes, setCalendarNotes] = useState({});
  const [occupiedDates, setOccupiedDates] = useState([]);
  const [closures, setClosures] = useState([]);

  const [dragStartDate, setDragStartDate] = useState(null);
  const [dragEndDate, setDragEndDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState('');
  const [noteDialogText, setNoteDialogText] = useState('');

  const lastLoadedRange = useRef({ from: '', to: '' });
  const blockedSelectionMessageRef = useRef('');

  const { months, scrollRef, handleScroll, prependMonth, appendMonth, focusOnMonth, recenterToday } =
    useInfiniteMonthScroll(selectedProp);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Mobile week view: extend the loaded month range so the swiped-to week always has data.
  const ensureWeekLoaded = useCallback((weekStartStr) => {
    if (!months.length) return;
    const wkEnd = shiftDate(weekStartStr, 6);
    const first = months[0];
    const last = months[months.length - 1];
    const firstStart = formatDate(first.year, first.month, 1);
    const lastEnd = formatDate(last.year, last.month, getDaysInMonth(last.year, last.month));
    if (weekStartStr < firstStart) prependMonth();
    if (wkEnd > lastEnd) appendMonth();
  }, [months, prependMonth, appendMonth]);

  // ---------- DATA LOADING ----------
  const loadProperties = async () => {
    try {
      setProperties(await api.getProperties());
    } catch {
      setLoadError(true);
    }
  };
  // School holidays are a cosmetic overlay (zone dots) — their absence degrades silently.
  const loadSchoolHolidays = async () => {
    try {
      setSchoolHolidays((await api.getSchoolHolidays()).periods || []);
    } catch {
      setSchoolHolidays([]);
    }
  };

  const loadCalendarData = useCallback(async () => {
    if (!selectedProp || months.length === 0) return;
    const first = months[0];
    const last = months[months.length - 1];
    const from = formatDate(first.year, first.month, 1);
    const to = formatDate(last.year, last.month, getDaysInMonth(last.year, last.month));
    if (from === lastLoadedRange.current.from && to === lastLoadedRange.current.to) return;
    lastLoadedRange.current = { from, to };
    try {
      const prop = await api.getProperty(selectedProp);
      setSelectedProperty(prop);
      const [data, notes, devisData] = await Promise.all([
        api.getReservations({ propertyId: selectedProp, from, to }),
        api.getCalendarNotes(selectedProp, from, to),
        // Devis overlay is cosmetic (dashed ghost bars) — silent-degrading enrichment.
        api.getDevis({ propertyId: selectedProp, from, to }).catch(() => []),
      ]);
      setReservations(data);
      setDevisList((devisData || []).filter((d) => d.status !== 'converted'));
      const notesMap = {};
      notes.forEach((n) => { notesMap[n.date] = n.note; });
      setCalendarNotes(notesMap);
      // Occupied dates + closures are ANTI-OVERBOOKING inputs (drag-select guards) — a failure
      // must surface, not silently allow selecting an actually-blocked range
      // (specs/ds-sweep-planning.md rule 9; original phase-1 audit finding CalendarPage.js:93).
      const [occupied, cls] = await Promise.all([
        api.getOccupiedDates(selectedProp, from, to),
        api.getEstablishmentClosures({ propertyId: selectedProp, from, to }),
      ]);
      setOccupiedDates(occupied || []);
      setClosures(cls || []);
      setLoadError(false);
    } catch (err) {
      setOccupiedDates([]);
      setClosures([]);
      setLoadError(true);
    }
  }, [selectedProp, months]);

  const retryLoads = () => {
    setLoadError(false);
    lastLoadedRange.current = { from: '', to: '' };
    loadProperties();
    loadCalendarData();
  };

  // Public holidays are now server-computed; fetch them for the visible years (deduped by year set).
  const visibleYearsKey = useMemo(
    () => [...new Set(months.map((mm) => mm.year))].sort().join(','),
    [months],
  );
  useEffect(() => {
    let cancelled = false;
    const years = visibleYearsKey.split(',').filter(Boolean).map(Number);
    if (years.length === 0) return undefined;
    api.getPublicHolidays(years)
      .then((list) => { if (!cancelled) setPublicHolidays(new Set((list || []).map((h) => h.date))); })
      .catch(() => { if (!cancelled) setPublicHolidays(new Set()); });
    return () => { cancelled = true; };
  }, [visibleYearsKey]);

  // ---------- PROPERTY SELECTION / NAVIGATION ----------
  const handleSelectProperty = (propertyId) => {
    const now = new Date();
    setSelectedProp(propertyId);
    lastLoadedRange.current = { from: '', to: '' };
    focusOnMonth(now.getFullYear(), now.getMonth(), { resetNavLocks: true });
  };

  useEffect(() => { loadProperties(); loadSchoolHolidays(); }, []);
  useEffect(() => { loadCalendarData(); }, [loadCalendarData]);

  // Read URL params for navigation from dashboard
  useEffect(() => {
    const propId = searchParams.get('propertyId');
    const y = searchParams.get('year');
    const m = searchParams.get('month');
    const resId = searchParams.get('reservationId');
    const focusStartDate = searchParams.get('focusStartDate');
    const focusEndDate = searchParams.get('focusEndDate');

    if (propId) {
      handleSelectProperty(Number(propId));
    } else {
      setSelectedProp('');
      setSelectedProperty(null);
    }

    let targetYear = null;
    let targetMonth = null;

    if (focusStartDate) {
      const start = new Date(`${focusStartDate}T00:00:00`);
      const end = focusEndDate ? new Date(`${focusEndDate}T00:00:00`) : null;
      if (!Number.isNaN(start.getTime())) {
        let focus = start;
        if (end && !Number.isNaN(end.getTime()) && end > start) {
          const mid = new Date(start);
          const halfDays = Math.floor((end.getTime() - start.getTime()) / (2 * 86400000));
          mid.setDate(mid.getDate() + halfDays);
          focus = mid;
        }
        targetYear = focus.getFullYear();
        targetMonth = focus.getMonth();
      }
    } else if (y && m !== null) {
      targetYear = Number(y);
      targetMonth = Number(m);
    }

    if (targetYear !== null && targetMonth !== null) {
      lastLoadedRange.current = { from: '', to: '' };
      focusOnMonth(targetYear, targetMonth);
    }
    // If reservationId param is present, open the edit dialog after property is loaded
    if (resId) {
      window.pendingReservationId = resId;
    }
  }, [searchParams]);

  // Handle opening reservation edit when coming from dashboard
  useEffect(() => {
    if (!selectedProp || !window.pendingReservationId) return;
    const resId = window.pendingReservationId;
    delete window.pendingReservationId;
    handleReservationClick(resId);
  }, [selectedProp]);

  const scrollToToday = () => {
    lastLoadedRange.current = { from: '', to: '' };
    recenterToday();
  };

  // ---------- DERIVED RENDER INPUTS ----------
  const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const cleaningHours = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;

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

  const openNewReservation = async (startDate, endDate) => {
    const conflictMessage = getRangeSelectionConflictMessage(startDate, endDate);
    if (conflictMessage) {
      await alert({ title: 'Conflit de réservation', message: conflictMessage });
      return;
    }
    const centerMonth = months[Math.floor(months.length / 2)] || { year: new Date().getFullYear(), month: new Date().getMonth() };
    const fromParams = new URLSearchParams();
    if (selectedProp) fromParams.set('propertyId', String(selectedProp));
    fromParams.set('year', String(centerMonth.year));
    fromParams.set('month', String(centerMonth.month));
    const fromUrl = `/calendar?${fromParams.toString()}`;

    navigate(withFrom(`/reservations/new?propertyId=${selectedProp}&startDate=${startDate}&endDate=${endDate}`, fromUrl));
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
    const centerMonth = months[Math.floor(months.length / 2)] || { year: new Date().getFullYear(), month: new Date().getMonth() };
    const fromParams = new URLSearchParams();
    if (selectedProp) fromParams.set('propertyId', String(selectedProp));
    fromParams.set('year', String(centerMonth.year));
    fromParams.set('month', String(centerMonth.month));
    const fromUrl = `/calendar?${fromParams.toString()}`;

    navigate(withFrom(`/reservations/${rawResId}`, fromUrl));
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
      setCalendarNotes((prev) => {
        const next = { ...prev };
        if (noteDialogText.trim()) next[noteDialogDate] = noteDialogText.trim();
        else delete next[noteDialogDate];
        return next;
      });
      setNoteDialogOpen(false);
      showSuccess('Note enregistrée.');
    } catch (e) {
      showError(e.message || "Impossible d'enregistrer la note.");
    }
  };

  const handleDeleteNote = async () => {
    try {
      await api.deleteCalendarNote(selectedProp, noteDialogDate);
      setCalendarNotes((prev) => { const next = { ...prev }; delete next[noteDialogDate]; return next; });
      setNoteDialogOpen(false);
      showSuccess('Note supprimée.');
    } catch (e) {
      showError(e.message || 'Impossible de supprimer la note.');
    }
  };

  // ---------- RENDER ----------
  const renderCell = (d, y, m, dim) => (
    <CalendarDayCell
      key={formatDate(y, m, d)}
      day={d} y={y} m={m} dim={dim}
      reservations={reservations}
      devisList={devisList}
      closures={closures}
      selectedProp={selectedProp}
      calendarNotes={calendarNotes}
      publicHolidays={publicHolidays}
      schoolHolidays={schoolHolidays}
      today={today}
      cleaningHours={cleaningHours}
      inDrag={isInDragRange(d, y, m)}
      isDragging={isDragging}
      onReservationClick={handleReservationClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onOpenNote={handleOpenNoteDialog}
      onOpenNewReservation={openNewReservation}
      onDevisClick={(devisId) => navigate(`/reservations/new?mode=devis&devisId=${devisId}`)}
    />
  );

  // Property picker cluster — bar `center` on sm+, compact strip under the bar on xs
  // (specs/ds-sweep-planning.md rule 3; absorbs the former CalendarToolbar).
  const renderPropertyPicker = () => (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Logement</InputLabel>
        {/* Until the property list lands, a URL-driven selectedProp has no matching option —
            render '' meanwhile to avoid MUI's transient out-of-range warning on deep links. */}
        <Select value={properties.length ? selectedProp : ''} label="Logement" onChange={(e) => handleSelectProperty(e.target.value)}>
          {properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </Select>
      </FormControl>
      {selectedProp && (
        <Button variant="text" size="small" onClick={() => setSelectedProp('')}>Vue logements</Button>
      )}
    </Box>
  );

  return (
    <Box>
      <PageActionBar
        title="Calendrier"
        titleOnXs
        center={renderPropertyPicker()}
        actionsBefore={[
          ...(selectedProp ? [
            { icon: <NavigateBeforeIcon />, tooltip: 'Mois précédent', onClick: prependMonth },
            { icon: <NavigateNextIcon />, tooltip: 'Mois suivant', onClick: appendMonth },
          ] : []),
          { icon: <TodayIcon />, tooltip: "Aujourd'hui", onClick: scrollToToday, color: 'primary' },
        ]}
      />
      {/* xs fallback for the bar's hidden `center` — same picker, compact strip. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {renderPropertyPicker()}
      </Box>

      {loadError && (
        <ErrorAlert
          message="Certaines données du calendrier n'ont pas pu être chargées (disponibilités / fermetures incluses)."
          onRetry={retryLoads}
          sx={{ mb: 2 }}
        />
      )}

      {/* Colour legend (cleaning + school-holiday zones) — informational, stays next to the grid. */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'common.white' }} />
        {[['A', ZONE_COLORS.A], ['B', ZONE_COLORS.B], ['C', ZONE_COLORS.C]].map(([zone, color]) => (
          <Box key={zone} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
            <Typography variant="caption" color="text.secondary">Zone {zone}</Typography>
          </Box>
        ))}
      </Box>

      {selectedProp ? (
        isMobile ? (
          <CalendarWeekView
            today={today}
            reservations={reservations}
            devisList={devisList}
            closures={closures}
            selectedProp={selectedProp}
            calendarNotes={calendarNotes}
            publicHolidays={publicHolidays}
            schoolHolidays={schoolHolidays}
            onReservationClick={handleReservationClick}
            onDevisClick={(devisId) => navigate(`/reservations/new?mode=devis&devisId=${devisId}`)}
            onOpenNewReservation={openNewReservation}
            onOpenNote={handleOpenNoteDialog}
            onWeekChange={ensureWeekLoaded}
          />
        ) : (
          <CalendarMonthGrid
            months={months}
            scrollRef={scrollRef}
            onScroll={handleScroll}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => isDragging && setIsDragging(false)}
            renderCell={renderCell}
          />
        )
      ) : (
        <CumulativeMonthCalendar
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
