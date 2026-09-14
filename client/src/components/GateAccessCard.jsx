/**
 * GateAccessCard — the fiche's compact « Accès portail » card (specs/gate-access-portier.md §3.2, §6).
 *
 * Page-specific (the reservation fiche). Everything is read from Portier through guestFlow when the
 * fiche opens: the state, the window in force, the phones, the last use. It changes nothing by itself —
 * « Ouvrir dans la liste » leads to Réglages › Accès portail — except « Recréer » on an access deleted
 * in the list, the only way back for it. A push to Portier failing for more than an hour shows here.
 * Renders nothing for a devis, or for a role the server keeps out (reception).
 *
 * Props:
 *   reservationId: number | null
 *   cardSx, contentSx: forwarded to the Card / CardContent (the fiche's section rhythm)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import LoadingState from './LoadingState';
import { useAppDialogs, useToast } from './DialogProvider';
import api from '../api';

const STATE_BADGE = { before: 'neutral', active: 'success', suspended: 'warning', revoked: 'error', after: 'neutral', deleted: 'error' };

export default function GateAccessCard({ reservationId, cardSx, contentSx }) {
  const navigate = useNavigate();
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [card, setCard] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!reservationId) return;
    try {
      setCard(await api.getReservationGateAccess(reservationId));
    } catch (err) {
      if (err && (err.status === 403 || err.status === 404)) setHidden(true);
      else setCard({ status: 'unavailable', banner: '' });
    }
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const onRecreate = useCallback(async () => {
    const ok = await confirm({
      title: "Recréer l'accès ?",
      message: "L'accès revient avec une nouvelle clé et un nouveau code. L'ancien code et les téléphones déjà installés ne serviront plus.",
      confirmLabel: 'Recréer',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.portierAccessAction(card.access.id, 'recreate');
      showSuccess("Accès recréé : le nouveau code est dans l'étape « Accès portail » du SAS.");
      await load();
    } catch (err) {
      showError(err?.message || "L'accès n'a pas pu être recréé.");
    } finally {
      setBusy(false);
    }
  }, [card, confirm, load, showError, showSuccess]);

  if (!reservationId || hidden || (card && card.status === 'none')) return null;

  const access = card && card.status === 'ok' ? card.access : null;

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader" sx={{ flex: 1 }}>Accès portail</Typography>
          {access && !access.deleted ? <StatusBadge status={STATE_BADGE[access.state] || 'neutral'} label={access.stateLabel} /> : null}
        </Stack>

        {!card ? <LoadingState variant="skeleton" rows={2} /> : null}

        {card && card.banner ? <Alert severity="warning" sx={{ mb: 1.5 }}>{card.banner}</Alert> : null}

        {card && card.status === 'not_configured' ? (
          <Typography variant="body2" color="text.secondary">Portier n&apos;est pas configuré sur ce serveur.</Typography>
        ) : null}
        {card && card.status === 'unavailable' ? (
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body2" color="text.secondary">Portier ne répond pas : l&apos;état de l&apos;accès n&apos;est pas affiché.</Typography>
            <Button size="small" variant="outlined" onClick={load} sx={{ minHeight: 36 }}>Réessayer</Button>
          </Stack>
        ) : null}
        {card && card.status === 'not_found' ? (
          <Typography variant="body2" color="text.secondary">Portier n&apos;a pas encore reçu ce séjour.</Typography>
        ) : null}

        {access && access.deleted ? (
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body2">Accès supprimé dans la liste.</Typography>
            <Button size="small" variant="outlined" onClick={onRecreate} disabled={busy} sx={{ minHeight: 36 }}>
              {busy ? 'Recréation…' : 'Recréer'}
            </Button>
          </Stack>
        ) : null}

        {access && !access.deleted ? (
          <Stack spacing={0.5}>
            <Typography variant="body2">{access.window}</Typography>
            <Typography variant="body2" color="text.secondary">
              {access.phones} · dernier usage : {access.lastUse}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ pt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => navigate(`/portail?access=${encodeURIComponent(access.id)}`)}
                sx={{ minHeight: 36, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
              >
                Ouvrir dans la liste
              </Button>
            </Stack>
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}
