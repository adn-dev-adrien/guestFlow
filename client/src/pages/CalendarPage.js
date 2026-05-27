import React, { useEffect, useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select,
  MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Chip, Tooltip
} from '@mui/material';
import PageHeader from '../components/PageHeader';
import SyncedPropertyMiniCalendars from '../components/SyncedPropertyMiniCalendars';
import { PLATFORMS, getPlatformColor, PLATFORM_COLORS } from '../constants/platforms';
import { TIME_OPTIONS } from '../constants/timeOptions';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { getFrenchPublicHolidays, getSchoolHolidayInfo } from '../frenchHolidays';
import { getBlockedNightConflictInfo, getDayOccupancyConflictMessage, getRangeOccupancyConflictInfo } from '../utils/reservationConflicts';
import { withFrom } from '../utils/navigation';
import { getClosureForDate } from '../utils/closureCalendar';

const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par jour',
  per_person_per_night: 'par pers./jour',
  per_hour: 'par heure',
  free: 'gratuit',
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getBlockedNightInfo(dateStr, reservations) {
  const blockedNightInfo = getBlockedNightConflictInfo(dateStr, reservations);
  if (!blockedNightInfo) return null;

  if (blockedNightInfo.type === 'early-arrival') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(17),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-evening') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(timeToHour(blockedNightInfo.reservation?.checkOutTime || '10:00')),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-morning') {
    return {
      ...blockedNightInfo,
      startPct: 0,
      endPct: hourToPercent(10),
      client: blockedNightInfo.reservation,
    };
  }

  return null;
}

function shiftDate(dateStr, daysDelta) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + daysDelta);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

// Time window for proportional fill: 8h to 21h (13h range)
const DAY_START = 8;
const DAY_END = 21;
const DAY_RANGE = DAY_END - DAY_START;

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

function getReservationColor(platform) {
  return getPlatformColor(platform);
}

const CLEANING_COLOR = '#e53935';
const BLOCKED_NIGHT_COLOR = '#ff9800'; // Orange pour les nuits bloquées

const ZONE_COLORS = { A: '#1976d2', B: '#388e3c', C: '#f57c00' };


