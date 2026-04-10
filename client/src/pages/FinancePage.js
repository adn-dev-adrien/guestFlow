import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, Checkbox, Divider, Tabs, Tab
} from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import PageHeader from '../components/PageHeader';
import { displayDate } from '../utils/formatters';
import { PLATFORM_COLORS } from '../constants/platforms';
import api from '../api';

const COLORS = ['#1565c0', '#4CAF50', '#f57c00', '#9c27b0'];

export default function FinancePage() {
  const navigate = useNavigate();
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
  const [properties, setProperties] = useState([]);
  const [upcomingByProperty, setUpcomingByProperty] = useState({});
  const [pendingPayments, setPendingPayments] = useState([]);
  const [financeViewTab, setFinanceViewTab] = useState('overdue');

  useEffect(() => {
    api.getFinanceSummary(from, to).then(setSummary);
  }, [from, to]);

  useEffect(() => {
    api.getFinanceProjection(projectionDate).then(setProjection);
  }, [projectionDate]);

  const loadOperationalFinanceData = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const [props, pending, upcoming] = await Promise.all([
      api.getProperties(),
      api.getPendingPayments(),
      api.getReservations({ from: todayStr }),
    ]);

    setProperties(props);
    setPendingPayments(pending);

    const grouped = {};
    for (const prop of props) {
      grouped[prop.id] = upcoming
        .filter((r) => r.propertyId === prop.id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 5);
    }
    setUpcomingByProperty(grouped);
  };

  useEffect(() => {
    loadOperationalFinanceData();
  }, []);

  const handleTogglePayment = async (reservation, field) => {
    const value = !reservation[field];
    await api.markPayment(reservation.id, { [field]: value });
    const [nextSummary, nextProjection] = await Promise.all([
      api.getFinanceSummary(from, to),
      api.getFinanceProjection(projectionDate),
      loadOperationalFinanceData(),
    ]);
    setSummary(nextSummary);
    setProjection(nextProjection);
  };

  const pieData = summary ? [
    { name: 'Encaissé', value: summary.totalCollected },
    { name: 'Restant', value: summary.totalPending },
  ] : [];

  const barData = summary ? summary.reservations.map(r => ({
    name: `${r.firstName} ${r.lastName}`,
    montant: r.finalPrice,
  })) : [];

  const getRemainingDue = (reservation) => {
    const finalPrice = Number(reservation.finalPrice || 0);
    const depositPaid = reservation.depositPaid ? Number(reservation.depositAmount || 0) : 0;
    const balancePaid = reservation.balancePaid ? Number(reservation.balanceAmount || 0) : 0;
    return Math.round((finalPrice - depositPaid - balancePaid) * 100) / 100;
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const overduePayments = pendingPayments
    .map((r) => {
      const depositOverdue = !r.depositPaid && r.depositDueDate && r.depositDueDate < todayStr;
      const balanceOverdue = !r.balancePaid && r.balanceDueDate && r.balanceDueDate < todayStr;
      const overdueAmount =
        (depositOverdue ? Number(r.depositAmount || 0) : 0)
        + (balanceOverdue ? Number(r.balanceAmount || 0) : 0);

      const oldestDueDate = [r.depositDueDate, r.balanceDueDate]
        .filter(Boolean)
        .sort()[0];

      return {
        ...r,
        depositOverdue,
        balanceOverdue,
        overdueAmount: Math.round(overdueAmount * 100) / 100,
        oldestDueDate,
      };
    })
    .filter((r) => r.depositOverdue || r.balanceOverdue)
    .sort((a, b) => (a.oldestDueDate || '').localeCompare(b.oldestDueDate || ''));
  const overdueReservationsCount = overduePayments.length;
  const overdueTotalAmount = Math.round(
    overduePayments.reduce((sum, r) => sum + Number(r.overdueAmount || 0), 0) * 100
  ) / 100;
  const upcomingReservations = Object.values(upcomingByProperty)
    .flat()
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  return (
    <Box>
      <PageHeader title="Suivi financier" />

      <Card
        sx={{
          mb: 3,
          cursor: 'pointer',
          border: '1px solid',
          borderColor: 'divider',
          transition: 'transform 0.2s, box-shadow 0.2s',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          },
        }}
        onClick={() => navigate('/finance/tourist-tax')}
      >
        <CardContent>
          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>
            Extraction
          </Typography>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Taxe de séjour
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Accéder au calcul mensuel par logement avec total à reverser à la collectivité.
          </Typography>
        </CardContent>
      </Card>

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
          <Box sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Typography variant="h6">Projection à une date</Typography>
            <TextField type="date" value={projectionDate} onChange={e => setProjectionDate(e.target.value)} InputLabelProps={{ shrink: true }} size="small" />
          </Box>
          {projection && (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">Déjà encaissé</Typography>
                  <Typography variant="h5">{projection.collected.toLocaleString('fr-FR')} €</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">À encaisser d'ici cette date</Typography>
                  <Typography variant="h5">{projection.expectedByDate.toLocaleString('fr-FR')} €</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">Total prévu</Typography>
                  <Typography variant="h5">{projection.total.toLocaleString('fr-FR')} €</Typography>
                </Grid>
              </Grid>
              <TableContainer>
                <Table size="small" sx={{ minWidth: 920 }}>
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
                        <TableCell>{displayDate(d.startDate)} → {displayDate(d.endDate)}</TableCell>
                        <TableCell>{d.finalPrice}€</TableCell>
                        <TableCell>
                          {d.depositAmount}€
                          {d.depositPaid ? <Chip label="Payé" size="small" color="success" sx={{ ml: 1 }} /> :
                            <Chip label={`Dû ${displayDate(d.depositDueDate)}`} size="small" color="warning" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell>
                          {d.balanceAmount}€
                          {d.balancePaid ? <Chip label="Payé" size="small" color="success" sx={{ ml: 1 }} /> :
                            <Chip label={`Dû ${displayDate(d.balanceDueDate)}`} size="small" color="warning" sx={{ ml: 1 }} />}
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

      <Divider sx={{ my: 3 }} />
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, gap: 1.5 }}>
            <Typography variant="h6">Suivi opérationnel</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip size="small" color={overdueReservationsCount > 0 ? 'error' : 'success'} label={`${overdueReservationsCount} retard${overdueReservationsCount > 1 ? 's' : ''}`} />
              <Chip size="small" color={overdueTotalAmount > 0 ? 'error' : 'success'} label={`Retard total: ${overdueTotalAmount.toLocaleString('fr-FR')}€`} />
              <Chip size="small" label={`En attente: ${pendingPayments.length}`} />
              <Chip size="small" label={`À venir: ${upcomingReservations.length}`} />
              <Chip size="small" label={`Période: ${(summary?.reservations || []).length}`} />
            </Box>
          </Box>

          <Tabs
            value={financeViewTab}
            onChange={(_, nextTab) => setFinanceViewTab(nextTab)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mt: 1.5, mb: 2 }}
          >
            <Tab value="overdue" label="Paiements en retard" />
            <Tab value="pending" label="Paiements en attente" />
            <Tab value="upcoming" label="Réservations à venir" />
            <Tab value="period" label="Réservations période" />
          </Tabs>

          {financeViewTab === 'overdue' && (
            overduePayments.length === 0 ? (
              <Typography color="text.secondary">Aucun paiement en retard</Typography>
            ) : (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 920 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Éléments en retard</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Montant en retard</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {overduePayments.map((r) => (
                      <TableRow
                        key={`overdue-${r.id}`}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/reservations/${r.id}`)}
                      >
                        <TableCell>{r.firstName} {r.lastName}</TableCell>
                        <TableCell>{r.propertyName}</TableCell>
                        <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                            {r.depositOverdue && (
                              <Chip size="small" color="error" label={`Acompte: ${r.depositAmount}€ (échu ${displayDate(r.depositDueDate)})`} />
                            )}
                            {r.balanceOverdue && (
                              <Chip size="small" color="error" label={`Solde: ${r.balanceAmount}€ (échu ${displayDate(r.balanceDueDate)})`} />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'error.main', fontWeight: 700 }}>{r.overdueAmount}€</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {financeViewTab === 'pending' && (
            pendingPayments.length === 0 ? (
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
                    {pendingPayments.map((r) => {
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
                              <Checkbox checked={!!r.depositPaid} onChange={() => handleTogglePayment(r, 'depositPaid')} size="small" />
                              <Box>
                                <Typography variant="body2" sx={{ color: depositOverdue ? 'error.main' : 'inherit', fontWeight: depositOverdue ? 700 : 400 }}>{r.depositAmount}€</Typography>
                                {r.depositDueDate && <Typography variant="caption" sx={{ color: depositOverdue ? 'error.main' : 'text.secondary', fontWeight: depositOverdue ? 700 : 400 }}>{displayDate(r.depositDueDate)}</Typography>}
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                              <Checkbox checked={!!r.balancePaid} onChange={() => handleTogglePayment(r, 'balancePaid')} size="small" />
                              <Box>
                                <Typography variant="body2" sx={{ color: balanceOverdue ? 'error.main' : 'inherit', fontWeight: balanceOverdue ? 700 : 400 }}>{r.balanceAmount}€</Typography>
                                {r.balanceDueDate && <Typography variant="caption" sx={{ color: balanceOverdue ? 'error.main' : 'text.secondary', fontWeight: balanceOverdue ? 700 : 400 }}>{displayDate(r.balanceDueDate)}</Typography>}
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell align="center">
                            {r.cautionAmount > 0 ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Checkbox checked={!!r.cautionReceived} onChange={() => handleTogglePayment(r, 'cautionReceived')} size="small" />
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
            )
          )}

          {financeViewTab === 'upcoming' && (
            upcomingReservations.length === 0 ? (
              <Typography color="text.secondary">Aucune réservation à venir</Typography>
            ) : (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 880 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Nuits</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Prix</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Reste à payer</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {upcomingReservations.map((r) => {
                      const nights = Math.round((new Date(r.endDate) - new Date(r.startDate)) / 86400000);
                      const remaining = (r.finalPrice || 0)
                        - (r.depositPaid ? (r.depositAmount || 0) : 0)
                        - (r.balancePaid ? (r.balanceAmount || 0) : 0);
                      return (
                        <TableRow key={`upcoming-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{r.propertyName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell>{nights}</TableCell>
                          <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: PLATFORM_COLORS[r.platform], color: 'white' }} /></TableCell>
                          <TableCell>{r.finalPrice}€</TableCell>
                          <TableCell sx={{ color: remaining > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>{remaining}€</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {financeViewTab === 'period' && (
            summary ? (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 920 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Dates</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Prix</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Suivi paiement</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.reservations.map((r) => {
                      const remainingDue = getRemainingDue(r);
                      return (
                        <TableRow key={`period-${r.id}`}>
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{r.propertyName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell><Chip label={r.platform} size="small" /></TableCell>
                          <TableCell>{r.finalPrice}€</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
                              <Chip label={remainingDue > 0 ? `Reste ${remainingDue}€` : 'Complet'} size="small" color={remainingDue > 0 ? 'warning' : 'success'} />
                              <Chip
                                label={`Acompte ${r.depositPaid ? 'payé' : 'non payé'}${r.depositDueDate && !r.depositPaid ? ` (${displayDate(r.depositDueDate)})` : ''}`}
                                size="small"
                                color={r.depositPaid ? 'success' : 'default'}
                                variant={r.depositPaid ? 'filled' : 'outlined'}
                              />
                              <Chip
                                label={`Solde ${r.balancePaid ? 'payé' : 'non payé'}${r.balanceDueDate && !r.balancePaid ? ` (${displayDate(r.balanceDueDate)})` : ''}`}
                                size="small"
                                color={r.balancePaid ? 'success' : 'default'}
                                variant={r.balancePaid ? 'filled' : 'outlined'}
                              />
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography color="text.secondary">Aucune donnée disponible sur cette période</Typography>
            )
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
