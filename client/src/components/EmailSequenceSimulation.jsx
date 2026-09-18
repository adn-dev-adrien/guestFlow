/**
 * EmailSequenceSimulation — what the guest email sequence would send over a period, and why an
 * email would not leave (specs/guest-email-sequence.md §3.6 rule 31, §6.2). Feature-specific: it
 * renders the server's simulation rows verbatim (dates, statuses and French reasons are all decided
 * server-side) inside the shared DataPageScaffold, table on md+ and cards on xs.
 *
 * Props:
 *   tabs: ReactNode — the history/simulation switch, rendered at the top of the filter card
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, TableCell, TableRow, TextField, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DataPageScaffold from './DataPageScaffold';
import StatusBadge from './StatusBadge';
import api from '../api';
import { displayDate } from '../utils/formatters';

const STATUS = {
  send: { status: 'success', label: 'Part' },
  blocked: { status: 'neutral', label: 'Ne part pas' },
  'already-sent': { status: 'info', label: 'Déjà envoyé' },
  'to-check': { status: 'warning', label: 'À vérifier' },
};

const isoDay = (date) => date.toISOString().slice(0, 10);

function SimulationBadge({ status }) {
  const s = STATUS[status] || { status: 'neutral', label: status };
  return <StatusBadge status={s.status} label={s.label} />;
}

export default function EmailSequenceSimulation({ tabs }) {
  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(new Date(Date.now() + 60 * 86400000)));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await api.getEmailSequenceSimulation({ from, to }));
    } catch (err) {
      setError(err.error === 'INVALID_RANGE' ? 'Période invalide (400 jours au plus, fin après début).' : 'La simulation n\'a pas pu être calculée.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const rows = result ? result.rows : [];
  const willSend = result ? result.counts.send : 0;

  const banner = result && (result.autoSendEnabled
    ? <Alert severity="success">Envoi automatique actif depuis le {displayDate(result.startDate)} : les mails « Part » partiront à leur date, à 8 h.</Alert>
    : <Alert severity="info">Envoi automatique désactivé : rien ne part tant qu&apos;il n&apos;est pas activé dans Réglages. La simulation suppose une activation aujourd&apos;hui.</Alert>);

  return (
    <DataPageScaffold
      title="Historique des emails"
      topContent={(
        <Stack spacing={1.5}>
          {tabs}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField size="small" type="date" label="Du" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: '100%', sm: 170 } }} />
            <TextField size="small" type="date" label="Au" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: '100%', sm: 170 } }} />
            <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 40 }}>
              Actualiser
            </Button>
          </Box>
          {banner}
          {result && (
            <Typography variant="body2" color="text.secondary">
              {willSend} mail{willSend > 1 ? 's' : ''} partirai{willSend > 1 ? 'ent' : 't'} sur la période, sur {rows.length} examiné{rows.length > 1 ? 's' : ''}.
              Rien n&apos;est envoyé ni enregistré par cette simulation.
            </Typography>
          )}
        </Stack>
      )}
      loading={loading}
      error={error || undefined}
      onRetry={load}
      minWidth={880}
      items={rows}
      getKey={(r) => `${r.mailKey}-${r.reservationId}-${r.clientId}-${r.date}`}
      head={(
        <TableRow>
          <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Mail</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Statut</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Raison</TableCell>
        </TableRow>
      )}
      renderRow={(r) => (
        <TableRow key={`${r.mailKey}-${r.reservationId}-${r.clientId}-${r.date}`} hover>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{displayDate(r.date)}</TableCell>
          <TableCell>{r.mailLabel}</TableCell>
          <TableCell>{r.clientName || '—'}</TableCell>
          <TableCell>{r.propertyName || '—'}</TableCell>
          <TableCell><SimulationBadge status={r.status} /></TableCell>
          <TableCell sx={{ color: 'text.secondary' }}>{r.reason}</TableCell>
        </TableRow>
      )}
      renderMobileCard={(r) => (
        <Stack spacing={0.5}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
            <Typography variant="subtitle2">{displayDate(r.date)} · {r.mailLabel}</Typography>
            <SimulationBadge status={r.status} />
          </Box>
          <Typography variant="body2">{r.clientName || '—'} · {r.propertyName || '—'}</Typography>
          {r.reason ? <Typography variant="caption" color="text.secondary">{r.reason}</Typography> : null}
        </Stack>
      )}
      emptyText="Aucun mail prévu sur cette période"
    />
  );
}
