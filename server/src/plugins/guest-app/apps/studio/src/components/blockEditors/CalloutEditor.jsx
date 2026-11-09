/** `callout` (rule 18): an information or a warning, an optional title, its text. */
import { Box, MenuItem, TextField } from '@mui/material';
import BilingualField from '../BilingualField';

export default function CalloutEditor({ data, onChange }) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <TextField select label="Ton" value={data.tone || 'info'} onChange={(e) => onChange({ ...data, tone: e.target.value })} sx={{ maxWidth: 260 }}>
        <MenuItem value="info">Information</MenuItem>
        <MenuItem value="warning">Avertissement</MenuItem>
      </TextField>
      <BilingualField label="Titre (facultatif)" value={data.title} maxLength={120} onChange={(title) => onChange({ ...data, title })} />
      <BilingualField label="Texte" value={data.text} multiline required maxLength={2000} onChange={(text) => onChange({ ...data, text })} />
    </Box>
  );
}
