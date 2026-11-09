/** `gallery` (rule 18): up to 30 photos, each with an optional caption. */
import { Box } from '@mui/material';
import MediaPicker from '../MediaPicker';
import BilingualField from '../BilingualField';
import RepeatedRows from './RepeatedRows';

export default function GalleryEditor({ data, onChange, media }) {
  return (
    <RepeatedRows
      rows={data.items || []}
      onChange={(items) => onChange({ items })}
      newRow={() => ({ mediaId: null })}
      addLabel="Ajouter une photo"
      rowLabel={(i) => `la photo ${i + 1}`}
      renderRow={(row, index, update) => (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <MediaPicker label={`Photo ${index + 1}`} mediaId={row.mediaId || null} media={media} removable={false} onChange={(mediaId) => update({ mediaId })} />
          <BilingualField label="Légende (facultatif)" value={row.caption} maxLength={240} onChange={(caption) => update({ caption })} />
        </Box>
      )}
    />
  );
}
