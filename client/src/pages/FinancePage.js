import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, Checkbox, Divider, Tabs, Tab,
  Tooltip, IconButton
} from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import PageHeader from '../components/PageHeader';
import { displayDate } from '../utils/formatters';
import { getPlatformColor } from '../constants/platforms';
import api from '../api';

const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR')} €`;

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
  // specs/finance-overview-rework.md §3.4 — the projection date defaults to today + 1 month.
  const [projectionDate, setProjectionDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  });
  const [summary, setSummary] = useState(null);
  const [projection, setProjection] = useState(null);
  const [operational, setOperational] = useState(null);
  const [financeViewTab, setFinanceViewTab] = useState('overdue');

  useEffect(() => {
    api.getFinanceSummary(from, to).then(setSummary);
  }, [from, to]);

  useEffect(() => {
    api.getFinanceProjection(projectionDate).then(setProjection);
  }, [projectionDate]);

  const loadOperational = async () => {
    setOperational(await api.getFinanceOperational());
  };

  useEffect(() => {
    loadOperational();
  }, []);

  const refreshAll = async () => {
    const [nextSummary, nextProjection] = await Promise.all([
      api.getFinanceSummary(from, to),
      api.getFinanceProjection(projectionDate),
      loadOperational(),
    ]);
    setSummary(nextSummary);
    setProjection(nextProjection);
  };

  const handleTogglePayment = async (reservation, field) => {
    await api.markPayment(reservation.id, { [field]: !reservation[field] });
    await refreshAll();
  };

  // specs/finance-overview-rework.md §3.6 — « Tout solder » marks every still-open component paid so the
  // reservation becomes settled and leaves the pending list. One PATCH carries all the fields at once.
  const handleSettleAll = async (r) => {
    const payload = {};
    if (!r.depositDisabled && Number(r.depositAmount || 0) > 0 && !r.depositPaid) payload.depositPaid = true;
    if (Number(r.balanceAmount || 0) > 0 && !r.balancePaid) payload.balancePaid = true;
    if (Number(r.complementAmount || 0) > 0 && !r.complementPaid) payload.complementPaid = true;
    if (Number(r.endOfStayComplementAmount || 0) > 0 && !r.endOfStayComplementPaid) payload.endOfStayComplementPaid = true;
    if (Object.keys(payload).length === 0) return;
    await api.markPayment(r.id, payload);
    await refreshAll();
  };

  // specs/finance-overview-rework.md §3.4 — pie of « Encaissé » vs « En attente » (the two card figures).
  const pieData = summary ? [
    { name: 'Encaissé', value: summary.totalCollected, fill: '#4CAF50' },
    { name: 'En attente', value: summary.totalPending, fill: '#f57c00' },
  ] : [];

  // specs/finance-overview-rework.md §3.4 — Σ « total de séjour » per logement over the period; a single
  // value per property (no collected/pending split).
  const barData = summary?.revenueByProperty?.map((p) => ({ name: p.propertyName, revenue: p.revenue })) || [];

  // The server (financeModel.getOperational) owns all overdue/pending/upcoming derivation.
  const overduePayments = operational?.overdue.reservations || [];
  const overdueReservationsCount = operational?.overdue.count || 0;
  const overdueTotalAmount = operational?.overdue.totalAmount || 0;
  const pendingPayments = operational?.pending.reservations || [];
  const upcomingReservations = operational?.upcoming.reservations || [];

  // specs/finance-overview-rework.md §3.2 — five cards: the two year cards first, then période / encaissé /
  // en attente, keeping the primary / green / orange colour language.
  const cards = summary ? [
    { label: "Revenus depuis le début de l'année", value: summary.yearToDate, bg: '#00838f' },
    { label: "Revenu total sur l'année", value: summary.yearTotal, bg: '#006064' },
    { label: 'Revenu total', caption: 'sur la période', value: summary.revenueTotal, bg: 'primary.main' },
    { label: 'Encaissé', value: summary.totalCollected, bg: '#4CAF50' },
    { label: 'En attente', value: summary.totalPending, bg: '#f57c00' },
  ] : [];

  // A money component (acompte / solde / complément / complément fin de séjour) for the upcoming list:
  // amount tinted green once paid (or « caisse » when settled off-books), em-dash when there's nothing due.
  const renderComponent = (amount, paid, cash, disabled) => {
    if (disabled) return <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>Désactivé</Typography>;
    if (!amount || Number(amount) === 0) return <Typography variant="body2" color="text.disabled">—</Typography>;
    const settledHere = paid || cash;
    return (
      <Box>
        <Typography variant="body2" sx={{ color: settledHere ? 'success.main' : 'text.primary', fontWeight: settledHere ? 600 : 400 }}>{amount}€</Typography>
        {cash ? <Typography variant="caption" color="warning.main">caisse</Typography>
          : (paid ? <Typography variant="caption" color="success.main">payé</Typography> : null)}
      </Box>
    );
  };

  return (
    <Box>
      <PageHeader title="Suivi financier" />
      {/* Period selector */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Du" type="date" value={from} onChange={e => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Au" type="date" value={to} onChange={e => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </CardContent>
      </Card>
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {cards.map((c) => (
            <Grid key={c.label} size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
              <Card sx={{ bgcolor: c.bg, color: 'white', height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle2">{c.label}</Typography>
                  {c.caption && <Typography variant="caption" sx={{ opacity: 0.85, display: 'block' }}>{c.caption}</Typography>}
                  <Typography variant="h4">{eur(c.value)}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Revenus par logement</Typography>
              {barData.length === 0 ? (
                <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Aucun revenu sur la période sélectionnée.
                  </Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <RechartsTooltip formatter={(value) => eur(value)} />
                    {/* Bar height = Σ total de séjour for that logement on the period. */}
                    <Bar dataKey="revenue" fill="#1565c0" name="Total de séjour" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Répartition</Typography>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${eur(value)}`}>
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Pie>
                  <Legend />
                  <RechartsTooltip formatter={(value) => eur(value)} />
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
            <TextField type="date" value={projectionDate} onChange={e => setProjectionDate(e.target.value)} size="small" slotProps={{ inputLabel: { shrink: true } }} />
          </Box>
          {projection && (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Typography variant="subtitle2" color="text.secondary">Total de séjour d'ici cette date</Typography>
                  <Typography variant="h5">{eur(projection.total)}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Typography variant="subtitle2" color="text.secondary">Déjà encaissé</Typography>
                  <Typography variant="h5">{eur(projection.collected)}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Typography variant="subtitle2" color="text.secondary">En attente</Typography>
                  <Typography variant="h5">{eur(projection.pending)}</Typography>
                </Grid>
              </Grid>
              <TableContainer>
                <Table size="small" sx={{ minWidth: 760 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Encaissé</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">État</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projection.details.map((d) => (
                      <TableRow key={d.reservationId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${d.reservationId}`)}>
                        <TableCell>{d.clientName}</TableCell>
                        <TableCell>{d.propertyName}</TableCell>
                        <TableCell>{displayDate(d.startDate)} → {displayDate(d.endDate)}</TableCell>
                        <TableCell align="right">{eur(d.collected)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{eur(d.totalSejour)}</TableCell>
                        <TableCell align="center">
                          <Chip size="small" label={d.settled ? 'Réglé' : 'En attente'} color={d.settled ? 'success' : 'warning'} variant={d.settled ? 'filled' : 'outlined'} />
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
              <Chip size="small" color={overdueTotalAmount > 0 ? 'error' : 'success'} label={`Retard total: ${eur(overdueTotalAmount)}`} />
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
                      <TableRow key={`overdue-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
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
                      <TableCell sx={{ fontWeight: 600 }} align="center">Acompte</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Solde</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Reste à payer</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Solder</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingPayments.map((r) => {
                      const { depositOverdue, balanceOverdue, remainingDue } = r;
                      const stop = (e) => e.stopPropagation();
                      return (
                        <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{r.propertyName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: getPlatformColor(r.platform), color: 'white' }} /></TableCell>
                          <TableCell align="center" onClick={stop}>
                            {r.depositDisabled ? (
                              <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>Désactivé</Typography>
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Checkbox checked={!!r.depositPaid} onChange={() => handleTogglePayment(r, 'depositPaid')} size="small" />
                                <Box>
                                  <Typography variant="body2" sx={{ color: depositOverdue ? 'error.main' : 'inherit', fontWeight: depositOverdue ? 700 : 400 }}>{r.depositAmount}€</Typography>
                                  {r.depositDueDate && <Typography variant="caption" sx={{ color: depositOverdue ? 'error.main' : 'text.secondary', fontWeight: depositOverdue ? 700 : 400 }}>{displayDate(r.depositDueDate)}</Typography>}
                                </Box>
                              </Box>
                            )}
                          </TableCell>
                          <TableCell align="center" onClick={stop}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                              <Checkbox checked={!!r.balancePaid} onChange={() => handleTogglePayment(r, 'balancePaid')} size="small" />
                              <Box>
                                <Typography variant="body2" sx={{ color: balanceOverdue ? 'error.main' : 'inherit', fontWeight: balanceOverdue ? 700 : 400 }}>{r.balanceAmount}€</Typography>
                                {r.balanceDueDate && <Typography variant="caption" sx={{ color: balanceOverdue ? 'error.main' : 'text.secondary', fontWeight: balanceOverdue ? 700 : 400 }}>{displayDate(r.balanceDueDate)}</Typography>}
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={{ color: remainingDue > 0 ? 'error.main' : 'success.main', fontWeight: 700 }}>
                            {Math.round(remainingDue * 100) / 100}€
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{eur(r.totalSejour)}</TableCell>
                          <TableCell align="center" onClick={stop}>
                            <Tooltip title="Tout solder">
                              <IconButton size="small" color="success" onClick={() => handleSettleAll(r)} aria-label="Tout solder">
                                <DoneAllIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
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
                <Table size="small" sx={{ minWidth: 1180 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Nuits</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Acompte</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Solde</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Complément</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Compl. fin de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">Payé</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {upcomingReservations.map((r) => (
                      <TableRow key={`upcoming-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                        <TableCell>{r.firstName} {r.lastName}</TableCell>
                        <TableCell>{r.propertyName}</TableCell>
                        <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                        <TableCell>{r.nights}</TableCell>
                        <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: getPlatformColor(r.platform), color: 'white' }} /></TableCell>
                        <TableCell align="center">{renderComponent(r.depositAmount, r.depositPaid, false, r.depositDisabled)}</TableCell>
                        <TableCell align="center">{renderComponent(r.balanceAmount, r.balancePaid, false, false)}</TableCell>
                        <TableCell align="center">{renderComponent(r.complementAmount, r.complementPaid, r.complementPaidCash, false)}</TableCell>
                        <TableCell align="center">{renderComponent(r.endOfStayComplementAmount, r.endOfStayComplementPaid, r.endOfStayComplementPaidCash, false)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{eur(r.totalSejour)}</TableCell>
                        <TableCell align="center">
                          <Chip size="small" label={r.settled ? 'Payé' : `Reste ${Math.round((r.remainingDue || 0) * 100) / 100}€`} color={r.settled ? 'success' : 'warning'} variant={r.settled ? 'filled' : 'outlined'} />
                        </TableCell>
                      </TableRow>
                    ))}
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
                      <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Suivi paiement</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.reservations.map((r) => {
                      const remainingDue = r.remainingDue;
                      return (
                        <TableRow key={`period-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{r.propertyName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: getPlatformColor(r.platform), color: 'white' }} /></TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{eur(r.totalSejour)}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
                              {/* settled honours caisse interne (§3.6): a complement paid off-books shows « Réglé ». */}
                              <Chip label={r.settled ? 'Réglé' : `Reste ${Math.round((remainingDue || 0) * 100) / 100}€`} size="small" color={r.settled ? 'success' : 'warning'} />
                              {r.depositDisabled ? (
                                <Chip label="Acompte désactivé" size="small" variant="outlined" sx={{ fontStyle: 'italic' }} />
                              ) : (
                                <Chip
                                  label={`Acompte ${r.depositPaid ? 'payé' : 'non payé'}${r.depositDueDate && !r.depositPaid ? ` (${displayDate(r.depositDueDate)})` : ''}`}
                                  size="small"
                                  color={r.depositPaid ? 'success' : 'default'}
                                  variant={r.depositPaid ? 'filled' : 'outlined'}
                                />
                              )}
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
