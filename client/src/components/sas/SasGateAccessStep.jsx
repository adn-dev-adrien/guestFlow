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
 * a key for as long as the stay lasts. « Partager » hands the same link to the phone's native share
 * sheet (Messages, WhatsApp, mail…) so guests renting together can send it to one another; where the
 * browser has no share sheet, « Copier le lien » stands in.
 *
 * Props:
 *   reservationId: number
 *   available:     boolean  — does guestFlow hold a usable key for the stay (from the SAS payload)
 *   portalCode:    string   — the gate keypad's code (Réglages), '' when there is none
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import ShareIcon from '@mui/icons-material/Share';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../../api';

const SHARE_TEXT = "Voici l'accès au portail pour notre séjour : ouvrez ce lien sur votre téléphone.";

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function ShareLinkButton({ url }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  if (canShare()) {
    const share = async () => {
      try {
        await navigator.share({ title: 'Accès portail', text: SHARE_TEXT, url });
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
    <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>
      {copied ? 'Lien copié' : 'Copier le lien'}
    </Button>
  );
}

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
      <ShareLinkButton url={step.url} />
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
