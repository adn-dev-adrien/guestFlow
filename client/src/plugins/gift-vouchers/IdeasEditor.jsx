/**
 * IdeasEditor — the price ideas of a lodging campaign (specs/gift-vouchers.md rule 14, specs/gift-voucher-campaigns.md rule 3): each a stay to price (label + lodging +
 * nights + guests), never a bare amount. The server prices them and judges the list; its refusal is shown under the rows.
 *
 * Props: ideas ([{ label, propertyId, nights, guests }]), properties ([{ id, name }]), onChange(ideas), error?
 */
import React from 'react';
import {
  Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { LODGING_TEXTS } from './giftVoucherTexts';

const T = LODGING_TEXTS.ideas;
const MAX_IDEAS = 6;

function IdeaRow({
  idea, properties, onChange, onRemove, index,
}) {
  const set = (key) => (event) => onChange({ ...idea, [key]: event.target.value });
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: '2fr 2fr 1fr 1fr auto' }, alignItems: 'center' }}>
      <TextField
        label={T.label} size="small" value={idea.label || ''} onChange={set('label')} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
        slotProps={{ htmlInput: { maxLength: 60, 'aria-label': `${T.label} ${index + 1}` } }}
      />
      <TextField
        select label={T.property} size="small" value={idea.propertyId || ''} onChange={set('propertyId')} sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
        slotProps={{ htmlInput: { 'aria-label': `${T.property} ${index + 1}` } }}
      >
        {properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
      </TextField>
      <TextField
        label={T.nights} size="small" type="number" value={idea.nights || ''} onChange={set('nights')}
        slotProps={{ htmlInput: { min: 1, max: 60, 'aria-label': `${T.nights} ${index + 1}` } }}
      />
      <TextField
        label={T.guests} size="small" type="number" value={idea.guests || ''} onChange={set('guests')}
        slotProps={{ htmlInput: { min: 1, max: 30, 'aria-label': `${T.guests} ${index + 1}` } }}
      />
      <Tooltip title={T.remove}>
        <IconButton onClick={onRemove} aria-label={`${T.remove} ${index + 1}`} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
      </Tooltip>
    </Box>
  );
}

export default function IdeasEditor({
  ideas, properties, onChange, error = null,
}) {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2">{T.title}</Typography>
        <Typography variant="body2" color="text.secondary">{T.help}</Typography>
      </Box>
      {ideas.length === 0 ? <Typography variant="body2" color="text.secondary">{T.empty}</Typography> : null}
      {ideas.map((idea, index) => (
        <IdeaRow
          key={index} index={index} idea={idea} properties={properties}
          onChange={(next) => onChange(ideas.map((x, i) => (i === index ? next : x)))} onRemove={() => onChange(ideas.filter((_, i) => i !== index))}
        />
      ))}
      {error ? <Typography variant="body2" color="error" role="alert">{error}</Typography> : null}
      {ideas.length < MAX_IDEAS ? (
        <Box>
          <Button startIcon={<AddIcon />} onClick={() => onChange([...ideas, { label: '', propertyId: '', nights: 2, guests: 2 }])} sx={{ minHeight: 44 }}>{T.add}</Button>
        </Box>
      ) : null}
    </Stack>
  );
}
