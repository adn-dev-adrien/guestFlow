import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Checkbox,
  Button, Divider, TextField, Tooltip, IconButton, Stack, TableRow, TableCell,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import EventIcon from '@mui/icons-material/Event';
import TodayIcon from '@mui/icons-material/Today';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageActionBar from '../components/PageActionBar';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import CumulativeMonthCalendar from '../components/CumulativeMonthCalendar';
import LinenShortageAlert from '../components/LinenShortageAlert';
import IcalDateDriftAlert from '../components/IcalDateDriftAlert';
import IcalCancellationAlert from '../components/IcalCancellationAlert';
import IcalNewReservationsAlert from '../components/IcalNewReservationsAlert';
import EmailPendingAlert from '../components/EmailPendingAlert';
import DevisPublicRequestAlert from '../components/DevisPublicRequestAlert';
import { useToast } from '../components/DialogProvider';
import { displayDate, formatCurrency } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import api from '../api';

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// Row/card background reflecting the check-in/out status (done = greyed, ready = green tint).
const statusBgSx = (t, done, ready = false) => {
  if (done) return { bgcolor: alpha(t.palette.grey[500], 0.18) };
  if (ready) return { bgcolor: alpha(t.palette.success.main, 0.1) };
  return {};
};

const optionsResourcesText = (r) => {
  const optionsText = (r.options || []).map((o) => `${o.title} x${o.quantity}`).join(', ');
  const resourcesText = [
    ...(Number(r.babyBeds || 0) > 0 ? [`Lit bebe x${r.babyBeds}`] : []),
    ...(r.resources || []).map((rr) => `${rr.name} x${rr.quantity}`),
  ].join(', ');
  return [optionsText, resourcesText].filter(Boolean).join(' | ') || '—';
};

/* Per-reservation depositDisabled (specs/disable-deposit-per-reservation.md): when the deposit is
   opted out for this reservation, "Acompte NON" would be misleading — there is literally nothing to
   collect. Render the row as if the deposit was already OK so only the Solde line drives the alert. */
const arrivalPaymentText = (r) => (r.paymentComplete
  ? 'OK'
  : `Manquant ${formatCurrency(r.remainingDue)} • Acompte ${r.depositPaid || r.depositDisabled ? 'OK' : 'NON'} • Solde ${r.balancePaid ? 'OK' : 'NON'}`);

