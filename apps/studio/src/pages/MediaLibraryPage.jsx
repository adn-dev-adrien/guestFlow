/**
 * Photos — the studio's library (rule 48): every photo sent, at the three sizes the server stored, with its
 * alternative text in FR and EN (what a screen reader says to a guest). A photo under 1 200 px is flagged.
 */
import { useRef, useState } from 'react';
import {
  Box, Button, CircularProgress, Paper, Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import EmptyState from '@guestflow/components/EmptyState';
import StatusBadge from '@guestflow/components/StatusBadge';
import StudioPage from '../components/StudioPage';
import BilingualField from '../components/BilingualField';
import { MIN_WIDTH, thumbOf } from '../components/MediaDialog';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';

function MediaCard({ media, onSaved }) {
  const [alt, setAlt] = useState({ fr: media.altFr || '', en: media.altEn || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = alt.fr !== (media.altFr || '') || alt.en !== (media.altEn || '');
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveMedia(media.id, { altFr: alt.fr, altEn: alt.en }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', display: 'grid' }}>
      <Box component="img" src={thumbOf(media)} alt={media.altFr || ''} sx={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', display: 'block' }} />
      <Box sx={{ p: 1.5, display: 'grid', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{media.width} × {media.height} px</Typography>
          {media.width < MIN_WIDTH ? <StatusBadge status="warning" label="Moins de 1 200 px" /> : null}
        </Box>
        {error ? <ErrorAlert message={error} /> : null}
        <BilingualField label="Texte alternatif" value={alt} maxLength={200} onChange={setAlt} />
        <Box>
          <Button variant="outlined" disabled={!dirty || busy} onClick={save} sx={{ minHeight: 44 }}>Enregistrer</Button>
        </Box>
      </Box>
    </Paper>
  );
}

export default function MediaLibraryPage() {
  const library = useLoad(() => api.media(), []);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const media = await api.uploadMedia(file);
      library.setData((list) => [media, ...(list || [])]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <StudioPage
      bar={(
        <PageActionBar
          title="Photos"
          actionsBefore={[{
            icon: busy ? <CircularProgress size={18} /> : <UploadIcon />, tooltip: 'Envoyer une photo', label: 'Envoyer une photo', onClick: () => input.current && input.current.click(), color: 'info', disabled: busy,
          }]}
        />
      )}
    >
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files && e.target.files[0])} />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        JPG, PNG ou WEBP, 10 Mo au plus, gardées en 1 600, 800 et 400 px. Formats attendus : accueil 4:5 (16:9 sur ordinateur), couverture de page 3:2, article 1:1.
      </Typography>
      {error ? <ErrorAlert message={error} /> : null}
      {library.error ? <ErrorAlert message={library.error.message} onRetry={library.reload} /> : null}
      {!library.data && !library.error ? <LoadingState /> : null}
      {library.data && !library.data.length ? <EmptyState message="Aucune photo pour l’instant." actionLabel="Envoyer une photo" onAction={() => input.current && input.current.click()} /> : null}
      {library.data && library.data.length ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {library.data.map((m) => <MediaCard key={m.id} media={m} onSaved={(next) => library.setData((list) => list.map((x) => (x.id === next.id ? next : x)))} />)}
        </Box>
      ) : null}
    </StudioPage>
  );
}
