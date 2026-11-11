/**
 * SupportAccessBanner — « Le support demande l'accès : <motif> » with « Autoriser 24 h » and
 * « Refuser », for every administrator (specs/hosting-h2-account-security.md rules 12-13). The
 * duration can be 1 h, 24 h or 7 days. Renders nothing without a pending request, on an instance
 * without support access (rule 17), or inside the support's own session.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './DialogProvider';
import { ADMIN, userHasRole } from '../constants/roles';

export default function SupportAccessBanner() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const active = userHasRole(user, ADMIN) && Boolean(user && user.supportAccessEnabled) && !user.isSupport;
  const [banner, setBanner] = useState(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    api.getSupportBanner()
      .then((b) => { if (alive) { setBanner(b); if (b && b.defaultHours) setHours(b.defaultHours); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [active]);

  if (!active || !banner || !banner.pending) return null;
  const label = (banner.durations || []).find((d) => d.hours === hours)?.label || `${hours} h`;

  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.decideSupportAccess(banner.pending.id, decision, decision === 'accept' ? hours : undefined);
      showSuccess(decision === 'accept' ? `Accès du support autorisé ${label}.` : 'Accès du support refusé.');
      setBanner(null);
    } catch (err) {
      showError((err && err.message) || 'Décision impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert
      severity="warning"
      sx={{ mb: 2, alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap', '& .MuiAlert-action': { pt: 0, ml: { xs: 0, sm: 'auto' } } }}
      action={(
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
          <TextField
            select
            size="small"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            slotProps={{ htmlInput: { 'aria-label': 'Durée' } }}
            sx={{ minWidth: 110 }}
          >
            {(banner.durations || []).map((d) => <MenuItem key={d.hours} value={d.hours}>{d.label}</MenuItem>)}
          </TextField>
          <Button size="small" variant="contained" disabled={busy} onClick={() => decide('accept')}>{`Autoriser ${label}`}</Button>
          <Button size="small" color="inherit" disabled={busy} onClick={() => decide('refuse')}>Refuser</Button>
        </Stack>
      )}
    >
      {`Le support demande l’accès : ${banner.pending.reason}`}
    </Alert>
  );
}
