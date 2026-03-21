import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip
} from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../api';

const COLORS = ['#1565c0', '#4CAF50', '#f57c00', '#9c27b0'];

export default function FinancePage() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
    return d.toISOString().split('T')[0];
  });
  const [projectionDate, setProjectionDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [projection, setProjection] = useState(null);

  useEffect(() => {
    api.getFinanceSummary(from, to).then(setSummary);
  }, [from, to]);

  useEffect(() => {
    api.getFinanceProjection(projectionDate).then(setProjection);
  }, [projectionDate]);

  const pieData = summary ? [
    { name: 'Encaissé', value: summary.totalCollected },
    { name: 'Restant', value: summary.totalPending },
  ] : [];

  const barData = summary ? summary.reservations.map(r => ({
    name: `${r.firstName} ${r.lastName}`,
    montant: r.finalPrice,
  })) : [];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Suivi financier</Typography>

      {/* Period selector */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Du" type="date" value={from} onChange={e => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="Au" type="date" value={to} onChange={e => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        </CardContent>
      </Card>

      {summary && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
              <CardContent>
                <Typography variant="subtitle2">Revenu total</Typography>
                <Typography variant="h4">{summary.totalRevenue.toLocaleString('fr-FR')} €</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card sx={{ bgcolor: '#4CAF50', color: 'white' }}>
              <CardContent>
                <Typography variant="subtitle2">Encaissé</Typography>
                <Typography variant="h4">{summary.totalCollected.toLocaleString('fr-FR')} €</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card sx={{ bgcolor: '#f57c00', color: 'white' }}>
              <CardContent>
                <Typography variant="subtitle2">En attente</Typography>
                <Typography variant="h4">{summary.totalPending.toLocaleString('fr-FR')} €</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Revenus par réservation</Typography>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="montant" fill="#1565c0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Répartition</Typography>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}€`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Projection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Projection à une date</Typography>
            <TextField type="date" value={projectionDate} onChange={e => setProjectionDate(e.target.value)} InputLabelProps={{ shrink: true }} size="small" />
          </Box>
          {projection && (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={4}>
                  <Typography variant="subtitle2" color="text.secondary">Déjà encaissé</Typography>
                  <Typography variant="h5">{projection.collected.toLocaleString('fr-FR')} €</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="subtitle2" color="text.secondary">À encaisser d'ici cette date</Typography>
                  <Typography variant="h5">{projection.expectedByDate.toLocaleString('fr-FR')} €</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="subtitle2" color="text.secondary">Total prévu</Typography>
                  <Typography variant="h5">{projection.total.toLocaleString('fr-FR')} €</Typography>
                </Grid>
              </Grid>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Prix final</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Acompte</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Solde</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projection.details.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>{d.clientName}</TableCell>
                        <TableCell>{d.propertyName}</TableCell>
                        <TableCell>{d.startDate} → {d.endDate}</TableCell>
                        <TableCell>{d.finalPrice}€</TableCell>
                        <TableCell>
                          {d.depositAmount}€
                          {d.depositPaid ? <Chip label="Payé" size="small" color="success" sx={{ ml: 1 }} /> :
                            <Chip label={`Dû ${d.depositDueDate}`} size="small" color="warning" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell>
                          {d.balanceAmount}€
                          {d.balancePaid ? <Chip label="Payé" size="small" color="success" sx={{ ml: 1 }} /> :
                            <Chip label={`Dû ${d.balanceDueDate}`} size="small" color="warning" sx={{ ml: 1 }} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detailed reservation list for period */}
      {summary && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Détails des réservations sur la période</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Dates</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Prix</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Acompte</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Solde</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.reservations.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.firstName} {r.lastName}</TableCell>
                      <TableCell>{r.propertyName}</TableCell>
                      <TableCell>{r.startDate} → {r.endDate}</TableCell>
                      <TableCell><Chip label={r.platform} size="small" /></TableCell>
                      <TableCell>{r.finalPrice}€</TableCell>
                      <TableCell>
                        {r.depositAmount}€
                        <Chip label={r.depositPaid ? 'Payé' : 'Non payé'} size="small" color={r.depositPaid ? 'success' : 'warning'} sx={{ ml: 1 }} />
                      </TableCell>
                      <TableCell>
                        {r.balanceAmount}€
                        <Chip label={r.balancePaid ? 'Payé' : 'Non payé'} size="small" color={r.balancePaid ? 'success' : 'warning'} sx={{ ml: 1 }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
