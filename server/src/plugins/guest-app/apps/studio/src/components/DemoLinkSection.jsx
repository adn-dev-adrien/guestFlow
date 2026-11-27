/**
 * DemoLinkSection — « Lien de démo » (specs/guest-app/guest-app-demo-mode.md rules 1, 2): the one link that opens the guest app on a
 * fictitious stay, with its QR, « Copier le lien », « Ouvrir » and « Régénérer le lien » (after a confirmation: the old link and every
 * session opened from it stop at once). The link is created the first time the card is shown.
 */
import { useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import ConfirmDialog from '@guestflow/components/ConfirmDialog';
import Section from './Section';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';

export default function DemoLinkSection() {
  const link = useLoad(() => api.demoLink(), []);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(link.data.url);
      setNotice('Lien copié.');
    } catch {
      setError('Copie impossible : sélectionner le lien et le copier à la main.');
    }
  };

  const regenerate = async () => {
    setConfirming(false);
    setError(null);
    try {
      link.setData(await api.regenerateDemoLink());
      setNotice('Nouveau lien : l’ancien ne s’ouvre plus.');
    } catch (err) {
      setError(err.message);
    }
  };

  let body;
  if (link.error) body = <ErrorAlert message={link.error.message} onRetry={link.reload} />;
  else if (!link.data) body = <LoadingState />;
  else {
    body = (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' }, alignItems: 'center' }}>
        <Box component="img" src={link.data.qrDataUri} alt="QR code du lien de démo" sx={{ width: 160, height: 160, justifySelf: { xs: 'center', sm: 'start' } }} />
        <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>
          <Typography variant="body2" sx={{ wordBreak: 'break-all', color: 'text.secondary' }}>{link.data.url}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>Copier le lien</Button>
            <Button variant="outlined" startIcon={<OpenInNewIcon />} component="a" href={link.data.url} target="_blank" rel="noopener noreferrer" sx={{ minHeight: 44 }}>Ouvrir</Button>
            <Button variant="outlined" color="error" startIcon={<AutorenewIcon />} onClick={() => setConfirming(true)} sx={{ minHeight: 44 }}>Régénérer le lien</Button>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Section
      id="demo"
      title="Lien de démo"
      description="Un séjour fictif, sans paiement ni effet réel. À montrer, pas à envoyer à un voyageur."
    >
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      {body}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={regenerate}
        title="Régénérer le lien de démo ?"
        message="L’ancien lien et le QR déjà montrés ne s’ouvriront plus, et les démos en cours s’arrêtent. Il faudra scanner le nouveau."
        confirmLabel="Régénérer"
      />
    </Section>
  );
}