export default function CalendarPage() {
  const { confirm, alert } = useAppDialogs();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [selectedProp, setSelectedProp] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [overviewReservations, setOverviewReservations] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [devisList, setDevisList] = useState([]);

  const getMonthsRange = (centerY, centerM, range = 3) => {
    const result = [];
    for (let i = -range; i <= range; i++) {
      const d = new Date(centerY, centerM + i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return result;
  };
  const getInitialMonths = () => {
    const now = new Date();
    return getMonthsRange(now.getFullYear(), now.getMonth(), 1);
  };
  const [months, setMonths] = useState(getInitialMonths);
  const [dragStartDate, setDragStartDate] = useState(null);
  const [dragEndDate, setDragEndDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef(null);
  const lastLoadedRange = useRef({ from: '', to: '' });
  const prevScrollHeight = useRef(0);
  const shouldAdjustScroll = useRef(false);
  const focusMonthKeyRef = useRef('');
  const pendingFocusScrollRef = useRef(false);
  const initialScrollDone = useRef(false);
  const prependMonthLock = useRef(false);
  const appendMonthLock = useRef(false);
  const autoPreloadAttemptsRef = useRef(0);
  const blockedSelectionMessageRef = useRef('');
  const [schoolHolidays, setSchoolHolidays] = useState([]);
  const [calendarNotes, setCalendarNotes] = useState({});
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState('');
  const [noteDialogText, setNoteDialogText] = useState('');
    const [occupiedDates, setOccupiedDates] = useState([]);
    const [closures, setClosures] = useState([]);

  const loadProperties = async () => setProperties(await api.getProperties());

  const loadOverviewReservations = useCallback(async () => {
    const from = new Date().toISOString().split('T')[0];
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 30);
    const to = toDate.toISOString().split('T')[0];
    setOverviewReservations(await api.getReservations({ from, to }));
  }, []);

  const handleSelectProperty = (propertyId) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    setSelectedProp(propertyId);
    setMonths(getMonthsRange(currentYear, currentMonth, 1));
    focusMonthKeyRef.current = `${currentYear}-${currentMonth}`;
    pendingFocusScrollRef.current = true;
    initialScrollDone.current = false;
    lastLoadedRange.current = { from: '', to: '' };
    prependMonthLock.current = false;
    appendMonthLock.current = false;
    autoPreloadAttemptsRef.current = 0;
  };

  const loadSchoolHolidays = async () => setSchoolHolidays((await api.getSchoolHolidays()).periods || []);

  const loadCalendarData = useCallback(async () => {
    if (!selectedProp || months.length === 0) return;
    const first = months[0];
    const last = months[months.length - 1];
    const from = formatDate(first.year, first.month, 1);
    const to = formatDate(last.year, last.month, getDaysInMonth(last.year, last.month));
    if (from === lastLoadedRange.current.from && to === lastLoadedRange.current.to) return;
    lastLoadedRange.current = { from, to };
    const prop = await api.getProperty(selectedProp);
    setSelectedProperty(prop);
    const [data, notes, devisData] = await Promise.all([
      api.getReservations({ propertyId: selectedProp, from, to }),
      api.getCalendarNotes(selectedProp, from, to),
      api.getDevis({ propertyId: selectedProp, from, to }).catch(() => []),
    ]);
    setReservations(data);
    setDevisList((devisData || []).filter((d) => d.status !== 'converted'));
    const notesMap = {};
    notes.forEach(n => { notesMap[n.date] = n.note; });
    setCalendarNotes(notesMap);
      // Load occupied dates from backend API
      try {
        const occupied = await api.getOccupiedDates(selectedProp, from, to);
        setOccupiedDates(occupied || []);
      } catch (err) {
        console.error('Failed to load occupied dates:', err);
        setOccupiedDates([]);
      }
      // Load establishment closures (global + per-property) overlapping the visible range.
      try {
        const cls = await api.getEstablishmentClosures({ propertyId: selectedProp, from, to });
        setClosures(cls || []);
      } catch (err) {
        console.error('Failed to load closures:', err);
        setClosures([]);
      }
  }, [selectedProp, months]);

  useEffect(() => { loadProperties(); loadSchoolHolidays(); loadOverviewReservations(); }, [loadOverviewReservations]);
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
      // Use a tighter range on deep-link navigation so the focused month is visible immediately.
      setMonths(getMonthsRange(targetYear, targetMonth, 1));
      focusMonthKeyRef.current = `${targetYear}-${targetMonth}`;
      pendingFocusScrollRef.current = true;
      initialScrollDone.current = false;
      lastLoadedRange.current = { from: '', to: '' };
      autoPreloadAttemptsRef.current = 0;
    }
    // If reservationId param is present, open the edit dialog after property is loaded
    if (resId) {
      window.pendingReservationId = resId;
    }
  }, [searchParams]);

  // Handle opening reservation edit dialog when coming from dashboard
  useEffect(() => {
    if (!selectedProp || !window.pendingReservationId) return;
    const resId = window.pendingReservationId;
    delete window.pendingReservationId;
    handleReservationClick(resId);
  }, [selectedProp]);

  // Maintain scroll position when prepending months
  useLayoutEffect(() => {
    if (shouldAdjustScroll.current && scrollRef.current) {
      const diff = scrollRef.current.scrollHeight - prevScrollHeight.current;
      scrollRef.current.scrollTop += diff;
      shouldAdjustScroll.current = false;
    }
  }, [months]);

  useLayoutEffect(() => {
    if (!pendingFocusScrollRef.current || !selectedProp || !scrollRef.current) return;

    const container = scrollRef.current;
    const key = focusMonthKeyRef.current;
    if (!key) {
      pendingFocusScrollRef.current = false;
      return;
    }

    const anchor = container.querySelector(`[data-month-anchor="${key}"]`);
    if (!anchor) return;

    const anchorTop = anchor.offsetTop;
    const topPadding = 12;
    container.scrollTop = Math.max(0, anchorTop - topPadding);
    pendingFocusScrollRef.current = false;
  }, [months, selectedProp]);

  // Auto-scroll to one week before current date on initial load
  useEffect(() => {
    if (initialScrollDone.current || !selectedProp) return;
    
    // Just mark as done - calendar loads month + 2 following months already
    initialScrollDone.current = true;
  }, [selectedProp, months]);

  useLayoutEffect(() => {
    if (!selectedProp || !initialScrollDone.current || !scrollRef.current) return;
    const el = scrollRef.current;
    const isScrollable = el.scrollHeight > el.clientHeight + 1;
    if (isScrollable) return;
    if (autoPreloadAttemptsRef.current >= 3) return;

    autoPreloadAttemptsRef.current += 1;
    setMonths((prev) => {
      if (!prev.length) return prev;
      const first = prev[0];
      const last = prev[prev.length - 1];
      const prevDate = new Date(first.year, first.month - 1, 1);
      const nextDate = new Date(last.year, last.month + 1, 1);
      const previousMonth = { year: prevDate.getFullYear(), month: prevDate.getMonth() };
      const nextMonth = { year: nextDate.getFullYear(), month: nextDate.getMonth() };

      const alreadyHasPrevious = prev[0]?.year === previousMonth.year && prev[0]?.month === previousMonth.month;
      const alreadyHasNext = prev[prev.length - 1]?.year === nextMonth.year && prev[prev.length - 1]?.month === nextMonth.month;

      if (alreadyHasPrevious && alreadyHasNext) return prev;
      return [
        ...(alreadyHasPrevious ? [] : [previousMonth]),
        ...prev,
        ...(alreadyHasNext ? [] : [nextMonth]),
      ];
    });
  }, [selectedProp, months]);

  const prependMonth = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      prevScrollHeight.current = el.scrollHeight;
      shouldAdjustScroll.current = true;
    }
    setMonths((prev) => {
      const first = prev[0];
      if (!first) return prev;
      const d = new Date(first.year, first.month - 1, 1);
      const nextMonth = { year: d.getFullYear(), month: d.getMonth() };
      if (prev[0]?.year === nextMonth.year && prev[0]?.month === nextMonth.month) {
        return prev;
      }
      return [nextMonth, ...prev];
    });
  }, []);

  const appendMonth = useCallback(() => {
    setMonths((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const d = new Date(last.year, last.month + 1, 1);
      const nextMonth = { year: d.getFullYear(), month: d.getMonth() };
      if (prev[prev.length - 1]?.year === nextMonth.year && prev[prev.length - 1]?.month === nextMonth.month) {
        return prev;
      }
      return [...prev, nextMonth];
    });
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !initialScrollDone.current) return;

    const topThreshold = 200;
    const bottomThreshold = 200;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    if (el.scrollTop >= topThreshold) {
      prependMonthLock.current = false;
    }

    if (distanceFromBottom >= bottomThreshold) {
      appendMonthLock.current = false;
    }

    if (el.scrollTop < topThreshold && !prependMonthLock.current) {
      prependMonthLock.current = true;
      prependMonth();
    }

    if (distanceFromBottom < bottomThreshold && !appendMonthLock.current) {
      appendMonthLock.current = true;
      appendMonth();
    }
  };


  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const cleaningHours = selectedProperty ? (selectedProperty.cleaningHours ?? 3) : 3;

  const getDaySelectionConflictMessage = (dateStr) => {
    return getDayOccupancyConflictMessage({
      dateStr,
      today,
      occupiedDates,
      reservations,
    });
  };

  const getRangeSelectionConflictMessage = (startDate, endDate) => {
    return getRangeOccupancyConflictInfo({
      startDate,
      endDate,
      occupiedDates,
      reservations,
    })?.message || '';
  };

  // Check if a day is fully blocked (mid-stay or past)
  const isDayFullyBlocked = (day, y, m) => {
    const dateStr = formatDate(y, m, day);
    return occupiedDates.includes(dateStr);
  };

  // Check if a day has an existing arrival
  const hasArrivalOnDay = (day, y, m) => {
    const dateStr = formatDate(y, m, day);
    return reservations.some(r => r.startDate === dateStr);
  };

  const isInDragRange = (day, y, m) => {
    if (!dragStartDate || !dragEndDate) return false;
    const dateStr = formatDate(y, m, day);
    const min = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const max = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
    return dateStr >= min && dateStr <= max;
  };

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


  const scrollToToday = () => {
    const now = new Date();
    setMonths(getMonthsRange(now.getFullYear(), now.getMonth(), 1));
    initialScrollDone.current = false;
    prependMonthLock.current = false;
    appendMonthLock.current = false;
    autoPreloadAttemptsRef.current = 0;
    lastLoadedRange.current = { from: '', to: '' };
  };


  // Check if a reservation has visible mid-stay days in the current month
  const resHasMidDays = (res, y, m, dim) => {
    const monthStartStr = formatDate(y, m, 1);
    const monthEndStr = formatDate(y, m, dim);
    const s = new Date(res.startDate); s.setDate(s.getDate() + 1);
    const firstMid = formatDate(s.getFullYear(), s.getMonth(), s.getDate());
    const e = new Date(res.endDate); e.setDate(e.getDate() - 1);
    const lastMid = formatDate(e.getFullYear(), e.getMonth(), e.getDate());
    if (firstMid > lastMid) return false;
    return firstMid <= monthEndStr && lastMid >= monthStartStr;
  };

  const compactName = (firstName, lastName) => {
    const f = (firstName || '').charAt(0);
    const l = lastName || '';
    const full = f ? `${f}. ${l}` : l;
    return full.length > 8 ? full.slice(0, 7) + '…' : full;
  };

  // ---------- CALENDAR NOTES ----------
  const NOTE_MAX_LENGTH = 50;

  const handleOpenNoteDialog = (dateStr) => {
    setNoteDialogDate(dateStr);
    setNoteDialogText(calendarNotes[dateStr] || '');
    setNoteDialogOpen(true);
  };

  const handleSaveNote = async () => {
    if (!selectedProp || !noteDialogDate) return;
    await api.upsertCalendarNote(selectedProp, noteDialogDate, noteDialogText);
    setCalendarNotes(prev => {
      const next = { ...prev };
      if (noteDialogText.trim()) next[noteDialogDate] = noteDialogText.trim();
      else delete next[noteDialogDate];
      return next;
    });
    setNoteDialogOpen(false);
  };

  const renderNoteLabel = (dateStr, hasReservation) => {
    const note = calendarNotes[dateStr];
    if (!note) return null;
    const fontSize = hasReservation ? 8 : 10;
    return (
      <Typography title={note} sx={{
        position: 'absolute', bottom: hasReservation ? 14 : 16, left: '50%', transform: 'translateX(-50%)',
        fontSize, lineHeight: 1.1, color: hasReservation ? 'rgba(255,255,255,0.9)' : '#1a1a1a',
        zIndex: 2, pointerEvents: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '90%', fontStyle: 'italic', fontWeight: 600,
        textShadow: hasReservation ? '0 0 2px rgba(0,0,0,0.5)' : 'none',
      }}>
        {note}
      </Typography>
    );
  };

  // ---------- RENDER A CALENDAR CELL ----------
  const visibleYears = [...new Set(months.map(m => m.year))];
  const allPublicHolidays = new Set();
  visibleYears.forEach(y => getFrenchPublicHolidays(y).forEach(d => allPublicHolidays.add(d)));

  const renderHolidayIndicators = (dateStr) => {
    const isPublicHoliday = allPublicHolidays.has(dateStr);
    const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
    return (
      <>
        {isPublicHoliday && (
          <Typography sx={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', fontSize: 14, color: '#d32f2f', zIndex: 3, pointerEvents: 'none', lineHeight: 1, opacity: 0.7, whiteSpace: 'nowrap' }}>férié</Typography>
        )}
        {schoolInfo && (
          <Box sx={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '3px', zIndex: 3, pointerEvents: 'none' }}>
            {schoolInfo.zones.map(z => (
              <Box key={z} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS[z] }} />
            ))}
          </Box>
        )}
      </>
    );
  };

  const renderDayCell = (day, y, m, dim) => {
    const dateStr = formatDate(y, m, day);
    const isPast = dateStr < today;
    const inDrag = isInDragRange(day, y, m);

    // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
    const departureRes = reservations.find(r => r.endDate === dateStr);
    const arrivalRes = reservations.find(r => r.startDate === dateStr);
    const midRes = reservations.find(r => dateStr > r.startDate && dateStr < r.endDate);
    const blockedNightInfo = getBlockedNightInfo(dateStr, reservations);

    // Devis (quotes) — shown as faded overlay when no reservation is present
    const midDevis = !midRes && !departureRes && !arrivalRes
      ? devisList.find((d) => dateStr > d.startDate && dateStr < d.endDate)
      : null;
    const arrivalDevis = !arrivalRes && !midRes
      ? devisList.find((d) => d.startDate === dateStr)
      : null;
    const departureDevis = !departureRes && !midRes
      ? devisList.find((d) => d.endDate === dateStr)
      : null;

    // If mid-stay: full color fill
    if (midRes) {
      const color = getReservationColor(midRes.platform);
      const isToday = dateStr === today;
      // Show label on the true middle day of the entire reservation
      const resStart = new Date(midRes.startDate);
      const resEnd = new Date(midRes.endDate);
      const totalDays = Math.round((resEnd - resStart) / 86400000);
      const midDate = new Date(resStart);
      midDate.setDate(midDate.getDate() + Math.round(totalDays / 2));
      const midDateStr = formatDate(midDate.getFullYear(), midDate.getMonth(), midDate.getDate());
      const isLabelDay = dateStr === midDateStr;
      return (
        <Box key={dateStr} data-date={dateStr} onClick={() => handleReservationClick(midRes.id)} onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }} sx={{
          textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', cursor: 'pointer',
          bgcolor: color, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64, height: 64, boxSizing: 'border-box',
          opacity: isPast ? 0.5 : 1,
          border: isToday ? '3px solid #1976d2' : 'none',
          transition: 'border 0.2s',
        }}>
          {renderHolidayIndicators(dateStr)}
          {renderNoteLabel(dateStr, true)}
          {isLabelDay ? (
            <>
              <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
                {midRes.firstName} {midRes.lastName}
              </Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                {midRes.platform}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
          )}
        </Box>
      );
    }

    // Compute departure and arrival percentages + cleaning
    const checkOutHour = departureRes ? timeToHour(departureRes.checkOutTime || '10:00') : null;
    const checkInHour = arrivalRes ? timeToHour(arrivalRes.checkInTime || '15:00') : null;

    const departPct = checkOutHour !== null ? hourToPercent(checkOutHour) : null;
    const cleanEndHour = checkOutHour !== null ? checkOutHour + cleaningHours : null;
    const cleanEndPct = cleanEndHour !== null ? hourToPercent(cleanEndHour) : null;
    const arrivePct = checkInHour !== null ? hourToPercent(checkInHour) : null;
    const isLateDepartureEvening = blockedNightInfo?.type === 'late-departure-evening' && blockedNightInfo.client?.id === departureRes?.id;
    const hasEarlyBlockedNight = blockedNightInfo?.type === 'early-arrival';
    const isEarlyArrivalDay = Boolean(arrivalRes && checkInHour !== null && checkInHour <= 10);

    const hasVisual = departPct !== null || arrivePct !== null || Boolean(blockedNightInfo);

    // Empty or drag-only day
    if (!hasVisual) {
      const isToday = dateStr === today;

      // Render devis (quote) as faded background when no reservation
      const activeDevis = midDevis || arrivalDevis || departureDevis;
      if (activeDevis && !inDrag) {
        const devisColor = '#bdbdbd';
        const isArrival = Boolean(arrivalDevis);
        const isDeparture = Boolean(departureDevis);
        const resStart = new Date(activeDevis.startDate);
        const resEnd = new Date(activeDevis.endDate);
        const totalDays = Math.max(1, Math.round((resEnd - resStart) / 86400000));
        const midDate = new Date(resStart);
        midDate.setDate(midDate.getDate() + Math.round(totalDays / 2));
        const midDateStr = formatDate(midDate.getFullYear(), midDate.getMonth(), midDate.getDate());
        const isLabelDay = dateStr === midDateStr;
        return (
          <Box
            key={dateStr}
            data-date={dateStr}
            onClick={() => navigate(`/reservations/new?mode=devis&devisId=${activeDevis.id}`)}
            sx={{
              textAlign: 'center', py: 1, borderRadius: 1, position: 'relative', cursor: 'pointer',
              bgcolor: devisColor, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64, height: 64, boxSizing: 'border-box',
              opacity: isPast ? 0.5 : 1,
              border: isToday ? '3px solid #1976d2' : 'none',
              transition: 'border 0.2s',
              background: isArrival
                ? `linear-gradient(135deg, transparent 0%, transparent 49.5%, ${devisColor} 50%, ${devisColor} 100%)`
                : isDeparture
                  ? `linear-gradient(135deg, ${devisColor} 0%, ${devisColor} 50%, transparent 50.5%, transparent 100%)`
                  : devisColor,
            }}
          >
            {renderHolidayIndicators(dateStr)}
            {renderNoteLabel(dateStr, true)}
            {isLabelDay && (
              <>
                <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                  devis
                </Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
                  {activeDevis.firstName} {activeDevis.lastName}
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                  {activeDevis.platform || '-'}
                </Typography>
              </>
            )}
            {!isLabelDay && (
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
            )}
          </Box>
        );
      }
      const closure = getClosureForDate(dateStr, closures, selectedProp);
      const cellNode = (
        <Box key={dateStr} data-date={dateStr}
          onMouseDown={() => !isPast && handleMouseDown(day, y, m)}
          onMouseEnter={() => handleMouseEnter(day, y, m)}
          onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }}
          sx={{
            textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
            height: 64, boxSizing: 'border-box',
            cursor: isPast || closure ? 'default' : 'pointer', fontSize: 14,
            bgcolor: isPast ? 'grey.300' : inDrag ? 'primary.light' : 'grey.100',
            color: isPast ? 'grey.500' : inDrag ? 'white' : 'text.primary',
            fontWeight: inDrag ? 600 : 400,
            border: isToday ? '3px solid #1976d2' : 'none',
            ...(!isPast && !closure && { '&:hover': { bgcolor: 'primary.light', color: 'white' } }),
            transition: 'background-color 0.15s, border 0.2s',
            ...(closure ? {
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 8px, rgba(0,0,0,0.14) 8px, rgba(0,0,0,0.14) 16px)',
              borderTop: '1px dashed',
              borderBottom: '1px dashed',
              borderColor: 'grey.500',
            } : {}),
          }}
        >
          {renderHolidayIndicators(dateStr)}
          {renderNoteLabel(dateStr, false)}
          {closure ? (
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
                fontStyle: 'italic', color: 'text.disabled', fontSize: 11,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                px: 0.5,
              }}
            >
              {closure.label || 'Fermé'}
            </Typography>
          ) : day}
        </Box>
      );
      return closure ? (
        <Tooltip
          key={`tip-${dateStr}`}
          title={`${closure.label || 'Fermeture'} — du ${closure.startDate} au ${closure.endDate}`}
          arrow
        >
          {cellNode}
        </Tooltip>
      ) : cellNode;
    }

    // Build gradient stops for the diagonal fill
    const departColor = departureRes ? getReservationColor(departureRes.platform) : null;
    const arriveColor = arrivalRes ? getReservationColor(arrivalRes.platform) : null;
    const stops = [];
    const gapColor = inDrag ? '#42a5f5' : 'transparent';

    if (departPct !== null) {
      stops.push(`${departColor} 0%`);
      stops.push(`${departColor} ${departPct}%`);
      const postDepartureColor = isLateDepartureEvening ? BLOCKED_NIGHT_COLOR : CLEANING_COLOR;
      if (cleanEndPct !== null && cleanEndPct > departPct && !isLateDepartureEvening) {
        stops.push(`${postDepartureColor} ${departPct}%`);
        stops.push(`${postDepartureColor} ${Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)}%`);
        const cleanStop = Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100);
        if (arrivePct !== null && arrivePct > cleanStop) {
          stops.push(`${gapColor} ${cleanStop}%`);
          stops.push(`${gapColor} ${arrivePct}%`);
        } else if (arrivePct === null) {
          if (hasEarlyBlockedNight) {
            stops.push(`${gapColor} ${cleanStop}%`);
            stops.push(`${gapColor} ${blockedNightInfo.startPct}%`);
            stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
            stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
          } else {
            stops.push(`${gapColor} ${cleanStop}%`);
            stops.push(`${gapColor} 100%`);
          }
        }
      } else {
        if (isLateDepartureEvening) {
          stops.push(`${postDepartureColor} ${departPct}%`);
          stops.push(`${postDepartureColor} 100%`);
        } else if (arrivePct !== null && arrivePct > departPct) {
          stops.push(`${gapColor} ${departPct}%`);
          stops.push(`${gapColor} ${arrivePct}%`);
        } else if (arrivePct === null) {
          if (hasEarlyBlockedNight) {
            stops.push(`${gapColor} ${departPct}%`);
            stops.push(`${gapColor} ${blockedNightInfo.startPct}%`);
            stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
            stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
          } else {
            stops.push(`${gapColor} ${departPct}%`);
            stops.push(`${gapColor} 100%`);
          }
        }
      }
    }

    if (arrivePct !== null) {
      if (departPct === null) {
        const freeColor = isEarlyArrivalDay ? BLOCKED_NIGHT_COLOR : (inDrag ? '#42a5f5' : 'transparent');
        stops.push(`${freeColor} 0%`);
        stops.push(`${freeColor} ${arrivePct}%`);
      }
      stops.push(`${arriveColor} ${arrivePct}%`);
      stops.push(`${arriveColor} 100%`);
    }

    if (blockedNightInfo && !departureRes && !arrivalRes) {
      if (blockedNightInfo.type === 'early-arrival') {
        const freeColor = inDrag ? '#42a5f5' : 'transparent';
        stops.length = 0;
        stops.push(`${freeColor} 0%`);
        stops.push(`${freeColor} ${blockedNightInfo.startPct}%`);
        stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
        stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
      } else if (blockedNightInfo.type === 'late-departure-morning') {
        const cleaningStartPct = blockedNightInfo.endPct;
        const nextDayCleaningEndPct = hourToPercent(10 + cleaningHours);
        stops.length = 0;
        stops.push(`${BLOCKED_NIGHT_COLOR} 0%`);
        stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.endPct}%`);
        if (nextDayCleaningEndPct > cleaningStartPct) {
          stops.push(`${CLEANING_COLOR} ${cleaningStartPct}%`);
          stops.push(`${CLEANING_COLOR} ${Math.min(nextDayCleaningEndPct, 100)}%`);
        }
        if (nextDayCleaningEndPct < 100) {
          stops.push(`${gapColor} ${Math.min(nextDayCleaningEndPct, 100)}%`);
          stops.push(`${gapColor} 100%`);
        }
      }
    }

    const gradient = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : undefined;

    // Boundary between departure/cleaning zone and free zone (for click detection)
    const blockedZoneStartPct = blockedNightInfo && blockedNightInfo.type !== 'late-departure-morning'
      ? blockedNightInfo.startPct
      : null;
    const blockedZoneEndPct = blockedNightInfo && blockedNightInfo.type !== 'late-departure-morning'
      ? 100
      : null;
    const arrivalBlockedZoneEndPct = isEarlyArrivalDay ? arrivePct : null;

    const departEndPct = departPct !== null
      ? (isLateDepartureEvening
        ? departPct
        : (cleanEndPct !== null && cleanEndPct > departPct
        ? Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)
        : departPct))
      : 0;

    const tooltipParts = [];
    if (departureRes) tooltipParts.push(`Départ: ${departureRes.firstName} ${departureRes.lastName} à ${departureRes.checkOutTime || '10:00'}`);
    if (departureRes) tooltipParts.push(`Ménage: ${cleaningHours}h`);
    if (arrivalRes) tooltipParts.push(`Arrivée: ${arrivalRes.firstName} ${arrivalRes.lastName} à ${arrivalRes.checkInTime || '15:00'}`);
    if (isEarlyArrivalDay) tooltipParts.push(`Nuit bloquée avant arrivée anticipée de ${arrivalRes.firstName} ${arrivalRes.lastName}`);
    if (blockedNightInfo?.type === 'early-arrival') tooltipParts.push(`Nuit bloquée: arrivée anticipée de ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);
    if (blockedNightInfo?.type === 'late-departure-evening') tooltipParts.push(`Nuit bloquée: départ tardif de ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);
    if (blockedNightInfo?.type === 'late-departure-morning') tooltipParts.push(`Nuit bloquée puis ménage pour ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);

    // Compute click zone from cursor position on the 135deg gradient
    const getClickPct = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return ((e.clientX - rect.left) + (e.clientY - rect.top)) / (rect.width + rect.height) * 100;
    };

    return (
      <Box key={dateStr} data-date={dateStr}
        onMouseDown={(e) => {
          if (isPast) return;
          const pct = getClickPct(e);
          const onDepartZone = departureRes && pct <= departEndPct;
          const onArriveZone = arrivalRes && pct >= arrivePct;
          const onBlockedZone = blockedNightInfo && blockedZoneStartPct !== null && blockedZoneEndPct !== null && pct >= blockedZoneStartPct && pct <= blockedZoneEndPct;
          const onArrivalBlockedZone = isEarlyArrivalDay && arrivalBlockedZoneEndPct !== null && pct <= arrivalBlockedZoneEndPct;
          if (!onDepartZone && !onArriveZone && !onBlockedZone && !onArrivalBlockedZone) {
            handleMouseDown(day, y, m);
          }
        }}
        onMouseEnter={() => handleMouseEnter(day, y, m)}
        onContextMenu={(e) => { e.preventDefault(); handleOpenNoteDialog(dateStr); }}
        onClick={async (e) => {
          if (isDragging) return;
          const pct = getClickPct(e);
          const onBlockedZone = blockedNightInfo && blockedZoneStartPct !== null && blockedZoneEndPct !== null && pct >= blockedZoneStartPct && pct <= blockedZoneEndPct;
          const onArrivalBlockedZone = isEarlyArrivalDay && arrivalBlockedZoneEndPct !== null && pct <= arrivalBlockedZoneEndPct;
          if (onArrivalBlockedZone && arrivalRes) {
            handleReservationClick(arrivalRes.id);
          } else if (onBlockedZone && blockedNightInfo?.client) {
            handleReservationClick(blockedNightInfo.client.id);
          } else if (departureRes && pct <= departEndPct) {
            handleReservationClick(departureRes.id);
          } else if (arrivalRes && pct >= arrivePct) {
            handleReservationClick(arrivalRes.id);
          } else if (departureRes && !arrivalRes) {
            // Free zone on departure-only day: create new reservation
            const startDate = formatDate(y, m, day);
            const endDate = shiftDate(startDate, 1);
            openNewReservation(startDate, endDate);
          } else if (!departureRes && arrivalRes) {
            // Free zone on arrival-only day: show arrival reservation
            handleReservationClick(arrivalRes.id);
          }
        }}
        title={tooltipParts.join('\n')}
        sx={{
          textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
          height: 64, boxSizing: 'border-box',
          cursor: 'pointer', fontSize: 14, fontWeight: 600,
          background: gradient || 'grey.100',
          border: dateStr === today ? '3px solid #1976d2' : '1px solid #e0e0e0',
          color: 'text.primary', overflow: 'hidden',
          opacity: isPast ? 0.5 : 1,
          transition: 'border 0.2s',
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1, textShadow: '0 0 3px rgba(255,255,255,0.8)' }}>
          {day}
        </Box>
        {renderHolidayIndicators(dateStr)}
        {renderNoteLabel(dateStr, !!(departureRes || arrivalRes || blockedNightInfo))}
        {blockedNightInfo?.client && !departureRes && !arrivalRes && (
          <Box sx={{ position: 'absolute', bottom: 1, right: 2, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {compactName(blockedNightInfo.client.firstName, blockedNightInfo.client.lastName)}
            </Typography>
            <Typography sx={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.88)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {blockedNightInfo.type === 'early-arrival' ? 'arrivée anticipée' : 'nuit bloquée'}
            </Typography>
          </Box>
        )}
        {/* Compact label for arrival on short reservations (no mid-day visible) */}
        {arrivalRes && !resHasMidDays(arrivalRes, y, m, dim) && (() => {
          const colorPct = 100 - (arrivePct || 0);
          const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
          const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
          return (
            <Box sx={{ position: 'absolute', bottom: 1, right: 2, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
              <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {compactName(arrivalRes.firstName, arrivalRes.lastName)}
              </Typography>
              <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {arrivalRes.platform}
              </Typography>
            </Box>
          );
        })()}
        {/* Compact label for departure on short reservations when arrival not in this month */}
        {departureRes && !resHasMidDays(departureRes, y, m, dim) && !(departureRes.startDate >= formatDate(y, m, 1) && departureRes.startDate <= formatDate(y, m, dim)) && (() => {
          const colorPct = departEndPct || departPct || 0;
          const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
          const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
          return (
            <Box sx={{ position: 'absolute', top: 1, left: 2, zIndex: 2, textAlign: 'left', lineHeight: 1, pointerEvents: 'none' }}>
              <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {compactName(departureRes.firstName, departureRes.lastName)}
              </Typography>
              <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {departureRes.platform}
              </Typography>
            </Box>
          );
        })()}
      </Box>
    );
  };

  return (
    <Box>
      <PageHeader title="Calendrier des réservations" />

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap' }}>
          <FormControl sx={{ minWidth: { xs: '100%', sm: 250 } }}>
            <InputLabel>Logement</InputLabel>
            <Select value={selectedProp} label="Logement" onChange={(e) => handleSelectProperty(e.target.value)}>
              {properties.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          {selectedProp && (
            <Button variant="text" onClick={() => setSelectedProp('')}>Vue logements</Button>
          )}
          {selectedProp && (
            <Button variant="outlined" onClick={prependMonth} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Mois précédent
            </Button>
          )}
          {selectedProp && (
            <Button variant="outlined" onClick={appendMonth} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Mois suivant
            </Button>
          )}
          <Button variant="outlined" onClick={scrollToToday} sx={{ width: { xs: '100%', sm: 'auto' } }}>Aujourd'hui</Button>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'white' }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.A }} />
              <Typography variant="caption" color="text.secondary">Zone A</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.B }} />
              <Typography variant="caption" color="text.secondary">Zone B</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.C }} />
              <Typography variant="caption" color="text.secondary">Zone C</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {selectedProp ? (
        <Card>
          <CardContent sx={{ p: 1 }}>
            <Box ref={scrollRef} onScroll={handleScroll}
              sx={{ height: { xs: 'calc(100vh - 290px)', md: 'calc(100vh - 250px)' }, overflowY: 'auto', overflowX: 'auto', pl: { xs: '8px', sm: '50px' } }}
            >
              <Box
                sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, userSelect: 'none', minWidth: 680 }}
                onMouseLeave={() => isDragging && setIsDragging(false)}
                onMouseUp={handleMouseUp}
              >
                {/* Sticky day names */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 5 }}>
                  {dayNames.map(d => (
                    <Box key={d} sx={{ textAlign: 'center', fontWeight: 600, py: 1, color: 'text.secondary', fontSize: 14 }}>{d}</Box>
                  ))}
                </Box>
                {/* Continuous day cells - organized by week/row */}
                {(() => {
                  const cells = [];
                  let col = 0;
                  const cellMonths = [];
                  
                  // Build all cells and track which month each belongs to
                  months.forEach(({ year: y, month: m }, mi) => {
                    const dim = getDaysInMonth(y, m);
                    const fow = new Date(y, m, 1).getDay();
                    const af = (fow + 6) % 7;
                    if (mi === 0) {
                      for (let i = 0; i < af; i++) {
                        cells.push(<Box key={`pad-${y}-${m}-${i}`} />);
                        cellMonths.push(null);
                        col = (col + 1) % 7;
                      }
                    }
                    for (let d = 1; d <= dim; d++) {
                      const monthKey = `${y}-${m}`;
                      const cell = renderDayCell(d, y, m, dim);
                      if (d === 1) {
                        const badgeLabel = `${monthNames[m].substring(0, 4)}. ${y}`;
                        cells.push(
                          <Box key={`m${y}-${m}-${d}`} sx={{ position: 'relative' }}>
                            <Box sx={{
                              position: 'absolute', top: 1, left: 1, zIndex: 4, pointerEvents: 'none',
                              bgcolor: 'primary.main', borderRadius: '4px', px: 0.5, py: '1px', lineHeight: 1,
                            }}>
                              <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap' }}>
                                {badgeLabel}
                              </Typography>
                            </Box>
                            {cell}
                          </Box>
                        );
                      } else {
                        cells.push(cell);
                      }
                      cellMonths.push(monthKey);
                      col = (col + 1) % 7;
                    }
                  });
                  
                  // Build rows and track which months appear in which rows
                  const rows = [];
                  const monthRowMap = {}; // monthKey -> array of row indices
                  let currentRow = [];
                  let currentRowMonthKey = null;
                  
                  cells.forEach((cell, idx) => {
                    currentRow.push(cell);
                    if (cellMonths[idx]) {
                      currentRowMonthKey = cellMonths[idx];
                    }
                    
                    if ((idx + 1) % 7 === 0) {
                      // End of week/row
                      const rowIndex = rows.length;
                      if (currentRowMonthKey) {
                        if (!monthRowMap[currentRowMonthKey]) {
                          monthRowMap[currentRowMonthKey] = [];
                        }
                        monthRowMap[currentRowMonthKey].push(rowIndex);
                      }
                      
                      rows.push({ monthKey: currentRowMonthKey, cells: currentRow });
                      currentRow = [];
                      currentRowMonthKey = null;
                    }
                  });
                  
                  // Determine which row should show each month's label (middle row)
                  const monthLabelRowMap = {};
                  Object.keys(monthRowMap).forEach(monthKey => {
                    const rowIndices = monthRowMap[monthKey];
                    const middleIndex = Math.floor((rowIndices[0] + rowIndices[rowIndices.length - 1]) / 2);
                    monthLabelRowMap[monthKey] = middleIndex;
                  });
                  
                  // Render rows with labels
                  return rows.map((row, rowIndex) => {
                    const shouldShowLabel = row.monthKey && monthLabelRowMap[row.monthKey] === rowIndex;
                    const isMonthAnchorRow = row.monthKey && monthRowMap[row.monthKey]?.[0] === rowIndex;
                    const [year, month] = row.monthKey ? row.monthKey.split('-').map(Number) : [0, 0];
                    
                    return (
                      <Box
                        key={`row-${rowIndex}`}
                        data-month-anchor={isMonthAnchorRow ? row.monthKey : undefined}
                        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'relative' }}
                      >
                        {shouldShowLabel && (
                          <Box sx={{ position: 'absolute', left: -45, top: 0, bottom: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                            <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap', lineHeight: 1 }}>
                              {monthNames[month].substring(0, 3)} {year}
                            </Typography>
                          </Box>
                        )}
                        {row.cells}
                      </Box>
                    );
                  });
                })()}
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <SyncedPropertyMiniCalendars
          properties={properties}
          reservations={overviewReservations}
          platformColors={PLATFORM_COLORS}
          title="Calendrier simplifié"
          helperText="Cliquez une date de début puis une date de fin sur un logement pour créer une réservation, ou ouvrez son calendrier complet."
          openPropertyLabel="Ouvrir"
          onOpenProperty={(property) => handleSelectProperty(property.id)}
          onCreateReservation={({ propertyId, startDate, endDate }) => {
            navigate(withFrom(`/reservations/new?propertyId=${propertyId}&startDate=${startDate}&endDate=${endDate}`, '/calendar'));
          }}
        />
      )}

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onClose={() => setNoteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Note — {noteDialogDate}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth multiline rows={2} margin="dense"
            label="Note (50 car. max)"
            value={noteDialogText}
            onChange={e => setNoteDialogText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
            helperText={`${noteDialogText.length}/${NOTE_MAX_LENGTH}`}
          />
        </DialogContent>
        <DialogActions>
          {calendarNotes[noteDialogDate] && (
            <Button color="error" onClick={async () => {
              await api.deleteCalendarNote(selectedProp, noteDialogDate);
              setCalendarNotes(prev => { const next = { ...prev }; delete next[noteDialogDate]; return next; });
              setNoteDialogOpen(false);
            }}>Supprimer</Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setNoteDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSaveNote}>Enregistrer</Button>
        </DialogActions>
      </Dialog>


    </Box>
  );
}
