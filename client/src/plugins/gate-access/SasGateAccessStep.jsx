/**
 * SasGateAccessStep — the arrival SAS's « Accès portail » step
 * (specs/gate-access-sowel-connector.md §3.5 rules 24-25).
 *
 * It shows the key Sowel made for this stay: the code in large, dictable type, and a QR of the very
 * link the J-7 email carries. **Flashing it installs the key with nothing to type.**
 *
 * It activates nothing and revokes nothing: the keys live in Sowel, and so does every action on
 * them. Here, we read.
 *
 * The QR stays on screen: never printed on a PDF, never attached to an email, never logged. It is
 * a key for as long as the stay lasts.
 *
 * Props:
 *   reservationId: number
 *   available:     boolean  — does guestFlow hold a usable key for the stay (pluginData of the SAS)
 *   portalCode:    string   — the gate keypad's code (Réglages), '' when there is none
 *
 * Rendered by the SAS « Portail » step through the `sas.portal` slot (specs/plugins-phase-1-sdk.md
 * rule 17).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { api, SasKeypadCode as KeypadCode } from '../sdk';

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
            ? "Accès portail indisponible : Sowel n'a pas encore créé la clé de ce séjour."
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
      {step.code ? (
        <Typography variant="kpiValue" sx={{ fontSize: '2.2rem', letterSpacing: 3 }}>{step.code}</Typography>
      ) : null}
      {step.windowLabel ? (
        <Typography variant="body2" color="text.secondary">{step.windowLabel}</Typography>
      ) : null}
      {/* The keypad code stays on the same page as the key's QR (rule 24): one page for every way in. */}
      <KeypadCode portalCode={portalCode} secondary />
    </Stack>
  );
}
