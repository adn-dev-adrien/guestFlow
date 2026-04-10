import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Checkbox, Chip, Divider,
  LinearProgress, TextField, Button, Tooltip, IconButton, Table, TableBody, TableCell, TableRow
} from '@mui/material';
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
import { displayDate } from '../utils/formatters';
import api from '../api';

const DAYS_AHEAD = 14;

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
  const persons = adults + children + teens;
  const nights = Math.max(1, Math.round((new Date(r.endDate) - new Date(r.startDate)) / 86400000));

  const getMultiplier = (priceType) => {
    if (priceType === 'per_person') return persons;
    if (priceType === 'per_night') return nights;
    if (priceType === 'per_person_per_night') return persons * nights;
    return 1;
  };

  const getEffectiveQty = (item) => {
    const baseQty = Number(item.quantity || 0);
    const multiplier = getMultiplier(item.priceType);
    const value = baseQty * multiplier;
    return Number.isInteger(value) ? value : Number(value.toFixed(2));
  };

  let alertBgColor = 'background.paper';
  if (alertInfo?.type === 'orange') {
    alertBgColor = 'rgba(244, 67, 54, 0.10)';
  } else if (alertInfo?.type === 'red') {
    alertBgColor = 'rgba(244, 67, 54, 0.14)';
  } else if (alertInfo?.type === 'blue') {
    alertBgColor = 'rgba(33, 150, 243, 0.08)';
  }

  const optionsText = (r.options || []).map((o) => `${o.title} ×${getEffectiveQty(o)}`);
  const resourcesText = (r.resources || []).map((rr) => `${rr.name} ×${getEffectiveQty(rr)}`);

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
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Tooltip title={done ? 'Logement prêt ✓' : 'Marquer comme prêt'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 32, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleReady(r)}
              sx={{ p: 0, mt: 0.25, flexShrink: 0 }}
            />
          </Tooltip>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
              <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
                {r.propertyName}
              </Typography>
              {done && (
                <Chip label="Prêt" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />
              )}
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
        </Box>
      </CardContent>
    </Card>
  );
}

function DepartureMiniRow({ reservation, onToggleDone }) {
  const done = Boolean(reservation.checkOutDone);
  const checkOutTime = reservation.checkOutTime || '10:00';
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        borderColor: done ? 'success.main' : 'divider',
        bgcolor: done ? 'rgba(76,175,80,0.06)' : 'background.paper',
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Tooltip title={done ? 'Départ validé' : 'Valider le départ'}>
            <Checkbox
              icon={<RadioButtonUncheckedIcon sx={{ fontSize: 22, color: 'text.disabled' }} />}
              checkedIcon={<CheckCircleIcon sx={{ fontSize: 22, color: 'success.main' }} />}
              checked={done}
              onChange={() => onToggleDone(reservation)}
              sx={{ p: 0 }}
            />
          </Tooltip>

          <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 42 }}>
            {checkOutTime}
          </Typography>

          <HomeWorkIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', minWidth: 0 }} noWrap>
            {reservation.propertyName}
          </Typography>

          <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
            · {reservation.firstName} {reservation.lastName}
          </Typography>
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

  const scrollContainerRef = useRef(null);
  const lastLoadedRef = useRef(null);

  const todayStr = new Date().toISOString().split('T')[0];

  // Load properties once
  useEffect(() => {
    api.getProperties().then(setProperties);
  }, []);

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
    const [reservationsBase, rbEvents] = await Promise.all([
      api.getReservations({ from, to }),
      api.getResourceBookingPlanningEvents(from, to).catch(() => []),
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
              inputProps={{ style: { padding: '6px 10px' } }}
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

        {/* Merge reservation days + resource booking days */}
        {[...new Set([...planningDays.map((d) => d.date), ...Object.keys(resourceBookingsMap), ...Object.keys(departuresMap)])].sort().map((date, idx, arr) => {
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

              {dayDepartures.length > 0 && (
                <Box sx={{ mb: 1.25 }}>
                  <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                    Départs ({dayDepartures.filter((r) => r.checkOutDone).length}/{dayDepartures.length})
                  </Typography>
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
