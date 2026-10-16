/**
 * IntakeBanner — what the Gîtes de France booking mail did to this fiche (specs/gites-de-france-mail-intake.md
 * rule 12), at the top of the reservation page (slot `reservation.banners`).
 *
 * States, all decided server-side: `applied` (dismissible), `needs_rent` (two rents fit the net: one button
 * each, with the commission it gives), `proposed` (the fiche was already edited: Appliquer / Ignorer),
 * `error`. Renders nothing otherwise.
 *
 * Props:
 *   reservationId          number
 *   onReservationChanged   () => void   the fiche reloads after the server wrote it
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Link, Stack, Typography } from '@mui/material';
import { api, formatCurrency } from '../sdk';

export default function IntakeBanner({ reservationId, onReservationChanged }) {
  const [intake, setIntake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getGdfIntakeForReservation(reservationId)
      .then((r) => setIntake(r && r.intake))
      .catch(() => setIntake(null));
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (onReservationChanged) onReservationChanged();
      load();
    } catch (err) {
      setError(err.message || 'Échec');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => run(() => api.dismissGdfIntake(intake.id));

  if (!intake || !['applied', 'needs_rent', 'proposed', 'error'].includes(intake.status)) return null;

  const mail = `mail Gîtes de France du ${intake.receivedLabel}`;
  const customNote = intake.customLines && intake.customLines.length > 0 && (
    <Typography variant="body2" sx={{ mt: 0.5 }}>
      Ajouté tel quel : {intake.customLines.map((l) => `« ${l.label} » ${formatCurrency(l.amount)}`).join(', ')}.
    </Typography>
  );
  const fullOnXs = { flex: { xs: '1 1 100%', sm: '0 0 auto' }, minHeight: 44 };

  if (intake.status === 'applied') {
    return (
      <Alert severity="success" sx={{ mb: 2 }} onClose={busy ? undefined : dismiss}>
        Rempli depuis le {mail}.
        {customNote}
      </Alert>
    );
  }

  if (intake.status === 'error') {
    return (
      <Alert severity="error" sx={{ mb: 2 }} onClose={busy ? undefined : dismiss}>
        Le {mail} n’a pas pu être appliqué : {intake.error}
      </Alert>
    );
  }

  if (intake.status === 'proposed') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Le {mail} (dossier {intake.dossierNumber}) concerne cette fiche, déjà modifiée à la main.
        <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" disabled={busy} sx={fullOnXs} onClick={() => run(() => api.applyGdfIntake(intake.id))}>
            Appliquer
          </Button>
          <Button size="small" variant="outlined" color="inherit" disabled={busy} sx={fullOnXs} onClick={dismiss}>
            Ignorer
          </Button>
        </Stack>
        {error && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error}</Typography>}
      </Alert>
    );
  }

  const rents = intake.rentCandidates || [];
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <AlertTitle>
        Prix de location : {rents.map((c) => formatCurrency(c.rent)).join(' ou ')} ?
      </AlertTitle>
      Le mail ne donne que le net ({formatCurrency(intake.netRent)}). Le reste de la fiche est rempli.
      {customNote}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${rents.length}, minmax(0, 200px))` }, gap: 1, mt: 1 }}>
        {rents.map((c) => (
          <Button
            key={c.rent}
            variant="outlined"
            color="inherit"
            disabled={busy}
            onClick={() => run(() => api.applyGdfIntake(intake.id, { rent: c.rent }))}
            sx={{ minHeight: 44, justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <span>{formatCurrency(c.rent)}</span>
            <Typography component="span" variant="caption">commission {formatCurrency(c.commission)}</Typography>
          </Button>
        ))}
      </Box>
      {intake.iteaUrl && (
        <Link href={intake.iteaUrl} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 1 }}>
          Voir le dossier sur ITEA
        </Link>
      )}
      {error && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error}</Typography>}
    </Alert>
  );
}
