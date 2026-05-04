import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Checkbox, LinearProgress,
  Button, Divider, TextField, Tooltip, IconButton
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import TodayIcon from '@mui/icons-material/Today';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageHeader from '../components/PageHeader';
import SyncedPropertyMiniCalendars from '../components/SyncedPropertyMiniCalendars';
import { PLATFORM_COLORS } from '../constants/platforms';
import { displayDate } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import api from '../api';

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [arrivalsToday, setArrivalsToday] = useState([]);
  const [departuresToday, setDeparturesToday] = useState([]);
  const [loading, setLoading] = useState(true);

  const getRemainingDue = (r) => {
    const paid = (r.depositPaid ? Number(r.depositAmount || 0) : 0)
      + (r.balancePaid ? Number(r.balanceAmount || 0) : 0);
    return Math.max(0, Math.round((Number(r.finalPrice || 0) - paid) * 100) / 100);
  };

  // Shared optimistic toggle for check-in/out status fields
  const handleToggleStatus = async (r, field, setList) => {
    const value = !r[field];
    await api.markPayment(r.id, { [field]: value });
    setList((prev) => prev.map((item) => item.id === r.id ? { ...item, [field]: value } : item));
  };

  // Checking "Arrivé" also auto-sets "Prêt" if not already set
  const handleCheckInDone = async (r) => {
    const newDone = !r.checkInDone;
    const updates = { checkInDone: newDone };
    if (newDone && !r.checkInReady) updates.checkInReady = true;
    await api.markPayment(r.id, updates);
    setArrivalsToday((prev) =>
      prev.map((item) => item.id === r.id ? { ...item, ...updates } : item)
    );
  };

  // Row background based on check-in/out status
  const getStatusRowSx = (done, ready = false) => {
    if (done) return { bgcolor: 'rgba(120,120,120,0.18)' };
    if (ready) return { bgcolor: 'rgba(76,175,80,0.1)' };
    return {};
  };

  const loadDashboardData = async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const from = todayStr;
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 30);
    const to = toDate.toISOString().split('T')[0];
    // Fetch reservations starting from selectedDate if it's in the past
    const fetchFrom = selectedDate < todayStr ? selectedDate : todayStr;

    const [props, resv, allUpcoming] = await Promise.all([
      api.getProperties(),
      api.getReservations({ from, to }),
      api.getReservations({ from: fetchFrom }),
    ]);

    setProperties(props);
    setReservations(resv);

    const arrivalsBase = allUpcoming
      .filter((r) => r.startDate === selectedDate)
      .sort((a, b) => (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59'));
    const departuresBase = allUpcoming
      .filter((r) => r.endDate === selectedDate)
      .sort((a, b) => (a.checkOutTime || '23:59').localeCompare(b.checkOutTime || '23:59'));

    const arrivalsDetailed = await Promise.all(arrivalsBase.map((r) => api.getReservation(r.id)));
    setArrivalsToday(arrivalsDetailed);
    const departuresDetailed = await Promise.all(departuresBase.map((r) => api.getReservation(r.id)));
    setDeparturesToday(departuresDetailed);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedDate]); // eslint-disable-line

  // Build timeline days (30 days)
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const handleOpenPropertyCalendar = (property) => {
    const ref = new Date(selectedDate || todayStr);
    navigate(`/calendar?propertyId=${property.id}&year=${ref.getFullYear()}&month=${ref.getMonth()}`);
  };

  if (loading) return <LinearProgress />;

  return (
    <Box>
      <PageHeader title="Tableau de bord" />

      {/* Summary cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <HomeWorkIcon sx={{ fontSize: 40, color: 'primary.main' }} />
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Logements</Typography>
                <Typography variant="h4">{properties.length}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <EventIcon sx={{ fontSize: 40, color: 'secondary.main' }} />
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Réservations (30j)</Typography>
                <Typography variant="h4">{reservations.length}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TodayIcon sx={{ fontSize: 40, color: '#f57c00' }} />
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Arrivées (date sélectionnée)</Typography>
                <Typography variant="h4">{arrivalsToday.length}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Daily arrivals / departures */}
      <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, gap: 2, mb: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Typography variant="h6">Arrivées &amp; Départs</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" onClick={() => setSelectedDate((d) => addDays(d, -1))} aria-label="Jour précédent">
            <NavigateBeforeIcon />
          </IconButton>
          <TextField
            type="date"
            size="small"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            sx={{ width: { xs: '100%', sm: 165 } }}
            inputProps={{ style: { padding: '6px 10px' } }}
          />
          <IconButton size="small" onClick={() => setSelectedDate((d) => addDays(d, 1))} aria-label="Jour suivant">
            <NavigateNextIcon />
          </IconButton>
        </Box>
        {selectedDate !== todayStr && (
          <Button size="small" variant="outlined" onClick={() => setSelectedDate(todayStr)} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Aujourd'hui
          </Button>
        )}
      </Box>
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Arrivées — {displayDate(selectedDate)}</Typography>
              {arrivalsToday.length === 0 ? (
                <Typography color="text.secondary">Aucune arrivée ce jour</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 1080 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Prêt</TableCell>
                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Arrivé</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Heure</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Lits à préparer</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Options / Ressources</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Paiements</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Caution</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {arrivalsToday.map((r) => {
                        const remaining = getRemainingDue(r);
                        const paymentOk = remaining <= 0;
                        const cautionOk = Number(r.cautionAmount || 0) <= 0 || !!r.cautionReceived;
                        const optionsText = (r.options || []).map((o) => `${o.title} x${o.quantity}`).join(', ');
                        const resourcesText = [
                          ...(Number(r.babyBeds || 0) > 0 ? [`Lit bebe x${r.babyBeds}`] : []),
                          ...(r.resources || []).map((rr) => `${rr.name} x${rr.quantity}`),
                        ].join(', ');
                        return (
                          <TableRow key={r.id} hover sx={getStatusRowSx(r.checkInDone, r.checkInReady)}>
                            <TableCell padding="checkbox">
                              <Tooltip title="Logement prêt">
                                <Checkbox
                                  size="small"
                                  checked={!!r.checkInReady}
                                  onChange={() => handleToggleStatus(r, 'checkInReady', setArrivalsToday)}
                                  sx={{ color: 'success.main', '&.Mui-checked': { color: 'success.main' } }}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell padding="checkbox">
                              <Tooltip title="Locataires arrivés">
                                <Checkbox
                                  size="small"
                                  checked={!!r.checkInDone}
                                  onChange={() => handleCheckInDone(r)}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell>{r.checkInTime || '15:00'}</TableCell>
                            <TableCell>{r.propertyName}</TableCell>
                            <TableCell>{r.firstName} {r.lastName}</TableCell>
                            <TableCell>
                              {`D:${Number(r.doubleBeds || 0)} / S:${Number(r.singleBeds || 0)} / B:${Number(r.babyBeds || 0)}`}
                            </TableCell>
                            <TableCell>{[optionsText, resourcesText].filter(Boolean).join(' | ') || '—'}</TableCell>
                            <TableCell>{r.notes || '—'}</TableCell>
                            <TableCell sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
                              {paymentOk
                                ? 'OK'
                                : `Manquant ${remaining}€ • Acompte ${r.depositPaid ? 'OK' : 'NON'} • Solde ${r.balancePaid ? 'OK' : 'NON'}`}
                            </TableCell>
                            <TableCell sx={{ color: cautionOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
                              {Number(r.cautionAmount || 0) > 0
                                ? (cautionOk ? `OK (${r.cautionAmount}€)` : `NON (${r.cautionAmount}€)`)
                                : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Départs — {displayDate(selectedDate)}</Typography>
              {departuresToday.length === 0 ? (
                <Typography color="text.secondary">Aucun départ ce jour</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 860 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Parti</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Heure</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Options / Ressources</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Paiements</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {departuresToday.map((r) => {
                        const remaining = getRemainingDue(r);
                        const paymentOk = remaining <= 0;
                        const optionsText = (r.options || []).map((o) => `${o.title} x${o.quantity}`).join(', ');
                        const resourcesText = [
                          ...(Number(r.babyBeds || 0) > 0 ? [`Lit bebe x${r.babyBeds}`] : []),
                          ...(r.resources || []).map((rr) => `${rr.name} x${rr.quantity}`),
                        ].join(', ');
                        return (
                          <TableRow key={r.id} hover sx={getStatusRowSx(r.checkOutDone)}>
                            <TableCell padding="checkbox">
                              <Tooltip title="Départ effectué">
                                <Checkbox
                                  size="small"
                                  checked={!!r.checkOutDone}
                                  onChange={() => handleToggleStatus(r, 'checkOutDone', setDeparturesToday)}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell>{r.checkOutTime || '10:00'}</TableCell>
                            <TableCell>{r.propertyName}</TableCell>
                            <TableCell>{r.firstName} {r.lastName}</TableCell>
                            <TableCell>{[optionsText, resourcesText].filter(Boolean).join(' | ') || '—'}</TableCell>
                            <TableCell>{r.notes || '—'}</TableCell>
                            <TableCell sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
                              {paymentOk ? 'OK' : `En attente: ${remaining}€`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Combined timeline calendar */}
      <Divider sx={{ my: 3 }} />
      <SyncedPropertyMiniCalendars
        properties={properties}
        reservations={reservations}
        platformColors={PLATFORM_COLORS}
        onOpenProperty={handleOpenPropertyCalendar}
        onOpenReservation={(r) => navigate(withFrom(`/reservations/${r.id}`, '/'))}
        onCreateReservation={({ propertyId, startDate, endDate }) => {
          navigate(withFrom(`/reservations/new?propertyId=${propertyId}&startDate=${startDate}&endDate=${endDate}`, '/'));
        }}
      />
    </Box>
  );
}
