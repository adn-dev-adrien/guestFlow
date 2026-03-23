import React, { useEffect, useState } from 'react';
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
  direct: '#1565c0', airbnb: '#FF5A5F', greengo: '#4CAF50',
  abritel: '#f57c00', abracadaroom: '#9c27b0', booking: '#003580'
};

export default function Dashboard() {
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

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
      api.getFinanceSummary(from, to)
    ]).then(([props, resv, pending, fin]) => {
      setProperties(props);
      setReservations(resv);
      setPendingPayments(pending);
      setSummary(fin);
      setLoading(false);
    });
  }, []);

  const handleTogglePayment = async (r, field) => {
    const value = !r[field];
    await api.markPayment(r.id, { [field]: value });
    // Refresh
    const pending = await api.getPendingPayments();
    setPendingPayments(pending);
    const today = new Date();
    const from = today.toISOString().split('T')[0];
    const toDate = new Date(today); toDate.setDate(toDate.getDate() + 30);
    const fin = await api.getFinanceSummary(from, toDate.toISOString().split('T')[0]);
    setSummary(fin);
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
