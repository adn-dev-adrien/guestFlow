/**
 * TokenTextField — a French/English text pair with its variable chips
 * (specs/plugins-phase-p-productisation.md §6, specs/guest-email-texts-made-simple.md rule 10).
 * Generic: any text the server fills with `{{token}}` and `{{#if flag}}…{{/if}}`.
 *
 * The field shows each variable by its French label (« ⟦Prénom du voyageur⟧ ») and hands the raw
 * `{{token}}` text to `onChange`; the labels and the chips come from the server.
 *
 * Props:
 *   label                  string — the text's name, above the pair
 *   fr, en                 strings — the two raw values
 *   onChange               (lang: 'fr' | 'en', rawValue: string) => void
 *   tokens                 [{ name, label }] (or names) — chips inserting a variable at the cursor
 *   flags                  [{ name, label }] (or names) — chips inserting a condition
 *   errorFr, errorEn       server refusals, shown under their field
 *   placeholderFr/En       shown in an empty field (e.g. the global text a property overrides); the
 *                          label stays above the field so the placeholder is seen without focus
 *   emptyHint              under an empty field without error (e.g. « Vide : texte commun utilisé »)
 *   helper                 ReactNode — under the pair (e.g. « Rétablir »)
 *   badge                  ReactNode — beside the label (e.g. « à relire »)
 *   disabled, id
 *   autoFocus              focus the French field on mount (an editor opened from a compact row)
 *   minRows                rows of each field (1 by default; a template body asks more)
 *
 * A variable is one unit (specs/guest-email-texts-made-simple.md rule 26): the caret never stops
 * inside ⟦…⟧ (it selects the whole of it), and Backspace or Delete next to it removes it whole, so
 * no half-variable can be left for the guest to read.
 *
 * French and English sit side by side from `md`, stacked below. The chips insert into the field that
 * last had the focus (French by default).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import {
  buildDictionary, toDisplay, toRaw, chipSnippet, chipLabel, displayError, selectionAround, deletion,
} from '../utils/tokenDisplay';

export default function TokenTextField({
  label, fr = '', en = '', onChange, tokens = [], flags = [], errorFr, errorEn,
  placeholderFr, placeholderEn, helper, badge, disabled = false, id, autoFocus = false, minRows = 1, emptyHint,
}) {
  const refs = { fr: useRef(null), en: useRef(null) };
  const [focused, setFocused] = useState('fr');
  const dict = useMemo(() => buildDictionary(tokens, flags), [tokens, flags]);
  const shown = { fr: toDisplay(fr, dict), en: toDisplay(en, dict) };

  const insert = (entry, kind) => {
    const field = refs[focused].current;
    const current = shown[focused] || '';
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? start;
    const { snippet, caret } = chipSnippet(entry, kind, dict);
    onChange(focused, toRaw(current.slice(0, start) + snippet + current.slice(end), dict));
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(start + caret, start + caret);
    });
  };

  // The caret inside a variable selects all of it: typing then replaces the variable, never splits it.
  const handleSelect = (lang) => (e) => {
    const field = e.target;
    if (field.selectionStart !== field.selectionEnd) return;
    const span = selectionAround(shown[lang], field.selectionStart);
    if (span) field.setSelectionRange(span[0], span[1]);
  };

  const handleKeyDown = (lang) => (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const field = e.target;
    if (field.selectionStart !== field.selectionEnd) return;
    const next = deletion(shown[lang], field.selectionStart, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(lang, toRaw(next.text, dict));
    requestAnimationFrame(() => field.setSelectionRange(next.caret, next.caret));
  };

  const input = (lang, error, placeholder) => (
    <TextField
      id={id ? `${id}-${lang}` : undefined}
      label={lang === 'fr' ? 'Français' : 'Anglais'}
      value={shown[lang]}
      onChange={(e) => onChange(lang, toRaw(e.target.value, dict))}
      onFocus={() => setFocused(lang)}
      onSelect={handleSelect(lang)}
      onKeyDown={handleKeyDown(lang)}
      inputRef={refs[lang]}
      error={Boolean(error)}
      helperText={error ? displayError(error, dict) : ((emptyHint && !String(shown[lang]).trim()) ? emptyHint : ' ')}
      placeholder={placeholder ? toDisplay(placeholder, dict) : undefined}
      slotProps={placeholder ? { inputLabel: { shrink: true } } : undefined}
      multiline
      minRows={minRows}
      fullWidth
      size="small"
      disabled={disabled}
      autoFocus={autoFocus && lang === 'fr'}
    />
  );

  return (
    <Box>
      {(label || badge) && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {label && <Typography variant="subtitle2">{label}</Typography>}
          {badge}
        </Stack>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 2 }}>
        {input('fr', errorFr, placeholderFr)}
        {input('en', errorEn, placeholderEn)}
      </Box>
      {(tokens.length > 0 || flags.length > 0) && (
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mb: helper ? 1 : 0 }}>
          {tokens.map((t) => (
            <Chip key={`t-${t.name || t}`} size="small" color="info" variant="outlined" label={chipLabel(t, 'var', dict)}
              onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t, 'var')} disabled={disabled} />
          ))}
          {flags.map((f) => (
            <Chip key={`f-${f.name || f}`} size="small" variant="outlined" label={chipLabel(f, 'cond', dict)}
              onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f, 'cond')} disabled={disabled} />
          ))}
        </Stack>
      )}
      {helper}
    </Box>
  );
}
