import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, TextField, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TableFooter, Chip, Checkbox, Divider, Tabs, Tab,
  Tooltip, IconButton, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from 'recharts';
import PageHeader from '../components/PageHeader';
import ReservationCard from '../components/ReservationCard';
import ReservationSasDialog from '../components/sas/ReservationSasDialog';
import { displayDate } from '../utils/formatters';
import { getPlatformColor } from '../constants/platforms';
import api from '../api';

const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR')} €`;

const RADIAN = Math.PI / 180;
// specs/finance-overview-rework.md §3.4 — the amounts sit INSIDE the camembert (white text at each slice
// centroid) rather than as outer labels.
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
  if (!value) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {eur(value)}
    </text>
  );
};

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
  // specs/finance-overview-rework.md §3.5 — « Réservations à venir » renders the same Planning arrival
  // cards (ReservationCard). The operational payload gives the SET; we fetch each reservation's full
  // detail (options/resources/beds…) exactly as PlanningPage does, then render the cards.
  const [upcomingDetails, setUpcomingDetails] = useState([]);
  const [sas, setSas] = useState(null);

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

  // Fetch the full reservation detail for each upcoming reservation (same source the Planning cards use),
  // so ReservationCard can render beds / family / options / resources / complément / caution.
  useEffect(() => {
    const ups = operational?.upcoming?.reservations || [];
    if (ups.length === 0) { setUpcomingDetails([]); return undefined; }
    let alive = true;
    Promise.all(ups.map((r) => api.getReservation(r.id).catch(() => null)))
      .then((list) => { if (alive) setUpcomingDetails(list.filter(Boolean)); });
    return () => { alive = false; };
  }, [operational]);

  // ReservationCard's « prêt » checkbox — toggles checkInReady (PATCH /payment handles it) + refreshes
  // that card's detail.
  const handleToggleReady = async (r) => {
    await api.markPayment(r.id, { checkInReady: !r.checkInReady });
    const fresh = await api.getReservation(r.id).catch(() => null);
    if (fresh) setUpcomingDetails((list) => list.map((d) => (d.id === r.id ? fresh : d)));
  };

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

  // The server (financeModel.getOperational) owns all overdue/pending/upcoming derivation + column totals.
  const overduePayments = operational?.overdue.reservations || [];
  const overdueReservationsCount = operational?.overdue.count || 0;
  const overdueTotalAmount = operational?.overdue.totalAmount || 0;
  // Hide the « Paiements en retard » tab entirely when nothing is overdue (request 2026-06-16); if it was
  // the selected tab, fall back to « Paiements en attente ».
  const hasOverdue = overdueReservationsCount > 0;
  const activeTab = (!hasOverdue && financeViewTab === 'overdue') ? 'pending' : financeViewTab;
  const pendingPayments = operational?.pending.reservations || [];
  const pendingTotals = operational?.pending.totals || {};
  const upcomingReservations = operational?.upcoming.reservations || [];
  const upcomingTotals = operational?.upcoming.totals || {};

  // specs/finance-overview-rework.md §3.2 / §6 — cards on TWO rows, keeping the primary / green / orange
  // colour language: the two annual cards first, then the three period cards (revenu total / encaissé /
  // en attente). Each card shows its element-by-element HT (server-computed) in smaller text.
  const yearCards = summary ? [
    { label: 'Revenus', caption: "depuis le début de l'année", value: summary.yearToDate, valueHt: summary.yearToDateHt, bg: '#00838f' },
    { label: 'Revenu total', caption: "sur l'année", value: summary.yearTotal, valueHt: summary.yearTotalHt, bg: '#006064' },
  ] : [];
  const periodCards = summary ? [
    { label: 'Revenu total', caption: 'sur la période', value: summary.revenueTotal, valueHt: summary.revenueTotalHt, bg: 'primary.main' },
    { label: 'Encaissé', value: summary.totalCollected, valueHt: summary.totalCollectedHt, bg: '#4CAF50' },
    { label: 'En attente', value: summary.totalPending, valueHt: summary.totalPendingHt, bg: '#f57c00' },
  ] : [];

  const renderCard = (c, size) => (
    <Grid key={c.label} size={size}>
      <Card sx={{ bgcolor: c.bg, color: 'white', height: '100%' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', py: 0.75, '&:last-child': { pb: 0.75 } }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
            {c.label}
            {c.caption && <Typography component="span" variant="caption" sx={{ opacity: 0.85, ml: 0.5, fontWeight: 400 }}>{c.caption}</Typography>}
          </Typography>
          {/* TTC centered both horizontally and vertically; HT right-aligned at the bottom. */}
          <Typography variant="h4" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', my: 0, lineHeight: 1.1 }}>{eur(c.value)}</Typography>
          {c.valueHt != null && (
            <Typography variant="caption" sx={{ opacity: 0.85, textAlign: 'right', mr: 1 }}>{eur(c.valueHt)} HT</Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  );

  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider' };

  const projectionCard = (
    <Accordion defaultExpanded={false} sx={{ mb: 3 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="h6">Projection à une date</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ mb: 2 }}>
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
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} sx={footerCellSx}>Total</TableCell>
                    <TableCell align="right" sx={footerCellSx}>{eur(projection.collected)}</TableCell>
                    <TableCell align="right" sx={footerCellSx}>{eur(projection.total)}</TableCell>
                    <TableCell sx={footerCellSx} />
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );

  return (
    <Box>
      <PageHeader title="Suivi financier" />
      {/* Row 1 — annual cards at the very top (independent of the selected period: 2 across from sm up). */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {yearCards.map((c) => renderCard(c, { xs: 12, sm: 6 }))}
        </Grid>
      )}
      {/* Period selector — drives the period cards + charts below it. */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Du" type="date" value={from} onChange={e => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Au" type="date" value={to} onChange={e => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </CardContent>
      </Card>
      {/* Row 2 — period cards (depend on the du/au range: 3 across from sm up, stacked on xs). */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {periodCards.map((c) => renderCard(c, { xs: 12, sm: 4 }))}
        </Grid>
      )}
      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Revenus par logement</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Période du {displayDate(from)} au {displayDate(to)}
              </Typography>
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
                    {/* Bar height = Σ total de séjour for that logement on the period; the amount is
                        printed inside the bar. */}
                    <Bar dataKey="revenue" fill="#1565c0" name="Total de séjour" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="revenue" position="center" formatter={(value) => eur(value)} fill="#fff" fontSize={12} fontWeight={600} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Répartition</Typography>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" labelLine={false} label={renderPieLabel}>
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
            value={activeTab}
            onChange={(_, nextTab) => setFinanceViewTab(nextTab)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mt: 1.5, mb: 2 }}
          >
            {hasOverdue && <Tab value="overdue" label="Paiements en retard" />}
            <Tab value="pending" label="Paiements en attente" />
            <Tab value="upcoming" label="Réservations à venir" />
            <Tab value="period" label="Réservations période" />
          </Tabs>

          {activeTab === 'overdue' && (
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
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                    <TableCell align="right" sx={{ ...footerCellSx, color: 'error.main' }}>{eur(overdueTotalAmount)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          )}

          {activeTab === 'pending' && (
            pendingPayments.length === 0 ? (
              <Typography color="text.secondary">Aucun paiement en attente</Typography>
            ) : (
              <>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Chip
                  size="small"
                  label={`En attente de paiement : ${eur(pendingTotals.remainingDue)}`}
                  sx={{ bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 600 }}
                />
              </Box>
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
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                      <TableCell align="center" sx={footerCellSx}>{eur(pendingTotals.depositAmount)}</TableCell>
                      <TableCell align="center" sx={footerCellSx}>{eur(pendingTotals.balanceAmount)}</TableCell>
                      <TableCell align="center" sx={footerCellSx}>{eur(pendingTotals.remainingDue)}</TableCell>
                      <TableCell align="right" sx={footerCellSx}>{eur(pendingTotals.totalSejour)}</TableCell>
                      <TableCell sx={footerCellSx} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
              </>
            )
          )}

          {activeTab === 'upcoming' && (
            upcomingReservations.length === 0 ? (
              <Typography color="text.secondary">Aucune réservation à venir</Typography>
            ) : (
              <>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
                <Chip
                  size="small"
                  label={`Total de séjour à venir : ${eur(upcomingTotals.totalSejour)}`}
                  sx={{ bgcolor: '#E3F2FD', color: '#1565c0', fontWeight: 600 }}
                />
              </Box>
              {/* Same arrival cards as the Planning, one after another. */}
              {upcomingDetails.length === 0 ? (
                <Typography color="text.secondary">Chargement…</Typography>
              ) : (
                upcomingDetails.map((r) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    onToggleReady={handleToggleReady}
                    onOpenReservation={(id) => navigate(`/reservations/${id}`)}
                    onOpenSas={(id) => setSas({ reservationId: id, mode: 'arrival' })}
                    onOpenClient={(clientId) => navigate(`/clients?clientId=${clientId}`)}
                  />
                ))
              )}
              </>
            )
          )}

          {activeTab === 'period' && (
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
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                      <TableCell align="right" sx={footerCellSx}>{eur(summary.revenueTotal)}</TableCell>
                      <TableCell sx={footerCellSx} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            ) : (
              <Typography color="text.secondary">Aucune donnée disponible sur cette période</Typography>
            )
          )}
        </CardContent>
      </Card>
      {/* Projection moved to the very end of the page (less central than the operational tracking). */}
      {projectionCard}

      {/* Arrival SAS launched from an upcoming card (same dialog as the Planning). */}
      <ReservationSasDialog
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onCommitted={async () => {
          const id = sas?.reservationId;
          setSas(null);
          if (id) {
            const fresh = await api.getReservation(id).catch(() => null);
            if (fresh) setUpcomingDetails((list) => list.map((d) => (d.id === id ? fresh : d)));
          }
        }}
      />
    </Box>
  );
}
