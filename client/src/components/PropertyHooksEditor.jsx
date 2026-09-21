/**
 * PropertyHooksEditor — « Accroche par logement » block of the J-7 template dialog
 * (specs/settings-rationalization.md rule 17c). One FR / EN pair per property; the sentence the J-7
 * email inserts through {{propertyHook}}, after « Plus qu'une semaine, et vous serez … ». Empty →
 * the sentence is left out.
 *
 * Props:
 *   hooks:    [{ propertyId, name, emailHook, emailHookEn }] | null (null = loading)
 *   onChange: (propertyId, key: 'emailHook' | 'emailHookEn', value) => void
 */
import React from 'react';
import { Box, CircularProgress, Stack, TextField, Typography } from '@mui/material';

export default function PropertyHooksEditor({ hooks, onChange }) {
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Accroche par logement</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Insérée par <code>{'{{propertyHook}}'}</code>, après « Plus qu&apos;une semaine, et vous serez … ».
        Vide : la phrase est omise.
      </Typography>
      {hooks === null ? <CircularProgress size={20} /> : (
        <Stack spacing={2}>
          {hooks.map((h) => (
            <Box key={h.propertyId}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>{h.name}</Typography>
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                <TextField
                  label="Français"
                  size="small"
                  fullWidth
                  multiline
                  value={h.emailHook || ''}
                  onChange={(e) => onChange(h.propertyId, 'emailHook', e.target.value)}
                  slotProps={{ htmlInput: { 'aria-label': `Accroche ${h.name} (français)` } }}
                />
                <TextField
                  label="Anglais"
                  size="small"
                  fullWidth
                  multiline
                  value={h.emailHookEn || ''}
                  onChange={(e) => onChange(h.propertyId, 'emailHookEn', e.target.value)}
                  slotProps={{ htmlInput: { 'aria-label': `Accroche ${h.name} (anglais)` } }}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
