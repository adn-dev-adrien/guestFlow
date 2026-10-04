/**
 * The fleet (specs/control-plane-plans-and-access.md rules 8, 18 and 33): today's alerts, the emails
 * awaiting approval, the three counters as filters, and one line per customer — a table on sm+,
 * cards on xs. Sorting a column is presentation only; every value comes ready from the server.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Box, Card, CardContent, Chip, Stack, TableCell, TableRow, TableSortLabel, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PageActionBar from '@gf/components/PageActionBar';
import ResponsiveTable from '@gf/components/ResponsiveTable';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import { useToast } from '@gf/components/DialogProvider';
import LifecycleChip from '../components/LifecycleChip';
import EmailQueue from '../components/EmailQueue';
import api from '../api';

const COLUMNS = [
  { key: 'companyName', label: 'Client' },
  { key: 'planName', label: 'Forfait' },
  { key: 'state', label: 'État' },
  { key: 'endsAt', label: 'Échéance' },
  { key: 'daysLeft', label: 'Jours' },
  { key: 'version', label: 'Version' },
  { key: 'installedCount', label: 'Plugins' },
  { key: 'process', label: 'Processus' },
  { key: 'lastBackup', label: 'Sauvegarde' },
];
const dash = (v) => (v === null || v === undefined ? '—' : v);

export default function FleetPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [queue, setQueue] = useState([]);
  const { showError, showSuccess } = useToast();
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [sort, setSort] = useState({ key: 'endsAt', dir: 'asc' });

  const load = () => {
    setError(null);
    Promise.all([api.fleet(), api.alerts()])
      .then(([fleet, a]) => { setData(fleet); setAlerts(a.alerts); setQueue(a.queue || []); })
      .catch((err) => setError(err.message));
  };
  useEffect(load, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const kept = filter ? data.rows.filter((r) => r.counters.includes(filter)) : data.rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    const value = (r) => (r[sort.key] === null ? Infinity : r[sort.key]);
    return [...kept].sort((a, b) => (value(a) > value(b) ? factor : value(a) < value(b) ? -factor : 0));
  }, [data, filter, sort]);

  const bar = (
    <PageActionBar
      title="Clients"
      titleOnXs
      actionsBefore={[{ icon: <AddIcon />, tooltip: 'Nouveau client', onClick: () => navigate('/clients/nouveau'), color: 'primary' }]}
    />
  );
  if (error) return <>{bar}<Box sx={{ p: 2 }}><ErrorAlert message={error} onRetry={load} /></Box></>;
  if (!data) return <>{bar}<LoadingState /></>;

  const open = (r) => navigate(`/clients/${r.id}`);
  const handle = (fn, done) => async (emailId) => {
    try {
      const next = await fn(emailId);
      setQueue(next.queue);
      showSuccess(done);
    } catch (err) {
      showError(err.message);
    }
  };
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <>
      {bar}
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        {alerts.length > 0 && (
          <Stack spacing={1} aria-label="À traiter aujourd’hui">
            {alerts.map((a, i) => (
              <Alert key={i} severity={a.severity} role="button" tabIndex={0} sx={{ cursor: 'pointer' }}
                onClick={() => navigate(a.link || `/clients/${a.customerId}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(a.link || `/clients/${a.customerId}`); } }}>
                {a.text}
              </Alert>
            ))}
          </Stack>
        )}
        {queue.length > 0 && (
          <Card>
            <CardContent>
              <Typography variant="sectionHeader" component="h2" sx={{ mb: 0.5 }}>Emails à valider ({queue.length})</Typography>
              <EmailQueue items={queue} onSend={handle(api.sendEmail, 'Email envoyé.')} onIgnore={handle(api.ignoreEmail, 'Email ignoré.')} />
            </CardContent>
          </Card>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {data.counters.map((c) => (
            <Chip
              key={c.key}
              label={`${c.count} ${c.label}`}
              color={filter === c.key ? 'primary' : 'default'}
              variant={filter === c.key ? 'filled' : 'outlined'}
              onClick={() => setFilter(filter === c.key ? null : c.key)}
              aria-pressed={filter === c.key}
              sx={{ minHeight: 40, fontWeight: 600 }}
            />
          ))}
        </Box>
        <ResponsiveTable
          items={rows}
          getKey={(r) => r.id}
          emptyText={filter ? 'Aucun client dans ce filtre.' : 'Aucun client pour l’instant.'}
          onItemClick={open}
          minWidth={900}
          head={(
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c.key}>
                  <TableSortLabel active={sort.key === c.key} direction={sort.key === c.key ? sort.dir : 'asc'} onClick={() => toggleSort(c.key)}>
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          )}
          renderRow={(r) => (
            <TableRow key={r.id} hover onClick={() => open(r)} sx={{ cursor: 'pointer' }}>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.companyName}</Typography>
                <Typography variant="caption" color="text.secondary">{r.url.replace('https://', '')}</Typography>
              </TableCell>
              <TableCell>{r.planName}{r.addonsCount ? ` + ${r.addonsCount} option${r.addonsCount > 1 ? 's' : ''}` : ''}</TableCell>
              <TableCell><LifecycleChip state={r.state} label={r.stateLabel} /></TableCell>
              <TableCell>{r.endsAtLabel}</TableCell>
              <TableCell>{dash(r.daysLeft)}</TableCell>
              <TableCell>{dash(r.version)}</TableCell>
              <TableCell>{dash(r.installedCount)}</TableCell>
              <TableCell>{dash(r.process)}</TableCell>
              <TableCell>{dash(r.lastBackup)}</TableCell>
            </TableRow>
          )}
          renderMobileCard={(r) => (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.companyName}</Typography>
                <LifecycleChip state={r.state} label={r.stateLabel} />
              </Box>
              <Typography variant="caption" color="text.secondary" component="div">
                {r.url.replace('https://', '')} · {r.planName}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                Échéance {r.endsAtLabel}{r.daysLeft !== null ? ` (${r.daysLeft} j)` : ''}
              </Typography>
            </>
          )}
        />
      </Stack>
    </>
  );
}
