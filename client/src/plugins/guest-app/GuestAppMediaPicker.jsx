/**
 * GuestAppMediaPicker — picks an article photo from the studio's library, or adds one (specs/guest-app.md rule 22:
 * « Photo » of the editor's « Application clients » section; the photos are the studio's, rule 48).
 *
 * Props:
 *   open      boolean
 *   media     Array<{ id, url, sizes, width, alt }> | null   the library (null while it loads)
 *   selected  number | null                                the current photo
 *   onClose   () => void
 *   onPick    (mediaId: number) => void                    a photo chosen (the dialog then closes)
 *   onUploaded (media) => void                             a new photo stored by the server
 */
import React, { useRef, useState } from 'react';
import {
  Alert, Box, Button, ButtonBase, CircularProgress, Stack, Typography,
} from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import { FormDialog, LoadingState } from '../sdk';
import guestAppApi from './guestAppApi';

const thumbOf = (m) => (m.sizes && (m.sizes['400'] || m.sizes[400])) || m.url;

export default function GuestAppMediaPicker({
  open, media, selected, onClose, onPick, onUploaded,
}) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const stored = await guestAppApi.uploadMedia(file);
      onUploaded(stored);
      onPick(stored.id);
    } catch (err) {
      setError(err.message || 'La photo n’a pas pu être envoyée.');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <FormDialog open={open} onClose={onClose} title="Photo de l’article" hideSubmit cancelLabel="Fermer" maxWidth="md">
      <Stack spacing={2}>
        <Box>
          <Button
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateOutlinedIcon />}
            disabled={uploading}
            onClick={() => input.current && input.current.click()}
            sx={{ minHeight: 44 }}
          >
            Ajouter une photo
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            data-testid="guest-app-media-file"
            onChange={(e) => upload(e.target.files && e.target.files[0])}
          />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
            JPG, PNG ou WEBP, 10 Mo au plus. Carrée, en lumière naturelle.
          </Typography>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {media === null ? <LoadingState variant="skeleton" rows={2} /> : (
          media.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Aucune photo pour l’instant : ajoutez la première.</Typography>
          ) : (
            <Box
              role="listbox"
              aria-label="Photos du Studio"
              sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 1 }}
            >
              {media.map((m) => {
                const isSelected = m.id === selected;
                return (
                  <ButtonBase
                    key={m.id}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={m.altFr || m.alt || `Photo ${m.id}`}
                    onClick={() => onPick(m.id)}
                    sx={(t) => ({
                      aspectRatio: '1 / 1',
                      borderRadius: 1,
                      overflow: 'hidden',
                      outline: isSelected ? `2px solid ${t.palette.primary.main}` : `1px solid ${t.palette.divider}`,
                      outlineOffset: isSelected ? 2 : 0,
                      '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 },
                    })}
                  >
                    <Box component="img" src={thumbOf(m)} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </ButtonBase>
                );
              })}
            </Box>
          )
        )}
      </Stack>
    </FormDialog>
  );
}

export { thumbOf };
