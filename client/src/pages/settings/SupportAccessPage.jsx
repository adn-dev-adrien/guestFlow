/**
 * SupportAccessPage — Paramètres › Accès du support at `/parametres/acces-support`
 * (specs/hosting-h2-account-security.md rules 13, 15, 17): every request with its decision and state,
 * « Révoquer » on an open access, and the log of what the support did, read-only. The page exists
 * only on an instance with a licence key (the route and the menu entry are hidden otherwise).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import PageActionBar from '../../components/PageActionBar';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import LoadingState from '../../components/LoadingState';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../components/DialogProvider';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import api from '../../api';

const STATUS = { open: 'success', pending: 'warning', refused: 'error', revoked: 'neutral', expired: 'neutral' };

export default function SupportAccessPage() {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [log, setLog] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.getSupportAccesses());
    } catch (err) {
      setError((err && err.message) || 'Lecture impossible.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openLog = async (access) => {
    setSelected(access);
    setLog(null);
    try {
      setLog(await api.getSupportAccessLog(access.id));
    } catch (err) {
      showError((err && err.message) || 'Lecture impossible.');
    }
  };

  const revoke = async () => {
    try {
      setData(await api.revokeSupportAccess(revoking.id));
      showSuccess('Accès révoqué.');
    } catch (err) {
      showError((err && err.message) || 'Révocation impossible.');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Box>
      <PageActionBar title="Accès du support" titleOnXs />
      <Box sx={{ maxWidth: 980, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!data && !error && <LoadingState />}
        {data && data.accesses.length === 0 && (
          <EmptyState icon={<SupportAgentIcon />} message="Aucune demande du support." py={6} />
        )}
        {data && data.accesses.length > 0 && (
          <Stack spacing={1.5}>
            {data.accesses.map((a) => (
              <Card variant="outlined" key={a.id} sx={{ borderColor: selected && selected.id === a.id ? 'primary.main' : undefined }}>
                <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{a.reason}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">{`Demandé le ${a.requestedAtLabel}`}</Typography>
                      {a.decisionLabel !== '—' && <Typography variant="caption" color="text.secondary" component="div">{a.decisionLabel}</Typography>}
                      {a.revokedLabel && <Typography variant="caption" color="text.secondary" component="div">{a.revokedLabel}</Typography>}
                    </Box>
                    <StatusBadge status={STATUS[a.state] || 'neutral'} label={a.stateLabel} />
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => openLog(a)} disabled={!a.logCount}>{`Journal (${a.logCount})`}</Button>
                      {a.state === 'open' && <Button size="small" color="error" variant="outlined" onClick={() => setRevoking(a)}>Révoquer</Button>}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {selected && (
          <Card variant="outlined" sx={{ mt: 3 }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Typography variant="sectionHeader">{`Journal — ${selected.reason}`}</Typography>
              {!log && <LoadingState />}
              {log && (
                <Box sx={{ overflowX: 'auto', mt: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow><TableCell>Quand</TableCell><TableCell>Action</TableCell><TableCell>Résultat</TableCell></TableRow>
                    </TableHead>
                    <TableBody>
                      {log.entries.map((e, i) => (
                        <TableRow key={`${e.at}-${i}`}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.atLabel}</TableCell>
                          <TableCell sx={{ overflowWrap: 'anywhere' }}>{e.label}</TableCell>
                          <TableCell>{e.summary || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </CardContent>
          </Card>
        )}
      </Box>
      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={revoke}
        title="Révoquer l’accès du support"
        message="La session du support se ferme à sa prochaine action."
        confirmLabel="Révoquer"
        confirmColor="error"
      />
    </Box>
  );
}
