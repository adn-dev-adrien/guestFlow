/**
 * UpdateProgressOverlay — the screen during a self-update (specs/self-update-and-releases.md §6.3).
 *
 * Mounted once at app level, so it takes over wherever the update was triggered from and survives a
 * page reload in the middle of one.
 *
 * It polls the status endpoint every 2 s. Failing requests are EXPECTED here — the server is being
 * restarted under us — so a network error is rendered as "Redémarrage en cours…", never as a
 * failure. The only authorities on the outcome are the phases the server and the swap helper write
 * to the status file: `done` reloads the page, `failed` / `rolled_back` show what went wrong.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Paper, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../api';
import CollapsibleSection from './CollapsibleSection';
import { UPDATE_STARTED_EVENT } from '../hooks/useAppUpdate';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';

const POLL_MS = 2000;
const MANUAL_RELOAD_AFTER_MS = 5 * 60 * 1000;

export default function UpdateProgressOverlay() {
  const { user } = useAuth();
  const isAdmin = userHasRole(user, ADMIN);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const [showManualReload, setShowManualReload] = useState(false);
  const startedAtRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const payload = await api.getUpdateStatus();
      setUnreachable(false);
      setStatus(payload);
      return payload;
    } catch {
      // The application is restarting: keep waiting, this is the normal middle of an update.
      setUnreachable(true);
      return null;
    }
  }, []);

  // Pick the update up wherever it started: the event, or an update already running when this
  // client mounted (a reload mid-update, or a second browser tab).
  useEffect(() => {
    if (!isAdmin) return undefined;
    const onStarted = () => {
      startedAtRef.current = Date.now();
      setActive(true);
      setStatus(null);
      setShowManualReload(false);
    };
    window.addEventListener(UPDATE_STARTED_EVENT, onStarted);

    let cancelled = false;
    api.getUpdateStatus()
      .then((payload) => {
        if (cancelled || !payload || payload.terminal) return;
        startedAtRef.current = Date.now();
        setStatus(payload);
        setActive(true);
      })
      .catch(() => { /* not an admin, or the API is unreachable — nothing to show */ });

    return () => {
      cancelled = true;
      window.removeEventListener(UPDATE_STARTED_EVENT, onStarted);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(async () => {
      const payload = await poll();
      if (payload?.phase === 'done') {
        window.location.reload();
        return;
      }
      if (startedAtRef.current && Date.now() - startedAtRef.current > MANUAL_RELOAD_AFTER_MS) {
        setShowManualReload(true);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, poll]);

  if (!active) return null;

  const failed = status?.phase === 'failed' || status?.phase === 'rolled_back';
  const label = unreachable && !failed
    ? 'Redémarrage en cours…'
    : (status?.label || 'Préparation de la mise à jour…');

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (theme) => theme.zIndex.modal + 10,
        bgcolor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, sm: 3 },
      }}
    >
      <Paper sx={{ p: { xs: 2.5, sm: 4 }, maxWidth: 560, width: '100%', textAlign: 'center' }}>
        {failed ? (
          <>
            <Alert severity={status.phase === 'rolled_back' ? 'warning' : 'error'} sx={{ textAlign: 'left' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{status.label}</Typography>
              {status.error && <Typography variant="body2">{status.error}</Typography>}
            </Alert>
            {status.logTail?.length > 0 && (
              <Box sx={{ mt: 2, textAlign: 'left' }}>
                <CollapsibleSection title="Journal de la mise à jour" toggleLabel="Afficher le journal">
                  <Box
                    component="pre"
                    sx={{
                      m: 0, p: 1.5, borderRadius: 1, bgcolor: 'action.hover',
                      fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}
                  >
                    {status.logTail.join('\n')}
                  </Box>
                </CollapsibleSection>
              </Box>
            )}
            <Button sx={{ mt: 2 }} variant="contained" onClick={() => setActive(false)}>
              Fermer
            </Button>
          </>
        ) : (
          <>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Mise à jour {status?.targetVersion ? `vers la ${status.targetVersion} ` : ''}en cours
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{label}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              La page se rechargera automatiquement. Ne fermez pas cette fenêtre.
            </Typography>
            {showManualReload && (
              <Button sx={{ mt: 2 }} startIcon={<RefreshIcon />} onClick={() => window.location.reload()}>
                Recharger la page
              </Button>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}
