import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Typography, Button, IconButton, Select, MenuItem,
  FormControl, InputLabel, Tooltip, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AddIcon from '@mui/icons-material/Add';
import PageActionBar from '../components/PageActionBar';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import ResourceBookingDialog from '../components/ResourceBookingDialog';
import { useToast } from '../components/DialogProvider';
import { withFrom } from '../utils/navigation';
import api from '../api';

const PIXELS_PER_MINUTE = 1.5; // 60 min = 90px
const MIN_BOOKING_HEIGHT = 18;
const HOUR_COL_WIDTH = 52;
const DAY_LABELS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const BOOKING_STEP_MINUTES = 5;

function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getMondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function getWeekDates(mondayStr) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayStr, i));
}

const todayStr = () => new Date().toISOString().split('T')[0];

export default function ResourcePlanningPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [resources, setResources] = useState([]);
  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const [monday, setMonday] = useState(() => getMondayOf(todayStr()));
  const [bookings, setBookings] = useState([]);
  // Reservation-attached hourly sessions (specs/resource-hourly-scheduling.md §3.4) — shown read-only
  // alongside the standalone bookings, reusing the existing planning-resource-cards endpoint.
  const [reservationSessions, setReservationSessions] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [clickedDate, setClickedDate] = useState(null);
  const [clickedTime, setClickedTime] = useState(null);

  // Load complex resources once
  const loadResources = useCallback(() => {
    api.getResources()
      .then((items) => {
        const complex = (items || []).filter((r) => r.isComplex);
        setResources(complex);
        if (complex.length > 0) setSelectedResourceId((prev) => prev || complex[0].id);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(() => { loadResources(); }, [loadResources]);

  const selectedResource = useMemo(
    () => resources.find((r) => r.id === selectedResourceId) || null,
    [resources, selectedResourceId],
  );

  // Load bookings when resource or week changes. A failed load must SURFACE (an empty grid would
  // read as « libre » and invite double-booking) — specs/ds-sweep-planning.md rule 9.
  const loadBookings = useCallback(() => {
    if (!selectedResourceId) return;
    setLoadError(false);
    api.getResourceBookings({ resourceId: selectedResourceId, weekStart: monday })
      .then(setBookings)
      .catch(() => { setBookings([]); setLoadError(true); });
    // Reservation sessions for this resource in the visible week (read-only). Reuses the planning
    // cards endpoint and filters to the selected resource.
    api.getPlanningResourceCards({ from: monday, to: addDays(monday, 6) })
      .then((summary) => {
        const byDate = summary?.resourceCardsByDate || {};
        const out = [];
        for (const date of Object.keys(byDate)) {
          for (const it of (byDate[date].items || [])) {
            if (Number(it.resourceId) !== Number(selectedResourceId)) continue;
            out.push({
              id: `res-${it.reservationId}-${it.date}-${it.start}`,
              reservationId: it.reservationId,
              date: it.date,
              startTime: it.start,
              endTime: it.end,
              displayName: it.clientName,
              propertyName: it.propertyName,
              isReservationSession: true,
            });
          }
        }
        setReservationSessions(out);
      })
      .catch(() => { setReservationSessions([]); setLoadError(true); });
  }, [selectedResourceId, monday]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  const weekDates = useMemo(() => getWeekDates(monday), [monday]);

  const openMin = timeToMinutes(selectedResource?.openTime || '08:00');
  const closeMin = timeToMinutes(selectedResource?.closeTime || '22:00');
  const totalMinutes = Math.max(closeMin - openMin, 60);
  const gridHeight = totalMinutes * PIXELS_PER_MINUTE;
  const slotDuration = selectedResource?.slotDuration || 5;
  const turnoverMinutes = Number(selectedResource?.turnoverMinutes || 0);

  const openDays = useMemo(() => {
    try {
      if (selectedResource?.openDays) return JSON.parse(selectedResource.openDays);
      const closed = JSON.parse(selectedResource?.closedDays || '[]');
      return [0, 1, 2, 3, 4, 5, 6].filter((d) => !closed.includes(d));
    } catch {
      return [0, 1, 2, 3, 4, 5, 6];
    }
  }, [selectedResource]);

  // Hour markers (every full hour within open range)
  const hourMarkers = useMemo(() => {
    const markers = [];
    const firstHour = Math.ceil(openMin / 60) * 60;
    for (let m = firstHour; m <= closeMin; m += 60) {
      markers.push({ minutes: m, top: (m - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin]);

  // Slot-duration markers (lighter lines)
  const slotMarkers = useMemo(() => {
    if (BOOKING_STEP_MINUTES >= 60) return []; // covered by hourMarkers
    const markers = [];
    for (let m = openMin + BOOKING_STEP_MINUTES; m < closeMin; m += BOOKING_STEP_MINUTES) {
      if (m % 60 !== 0) markers.push({ top: (m - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin]);

  function getBookingsForDate(date) {
    return [...bookings.filter((b) => b.date === date), ...reservationSessions.filter((s) => s.date === date)];
  }

  function getBookingStyle(b) {
    const startM = timeToMinutes(b.startTime);
    const endM = timeToMinutes(b.endTime);
    const top = (startM - openMin) * PIXELS_PER_MINUTE;
    const height = Math.max((endM - startM) * PIXELS_PER_MINUTE, MIN_BOOKING_HEIGHT);
    const turnoverHeight = Math.max(0, Number(b.turnoverMinutes || turnoverMinutes) * PIXELS_PER_MINUTE);
    return { top, height, turnoverTop: top + height, turnoverHeight };
  }

  function handleGridClick(date, clientY, rect) {
    const clickY = clientY - rect.top;
    const rawMinutes = openMin + clickY / PIXELS_PER_MINUTE;
    const snapped = Math.floor(rawMinutes / BOOKING_STEP_MINUTES) * BOOKING_STEP_MINUTES;
    const minDuration = Math.max(slotDuration, BOOKING_STEP_MINUTES);
    const clamped = Math.max(openMin, Math.min(closeMin - minDuration, snapped));
    setClickedDate(date);
    setClickedTime(minutesToTime(clamped));
    setEditingBooking(null);
    setDialogOpen(true);
  }

  function handleBookingClick(e, booking) {
    e.stopPropagation();
    // A reservation session is read-only here → open the reservation fiche instead of the booking editor.
    if (booking.isReservationSession) {
      navigate(withFrom(`/reservations/${booking.reservationId}`, '/resource-planning'));
      return;
    }
    setEditingBooking(booking);
    setClickedDate(null);
    setClickedTime(null);
    setDialogOpen(true);
  }

  async function handleSave(data) {
    try {
      if (editingBooking) {
        await api.updateResourceBooking(editingBooking.id, data);
      } else {
        await api.createResourceBooking({ resourceId: selectedResourceId, ...data });
      }
      loadBookings();
      setDialogOpen(false);
      showSuccess('Réservation enregistrée.');
    } catch (e) {
      showError(e.message || "Impossible d'enregistrer la réservation.");
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteResourceBooking(id);
      loadBookings();
      setDialogOpen(false);
      showSuccess('Réservation supprimée.');
    } catch (e) {
      showError(e.message || 'Impossible de supprimer la réservation.');
    }
  }

  const weekLabel = (() => {
    const s = new Date(monday + 'T12:00:00');
    const e = addDays(monday, 6);
    const eDate = new Date(e + 'T12:00:00');
    const fmt = (d, opts) => d.toLocaleDateString('fr-FR', opts);
    return `${fmt(s, { day: 'numeric', month: 'long' })} – ${fmt(eDate, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  })();

  // Count bookings this week for badge
  const weekBookingCount = bookings.length;

  // Resource + week cluster — bar `center` on sm+, compact strip under the bar on xs
  // (specs/ds-sweep-planning.md rule 4).
  const renderWeekControls = () => (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>Ressource</InputLabel>
        <Select
          value={selectedResourceId || ''}
          label="Ressource"
          onChange={(e) => setSelectedResourceId(e.target.value)}
        >
          {resources.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
        </Select>
      </FormControl>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton size="small" onClick={() => setMonday((m) => addDays(m, -7))} aria-label="Semaine précédente">
          <NavigateBeforeIcon />
        </IconButton>
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: { xs: 0, md: 240 }, textAlign: 'center' }}>
          {weekLabel}
        </Typography>
        <IconButton size="small" onClick={() => setMonday((m) => addDays(m, 7))} aria-label="Semaine suivante">
          <NavigateNextIcon />
        </IconButton>
      </Box>
      {weekBookingCount > 0 && (
        <Chip label={`${weekBookingCount} réservation${weekBookingCount > 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" />
      )}
    </Box>
  );

  return (
    <Box>
      <PageActionBar
        title="Planning ressources"
        titleOnXs
        center={resources.length > 0 ? renderWeekControls() : undefined}
        actionsBefore={resources.length > 0 ? [{
          node: (
            <Button
              key="create-booking"
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => { setEditingBooking(null); setClickedDate(todayStr()); setClickedTime(selectedResource?.openTime || '08:00'); setDialogOpen(true); }}
            >
              Nouvelle réservation
            </Button>
          ),
        }] : []}
      />
      {resources.length > 0 && (
        // xs fallback for the bar's hidden `center` — same controls, compact strip.
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
          {renderWeekControls()}
        </Box>
      )}

      {loadError && (
        <ErrorAlert
          message="Impossible de charger le planning de la ressource."
          onRetry={() => { loadResources(); loadBookings(); }}
          sx={{ mb: 2 }}
        />
      )}

      {resources.length === 0 ? (
        !loadError && (
          <EmptyState
            message="Aucune ressource complexe configurée. Dans la page Ressources, activez l'option « Ressource à créneaux » sur une ressource."
          />
        )
      ) : (
        <>
          {/* Legend */}
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {/* « Non payé » is INFO blue, not primary: the « Maison » primary is green and would
                  collide with the green « Payé » swatch below. */}
              <Box sx={{ width: 14, height: 14, bgcolor: 'info.main', borderRadius: 0.5 }} />
              <Typography variant="caption">Non payé</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 14, height: 14, bgcolor: 'success.main', borderRadius: 0.5 }} />
              <Typography variant="caption">Payé</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 14, height: 14, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider', borderRadius: 0.5 }} />
              <Typography variant="caption">Fermé</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={(t) => ({ width: 14, height: 14, bgcolor: alpha(t.palette.error.main, 0.35), borderRadius: 0.5 })} />
              <Typography variant="caption">Remise en état</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 14, height: 14, bgcolor: 'secondary.dark', borderRadius: 0.5 }} />
              <Typography variant="caption">Réservation</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Clic sur une case vide pour créer · Clic sur un créneau pour modifier (pas de 5 min)
            </Typography>
          </Box>

          {/* Calendar grid — intrinsically a wide+tall 2D panel: contained scroll is the documented
              exemption (specs/ds-sweep-planning.md rule 7); the page itself flows normally so the
              sticky bar survives. */}
          <Box sx={{ maxHeight: { xs: '70vh', md: 'calc(100vh - 300px)' }, overflowY: 'auto', overflowX: 'auto' }}>
            <Box sx={{ display: 'flex', minWidth: 600 }}>
              {/* Hour label column */}
              <Box sx={{ width: HOUR_COL_WIDTH, flexShrink: 0, position: 'relative', pt: '40px' }}>
                <Box sx={{ position: 'relative', height: gridHeight }}>
                  {hourMarkers.map((hm) => (
                    <Typography
                      key={hm.minutes}
                      variant="caption"
                      sx={{
                        position: 'absolute',
                        top: hm.top - 8,
                        right: 6,
                        color: 'text.secondary',
                        fontSize: '10px',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {minutesToTime(hm.minutes)}
                    </Typography>
                  ))}
                </Box>
              </Box>

              {/* Day columns */}
              {weekDates.map((date) => {
                const jsDay = new Date(date + 'T12:00:00').getDay();
                const isClosed = !openDays.includes(jsDay);
                const isToday = date === todayStr();
                const dayBookings = getBookingsForDate(date);
                const dayLabel = DAY_LABELS_FR[jsDay];
                const dayNum = new Date(date + 'T12:00:00').getDate();

                return (
                  <Box
                    key={date}
                    sx={{
                      flex: 1,
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      minWidth: 80,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* Day header */}
                    <Box
                      sx={{
                        height: 40,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: isToday ? 'primary.main' : isClosed ? 'action.disabledBackground' : 'background.paper',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        flexShrink: 0,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ color: isToday ? 'primary.contrastText' : 'text.secondary', lineHeight: 1, fontSize: '10px' }}
                      >
                        {dayLabel}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, color: isToday ? 'primary.contrastText' : 'text.primary', lineHeight: 1.2 }}
                      >
                        {dayNum}
                      </Typography>
                    </Box>

                    {/* Time grid */}
                    <Box
                      sx={{
                        position: 'relative',
                        height: gridHeight,
                        bgcolor: isClosed ? 'action.hover' : 'background.default',
                        cursor: isClosed ? 'not-allowed' : 'pointer',
                        '&:hover': isClosed ? {} : { bgcolor: 'action.hover' },
                      }}
                      onClick={(e) => {
                        if (isClosed) return;
                        handleGridClick(date, e.clientY, e.currentTarget.getBoundingClientRect());
                      }}
                    >
                      {/* Slot lines */}
                      {slotMarkers.map((sm, i) => (
                        <Box
                          key={i}
                          sx={{
                            position: 'absolute',
                            top: sm.top,
                            left: 0,
                            right: 0,
                            borderTop: '1px dashed',
                            borderColor: 'divider',
                            opacity: 0.4,
                            pointerEvents: 'none',
                          }}
                        />
                      ))}
                      {/* Hour lines */}
                      {hourMarkers.map((hm) => (
                        <Box
                          key={hm.minutes}
                          sx={{
                            position: 'absolute',
                            top: hm.top,
                            left: 0,
                            right: 0,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                            opacity: 0.6,
                            pointerEvents: 'none',
                          }}
                        />
                      ))}

                      {/* Bookings */}
                      {dayBookings.map((b) => {
                        const { top, height, turnoverTop, turnoverHeight } = getBookingStyle(b);
                        return (
                          <Tooltip
                            key={b.id}
                            title={`${b.isReservationSession ? 'Réservation · ' : ''}${b.startTime}→${b.endTime} · ${b.displayName}${b.propertyName ? ` · ${b.propertyName}` : ''}${b.turnoverMinutes ? ` · remise en état ${b.turnoverMinutes} min` : ''}${b.notes ? ` · ${b.notes}` : ''}`}
                            arrow
                          >
                            <Box>
                              <Box
                                onClick={(e) => handleBookingClick(e, b)}
                                sx={{
                                  position: 'absolute',
                                  left: 2,
                                  right: 2,
                                  top,
                                  height,
                                  bgcolor: (t) => (b.isReservationSession ? t.palette.secondary.dark : (b.paid ? t.palette.success.main : t.palette.info.main)),
                                  color: 'common.white',
                                  borderRadius: 0.75,
                                  px: 0.5,
                                  py: 0.25,
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                  boxShadow: 1,
                                  '&:hover': { filter: 'brightness(0.85)' },
                                  zIndex: 2,
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{ display: 'block', fontWeight: 700, fontSize: '9px', lineHeight: 1.3 }}
                                >
                                  {b.startTime}–{b.endTime}
                                </Typography>
                                {height >= 28 && (
                                  <Typography
                                    variant="caption"
                                    sx={{ display: 'block', fontSize: '9px', lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                                  >
                                    {b.displayName}
                                  </Typography>
                                )}
                                {height >= 42 && b.propertyName && (
                                  <Typography
                                    variant="caption"
                                    sx={{ display: 'block', fontSize: '9px', opacity: 0.85, lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                                  >
                                    {b.propertyName}
                                  </Typography>
                                )}
                              </Box>
                              {!b.isReservationSession && turnoverHeight > 0 && (
                                <Typography
                                  component="div"
                                  sx={{
                                    position: 'absolute',
                                    left: 2,
                                    right: 2,
                                    top: turnoverTop,
                                    height: turnoverHeight,
                                    borderRadius: 0.5,
                                    bgcolor: (t) => alpha(t.palette.error.main, 0.35),
                                    border: (t) => `1px dashed ${alpha(t.palette.error.dark, 0.6)}`,
                                    zIndex: 1,
                                  }}
                                >
                                  {''}
                                </Typography>
                              )}
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </>
      )}

      {dialogOpen && selectedResource && (
        <ResourceBookingDialog
          open={dialogOpen}
          resource={selectedResource}
          initialDate={clickedDate}
          initialTime={clickedTime}
          booking={editingBooking}
          onClose={() => setDialogOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </Box>
  );
}
