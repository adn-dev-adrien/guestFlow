/** `place` (rule 18): a name, an address — « Itinéraire » opens it in the guest's maps app. */
import { Box, TextField } from '@mui/material';
import BilingualField from '../BilingualField';

export default function PlaceEditor({ data, onChange }) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BilingualField label="Nom du lieu" value={data.name} required maxLength={120} onChange={(name) => onChange({ ...data, name })} />
      <TextField label="Adresse" required value={data.address || ''} onChange={(e) => onChange({ ...data, address: e.target.value })} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
    </Box>
  );
}
