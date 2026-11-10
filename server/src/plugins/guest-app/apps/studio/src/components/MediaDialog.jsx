/**
 * MediaDialog — choose a photo of the studio's library, or send a new one (rule 48: photos come from the studio;
 * JPG / PNG / WEBP, 10 Mo at most, stored at 1600 / 800 / 400 px). A photo narrower than 1 200 px is flagged, and
 * the expected ratio is recalled (§6.3: hero 4:5 / 16:9, product 1:1, page cover 3:2).
 *
 * Props: `open`, `onClose`, `onPick(media)`, `ratio` (« 3:2 »), `selectedId`.
 */
import { useRef, useState } from 'react';
import {
  Alert, Box, Button, ButtonBase, CircularProgress, Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import FormDialog from '@guestflow/components/FormDialog';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import EmptyState from '@guestflow/components/EmptyState';
import LoadingState from '@guestflow/components/LoadingState';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';

export const MIN_WIDTH = 1200;

export function thumbOf(media) {
  return media ? (media.sizes && (media.sizes[400] || media.sizes['400'])) || media.url : null;
}

export default function MediaDialog({ open, onClose, onPick, ratio, selectedId }) {
  const library = useLoad(() => (open ? api.media() : Promise.resolve(null)), [open]);
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
      onPick(media);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <FormDialog open={open} onClose={onClose} title="Choisir une photo" hideSubmit cancelLabel="Fermer" maxWidth="md">
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <UploadIcon />} disabled={busy} onClick={() => input.current && input.current.click()} sx={{ minHeight: 44 }}>
            Envoyer une photo
          </Button>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            JPG, PNG ou WEBP, 10 Mo au plus.{ratio ? ` Format attendu : ${ratio}.` : ''} Au moins {MIN_WIDTH.toLocaleString('fr-FR')} px de large.
          </Typography>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files && e.target.files[0])} />
        </Box>
        {error ? <ErrorAlert message={error} /> : null}
        {library.error ? <ErrorAlert message={library.error.message} onRetry={library.reload} /> : null}
        {!library.data && !library.error ? <LoadingState variant="skeleton" rows={2} /> : null}
        {library.data && !library.data.length ? <EmptyState message="Aucune photo pour l’instant." /> : null}
        {library.data && library.data.length ? (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {library.data.map((m) => (
              <ButtonBase
                key={m.id}
                onClick={() => onPick(m)}
                aria-label={`${m.altFr || 'Photo sans texte alternatif'}${m.width < MIN_WIDTH ? ', moins de 1 200 px de large' : ''}`}
                aria-pressed={m.id === selectedId}
                sx={{
                  display: 'block', borderRadius: 2, overflow: 'hidden', border: 2, borderColor: m.id === selectedId ? 'primary.main' : 'transparent', textAlign: 'left',
                }}
              >
                <Box component="img" src={thumbOf(m)} alt="" sx={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                <Typography variant="caption" noWrap sx={{ display: 'block', px: 0.75, py: 0.5 }}>{m.altFr || `${m.width} × ${m.height}`}</Typography>
              </ButtonBase>
            ))}
          </Box>
        ) : null}
        {library.data && library.data.some((m) => m.width < MIN_WIDTH) ? (
          <Alert severity="info">Les photos de moins de 1 200 px de large paraîtront floues sur une tablette.</Alert>
        ) : null}
      </Box>
    </FormDialog>
  );
}
