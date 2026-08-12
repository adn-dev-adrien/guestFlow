import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
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
import TariffRecipeRunsAlert from '../components/TariffRecipeRunsAlert';
import EmailPendingAlert from '../components/EmailPendingAlert';
import DevisPublicRequestAlert from '../components/DevisPublicRequestAlert';
import { useToast } from '../components/DialogProvider';
import CollectionStatusCell from '../components/CollectionStatusCell';
import { displayDate, formatCurrency } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import { useAuth } from '../hooks/useAuth';
import { isReceptionOnly } from '../constants/roles';
import { statusLockTooltip } from '../constants/receptionSasLock';
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

export default function Dashboard() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { user } = useAuth();
  // specs/reception-role-checkin-only.md §3.3 — a reception-only user gets a reduced, finance-free
  // home: arrivals/departures lists only (no Paiements column, no KPI tiles, no admin alert banners,
  // no month calendar). A row tap opens the SAS on the Planning via the deep-link.
  const receptionMode = isReceptionOnly(user);
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
  // Reception has no reservation sheet — a row tap jumps to the Planning with the matching SAS open.
  const openArrival = (r) => (receptionMode
    ? navigate(`/planning?sas=arrival&reservationId=${r.id}`)
    : openReservation(r));
  const openDeparture = (r) => (receptionMode
    ? navigate(`/planning?sas=departure&reservationId=${r.id}`)
    : openReservation(r));

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

  const checkboxCell = (title, checked, onChange, checkboxSx, disabled = false) => (
    <Tooltip title={title}>
      <span>
        <Checkbox size="small" checked={checked} onChange={onChange} sx={checkboxSx} disabled={disabled} />
      </span>
    </Tooltip>
  );

  // specs/reception-sas-today-only.md §3.3 rule 12 — the day window is resolved server-side and rides
  // in the reception payload; the flags are absent for an admin, which reads as "always editable".
  const arrivalStatusLocked = (r) => r.checkInStatusEditable === false;
  const departureStatusLocked = (r) => r.checkOutStatusEditable === false;
  const arrivalStatusTitle = (r, label) => (arrivalStatusLocked(r) ? statusLockTooltip('arrival') : label);
  const departureStatusTitle = (r, label) => (departureStatusLocked(r) ? statusLockTooltip('departure') : label);

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
      {!receptionMode && <TableCell sx={{ fontWeight: 600 }}>Paiements</TableCell>}
      <TableCell sx={{ fontWeight: 600 }}>Caution</TableCell>
    </TableRow>
  );

  const renderArrivalRow = (r) => {
    const cautionOk = Number(r.cautionAmount || 0) <= 0 || !!r.cautionReceived;
    return (
      <TableRow
        key={r.id}
        hover
        sx={(t) => ({ ...statusBgSx(t, r.checkInDone, r.checkInReady), cursor: 'pointer' })}
        onClick={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('.MuiCheckbox-root')) return; openArrival(r); }}
      >
        <TableCell padding="checkbox">
          {checkboxCell(arrivalStatusTitle(r, 'Logement prêt'), !!r.checkInReady, () => handleToggleStatus(r, 'checkInReady', setArrivalsToday), { color: 'success.main', '&.Mui-checked': { color: 'success.main' } }, arrivalStatusLocked(r))}
        </TableCell>
        <TableCell padding="checkbox">
          {checkboxCell(arrivalStatusTitle(r, 'Locataires arrivés'), !!r.checkInDone, () => handleCheckInDone(r), undefined, arrivalStatusLocked(r))}
        </TableCell>
        <TableCell>{r.checkInTime || '15:00'}</TableCell>
        <TableCell>{r.propertyName}</TableCell>
        <TableCell>{r.firstName} {r.lastName}</TableCell>
        <TableCell>
          {`D:${Number(r.doubleBeds || 0)} / S:${Number(r.singleBeds || 0)} / B:${Number(r.babyBeds || 0)}`}
        </TableCell>
        <TableCell>{optionsResourcesText(r)}</TableCell>
        <TableCell>{r.notes || '—'}</TableCell>
        {!receptionMode && (
          <TableCell>
            <CollectionStatusCell collection={r.operationalCollection} side="arrival" />
          </TableCell>
        )}
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
    const cautionOk = Number(r.cautionAmount || 0) <= 0 || !!r.cautionReceived;
    return (
      <Box sx={(t) => ({ m: -1.5, p: 1.5, ...statusBgSx(t, r.checkInDone, r.checkInReady) })}>
        <Stack spacing={0.5}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
              {r.checkInTime || '15:00'} · {r.propertyName}
            </Typography>
            <Box onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
              {checkboxCell(arrivalStatusTitle(r, 'Logement prêt'), !!r.checkInReady, () => handleToggleStatus(r, 'checkInReady', setArrivalsToday), { color: 'success.main', '&.Mui-checked': { color: 'success.main' } }, arrivalStatusLocked(r))}
              {checkboxCell(arrivalStatusTitle(r, 'Locataires arrivés'), !!r.checkInDone, () => handleCheckInDone(r), undefined, arrivalStatusLocked(r))}
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
          {!receptionMode && (
            <CollectionStatusCell collection={r.operationalCollection} side="arrival" variant="card" />
          )}
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
      {!receptionMode && <TableCell sx={{ fontWeight: 600 }}>Paiements</TableCell>}
    </TableRow>
  );

  const renderDepartureRow = (r) => (
    <TableRow
      key={r.id}
      hover
      sx={(t) => ({ ...statusBgSx(t, r.checkOutDone), cursor: 'pointer' })}
      onClick={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('.MuiCheckbox-root')) return; openDeparture(r); }}
    >
      <TableCell padding="checkbox">
        {checkboxCell(departureStatusTitle(r, 'Départ effectué'), !!r.checkOutDone, () => handleToggleStatus(r, 'checkOutDone', setDeparturesToday), undefined, departureStatusLocked(r))}
      </TableCell>
      <TableCell>{r.checkOutTime || '10:00'}</TableCell>
      <TableCell>{r.propertyName}</TableCell>
      <TableCell>{r.firstName} {r.lastName}</TableCell>
      <TableCell>{optionsResourcesText(r)}</TableCell>
      <TableCell>{r.notes || '—'}</TableCell>
      {!receptionMode && (
        <TableCell>
          <CollectionStatusCell collection={r.operationalCollection} side="departure" />
        </TableCell>
      )}
    </TableRow>
  );

  const renderDepartureCard = (r) => (
    <Box sx={(t) => ({ m: -1.5, p: 1.5, ...statusBgSx(t, r.checkOutDone) })}>
      <Stack spacing={0.5}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
            {r.checkOutTime || '10:00'} · {r.propertyName}
          </Typography>
          <Box onClick={(e) => e.stopPropagation()}>
            {checkboxCell(departureStatusTitle(r, 'Départ effectué'), !!r.checkOutDone, () => handleToggleStatus(r, 'checkOutDone', setDeparturesToday), undefined, departureStatusLocked(r))}
          </Box>
        </Stack>
        <Typography variant="body2">{r.firstName} {r.lastName}</Typography>
        {optionsResourcesText(r) !== '—' && (
          <Typography variant="caption" color="text.secondary">{optionsResourcesText(r)}</Typography>
        )}
        {r.notes && <Typography variant="caption" color="text.secondary">Note : {r.notes}</Typography>}
        {!receptionMode && (
          <CollectionStatusCell collection={r.operationalCollection} side="departure" variant="card" />
        )}
      </Stack>
    </Box>
  );

  return (
    <Box>
      <PageActionBar title="Tableau de bord" titleOnXs center={renderDateNav()} />
      {/* xs fallback for the bar's hidden `center` — same date cluster, compact strip. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {renderDateNav()}
      </Box>

      {/* Admin operational banners — hidden for the reception role (they drive admin-only workflows
          like iCal approvals, the manual email queue, and website booking requests). */}
      {!receptionMode && (
        <>
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
          <TariffRecipeRunsAlert />
          {/* Manual email queue (specs/email-automation.md §6.2). Self-contained: renders
              nothing when no manual email is pending. */}
          <EmailPendingAlert />
          {/* Site-origin devis pending handling (specs/site-booking-notifications.md §3 rule 5).
              Self-contained: renders nothing when there is no pending website request. */}
          <DevisPublicRequestAlert />
        </>
      )}

      {loadError ? (
        <ErrorAlert message="Impossible de charger le tableau de bord." onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 3 }} />
      ) : loading ? (
        <LoadingState label="Chargement du tableau de bord…" />
      ) : (
        <>
          {/* Summary cards — neutral « Maison » KPI tiles (admin only; reception sees just the lists) */}
          {!receptionMode && (
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
          )}

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
                onItemClick={openArrival}
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
                onItemClick={openDeparture}
              />
            </Box>
          </Stack>

          {/* Cumulative month calendar — the SAME component as the Calendrier page (no duplication).
              Hidden for reception (finance-free home is arrivals/departures only, §3.3). */}
          {!receptionMode && (
            <>
              <Divider sx={{ my: 3 }} />
              <CumulativeMonthCalendar
                onReservationClick={(id) => navigate(withFrom(`/reservations/${id}`, '/'))}
                onCreateReservation={(startDate) => navigate(withFrom(`/reservations/new?startDate=${startDate}`, '/'))}
              />
            </>
          )}
        </>
      )}
    </Box>
  );
}
