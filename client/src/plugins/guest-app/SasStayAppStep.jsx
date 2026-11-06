/**
 * SasStayAppStep — the arrival SAS's « Mon séjour » step (specs/guest-app.md rules 1, 9bis a).
 *
 * While the guest app is active and the lodging is in it, this step takes the place of the « Portail » step:
 * the QR of the stay's own link (the app opens on the stay: gate, booklet, shop, bath), the gate keypad code,
 * « Partager » for the other guests (the native share sheet, else « Copier le lien »), « Régénérer le lien »
 * (the old link and every session opened from it stop at once), and a discreet « QR du portail seul » that shows
 * today's gate step for a phone with weak coverage. The link, its QR and its validity line come from the server.
 *
 * Props:
 *   reservationId: number
 *   portalCode:    string     — the gate keypad's code (Réglages), '' when there is none
 *   gateStep:      ReactNode  — the gate key's own step (gate-access), null when the stay has no key
 *
 * Contributed to the `sas.portal` slot with `leadsStep` (specs/plugins-phase-1-sdk.md rule 17).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Collapse, Stack, Typography } from '@mui/material';
import ShareIcon from '@mui/icons-material/Share';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { api, SasKeypadCode as KeypadCode, useAppDialogs } from '../sdk';

export const STAY_APP_TEXT = {
  lead: 'Flashez pour ouvrir Mon séjour : le portail, le livret, la boutique et le bain',
  share: 'Voici « Mon séjour », l’application de notre séjour : le portail, le livret et la boutique.',
  regenerateTitle: 'Régénérer le lien ?',
  regenerateMessage: 'Le lien actuel cessera de fonctionner tout de suite, sur tous les téléphones qui l’ont ouvert. '
    + 'Il faudra donner le nouveau aux voyageurs.',
  error: 'Le lien « Mon séjour » est indisponible pour ce séjour.',
};

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function ShareStayLink({ url }) {
  const [copied, setCopied] = useState(false);
  if (canShare()) {
    const share = async () => {
      try {
        await navigator.share({ title: 'Mon séjour', text: STAY_APP_TEXT.share, url });
      } catch {
        // A dismissed share sheet rejects with AbortError: nothing to say.
      }
    };
    return (
      <Button variant="contained" startIcon={<ShareIcon />} onClick={share} sx={{ minHeight: 44 }}>
        Partager
      </Button>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>
      {copied ? 'Lien copié' : 'Copier le lien'}
    </Button>
  );
}

export default function SasStayAppStep({ reservationId, portalCode, gateStep = null }) {
  const { confirm } = useAppDialogs();
  const [link, setLink] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const load = useCallback(async (regenerate = false) => {
    if (!reservationId) return;
    setBusy(true);
    try {
      setLink(await (regenerate ? api.regenerateStayLink(reservationId) : api.getStayLink(reservationId)));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [reservationId]);

  useEffect(() => { load(false); }, [load]);

  const regenerate = async () => {
    const ok = await confirm({
      title: STAY_APP_TEXT.regenerateTitle,
      message: STAY_APP_TEXT.regenerateMessage,
      confirmLabel: 'Régénérer',
    });
    if (ok) load(true);
  };

  if (!link && busy) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'center', py: 4 }}>
        <Typography variant="body2" color="text.secondary">Lecture du lien Mon séjour…</Typography>
      </Stack>
    );
  }

  const gateFallback = gateStep ? (
    <Stack spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
      <Button size="small" onClick={() => setGateOpen((open) => !open)} sx={{ minHeight: 44 }} aria-expanded={gateOpen}>
        {gateOpen ? 'Masquer le QR du portail' : 'QR du portail seul'}
      </Button>
      <Collapse in={gateOpen} sx={{ width: '100%' }} unmountOnExit>{gateStep}</Collapse>
    </Stack>
  ) : null;

  if (!link) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
        <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>{STAY_APP_TEXT.error}</Alert>
        <Button variant="outlined" onClick={() => load(false)} disabled={busy} sx={{ minHeight: 44 }}>
          {busy ? 'Lecture…' : 'Réessayer'}
        </Button>
        <KeypadCode portalCode={portalCode} secondary />
        {gateStep}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.25} sx={{ alignItems: 'center', py: 1, textAlign: 'center' }}>
      <Typography variant="body1" sx={{ maxWidth: 360, textWrap: 'balance' }}>{STAY_APP_TEXT.lead}</Typography>
      <Box
        component="img"
        src={link.qrDataUri}
        alt="QR du lien Mon séjour"
        sx={{ width: 220, maxWidth: '100%', minWidth: 180, height: 'auto', display: 'block', bgcolor: '#fff', p: 1, borderRadius: 1 }}
      />
      {link.validUntilLabel ? (
        <Typography variant="body2" color="text.secondary">{link.validUntilLabel}</Typography>
      ) : null}
      {error ? <Alert severity="error" sx={{ width: '100%', textAlign: 'left' }}>Le lien n’a pas pu être régénéré. Réessayez.</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
        <ShareStayLink url={link.url} />
        <Button variant="outlined" startIcon={<AutorenewIcon />} onClick={regenerate} disabled={busy} sx={{ minHeight: 44 }}>
          Régénérer le lien
        </Button>
      </Stack>
      {/* The keypad code stays on the same page as the QR (rule 9bis): one page for every way in. */}
      <KeypadCode portalCode={portalCode} secondary />
      {gateFallback}
    </Stack>
  );
}
