import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Checkbox, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Divider, TextField, Tooltip, IconButton
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
  const [pendingPayments, setPendingPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [upcomingByProperty, setUpcomingByProperty] = useState({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRes, setDetailRes] = useState(null);

  const handleOpenDetail = async (resId) => {
    const res = await api.getReservation(resId);
    setDetailRes(res);
    setDetailOpen(true);
  };

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

    const [props, resv, pending, allUpcoming] = await Promise.all([
      api.getProperties(),
      api.getReservations({ from, to }),
      api.getPendingPayments(),
      api.getReservations({ from: fetchFrom }),
    ]);

    setProperties(props);
    setReservations(resv);
    setPendingPayments(pending);

    const grouped = {};
    for (const prop of props) {
      grouped[prop.id] = allUpcoming
        .filter(r => r.propertyId === prop.id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 5);
    }
    setUpcomingByProperty(grouped);

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

  const handleTogglePayment = async (r, field) => {
    const value = !r[field];
    await api.markPayment(r.id, { [field]: value });
    await loadDashboardData();
  };

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
        onCreateReservation={({ propertyId, startDate, endDate }) => {
          navigate(withFrom(`/reservations/new?propertyId=${propertyId}&startDate=${startDate}&endDate=${endDate}`, '/'));
        }}
      />

      {/* Upcoming reservations per property */}
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" sx={{ mb: 1.5 }}>Réservations à venir</Typography>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          {properties.map(prop => {
            const upcoming = upcomingByProperty[prop.id] || [];
            if (upcoming.length === 0) return null;
            return (
              <Box key={prop.id} sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>{prop.name}</Typography>
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 820 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Nuits</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Prix</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Reste à payer</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Créée le</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {upcoming.map(r => {
                        const nights = Math.round((new Date(r.endDate) - new Date(r.startDate)) / 86400000);
                        const remaining = (r.finalPrice || 0)
                          - (r.depositPaid ? (r.depositAmount || 0) : 0)
                          - (r.balancePaid ? (r.balanceAmount || 0) : 0);
                        return (
                        <TableRow
                          key={r.id}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() => handleOpenDetail(r.id)}
                        >
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell>{nights}</TableCell>
                          <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: PLATFORM_COLORS[r.platform], color: 'white' }} /></TableCell>
                          <TableCell>{r.finalPrice}€</TableCell>
                          <TableCell sx={{ color: remaining > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>{remaining}€</TableCell>
                          <TableCell>{displayDate(r.createdAt ? r.createdAt.split(/[T ]/)[0] : r.createdAt)}</TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            );
          })}
          {properties.every(p => !(upcomingByProperty[p.id] || []).length) && (
            <Typography color="text.secondary">Aucune réservation à venir</Typography>
          )}
        </CardContent>
      </Card>

      {/* Pending payments with checkboxes */}
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" sx={{ mb: 1.5 }}>Paiements en attente</Typography>
      <Card>
        <CardContent>
          {pendingPayments.length === 0 ? (
            <Typography color="text.secondary">Aucun paiement en attente</Typography>
          ) : (
            <TableContainer>
              <Table size="small" sx={{ minWidth: 980 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Prix total</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Reste à payer</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Acompte</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Solde</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Caution</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pendingPayments.map(r => {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const depositOverdue = !r.depositPaid && r.depositDueDate && r.depositDueDate < todayStr;
                    const balanceOverdue = !r.balancePaid && r.balanceDueDate && r.balanceDueDate < todayStr;
                    const remainingDue = (r.finalPrice || 0)
                      - (r.depositPaid ? (r.depositAmount || 0) : 0)
                      - (r.balancePaid ? (r.balanceAmount || 0) : 0);
                    return (
                    <TableRow key={r.id} hover>
                      <TableCell>{r.firstName} {r.lastName}</TableCell>
                      <TableCell>{r.propertyName}</TableCell>
                      <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                      <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: PLATFORM_COLORS[r.platform], color: 'white' }} /></TableCell>
                      <TableCell>{r.finalPrice}€</TableCell>
                      <TableCell align="center" sx={{ color: remainingDue > 0 ? 'error.main' : 'success.main', fontWeight: 700 }}>
                        {Math.round(remainingDue * 100) / 100}€
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Checkbox
                            checked={!!r.depositPaid}
                            onChange={() => handleTogglePayment(r, 'depositPaid')}
                            size="small"
                          />
                          <Box>
                            <Typography variant="body2" sx={{ color: depositOverdue ? 'error.main' : 'inherit', fontWeight: depositOverdue ? 700 : 400 }}>{r.depositAmount}€</Typography>
                            {r.depositDueDate && <Typography variant="caption" sx={{ color: depositOverdue ? 'error.main' : 'text.secondary', fontWeight: depositOverdue ? 700 : 400 }}>{displayDate(r.depositDueDate)}</Typography>}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Checkbox
                            checked={!!r.balancePaid}
                            onChange={() => handleTogglePayment(r, 'balancePaid')}
                            size="small"
                          />
                          <Box>
                            <Typography variant="body2" sx={{ color: balanceOverdue ? 'error.main' : 'inherit', fontWeight: balanceOverdue ? 700 : 400 }}>{r.balanceAmount}€</Typography>
                            {r.balanceDueDate && <Typography variant="caption" sx={{ color: balanceOverdue ? 'error.main' : 'text.secondary', fontWeight: balanceOverdue ? 700 : 400 }}>{displayDate(r.balanceDueDate)}</Typography>}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        {r.cautionAmount > 0 ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <Checkbox
                              checked={!!r.cautionReceived}
                              onChange={() => handleTogglePayment(r, 'cautionReceived')}
                              size="small"
                            />
                            <Typography variant="body2">{r.cautionAmount}€</Typography>
                          </Box>
                        ) : '—'}
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

      {/* Reservation Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="sm" fullWidth>
        {detailRes && (() => {
          const nights = Math.round((new Date(detailRes.endDate) - new Date(detailRes.startDate)) / 86400000);
          const todayStr = new Date().toISOString().split('T')[0];
          const depositOverdue = !detailRes.depositPaid && detailRes.depositDueDate && detailRes.depositDueDate < todayStr;
          const balanceOverdue = !detailRes.balancePaid && detailRes.balanceDueDate && detailRes.balanceDueDate < todayStr;
          const totalPersons = (detailRes.adults || 0) + (detailRes.children || 0) + (detailRes.teens || 0) + (detailRes.babies || 0);
          return (
            <>
              <DialogTitle>Réservation — {detailRes.propertyName}</DialogTitle>
              <DialogContent dividers>
                {/* Client */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Client</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                  <Typography variant="body2"><b>Nom :</b> {detailRes.firstName} {detailRes.lastName}</Typography>
                  <Typography variant="body2"><b>Tél :</b> {detailRes.phone || '—'}</Typography>
                  <Typography variant="body2"><b>Email :</b> {detailRes.email || '—'}</Typography>
                  <Typography variant="body2"><b>Plateforme :</b> <Chip label={detailRes.platform} size="small" sx={{ bgcolor: PLATFORM_COLORS[detailRes.platform], color: 'white', ml: 0.5 }} /></Typography>
                </Box>
                <Divider sx={{ my: 1.5 }} />

                {/* Séjour */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Séjour</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                  <Typography variant="body2"><b>Arrivée :</b> {displayDate(detailRes.startDate)} à {detailRes.checkInTime || '15:00'}</Typography>
                  <Typography variant="body2"><b>Départ :</b> {displayDate(detailRes.endDate)} à {detailRes.checkOutTime || '10:00'}</Typography>
                  <Typography variant="body2"><b>Nuits :</b> {nights}</Typography>
                  <Typography variant="body2"><b>Personnes :</b> {totalPersons} ({detailRes.adults} ad.{detailRes.children > 0 ? `, ${detailRes.children} enf. 2-12` : ''}{detailRes.teens > 0 ? `, ${detailRes.teens} ado${detailRes.teens > 1 ? 's' : ''} 12-18` : ''}{detailRes.babies > 0 ? `, ${detailRes.babies} bébé${detailRes.babies > 1 ? 's' : ''}` : ''})</Typography>
                </Box>

                {/* Options */}
                {detailRes.options && detailRes.options.length > 0 && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Options</Typography>
                    <Table size="small" sx={{ mb: 2 }}>
                      <TableBody>
                        {detailRes.options.map(opt => (
                          <TableRow key={opt.optionId}>
                            <TableCell sx={{ border: 0, pl: 0 }}>{opt.title}</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">x{opt.quantity}</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">{opt.totalPrice}€</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}

                {/* Ressources */}
                {(detailRes.resources && detailRes.resources.length > 0) || (detailRes.babyBeds && detailRes.babyBeds > 0) ? (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Ressources réservées</Typography>
                    <Table size="small" sx={{ mb: 2 }}>
                      <TableBody>
                        {detailRes.babyBeds > 0 && (
                          <TableRow>
                            <TableCell sx={{ border: 0, pl: 0 }}>Lit bébé</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">x{detailRes.babyBeds}</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">0€</TableCell>
                          </TableRow>
                        )}
                        {detailRes.resources.map(rr => (
                          <TableRow key={rr.resourceId}>
                            <TableCell sx={{ border: 0, pl: 0 }}>{rr.name}</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">x{rr.quantity}</TableCell>
                            <TableCell sx={{ border: 0 }} align="right">{rr.totalPrice}€</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                ) : null}

                <Divider sx={{ my: 1.5 }} />

                {/* Finances */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Finances</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                  <Typography variant="body2"><b>Prix total :</b> {detailRes.finalPrice}€{detailRes.discountPercent > 0 ? ` (−${detailRes.discountPercent}%)` : ''}</Typography>
                  <Box />
                  <Typography variant="body2" sx={{ color: depositOverdue ? 'error.main' : 'inherit', fontWeight: depositOverdue ? 700 : 400 }}>
                    <b>Acompte :</b> {detailRes.depositAmount}€ — {detailRes.depositPaid ? '✅ Payé' : '❌ Non payé'}
                    {detailRes.depositDueDate && ` (${displayDate(detailRes.depositDueDate)})`}
                  </Typography>
                  <Typography variant="body2" sx={{ color: balanceOverdue ? 'error.main' : 'inherit', fontWeight: balanceOverdue ? 700 : 400 }}>
                    <b>Solde :</b> {detailRes.balanceAmount}€ — {detailRes.balancePaid ? '✅ Payé' : '❌ Non payé'}
                    {detailRes.balanceDueDate && ` (${displayDate(detailRes.balanceDueDate)})`}
                  </Typography>
                  {detailRes.cautionAmount > 0 && (
                    <Typography variant="body2" sx={{ color: detailRes.cautionReceived ? 'success.main' : 'error.main', fontWeight: 700 }}>
                      <b>Caution :</b> {detailRes.cautionAmount}€ — {detailRes.cautionReceived ? '✅ Reçue' : '❌ Non reçue'}
                    </Typography>
                  )}
                </Box>

                {detailRes.notes && (
                  <Box sx={{ mt: 1 }}>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Notes</Typography>
                    <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>{detailRes.notes}</Typography>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => {
                  navigate(withFrom(`/reservations/${detailRes.id}`, '/'));
                }}>Éditer la réservation</Button>
                <Button onClick={() => setDetailOpen(false)}>Fermer</Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </Box>
  );
}