export default function Dashboard() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [arrivalsToday, setArrivalsToday] = useState([]);
  const [departuresToday, setDeparturesToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Shared optimistic toggle for check-in/out status fields
  const handleToggleStatus = async (r, field, setList) => {
    const value = !r[field];
    try {
      await api.markPayment(r.id, { [field]: value });
      setList((prev) => prev.map((item) => item.id === r.id ? { ...item, [field]: value } : item));
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  };

  // Checking "Arrivé" also auto-sets "Prêt" if not already set
  const handleCheckInDone = async (r) => {
    const newDone = !r.checkInDone;
    const updates = { checkInDone: newDone };
    if (newDone && !r.checkInReady) updates.checkInReady = true;
    try {
      await api.markPayment(r.id, updates);
      setArrivalsToday((prev) =>
        prev.map((item) => item.id === r.id ? { ...item, ...updates } : item)
      );
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
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

    try {
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
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedDate, reloadNonce]); // eslint-disable-line

  const todayStr = new Date().toISOString().split('T')[0];

  const openReservation = (r) => navigate(withFrom(`/reservations/${r.id}`, '/'));

  // Date cluster — rendered in the bar `center` on sm+ and as a compact strip under the bar on xs
  // (PageActionBar hides `center` on xs). specs/ds-sweep-planning.md rule 1.
  const renderDateNav = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton size="small" onClick={() => setSelectedDate((d) => addDays(d, -1))} aria-label="Jour précédent">
        <NavigateBeforeIcon />
      </IconButton>
      <TextField
        type="date"
        size="small"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
        sx={{ width: 165 }}
        slotProps={{ htmlInput: { style: { padding: '6px 10px' }, 'aria-label': 'Date affichée' } }}
      />
      <IconButton size="small" onClick={() => setSelectedDate((d) => addDays(d, 1))} aria-label="Jour suivant">
        <NavigateNextIcon />
      </IconButton>
      {selectedDate !== todayStr && (
        <Button size="small" variant="outlined" onClick={() => setSelectedDate(todayStr)}>
          Aujourd'hui
        </Button>
      )}
    </Box>
  );

  // KPI tiles — neutral « Maison » (phase-4 precedent; specs/ds-sweep-planning.md rule 18).
  const kpiCards = [
    { label: 'Logements', value: properties.length, icon: HomeWorkIcon, accent: 'primary.main', to: '/properties' },
    { label: 'Réservations (30j)', value: reservations.length, icon: EventIcon, accent: 'secondary.main', to: '/reservations/upcoming' },
    { label: 'Arrivées (date sélectionnée)', value: arrivalsToday.length, icon: TodayIcon, accent: 'warning.main', to: '/planning' },
  ];

  const checkboxCell = (title, checked, onChange, checkboxSx) => (
    <Tooltip title={title}>
      <Checkbox size="small" checked={checked} onChange={onChange} sx={checkboxSx} />
    </Tooltip>
  );

  const arrivalsHead = (
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
  );

  const renderArrivalRow = (r) => {
    const paymentOk = r.paymentComplete;
    const cautionOk = Number(r.cautionAmount || 0) <= 0 || !!r.cautionReceived;
    return (
      <TableRow
        key={r.id}
        hover
        sx={(t) => ({ ...statusBgSx(t, r.checkInDone, r.checkInReady), cursor: 'pointer' })}
        onClick={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('.MuiCheckbox-root')) return; openReservation(r); }}
      >
        <TableCell padding="checkbox">
          {checkboxCell('Logement prêt', !!r.checkInReady, () => handleToggleStatus(r, 'checkInReady', setArrivalsToday), { color: 'success.main', '&.Mui-checked': { color: 'success.main' } })}
        </TableCell>
        <TableCell padding="checkbox">
          {checkboxCell('Locataires arrivés', !!r.checkInDone, () => handleCheckInDone(r))}
        </TableCell>
        <TableCell>{r.checkInTime || '15:00'}</TableCell>
        <TableCell>{r.propertyName}</TableCell>
        <TableCell>{r.firstName} {r.lastName}</TableCell>
        <TableCell>
          {`D:${Number(r.doubleBeds || 0)} / S:${Number(r.singleBeds || 0)} / B:${Number(r.babyBeds || 0)}`}
        </TableCell>
        <TableCell>{optionsResourcesText(r)}</TableCell>
        <TableCell>{r.notes || '—'}</TableCell>
        <TableCell sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
          {arrivalPaymentText(r)}
        </TableCell>
        <TableCell sx={{ color: cautionOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
          {Number(r.cautionAmount || 0) > 0
            ? (cautionOk ? `OK (${formatCurrency(r.cautionAmount)})` : `NON (${formatCurrency(r.cautionAmount)})`)
            : '—'}
        </TableCell>
      </TableRow>
    );
  };

  // The -m/+p box paints the status tint edge-to-edge inside ResponsiveTable's padded card.
  const renderArrivalCard = (r) => {
    const paymentOk = r.paymentComplete;
    const cautionOk = Number(r.cautionAmount || 0) <= 0 || !!r.cautionReceived;
    return (
      <Box sx={(t) => ({ m: -1.5, p: 1.5, ...statusBgSx(t, r.checkInDone, r.checkInReady) })}>
        <Stack spacing={0.5}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
              {r.checkInTime || '15:00'} · {r.propertyName}
            </Typography>
            <Box onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
              {checkboxCell('Logement prêt', !!r.checkInReady, () => handleToggleStatus(r, 'checkInReady', setArrivalsToday), { color: 'success.main', '&.Mui-checked': { color: 'success.main' } })}
              {checkboxCell('Locataires arrivés', !!r.checkInDone, () => handleCheckInDone(r))}
            </Box>
          </Stack>
          <Typography variant="body2">{r.firstName} {r.lastName}</Typography>
          <Typography variant="caption" color="text.secondary">
            Lits : D:{Number(r.doubleBeds || 0)} / S:{Number(r.singleBeds || 0)} / B:{Number(r.babyBeds || 0)}
          </Typography>
          {optionsResourcesText(r) !== '—' && (
            <Typography variant="caption" color="text.secondary">{optionsResourcesText(r)}</Typography>
          )}
          {r.notes && <Typography variant="caption" color="text.secondary">Note : {r.notes}</Typography>}
          <Typography variant="caption" sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
            {arrivalPaymentText(r)}
          </Typography>
          {Number(r.cautionAmount || 0) > 0 && (
            <Typography variant="caption" sx={{ color: cautionOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
              Caution {cautionOk ? 'OK' : 'NON'} ({formatCurrency(r.cautionAmount)})
            </Typography>
          )}
        </Stack>
      </Box>
    );
  };

  const departuresHead = (
    <TableRow>
      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Parti</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Heure</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Options / Ressources</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
      <TableCell sx={{ fontWeight: 600 }}>Paiements</TableCell>
    </TableRow>
  );

  const renderDepartureRow = (r) => {
    const paymentOk = r.paymentComplete;
    return (
      <TableRow
        key={r.id}
        hover
        sx={(t) => ({ ...statusBgSx(t, r.checkOutDone), cursor: 'pointer' })}
        onClick={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('.MuiCheckbox-root')) return; openReservation(r); }}
      >
        <TableCell padding="checkbox">
          {checkboxCell('Départ effectué', !!r.checkOutDone, () => handleToggleStatus(r, 'checkOutDone', setDeparturesToday))}
        </TableCell>
        <TableCell>{r.checkOutTime || '10:00'}</TableCell>
        <TableCell>{r.propertyName}</TableCell>
        <TableCell>{r.firstName} {r.lastName}</TableCell>
        <TableCell>{optionsResourcesText(r)}</TableCell>
        <TableCell>{r.notes || '—'}</TableCell>
        <TableCell sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
          {paymentOk ? 'OK' : `En attente: ${formatCurrency(r.remainingDue)}`}
        </TableCell>
      </TableRow>
    );
  };

  const renderDepartureCard = (r) => {
    const paymentOk = r.paymentComplete;
    return (
      <Box sx={(t) => ({ m: -1.5, p: 1.5, ...statusBgSx(t, r.checkOutDone) })}>
        <Stack spacing={0.5}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
              {r.checkOutTime || '10:00'} · {r.propertyName}
            </Typography>
            <Box onClick={(e) => e.stopPropagation()}>
              {checkboxCell('Départ effectué', !!r.checkOutDone, () => handleToggleStatus(r, 'checkOutDone', setDeparturesToday))}
            </Box>
          </Stack>
          <Typography variant="body2">{r.firstName} {r.lastName}</Typography>
          {optionsResourcesText(r) !== '—' && (
            <Typography variant="caption" color="text.secondary">{optionsResourcesText(r)}</Typography>
          )}
          {r.notes && <Typography variant="caption" color="text.secondary">Note : {r.notes}</Typography>}
          <Typography variant="caption" sx={{ color: paymentOk ? 'success.main' : 'error.main', fontWeight: 700 }}>
            {paymentOk ? 'Paiements OK' : `En attente: ${formatCurrency(r.remainingDue)}`}
          </Typography>
        </Stack>
      </Box>
    );
  };

  return (
    <Box>
      <PageActionBar title="Tableau de bord" titleOnXs center={renderDateNav()} />
      {/* xs fallback for the bar's hidden `center` — same date cluster, compact strip. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {renderDateNav()}
      </Box>

      {/* §3.7 linen shortage alert (specs/linen-inventory-shortage-tracking.md §6.3). Self-
          contained: renders nothing when no shortage is projected. */}
      <LinenShortageAlert />
      {/* iCal locked-date drift approvals (specs/ical-sync-override-locked-dates.md §6.1).
          Self-contained: renders nothing when no pending drift exists. */}
      <IcalDateDriftAlert />
      {/* iCal cancellation approvals (specs/ical-cancellation-approval.md §6.1). Self-
          contained: renders nothing when no pending cancellation exists. */}
      <IcalCancellationAlert />
      {/* New iCal reservations imported today (specs/dashboard-ical-new-reservations.md). Read-only
          notification; renders nothing when nothing was imported today. */}
      <IcalNewReservationsAlert />
      {/* Manual email queue (specs/email-automation.md §6.2). Self-contained: renders
          nothing when no manual email is pending. */}
      <EmailPendingAlert />
      {/* Site-origin devis pending handling (specs/site-booking-notifications.md §3 rule 5).
          Self-contained: renders nothing when there is no pending website request. */}
      <DevisPublicRequestAlert />

      {loadError ? (
        <ErrorAlert message="Impossible de charger le tableau de bord." onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 3 }} />
      ) : loading ? (
        <LoadingState label="Chargement du tableau de bord…" />
      ) : (
        <>
          {/* Summary cards — neutral « Maison » KPI tiles */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {kpiCards.map((c) => {
              const Icon = c.icon;
              return (
                <Grid key={c.label} size={{ xs: 12, sm: 4 }}>
                  <Card
                    onClick={() => navigate(c.to)}
                    sx={{
                      height: '100%',
                      cursor: 'pointer',
                      borderLeft: '3px solid',
                      borderColor: c.accent,
                      transition: 'transform .1s, box-shadow .1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
                    }}
                  >
                    <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Icon sx={{ fontSize: 40, color: c.accent }} />
                      <Box>
                        <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>{c.label}</Typography>
                        <Typography variant="kpiValue">{c.value}</Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {/* Daily arrivals / departures */}
          <Stack spacing={3} sx={{ mb: 3 }}>
            <Box>
              <Typography variant="sectionHeader" gutterBottom>Arrivées — {displayDate(selectedDate)}</Typography>
              <ResponsiveTable
                items={arrivalsToday}
                getKey={(r) => r.id}
                minWidth={1080}
                emptyText="Aucune arrivée ce jour."
                head={arrivalsHead}
                renderRow={renderArrivalRow}
                renderMobileCard={renderArrivalCard}
                onItemClick={openReservation}
              />
            </Box>

            <Box>
              <Typography variant="sectionHeader" gutterBottom>Départs — {displayDate(selectedDate)}</Typography>
              <ResponsiveTable
                items={departuresToday}
                getKey={(r) => r.id}
                minWidth={860}
                emptyText="Aucun départ ce jour."
                head={departuresHead}
                renderRow={renderDepartureRow}
                renderMobileCard={renderDepartureCard}
                onItemClick={openReservation}
              />
            </Box>
          </Stack>

          {/* Cumulative month calendar — the SAME component as the Calendrier page (no duplication). */}
          <Divider sx={{ my: 3 }} />
          <CumulativeMonthCalendar
            onReservationClick={(id) => navigate(withFrom(`/reservations/${id}`, '/'))}
            onCreateReservation={(startDate) => navigate(withFrom(`/reservations/new?startDate=${startDate}`, '/'))}
          />
        </>
      )}
    </Box>
  );
}
