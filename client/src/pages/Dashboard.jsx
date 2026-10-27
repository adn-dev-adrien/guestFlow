import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Typography, Checkbox,
  Alert, Button, TextField, Tooltip, IconButton, Stack, TableRow, TableCell,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import PageActionBar from '../components/PageActionBar';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import CumulativeMonthCalendar from '../components/CumulativeMonthCalendar';
import AttentionInbox, { AttentionPinned, LegacyPluginAlerts } from '../components/AttentionInbox';
import useAttention from '../hooks/useAttention';
import { useToast } from '../components/DialogProvider';
import CollectionStatusCell from '../components/CollectionStatusCell';
import { displayDate, formatCurrency } from '../utils/formatters';
import { withFrom } from '../utils/navigation';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, isReceptionOnly, userHasRole } from '../constants/roles';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { statusLockTooltip } from '../constants/receptionSasLock';
import api from '../api';
import useServerToday from '../hooks/useServerToday';
import { addIsoDays } from '../utils/isoDay';

const addDays = addIsoDays;

// Row/card background reflecting the check-in/out status (done = greyed, ready = green tint).
const statusBgSx = (t, done, ready = false) => {
  if (done) return { bgcolor: alpha(t.palette.grey[500], 0.18) };
  if (ready) return { bgcolor: alpha(t.palette.success.main, 0.1) };
  return {};
};

const optionsResourcesText = (r) => {
  const optionsText = (r.options || []).map((o) => `${o.title} x${o.quantity}`).join(', ');
  const resourcesText = [
    ...(Number(r.babyBeds || 0) > 0 ? [`Lit bébé ×${r.babyBeds}`] : []),
    ...(r.resources || []).map((rr) => `${rr.name} x${rr.quantity}`),
  ].join(', ');
  return [optionsText, resourcesText].filter(Boolean).join(' | ') || '—';
};

