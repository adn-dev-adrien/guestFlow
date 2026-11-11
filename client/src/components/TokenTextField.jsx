/**
 * TokenTextField — a French/English text with its variables
 * (specs/plugins-phase-p-productisation.md §6, specs/guest-email-texts-made-simple.md rules 10, 27, 37, 38, 46).
 * Generic: any text the server fills with `{{token}}` and `{{#if flag}}…{{/if}}`.
 *
 * The field shows each variable by its French label (« ⟦Prénom du voyageur⟧ ») and hands the raw
 * `{{token}}` text to `onChange`; the labels come from the server.
 *
 * Variables are offered on demand (rule 41, UI/UX review 2026-10-18 decision 5): « + Variable », or a
 * `[` typed in a field, opens the `VariablePicker` at the field; no chip wall. The typed `[` stays in
 * the text: picking a variable replaces it, Échap keeps it. A refusal shows under the field it
 * concerns, with the server's suggestion as a one-tap « Remplacer ».
 *
 * Props:
 *   label                  string — the text's name, above the field(s)
 *   fr, en                 strings — the two raw values
 *   onChange               (lang: 'fr' | 'en', rawValue: string) => void
 *   tokens                 [{ name, label }] (or names) — the variables the picker offers
 *   flags                  [{ name, label }] (or names) — the conditions the picker offers
 *   language               'fr' | 'en' — one language at a time (rule 42): only that field; in English the
 *                          French reads above it as a reference. Omitted: both, side by side from `md`.
 *   errorFr, errorEn       server refusals under their field: a string, or `{ message, unknown, suggestion }`
 *   placeholderFr/En       shown in an empty field (e.g. the global text a property overrides)
 *   emptyHint              under an empty field without error (e.g. « Vide : texte commun utilisé »)
 *   helper                 ReactNode — under the field(s) (e.g. « Rétablir »)
 *   badge                  ReactNode — beside the label (e.g. « à relire »)
 *   onFocus                (lang) => void — a field took the focus (the page highlights its sentence)
 *   disabled, id
 *   autoFocus              focus the field on mount (an editor opened from a compact row or the preview)
 *   minRows                rows of each field (1 by default; a template body asks more)
 *
 * A variable is one unit (rule 27): the caret never stops inside ⟦…⟧ (it selects the whole of it), and
 * Backspace or Delete next to it removes it whole, so no half-variable can be left for the guest to read.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VariablePicker from './VariablePicker';
import {
  buildDictionary, toDisplay, toRaw, chipSnippet, displayError, selectionAround, deletion, replaceVariable,
} from '../utils/tokenDisplay';

const asEntry = (t) => (typeof t === 'string' ? { name: t, label: t } : t);

export default function TokenTextField({
  label, fr = '', en = '', onChange, tokens = [], flags = [], errorFr, errorEn, language,
  placeholderFr, placeholderEn, helper, badge, disabled = false, id, autoFocus = false, minRows = 1, emptyHint, onFocus,
}) {
  const refs = { fr: useRef(null), en: useRef(null) };
  const [focused, setFocused] = useState(language || 'fr');
  const [picker, setPicker] = useState(null); // { lang, start, end }
  const dict = useMemo(() => buildDictionary(tokens, flags), [tokens, flags]);
  const shown = { fr: toDisplay(fr, dict), en: toDisplay(en, dict) };
  const raw = { fr, en };
  const languages = language ? [language] : ['fr', 'en'];
  const hasVariables = tokens.length > 0 || flags.length > 0;

  // A field that never had a caret receives the variable at its end, not before its first word
  // (rule 46): a browser reports a caret at 0 for a field nobody has clicked yet.
  const hadCaret = useRef({ fr: false, en: false });

  const openPicker = (lang) => {
    const field = refs[lang].current;
    if (!hadCaret.current[lang]) {
      const endOf = (shown[lang] || '').length;
      setPicker({ lang, start: endOf, end: endOf, atEnd: true });
      return;
    }
    const start = field?.selectionStart ?? shown[lang].length;
    setPicker({ lang, start, end: field?.selectionEnd ?? start });
  };

  // Échap or a click away gives the field back, the caret where it was (after a typed `[`, kept);
  // Tab or a blur lets the focus go on.
  const closePicker = (reason) => {
    const { lang, end } = picker || {};
    setPicker(null);
    if (reason === 'tab' || reason === 'blur') return;
    requestAnimationFrame(() => {
      const field = refs[lang]?.current;
      if (!field) return;
      field.focus();
      if (end != null) field.setSelectionRange(end, end);
    });
  };

  // A `[` typed in the field stays in the text and opens the list there: picking a variable replaces
  // it, Échap keeps it (rule 41). Read on the change, not the key, so it works whatever the keyboard
  // layout (« ⌥⇧( » on a French Mac) and never while an input method is composing.
  const handleChange = (lang) => (e) => {
    const next = e.target.value;
    const previous = shown[lang] || '';
    const pos = e.target.selectionStart;
    onChange(lang, toRaw(next, dict));
    const composing = e.nativeEvent && e.nativeEvent.isComposing;
    const typedBracket = hasVariables && !composing && pos > 0 && next.length === previous.length + 1
      && next[pos - 1] === '[' && next.slice(0, pos - 1) + next.slice(pos) === previous;
    if (typedBracket) setPicker({ lang, start: pos - 1, end: pos });
  };

  const insert = (entry, kind) => {
    const { lang, end, atEnd } = picker;
    const field = refs[lang].current;
    const current = shown[lang] || '';
    const { snippet: bare, caret: bareCaret } = chipSnippet(entry, kind, dict);
    // Appended to a text that does not end in a space: one space keeps the variable off the last word.
    const spaced = atEnd && current.length > 0 && !/\s$/.test(current);
    const snippet = spaced ? ` ${bare}` : bare;
    const caret = spaced ? bareCaret + 1 : bareCaret;
    const { start } = picker;
    hadCaret.current[lang] = true;
    onChange(lang, toRaw(current.slice(0, start) + snippet + current.slice(end), dict));
    setPicker(null);
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

  // A refusal, in the brackets the field shows, with the closest variable as a one-tap fix (rule 41).
  const refusalOf = (lang, error) => {
    const { message, unknown, suggestion } = typeof error === 'string' ? { message: error } : error;
    const fix = suggestion && unknown ? suggestion : null;
    return (
      <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
        <span>{displayError(message, dict)}</span>
        {fix && (
          <>
            <span>{`${fix.label} ?`}</span>
            <Button
              size="small"
              variant="outlined"
              color="error"
              sx={{ minHeight: 32, py: 0, '@media (pointer: coarse)': { minHeight: 44 } }}
              onClick={() => onChange(lang, replaceVariable(raw[lang], unknown, fix.name))}
            >
              Remplacer
            </Button>
          </>
        )}
      </Box>
    );
  };

  const errors = { fr: errorFr, en: errorEn };
  const placeholders = { fr: placeholderFr, en: placeholderEn };
  const helperOf = (lang) => {
    if (errors[lang]) return refusalOf(lang, errors[lang]);
    if (emptyHint && !String(shown[lang]).trim()) return emptyHint;
    return language ? undefined : ' ';
  };

  const input = (lang) => (
    <TextField
      key={lang}
      id={id ? `${id}-${lang}` : undefined}
      label={language ? undefined : (lang === 'fr' ? 'Français' : 'Anglais')}
      value={shown[lang]}
      onChange={handleChange(lang)}
      onFocus={() => { setFocused(lang); if (onFocus) onFocus(lang); }}
      onPointerUp={() => { hadCaret.current[lang] = true; }}
      onKeyUp={(e) => { if (e.key !== 'Tab' && e.key !== 'Shift') hadCaret.current[lang] = true; }}
      onSelect={handleSelect(lang)}
      onKeyDown={handleKeyDown(lang)}
      inputRef={refs[lang]}
      error={Boolean(errors[lang])}
      helperText={helperOf(lang)}
      placeholder={placeholders[lang] ? toDisplay(placeholders[lang], dict) : undefined}
      slotProps={{
        ...(placeholders[lang] && !language ? { inputLabel: { shrink: true } } : {}),
        htmlInput: language
          ? { 'aria-label': `${label || 'Texte'} — ${lang === 'fr' ? 'français' : 'anglais'}`, lang }
          : { lang },
        formHelperText: { component: 'div' },
      }}
      multiline
      minRows={minRows}
      fullWidth
      size="small"
      disabled={disabled}
      autoFocus={autoFocus && lang === languages[0]}
    />
  );

  return (
    <Box>
      {(label || badge || hasVariables) && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', minHeight: 32 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
            {label && <Typography variant="subtitle2">{label}</Typography>}
            {badge}
          </Stack>
          {hasVariables && (
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openPicker(language || focused)}
              disabled={disabled}
              aria-haspopup="listbox"
              sx={{ flexShrink: 0, minHeight: { xs: 44, sm: 32 }, '@media (pointer: coarse)': { minHeight: 44 } }}
            >
              Variable
            </Button>
          )}
        </Stack>
      )}
      {language === 'en' && (
        <Typography
          variant="body2"
          color="text.secondary"
          lang="fr"
          data-testid="french-reference"
          sx={{ mb: 1, pl: 1.5, borderLeft: 2, borderColor: 'divider', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {shown.fr || (placeholderFr ? toDisplay(placeholderFr, dict) : 'Pas de texte français')}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: language ? '1fr' : '1fr 1fr' }, columnGap: 2 }}>
        {languages.map((lang) => input(lang))}
      </Box>
      {helper}
      <VariablePicker
        open={Boolean(picker)}
        anchorEl={picker ? refs[picker.lang].current : null}
        variables={tokens.map(asEntry)}
        conditions={flags.map(asEntry)}
        onPick={insert}
        onClose={closePicker}
      />
    </Box>
  );
}
