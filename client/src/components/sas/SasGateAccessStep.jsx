/**
 * SasGateAccessStep — the SAS step « Accès portail » (specs/gate-access-portier.md §3.3, §6).
 *
 * Page-specific: it only makes sense inside the arrival SAS. It reads Portier through guestFlow when
 * the step is shown (and on « Réessayer »): the code, a QR of the very address the J-7 email carries —
 * flashing it sets the guest's app up — and the window in force. The QR stays on screen: it is
 * rendered from the server's data URI and never printed or stored. When Portier does not answer, the
 * gate keypad's physical code stays there to dictate.
 *
 * Props:
 *   reservationId: number
 *   configured:    boolean   is there a Portier to read (from the SAS payload)
 *   portalCode:    string    the gate keypad's code (Réglages), '' when none
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import LoadingState from '../LoadingState';
import api from '../../api';

function FallbackCode({ portalCode, secondary }) {
  if (!portalCode) return null;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center', pt: secondary ? 1.5 : 0 }}>
      <Typography variant="body2" color="text.secondary">
        {secondary ? 'Secours — code du clavier du portail :' : 'Code du portail à communiquer au client :'}
      </Typography>
      {/* A code is digits and letters → kpiValue (sans, tabular): never serif. */}
      <Typography variant="kpiValue" sx={{ fontSize: secondary ? '1.6rem' : '2.6rem', letterSpacing: 2 }}>{portalCode}</Typography>
    </Stack>
  );
}

export default function SasGateAccessStep({ reservationId, configured, portalCode }) {
  const [step, setStep] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!configured || !reservationId) return;
    setLoading(true);
    try {
      setStep(await api.getSasGateAccess(reservationId));
    } catch {
      setStep({ status: 'unavailable' });
    } finally {
      setLoading(false);
    }
  }, [configured, reservationId]);

  useEffect(() => { load(); }, [load]);

  if (!configured) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">Portier n&apos;est pas configuré sur ce serveur : pas d&apos;accès portail à installer.</Typography>
        <FallbackCode portalCode={portalCode} />
      </Stack>
    );
  }

  if (loading && !step) return <LoadingState label="Lecture de l'accès portail…" py={4} />;

  if (!step || step.status !== 'ok') {
    const notYet = step && step.status === 'not_found';
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
        <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>
          {notYet
            ? "Accès portail indisponible : Portier n'a pas encore reçu ce séjour."
            : 'Accès portail indisponible : Portier ne répond pas.'}
        </Alert>
        <Button variant="outlined" onClick={load} disabled={loading} sx={{ minHeight: 44 }}>
          {loading ? 'Lecture…' : 'Réessayer'}
        </Button>
        <FallbackCode portalCode={portalCode} secondary />
      </Stack>
    );
  }

  return (
    <Stack spacing={1.25} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
      {step.code ? (
        <>
          <Typography variant="body1">Flashez pour installer l&apos;accès au portail</Typography>
          <Box
            component="img"
            src={step.qrDataUri}
            alt="QR de l'accès portail"
            sx={{ width: 220, maxWidth: '100%', minWidth: 180, height: 'auto', display: 'block', bgcolor: '#fff', p: 1, borderRadius: 1 }}
          />
          <Typography variant="kpiValue" sx={{ fontSize: '2.2rem', letterSpacing: 3 }}>{step.code}</Typography>
          <Typography variant="body2" color="text.secondary">{step.windowLabel}</Typography>
        </>
      ) : null}
      {step.notice ? <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>{step.notice}</Alert> : null}
    </Stack>
  );
}
