/**
 * BilingualField — one text written in French and in English side by side (rule 19): the English may be left
 * empty, the guest then reads the French, and the field says so (« Non traduit »). Stacks under 600 px.
 *
 * Props: `label`, `value` ({ fr, en }), `onChange(next)`, `multiline`, `minRows`, `maxLength`, `required` (French),
 *        `helperText` (under both), `placeholder` ({ fr, en }).
 */
import { Box, TextField, Typography } from '@mui/material';

export default function BilingualField({
  label, value, onChange, multiline = false, minRows = 2, maxLength, required = false, helperText, placeholder = {},
}) {
  const v = value || {};
  const missingEn = Boolean(String(v.fr || '').trim()) && !String(v.en || '').trim();
  const field = (lang, title) => (
    <TextField
      label={title}
      value={v[lang] || ''}
      onChange={(e) => onChange({ ...v, [lang]: e.target.value })}
      multiline={multiline}
      minRows={multiline ? minRows : undefined}
      required={lang === 'fr' && required}
      placeholder={placeholder[lang]}
      slotProps={{ htmlInput: { maxLength, lang } }}
      helperText={lang === 'en' && missingEn ? 'Non traduit : les clients anglophones liront le français.' : ' '}
      fullWidth
    />
  );
  return (
    <Box>
      {label ? <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{label}</Typography> : null}
      <Box sx={{ display: 'grid', gap: { xs: 0, sm: 1.5 }, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        {field('fr', 'Français')}
        {field('en', 'English')}
      </Box>
      {helperText ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{helperText}</Typography> : null}
    </Box>
  );
}
