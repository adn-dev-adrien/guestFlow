import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Checkbox, Chip, Divider,
  LinearProgress, TextField, Button, Tooltip, IconButton, Table, TableBody, TableCell, TableRow
} from '@mui/material';
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

function ReservationCard({ reservation, onToggleReady, alertType }) {
  const r = reservation;
  const done = !!r.checkInReady;

  let alertBgColor = 'background.paper';
  if (alertType === 'orange') {
    alertBgColor = 'rgba(255, 152, 0, 0.08)';
  } else if (alertType === 'red') {
    alertBgColor = 'rgba(244, 67, 54, 0.08)';
  } else if (alertType === 'blue') {
    alertBgColor = 'rgba(33, 150, 243, 0.08)';
  }

  const optionsText = (r.options || []).map((o) => `${o.title}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`);
  const resourcesText = (r.resources || []).map((rr) => `${rr.name}${rr.quantity > 1 ? ` ×${rr.quantity}` : ''}`);

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

            <BedVisual doubleBeds={r.doubleBeds} singleBeds={r.singleBeds} babyBeds={r.babyBeds} />

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

export default function PlanningPage() {
  const [loading, setLoading] = useState(true);
  const [planningDays, setPlanningDays] = useState([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [alertMap, setAlertMap] = useState({});

  const scrollContainerRef = useRef(null);
  const lastLoadedRef = useRef(null);

  const todayStr = new Date().toISOString().split('T')[0];

  // Detect scheduling conflicts
  const detectAlerts = useCallback((days) => {
    const alerts = {};

    for (const day of days) {
      const ress = day.reservations;
      for (let i = 0; i < ress.length; i++) {
        const r = ress[i];

        // Type 1: Multiple logements with same checkout time (orange)
        const firstCheckout = ress[i].endDate === ress[i].startDate ? ress[i].checkOutTime || '11:00' : '11:00';
        const matchingCheckout = ress.filter(
          (rr) => rr.id !== r.id && rr.endDate === r.endDate && (rr.checkOutTime || '11:00') === firstCheckout
        );
        if (matchingCheckout.length > 0) {
          alerts[r.id] = 'orange';
        }

        // Type 2: Checkout + 2hr cleaning = next arrival (red)
        const nextRes = ress.find((rr) => rr.id !== r.id && rr.propertyId === r.propertyId && rr.startDate > r.endDate);
        if (nextRes) {
          const checkOutMin = timeToMinutes(firstCheckout);
          const cleaningEndMin = checkOutMin + 120;
          const nextArrivalMin = timeToMinutes(nextRes.checkInTime || '15:00');
          if (cleaningEndMin >= nextArrivalMin) {
            alerts[r.id] = 'red';
          }
        }

        // Type 3: Arrival during another logement's cleaning (blue)
        const otherRes = ress.find((rr) => rr.id !== r.id && rr.propertyId !== r.propertyId && rr.endDate <= r.startDate);
        if (otherRes) {
          const otherCheckOut = otherRes.endDate === otherRes.startDate ? otherRes.checkOutTime || '11:00' : '11:00';
          const otherCleaningEnd = timeToMinutes(otherCheckOut) + 120;
          const arrivalMin = timeToMinutes(r.checkInTime || '15:00');
          if (arrivalMin < otherCleaningEnd) {
            alerts[r.id] = 'blue';
          }
        }
      }
    }

    setAlertMap(alerts);
  }, []);

  const loadPlanning = async (from) => {
    setLoading(true);
    const to = addDays(from, DAYS_AHEAD - 1);
    const reservationsBase = await api.getReservations({ from, to });
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
    detectAlerts(days);
    lastLoadedRef.current = to;
    setLoading(false);
  };

  useEffect(() => {
    loadPlanning(startDate);
  }, [startDate]); // eslint-disable-line

  // Infinite scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200 && !loading && lastLoadedRef.current) {
        const nextStart = addDays(lastLoadedRef.current, 1);
        const nextEnd = addDays(nextStart, DAYS_AHEAD - 1);
        api.getReservations({ from: nextStart, to: nextEnd }).then((newArrivals) => {
          if (newArrivals.length === 0) {
            lastLoadedRef.current = null;
            return;
          }
          const detailed = Promise.all(newArrivals.map((r) => api.getReservation(r.id))).then((ress) => {
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
            setPlanningDays((prev) => [...prev, ...newDays]);
            detectAlerts([...planningDays, ...newDays]);
            lastLoadedRef.current = nextEnd;
          });
        });
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading, planningDays, detectAlerts]); // eslint-disable-line

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

  const totalCount = planningDays.reduce((acc, d) => acc + d.reservations.length, 0);
  const readyCount = planningDays.reduce(
    (acc, d) => acc + d.reservations.filter((r) => r.checkInReady).length,
    0
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <PageHeader title="Planning ménage" />

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
            {!loading && totalCount > 0 && (
              <Chip
                label={`${readyCount} / ${totalCount} prêt${readyCount > 1 ? 's' : ''}`}
                color={readyCount === totalCount ? 'success' : 'default'}
                size="small"
                sx={{ ml: 'auto' }}
              />
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
                Aucune arrivée sur les {DAYS_AHEAD} prochains jours
              </Typography>
            </CardContent>
          </Card>
        )}

        {planningDays.map((day, idx) => {
          const isToday = day.date === todayStr;
          const allReady = day.reservations.every((r) => r.checkInReady);
          return (
            <Box key={day.date} sx={{ mb: 3 }}>
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
                    {frenchWeekday(day.date)}
                    {isToday && ' — Aujourd\'hui'}
                  </Typography>
                  <Chip
                    label={`${day.reservations.filter((r) => r.checkInReady).length}/${day.reservations.length}`}
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

              {day.reservations.map((r) => (
                <ReservationCard
                  key={r.id}
                  reservation={r}
                  onToggleReady={handleToggleReady}
                  alertType={alertMap[r.id]}
                />
              ))}

              {idx < planningDays.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
