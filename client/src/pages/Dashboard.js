import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Checkbox, LinearProgress
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import PaymentIcon from '@mui/icons-material/Payment';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import api from '../api';

function displayDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

const PLATFORM_COLORS = {
  direct: '#c9a227', airbnb: '#FF5A5F', greengo: '#4CAF50',
  abritel: '#1565c0', abracadaroom: '#00bcd4', booking: '#003580',
  gitedefrance: '#e6c832', pitchup: '#f57c00'
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upcomingByProperty, setUpcomingByProperty] = useState({});

  useEffect(() => {
    const today = new Date();
    const from = today.toISOString().split('T')[0];
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 30);
    const to = toDate.toISOString().split('T')[0];

    Promise.all([
      api.getProperties(),
      api.getReservations({ from, to }),
      api.getPendingPayments(),
      api.getFinanceSummary(from, to),
      api.getReservations({ from }),
    ]).then(([props, resv, pending, fin, allUpcoming]) => {
      setProperties(props);
      setReservations(resv);
      setPendingPayments(pending);
      setSummary(fin);

      const grouped = {};
      for (const prop of props) {
        grouped[prop.id] = allUpcoming
          .filter(r => r.propertyId === prop.id)
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .slice(0, 5);
      }
      setUpcomingByProperty(grouped);
      setLoading(false);
    });
  }, []);

  const handleTogglePayment = async (r, field) => {
    const value = !r[field];
    await api.markPayment(r.id, { [field]: value });
    // Refresh
    const today = new Date();
    const from = today.toISOString().split('T')[0];
    const toDate = new Date(today); toDate.setDate(toDate.getDate() + 30);
    const [pending, fin, allUpcoming] = await Promise.all([
      api.getPendingPayments(),
      api.getFinanceSummary(from, toDate.toISOString().split('T')[0]),
      api.getReservations({ from }),
    ]);
    setPendingPayments(pending);
    setSummary(fin);
    const grouped = {};
    for (const prop of properties) {
      grouped[prop.id] = allUpcoming
        .filter(u => u.propertyId === prop.id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 5);
    }
    setUpcomingByProperty(grouped);
  };

  // Build timeline days (30 days)
  const today = new Date();
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }

  if (loading) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Tableau de bord</Typography>

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
              <PaymentIcon sx={{ fontSize: 40, color: '#f57c00' }} />
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Reste à encaisser (30j)</Typography>
                <Typography variant="h4">{summary ? summary.totalPending.toLocaleString('fr-FR') : 0} €</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Combined timeline calendar */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Calendrier cumulé — 30 prochains jours</Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: `180px repeat(${days.length}, minmax(36px, 1fr))`, gap: 0.5, minWidth: days.length * 38 + 180 }}>
              {/* Header row: dates */}
              <Box sx={{ fontWeight: 600, py: 1 }}>Logement</Box>
              {days.map(d => {
                const date = new Date(d);
                return (
                  <Box key={d} sx={{ textAlign: 'center', fontSize: 10, py: 1, color: 'text.secondary' }}>
                    <Box>{date.getDate()}</Box>
                    <Box>{['Di','Lu','Ma','Me','Je','Ve','Sa'][date.getDay()]}</Box>
                  </Box>
                );
              })}

              {/* One row per property */}
              {properties.map(prop => (
                <React.Fragment key={prop.id}>
                  <Box sx={{ py: 1, fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center' }}>
                    {prop.name}
                  </Box>
                  {days.map(d => {
                    const res = reservations.find(r => r.propertyId === prop.id && d >= r.startDate && d < r.endDate);
                    return (
                      <Box
                        key={d}
                        sx={{
                          borderRadius: 0.5,
                          bgcolor: res ? (PLATFORM_COLORS[res.platform] || '#757575') : 'grey.100',
                          minHeight: 28,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={res ? `${res.firstName} ${res.lastName} (${res.platform})` : ''}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Upcoming reservations per property */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Réservations à venir</Typography>
          {properties.map(prop => {
            const upcoming = upcomingByProperty[prop.id] || [];
            if (upcoming.length === 0) return null;
            return (
              <Box key={prop.id} sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>{prop.name}</Typography>
                <TableContainer>
                  <Table size="small">
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
                          onClick={() => {
                            const d = new Date(r.startDate);
                            navigate(`/calendar?propertyId=${r.propertyId}&year=${d.getFullYear()}&month=${d.getMonth()}`);
                          }}
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
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Paiements en attente</Typography>
          {pendingPayments.length === 0 ? (
            <Typography color="text.secondary">Aucun paiement en attente</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Prix total</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Acompte</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Solde</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Caution</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pendingPayments.map(r => (
                    <TableRow key={r.id} hover>
                      <TableCell>{r.firstName} {r.lastName}</TableCell>
                      <TableCell>{r.propertyName}</TableCell>
                      <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                      <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: PLATFORM_COLORS[r.platform], color: 'white' }} /></TableCell>
                      <TableCell>{r.finalPrice}€</TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Checkbox
                            checked={!!r.depositPaid}
                            onChange={() => handleTogglePayment(r, 'depositPaid')}
                            size="small"
                          />
                          <Typography variant="body2">{r.depositAmount}€</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                          <Checkbox
                            checked={!!r.balancePaid}
                            onChange={() => handleTogglePayment(r, 'balancePaid')}
                            size="small"
                          />
                          <Typography variant="body2">{r.balanceAmount}€</Typography>
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
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
