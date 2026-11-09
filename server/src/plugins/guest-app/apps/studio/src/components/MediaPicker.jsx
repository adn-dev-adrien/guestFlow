/**
 * MediaPicker — the photo of one field (a hero, a page cover, an article, an image block): its thumbnail,
 * « Choisir », « Retirer », and a warning when the chosen photo is narrower than 1 200 px (§6.3).
 *
 * Props: `label`, `mediaId`, `media` (the library rows, to draw the thumbnail), `onChange(mediaId|null)`,
 *        `ratio` (« 3:2 »), `helperText`, `removable` (default true), `emptyLabel` (what shows without a photo).
 */
import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import MediaDialog, { MIN_WIDTH, thumbOf } from './MediaDialog';

export default function MediaPicker({
  label, mediaId, media = [], onChange, ratio, helperText, removable = true, emptyLabel = 'Aucune photo',
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const current = (picked && picked.id === mediaId ? picked : null) || media.find((m) => m.id === mediaId) || null;
  const narrow = current && current.width < MIN_WIDTH;
  const aspect = ratio ? ratio.replace(':', ' / ') : '1';
  return (
    <Box>
      {label ? <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{label}{ratio ? ` (${ratio})` : ''}</Typography> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ width: 120, aspectRatio: aspect, maxHeight: 120, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          {current ? <Box component="img" src={thumbOf(current)} alt={current.altFr || ''} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageOutlinedIcon sx={{ color: 'text.secondary' }} aria-label={emptyLabel} />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>{current ? 'Changer' : 'Choisir'}</Button>
          {removable && mediaId ? <Button color="inherit" onClick={() => onChange(null)} sx={{ minHeight: 44 }}>Retirer</Button> : null}
        </Box>
      </Box>
      {narrow ? <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.text' }}>Cette photo fait {current.width} px de large : moins de 1 200 px, elle paraîtra floue sur une tablette.</Typography> : null}
      {helperText ? <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>{helperText}</Typography> : null}
      <MediaDialog
        open={open}
        ratio={ratio}
        selectedId={mediaId}
        onClose={() => setOpen(false)}
        onPick={(m) => { setPicked(m); setOpen(false); onChange(m.id); }}
      />
    </Box>
  );
}
