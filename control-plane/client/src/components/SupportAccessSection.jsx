/**
 * « Accès du support » on a customer's page (specs/hosting-h2-account-security.md rules 12-14,
 * §4.2): ask for access with a reason, see whether the customer answered, and — while an access is
 * open — « Ouvrir l'espace », which opens the customer's space in a new tab through a signed link
 * valid 2 minutes. The state is the server's, read from the instance.
 *
 * Props: customerId, onChanged() (the page reloads its journal).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useToast } from '@gf/components/DialogProvider';
import api from '../api';

export default function SupportAccessSection({ customerId, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState(null);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.supportState(customerId));
    } catch (err) {
      setState({ available: false, unavailableReason: err.message });
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const ask = async () => {
    setFieldError('');
    setBusy(true);
    try {
      setState(await api.supportRequest(customerId, reason));
      setReason('');
      showSuccess('Demande envoyée à l’instance.');
      if (onChanged) onChanged();
    } catch (err) {
      if (err.errors && err.errors.reason) setFieldError(err.errors.reason);
      else showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setBusy(true);
    try {
      const { url } = await api.supportLink(customerId);
      window.open(url, '_blank', 'noopener');
      if (onChanged) onChanged();
    } catch (err) {
      showError(err.message);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="sectionHeader" component="h2" sx={{ mb: 1, display: 'block' }}>Accès du support</Typography>
        {!state && <Typography variant="body2" color="text.secondary">…</Typography>}
        {state && !state.available && <Typography variant="body2" color="text.secondary">{state.unavailableReason}</Typography>}
        {state && state.available && (
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{state.stateLabel}</Typography>
              {state.lastLabel && <Typography variant="caption" color="text.secondary">{state.lastLabel}</Typography>}
            </Box>
            {state.canOpen ? (
              <Box>
                <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={open} disabled={busy} sx={{ minHeight: 44 }}>Ouvrir l’espace</Button>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>Lien signé, valable 2 minutes, usage unique.</Typography>
              </Box>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
                <TextField
                  label="Motif"
                  size="small"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={Boolean(fieldError)}
                  helperText={fieldError || (state.state === 'pending' ? 'Une nouvelle demande remplace celle en attente.' : ' ')}
                  sx={{ flex: 1 }}
                />
                <Button variant="outlined" onClick={ask} disabled={busy} sx={{ minHeight: 40 }}>Demander l’accès</Button>
              </Stack>
            )}
            {state.state === 'pending' && <Alert severity="info">La demande s’affiche aux administrateurs du client.</Alert>}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
