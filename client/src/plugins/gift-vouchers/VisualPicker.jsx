/**
 * VisualPicker — one front picked in the visual library, with the thumbnail and « Ajouter un visuel » inline (specs/gift-voucher-campaigns.md rules 7, 47). Only the
 * visuals meant for this face are listed; the server judges the choice on save.
 *
 * Props: label, value (visual id | null | ''), onChange(id | null), visuals (the library), use ('voucher' | 'merchant'), onAdded(visual), error?, optional?
 */
import React, { useState } from 'react';
import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import giftVouchersApi from './giftVouchersApi';
import VisualFormDialog from './VisualFormDialog';
import { CAMPAIGN_TEXTS } from './giftVoucherTexts';

const T = CAMPAIGN_TEXTS.editor;

export default function VisualPicker({
  label, value, onChange, visuals, use, onAdded, error = null,
}) {
  const [adding, setAdding] = useState(false);
  const eligible = visuals.filter((v) => v.use === use || v.use === 'both');
  const chosen = visuals.find((v) => v.id === value);

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {chosen ? (
          <Box component="img" src={giftVouchersApi.visualImageUrl(chosen)} alt="" sx={{ width: 56, height: 80, objectFit: 'cover', borderRadius: 0.5, border: '1px solid', borderColor: 'divider', flexShrink: 0 }} />
        ) : null}
        <TextField
          select fullWidth size="small" label={label} value={value || ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          error={Boolean(error)} helperText={error || undefined}
        >
          <MenuItem value="">{T.noVisual}</MenuItem>
          {eligible.map((v) => <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>)}
        </TextField>
      </Stack>
      <Box>
        <Button size="small" startIcon={<AddPhotoAlternateOutlinedIcon />} onClick={() => setAdding(true)} sx={{ minHeight: 44 }}>{T.addVisual}</Button>
      </Box>
      <VisualFormDialog
        open={adding} onClose={() => setAdding(false)} defaultUse={use}
        onSaved={(saved) => { setAdding(false); onAdded(saved); onChange(saved.id); }}
      />
    </Stack>
  );
}
