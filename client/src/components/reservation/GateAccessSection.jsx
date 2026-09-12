import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardContent, Typography, Stack, Box, Button, Chip, Divider, Alert, Tooltip, CircularProgress,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import BlockIcon from '@mui/icons-material/Block';
import api from '../../api';
import { useAppDialogs, useToast } from '../DialogProvider';

/**
 * « Accès portail » card on the reservation fiche (specs/guest-gate-access.md §3.6 rule 21).
 *
 * It replaces nothing on screen and adds the one thing the old single portal code never had: a
 * record. The code of this stay, the window it works in, the phones that used it, and the journal
 * that answers « who came in that night ».
 *
 * Both actions are destructive in the way that matters to a guest standing at a gate, so both ask
 * first: regenerating kills the link already emailed, revoking kills the access outright.
 */

const STATE_CHIP = {
  active: { label: 'actif', color: 'success' },
  before: { label: 'pas encore actif', color: 'default' },
  after: { label: 'expiré', color: 'default' },
  revoked: { label: 'révoqué', color: 'error' },
  unknown: { label: 'indéterminé', color: 'warning' },
};

const EVENT_LABEL = {
  created: 'Accès créé',
  code_ok: 'Code accepté',
  code_ko: 'Code refusé',
  open: 'Demande d’ouverture',
  opened: 'Portail ouvert',
  already_open: 'Portail déjà ouvert — aucune impulsion',
  refused: 'Ouverture refusée',
  error: 'Échec de l’ouverture',
  timeout: 'Sans réponse de la maison',
  revoked: 'Accès révoqué',
  regenerated: 'Code régénéré',
  early_open: 'Accès ouvert par anticipation',
};

function formatAt(value) {
  if (!value) return '';
  const iso = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export default function GateAccessSection({ reservationId, cardSx, contentSx }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();

  const load = useCallback(async () => {
    if (!reservationId) return;
    setLoading(true);
    setError('');
    try {
      setCard(await api.getGateAccess(reservationId));
    } catch (err) {
      // A stay that can have no access (a devis, a cancellation) answers 404 — that is not an error
      // worth shouting about, the card simply does not render.
      if (err?.status === 404) setCard(null);
      else setError(err?.message || 'Lecture de l’accès portail impossible.');
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (kind, call, successMessage) => {
    setBusy(kind);
    try {
      setCard(await call(reservationId));
      showSuccess(successMessage);
    } catch (err) {
      // specs/ds-components.md §3.2 — post-action feedback goes through the toast, not an inline
      // Alert. The inline one above is for a failed READ, where there is nothing else to show.
      showError(err?.message || 'L’opération a échoué.');
    } finally {
      setBusy('');
    }
  }, [reservationId, showSuccess, showError]);

  const onRegenerate = useCallback(async () => {
    const ok = await confirm({
      title: 'Régénérer le code ?',
      message: 'Le lien déjà envoyé au client cessera de fonctionner, et les téléphones déjà '
        + 'utilisés devront saisir le nouveau code. À faire si le code a circulé hors du séjour.',
      confirmLabel: 'Régénérer',
      confirmColor: 'warning',
    });
    if (ok) run('regenerate', api.regenerateGateAccess, 'Nouveau code généré.');
  }, [confirm, run]);

  const onRevoke = useCallback(async () => {
    const ok = await confirm({
      title: 'Révoquer l’accès ?',
      message: 'Le client ne pourra plus ouvrir le portail depuis son téléphone, immédiatement.',
      confirmLabel: 'Révoquer',
      confirmColor: 'error',
    });
    if (ok) run('revoke', api.revokeGateAccess, 'Accès révoqué.');
  }, [confirm, run]);

  if (!reservationId || (!card && !loading && !error)) return null;

  const chip = card ? (STATE_CHIP[card.state] || STATE_CHIP.unknown) : null;

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader" sx={{ flex: 1 }}>Accès portail</Typography>
          {chip && <Chip size="small" label={chip.label} color={chip.color} />}
          {card && !card.service.available && (
            <Tooltip title="La maison n’a pas répondu depuis plus d’une minute : le bouton du client est grisé.">
              <Chip size="small" label="ouverture à distance indisponible" color="warning" variant="outlined" />
            </Tooltip>
          )}
        </Stack>

        {loading && !card && <CircularProgress size={22} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {card && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <Stack spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Code du séjour</Typography>
                <Typography variant="kpiValue" sx={{ fontSize: '1.6rem', letterSpacing: 2 }}>
                  {card.code || '—'}
                </Typography>
                {!card.code && (
                  <Typography variant="caption" color="text.secondary">
                    Effacé une semaine après le séjour.
                  </Typography>
                )}
              </Stack>
              <Stack spacing={0.25}>
                <Typography variant="caption" color="text.secondary">Fenêtre</Typography>
                <Typography variant="body2">{card.window ? card.window.label : '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {card.deviceCount} appareil{card.deviceCount > 1 ? 's' : ''}
                  {card.earlyOpenedAt ? ` · ouvert par anticipation le ${formatAt(card.earlyOpenedAt)}` : ''}
                </Typography>
              </Stack>
            </Box>

            {card.deviceCount > 6 && (
              <Alert severity="info">
                {card.deviceCount} téléphones ont utilisé ce code. C’est normal pour une famille
                nombreuse ; si ça ne l’est pas, régénérez-le.
              </Alert>
            )}

            <Divider />

            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">Journal</Typography>
              {card.events.length === 0 && (
                <Typography variant="body2" color="text.secondary">Rien encore.</Typography>
              )}
              {card.events.map((event) => (
                <Box
                  key={event.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '7.5rem 1fr',
                    gap: 1,
                    py: 0.35,
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatAt(event.at)}
                  </Typography>
                  <Typography variant="body2">
                    {EVENT_LABEL[event.kind] || event.kind}
                    {event.reason ? ` — ${event.reason}` : ''}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<AutorenewIcon />}
                onClick={onRegenerate}
                disabled={!!busy}
              >
                {busy === 'regenerate' ? 'Régénération…' : 'Régénérer'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<BlockIcon />}
                onClick={onRevoke}
                disabled={!!busy || !!card.revokedAt}
              >
                {busy === 'revoke' ? 'Révocation…' : 'Révoquer'}
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