// « D:1 / S:2 / B:0 », or null when the stay has no bed at all: the server zeroes the bed counts of a
// stay without a bed-linen option (specs/bed-config-in-linen-card.md rules 7, 14), so « D:0 / S:0 / B:0 »
// would only say « nothing to prepare » in a misleading way.
const bedsLabel = (r) => {
  const [d, s, b] = [r.doubleBeds, r.singleBeds, r.babyBeds].map((n) => Number(n || 0));
  return d || s || b ? `D:${d} / S:${s} / B:${b}` : null;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { user } = useAuth();
  // specs/reception-role-checkin-only.md §3.3 — a reception-only user gets a reduced, finance-free
  // home: arrivals/departures lists only (no Paiements column, no attention subjects, no month
  // calendar). A row tap opens the SAS on the Planning via the deep-link.
  const receptionMode = isReceptionOnly(user);
  // What asks for the operator, counted and ordered by the server (specs/shell-and-home-day-first.md §3.B).
  // An admin read: any other role makes no call (it would collect a 403).
  const showAttention = userHasRole(user, ADMIN) && !receptionMode;
  const attention = useAttention({ enabled: showAttention });
  // A reception account only acts through the SAS: without it (outside the plan, failed) a row leads
  // nowhere, so it is not offered as a link.
  const sasOn = usePlugin(SAS);
  // The server's date (specs/ds-sweep-planning.md rule 28); nothing loads before it is known.
  const todayStr = useServerToday();
  const [pickedDate, setPickedDate] = useState(null);
  const selectedDate = pickedDate || todayStr;
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

  // Only the latest load paints: quick day-to-day clicks, or the server's day moving on when the page
  // comes back to the foreground, can answer out of order (specs/upcoming-reservations-cards.md rule 7).
  const loadSeq = useRef(0);
  const loadDashboardData = async () => {
    const seq = ++loadSeq.current;
    const isCurrent = () => seq === loadSeq.current;
    // Fetch reservations starting from selectedDate if it's in the past
    const fetchFrom = selectedDate < todayStr ? selectedDate : todayStr;

    try {
      const allUpcoming = await api.getReservations({ from: fetchFrom });

      const arrivalsBase = allUpcoming
        .filter((r) => r.startDate === selectedDate)
        .sort((a, b) => (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59'));
      const departuresBase = allUpcoming
        .filter((r) => r.endDate === selectedDate)
        .sort((a, b) => (a.checkOutTime || '23:59').localeCompare(b.checkOutTime || '23:59'));

      const [arrivalsDetailed, departuresDetailed] = await Promise.all([
        Promise.all(arrivalsBase.map((r) => api.getReservation(r.id))),
        Promise.all(departuresBase.map((r) => api.getReservation(r.id))),
      ]);
      if (!isCurrent()) return;
      setArrivalsToday(arrivalsDetailed);
      setDeparturesToday(departuresDetailed);
      setLoadError(false);
    } catch (e) {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDate) loadDashboardData();
  }, [selectedDate, todayStr, reloadNonce]); // eslint-disable-line

  const openReservation = (r) => navigate(withFrom(`/reservations/${r.id}`, '/'));
  // Reception has no reservation sheet — a row tap jumps to the Planning with the matching SAS open.
  const openArrival = (r) => {
    if (!receptionMode) openReservation(r);
    else if (sasOn) navigate(`/planning?sas=arrival&reservationId=${r.id}`);
  };
  const openDeparture = (r) => {
    if (!receptionMode) openReservation(r);
    else if (sasOn) navigate(`/planning?sas=departure&reservationId=${r.id}`);
  };

  // Date cluster — rendered in the bar `center` on sm+ and as a compact strip under the bar on xs
  // (PageActionBar hides `center` on xs). specs/ds-sweep-planning.md rule 1.
  const renderDateNav = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton size="small" onClick={() => setPickedDate(addDays(selectedDate, -1))} disabled={!selectedDate} aria-label="Jour précédent">
        <NavigateBeforeIcon />
      </IconButton>
      <TextField
        type="date"
        size="small"
        value={selectedDate || ''}
        onChange={(e) => setPickedDate(e.target.value)}
        sx={{ width: 165 }}
        slotProps={{ htmlInput: { style: { padding: '6px 10px' }, 'aria-label': 'Date affichée' } }}
      />
      <IconButton size="small" onClick={() => setPickedDate(addDays(selectedDate, 1))} disabled={!selectedDate} aria-label="Jour suivant">
        <NavigateNextIcon />
      </IconButton>
      {selectedDate !== todayStr && (
        <Button size="small" variant="outlined" onClick={() => setPickedDate(null)}>
          Aujourd'hui
        </Button>
      )}
    </Box>
  );

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
          {bedsLabel(r) || '—'}
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
          {bedsLabel(r) && (
            <Typography variant="caption" color="text.secondary">{`Lits : ${bedsLabel(r)}`}</Typography>
          )}
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
      <PageActionBar title="Tableau de bord" center={renderDateNav()} />
      {/* xs fallback for the bar's hidden `center` — same date cluster, compact strip. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: 2 }}>
        {renderDateNav()}
      </Box>

      {/* The day first (specs/shell-and-home-day-first.md rules 1–3): the gate keys and the payment
          deadlines stay unfolded above it; everything else waits in « À traiter » below it. The KPI
          tiles left the home (decision 1) — their figures live in Suivi financier. */}
      {showAttention && <AttentionPinned subjects={attention.pinned} />}
      {/* Plugin packages older than SDK 1.4.0 keep their own alert (rule 22). */}
      {showAttention && attention.loaded && <LegacyPluginAlerts declared={attention.declared} />}

      {loadError ? (
        <ErrorAlert message="Impossible de charger le tableau de bord." onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 3 }} />
      ) : loading ? (
        <LoadingState label="Chargement du tableau de bord…" />
      ) : (
        <>
          {/* Daily departures / arrivals — DEPARTURES FIRST (issue #427,
              specs/reception-role-checkin-only.md §6): the day runs in that order, the departures are
              handled in the morning and the arrivals in the afternoon, so the first list is the one
              the operator needs first. */}
          <Stack spacing={3} sx={{ mb: 3 }}>
            {receptionMode && !sasOn && (
              <Alert severity="info">Arrivées et départs guidés indisponibles pour le moment.</Alert>
            )}
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
          </Stack>

          {showAttention && <AttentionInbox items={attention.items} total={attention.total} unavailableLabel={attention.unavailableLabel} />}

          {/* Cumulative month calendar — the SAME component as the Calendrier page (no duplication).
              Hidden for reception (finance-free home is arrivals/departures only, §3.3). */}
          {!receptionMode && (
            <CumulativeMonthCalendar
              onReservationClick={(id) => navigate(withFrom(`/reservations/${id}`, '/'))}
              onCreateReservation={(startDate) => navigate(withFrom(`/reservations/new?startDate=${startDate}`, '/'))}
            />
          )}
        </>
      )}
    </Box>
  );
}
