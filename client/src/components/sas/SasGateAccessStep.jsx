/**
 * SasGateAccessStep — the arrival SAS's « Accès portail » step
 * (specs/gate-access-sowel-connector.md §3.4).
 *
 * It shows what the house minted for this stay: the code in large, dictable type, and a QR of the
 * very address the J-7 email carries. **Flashing it sets the access up with nothing to type.**
 *
 * It activates nothing and revokes nothing: the gate belongs to the house, and every action lives
 * in Sowel (Administration → Accès invités). Here, we read.
 *
 * The QR stays on screen: never printed on a PDF, never attached to an email, never logged. It is
 * a key for as long as the stay lasts.
 *
 * Props:
 *   reservationId: number
 *   available:     boolean  — has the house pushed a showable invitation (from the SAS payload)
 *   portalCode:    string   — the gate keypad's code (Réglages), '' when there is none
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import api from '../../api';

function KeypadCode({ portalCode, secondary }) {
  if (!portalCode) return null;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center', pt: secondary ? 1.5 : 0 }}>
      <Typography variant="body2" color="text.secondary">
        {secondary ? 'Secours — code du clavier du portail :' : 'Code du portail à communiquer au client :'}
      </Typography>
      {/* A code is digits and letters → kpiValue (sans, tabular): never serif. */}
      <Typography variant="kpiValue" sx={{ fontSize: secondary ? '1.6rem' : '2.6rem', letterSpacing: 2 }}>
        {portalCode}
      </Typography>
    </Stack>
  );
}

export default function SasGateAccessStep({ reservationId, available, portalCode }) {
  const [step, setStep] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!available || !reservationId) return;
    setLoading(true);
    try {
      const { sas } = await api.getReservationGateAccess(reservationId);
      setStep(sas);
    } catch {
      setStep({ status: 'error' });
    } finally {
      setLoading(false);
    }
  }, [available, reservationId]);

  useEffect(() => { load(); }, [load]);

  if (!available) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Aucun accès portail pour ce séjour.
        </Typography>
        <KeypadCode portalCode={portalCode} />
      </Stack>
    );
  }

  if (loading && !step) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'center', py: 4 }}>
        <Typography variant="body2" color="text.secondary">Lecture de l&apos;accès portail…</Typography>
      </Stack>
    );
  }

  if (!step || step.status !== 'ok') {
    const notYet = step && step.status === 'not_received';
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
        <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>
          {notYet
            ? "Accès portail indisponible : la maison n'a pas encore configuré ce séjour."
            : "Accès portail indisponible pour ce séjour."}
        </Alert>
        <Button variant="outlined" onClick={load} disabled={loading} sx={{ minHeight: 44 }}>
          {loading ? 'Lecture…' : 'Réessayer'}
        </Button>
        <KeypadCode portalCode={portalCode} secondary />
      </Stack>
    );
  }

  return (
    <Stack spacing={1.25} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
      <Typography variant="body1">Flashez pour installer l&apos;accès au portail</Typography>
      {step.qrDataUri ? (
        <Box
          component="img"
          src={step.qrDataUri}
          alt="QR de l'accès portail"
          sx={{ width: 220, maxWidth: '100%', minWidth: 180, height: 'auto', display: 'block', bgcolor: '#fff', p: 1, borderRadius: 1 }}
        />
      ) : null}
      {/* The code stays readable and dictable beside the QR, for a guest who would rather type it
          or who hears it over the telephone. */}
      <Typography variant="kpiValue" sx={{ fontSize: '2.2rem', letterSpacing: 3 }}>{step.code}</Typography>
      {step.windowLabel ? (
        <Typography variant="body2" color="text.secondary">{step.windowLabel}</Typography>
      ) : null}
    </Stack>
  );
}
