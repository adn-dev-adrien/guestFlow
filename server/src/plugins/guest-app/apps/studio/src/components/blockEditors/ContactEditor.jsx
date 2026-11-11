/** `contact` (rule 18): the lodging's emergency contacts, or one contact typed here. */
import {
  Box, FormControlLabel, Radio, RadioGroup, TextField,
} from '@mui/material';
import BilingualField from '../BilingualField';

export default function ContactEditor({ data, onChange }) {
  const inline = data.source === 'inline';
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <RadioGroup
        row
        value={inline ? 'inline' : 'lodging'}
        onChange={(e) => onChange(e.target.value === 'inline' ? { source: 'inline', name: '', phone: '' } : { source: 'lodging' })}
        aria-label="Source du contact"
      >
        <FormControlLabel value="lodging" control={<Radio />} label="Les contacts du logement" />
        <FormControlLabel value="inline" control={<Radio />} label="Un contact saisi ici" />
      </RadioGroup>
      {inline ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="Nom" required value={data.name || ''} onChange={(e) => onChange({ ...data, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} />
          <TextField label="Téléphone" type="tel" value={data.phone || ''} onChange={(e) => onChange({ ...data, phone: e.target.value })} slotProps={{ htmlInput: { maxLength: 30, inputMode: 'tel' } }} />
          <TextField label="WhatsApp" type="tel" value={data.whatsapp || ''} onChange={(e) => onChange({ ...data, whatsapp: e.target.value })} slotProps={{ htmlInput: { maxLength: 30, inputMode: 'tel' } }} />
          <TextField label="E-mail" type="email" value={data.email || ''} onChange={(e) => onChange({ ...data, email: e.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <Box sx={{ gridColumn: '1 / -1' }}><BilingualField label="Rôle (facultatif)" value={data.role} maxLength={80} onChange={(role) => onChange({ ...data, role })} /></Box>
        </Box>
      ) : null}
    </Box>
  );
}
