/**
 * StayLinkCard — « Lien Mon séjour » on the fiche (specs/guest-app.md rules 1, 9bis c): the stay's link to the
 * guest app, its QR and how long it is valid, « Copier le lien » and « Régénérer le lien » (confirmed first — the old
 * link and every phone that opened it stop at once). The link is created by the server on first need.
 *
 * When the server refuses the link (409: cancelled stay, lodging outside the app, no guest host set) the card stays
 * and states the server's reason instead of vanishing. Nothing is rendered for a new fiche, an unknown stay, a devis
 * (code NOT_A_STAY) or any other failure.
 *
 * Props (slot `reservation.cards`): reservationId, cardSx, contentSx
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Stack, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { useAppDialogs } from '../sdk';
import guestAppApi from './guestAppApi';
import { STAY_APP_TEXT } from './SasStayAppStep';

export default function StayLinkCard({ reservationId, cardSx, contentSx }) {
  const { confirm } = useAppDialogs();
  const [link, setLink] = useState(null);
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const [copied, setCopied] = useState(false);
  const stale = useRef(false);

  const load = useCallback(async () => {
    setLink(null);
    setReason(null);
    if (!reservationId) return;
    try {
      const fetched = await guestAppApi.getStayLink(reservationId);
      if (!stale.current) setLink(fetched);
    } catch (err) {
      if (!stale.current && err.status === 409 && err.code !== 'NOT_A_STAY' && err.message) setReason(err.message);
    }
  }, [reservationId]);

  useEffect(() => {
    stale.current = false;
    load();
    return () => { stale.current = true; };
  }, [load]);

  if (!link && !reason) return null;

  if (!link) {
    return (
      <Card variant="outlined" sx={cardSx}>
        <CardContent sx={contentSx}>
          <Typography variant="sectionHeader" sx={{ mb: 1 }}>Lien Mon séjour</Typography>
          <Typography variant="body2" color="text.secondary">{reason}</Typography>
        </CardContent>
      </Card>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: STAY_APP_TEXT.regenerateTitle,
      message: STAY_APP_TEXT.regenerateMessage,
      confirmLabel: 'Régénérer',
    });
    if (!ok) return;
    setBusy(true);
    setRefused(null);
    try {
      setLink(await guestAppApi.regenerateStayLink(reservationId));
    } catch (err) {
      setRefused(err.message || 'Le lien n’a pas pu être régénéré. Réessayer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Typography variant="sectionHeader" sx={{ mb: 1.5 }}>Lien Mon séjour</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexDirection: { xs: 'column', sm: 'row' } }}>
          <Box
            component="img"
            src={link.qrDataUri}
            alt="QR du lien Mon séjour"
            sx={{ width: 132, height: 132, flexShrink: 0, bgcolor: '#fff', p: 0.75, borderRadius: 1, border: 1, borderColor: 'divider' }}
          />
          <Stack spacing={1.25} sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Le portail, le livret, la boutique et le bain de ce séjour, sans rien à saisir. À partager avec les voyageurs.
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1 }}
            >
              {link.url}
            </Typography>
            {link.validUntilLabel && <Typography variant="caption" color="text.secondary">{link.validUntilLabel}</Typography>}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>
                {copied ? 'Lien copié' : 'Copier le lien'}
              </Button>
              <Button color="inherit" startIcon={<AutorenewIcon />} onClick={regenerate} disabled={busy} sx={{ minHeight: 44 }}>
                Régénérer le lien
              </Button>
            </Stack>
            {refused && <Alert severity="error">{refused}</Alert>}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
