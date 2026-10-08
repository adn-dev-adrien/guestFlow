/**
 * TokenTextField — a French/English text pair with its token chips (specs/plugins-phase-p-productisation.md
 * §6). Generic: any text that the server fills with `{{token}}` and `{{#if flag}}…{{/if}}`.
 *
 * Props:
 *   label                  string — the text's name, above the pair
 *   fr, en                 strings — the two values
 *   onChange               (lang: 'fr' | 'en', value: string) => void
 *   tokens                 string[] — chips inserting `{{token}}` at the cursor
 *   flags                  string[] — chips inserting `{{#if flag}}…{{/if}}`
 *   errorFr, errorEn       server refusals, shown under their field
 *   placeholderFr/En       shown in an empty field (e.g. the global text a property overrides)
 *   helper                 ReactNode — under the pair (e.g. « Rétablir »)
 *   disabled
 *
 * French and English sit side by side from `md`, stacked below. The chips insert into the field that
 * last had the focus (French by default).
 */
import React, { useRef, useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';

export default function TokenTextField({
  label, fr = '', en = '', onChange, tokens = [], flags = [], errorFr, errorEn,
  placeholderFr, placeholderEn, helper, disabled = false,
}) {
  const refs = { fr: useRef(null), en: useRef(null) };
  const [focused, setFocused] = useState('fr');
  const values = { fr, en };

  const insert = (snippet) => {
    const field = refs[focused].current;
    const current = values[focused] || '';
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? start;
    onChange(focused, current.slice(0, start) + snippet + current.slice(end));
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      const pos = start + snippet.length;
      field.setSelectionRange(pos, pos);
    });
  };

  const input = (lang, error, placeholder) => (
    <TextField
      label={lang === 'fr' ? 'Français' : 'Anglais'}
      value={values[lang]}
      onChange={(e) => onChange(lang, e.target.value)}
      onFocus={() => setFocused(lang)}
      inputRef={refs[lang]}
      error={Boolean(error)}
      helperText={error || ' '}
      placeholder={placeholder}
      multiline
      minRows={2}
      fullWidth
      size="small"
      disabled={disabled}
    />
  );

  return (
    <Box>
      {label && <Typography variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 2 }}>
        {input('fr', errorFr, placeholderFr)}
        {input('en', errorEn, placeholderEn)}
      </Box>
      {(tokens.length > 0 || flags.length > 0) && (
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mb: helper ? 1 : 0 }}>
          {tokens.map((t) => (
            <Chip key={`t-${t}`} size="small" label={`{{${t}}}`} onClick={() => insert(`{{${t}}}`)} disabled={disabled} />
          ))}
          {flags.map((f) => (
            <Chip key={`f-${f}`} size="small" variant="outlined" label={`si ${f}`} onClick={() => insert(`{{#if ${f}}}{{/if}}`)} disabled={disabled} />
          ))}
        </Stack>
      )}
      {helper}
    </Box>
  );
}
