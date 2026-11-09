/** `image` (rule 18): one photo and its optional caption. */
import { Box } from '@mui/material';
import MediaPicker from '../MediaPicker';
import BilingualField from '../BilingualField';

export default function ImageEditor({ data, onChange, media }) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <MediaPicker mediaId={data.mediaId || null} media={media} removable={false} onChange={(mediaId) => onChange({ ...data, mediaId })} />
      <BilingualField label="Légende (facultatif)" value={data.caption} maxLength={240} onChange={(caption) => onChange({ ...data, caption })} />
    </Box>
  );
}
