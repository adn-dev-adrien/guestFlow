// Props: tiers [{ fromHour, percent }] (the typed values, kept as typed), onChange(nextTiers).
// The hourly degressivity table of a resource (specs/gift-voucher-campaigns.md rule 43): one row per band
// « from the Nth hour, X % off ». It only edits the rows; the server judges them and its refusal sentence is
// drawn by the resource form.
import React from 'react';
import {
  Box, Button, IconButton, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';

export default function DegressiveTiersEditor({ tiers, onChange }) {
  const rows = Array.isArray(tiers) ? tiers : [];
  const setRow = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const addRow = () => {
    const last = rows.length > 0 ? Number(rows[rows.length - 1].fromHour) || 1 : 1;
    onChange([...rows, { fromHour: last + 1, percent: 0 }]);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Dégressivité par heure
      </Typography>
      {rows.length === 0 && (
        <Typography variant="caption" color="text.secondary">Aucune remise : chaque heure au même tarif.</Typography>
      )}
      {rows.map((row, index) => (
        // The rows have no identity of their own: the position is the key.
        // eslint-disable-next-line react/no-array-index-key
        <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            label="À partir de la Nᵉ heure"
            type="number"
            size="small"
            value={row.fromHour ?? ''}
            onChange={(e) => setRow(index, { fromHour: e.target.value === '' ? '' : Number(e.target.value) })}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { min: 2, step: 1, 'aria-label': `Ligne ${index + 1} · à partir de la Nᵉ heure` } }}
          />
          <TextField
            label="Remise (%)"
            type="number"
            size="small"
            value={row.percent ?? ''}
            onChange={(e) => setRow(index, { percent: e.target.value === '' ? '' : Number(e.target.value) })}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { min: 0, max: 100, step: 1, 'aria-label': `Ligne ${index + 1} · remise` } }}
          />
          <Tooltip title="Retirer la ligne">
            <IconButton
              aria-label={`Retirer la ligne ${index + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={addRow}>Ajouter une ligne</Button>
      </Box>
    </Box>
  );
}
