/**
 * OneTimeCodeField — the field of a one-time code: a 6-digit code from an authenticator app or an
 * email, or a backup code (« k7m2p-x9q4r ») when `allowBackup` is set
 * (specs/hosting-h2-account-security.md rules 7, 32–34). Generic: the instance's login, « Mon compte »
 * and the console's operator login use it.
 *
 * ONE native input (`autocomplete="one-time-code"`, `inputmode="numeric"`), transparent, laid over six
 * drawn cells that mirror its value: autofill and paste keep working as on any field, which six
 * separate inputs would break. On a phone it opens the numeric keypad and offers the code just
 * received. With `allowBackup`, « Utiliser un code de secours » switches to the letter keyboard and one
 * wide cell (and back with `primaryLinkLabel`); a backup code typed or pasted in the numeric field is
 * still taken as it is.
 *
 * `onComplete(code)` fires once when the 6th digit arrives (or a whole backup code): the caller submits
 * there and guards against a second call while busy. A refusal is given back through `error`: the
 * message sits under the cells, the cells shake (colour only under reduced motion) and the digits stay
 * selected, so the next keystroke replaces them. The caller clears `error` when the value changes.
 *
 * The code is taken out of whatever arrives (rule 35, `extractCode`): « Votre code : 123 456 », a
 * backup code without its dash. `incompleteCodeMessage(value)` says why a value cannot be sent yet.
 *
 * A complete code is selected whole when the field takes focus or is clicked, and when a refused complete
 * code receives more digits only what was just typed or pasted is kept: after a refusal the next code
 * replaces the refused one instead of being cut to its first 6 digits. `readOnly` (rather than
 * `disabled`) holds the field while a check is in flight, so a phone keeps the focus and its keyboard.
 *
 * Props: value, onChange(value: string), onComplete(code), label ('Code à 6 chiffres', the input's
 *        accessible name), allowBackup (false), primaryLinkLabel ('Utiliser le code de l’application'),
 *        error (string — the refusal, shown under the cells), helperText (shown when there is no error),
 *        autoFocus, disabled, readOnly, id.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

const BACKUP_LABEL = 'Code de secours';
const BACKUP_PLACEHOLDER = 'xxxxx-xxxxx';
const CODE_LENGTH = 6;
const BACKUP_RE = /^[a-z0-9]{5}-[a-z0-9]{5}$/;

export function isCompleteCode(value, allowBackup = false) {
  const v = String(value || '');
  return /^\d{6}$/.test(v) || (allowBackup && BACKUP_RE.test(v));
}

const SIX_DIGITS_RE = /(?<![\p{L}\p{N}])(\d{3})[\s.-]?(\d{3})(?![\p{L}\p{N}])/u;
const BACKUP_IN_TEXT_RE = /(?<![a-z0-9])([a-z0-9]{5})[\s-]?([a-z0-9]{5})(?![a-z0-9])/;

/**
 * The code inside what was typed or pasted (rule 35): « Votre code : 123 456 » → « 123456 »,
 * « 123-456 » → « 123456 », a backup code with or without its dash → « xxxxx-xxxxx », digits beyond
 * the 6th dropped. While a backup code is being typed, its dash is put back after the 5th character.
 */
export function extractCode(raw, { allowBackup = false, backup = false } = {}) {
  const text = String(raw || '').toLowerCase();
  const six = SIX_DIGITS_RE.exec(text);
  if (six && !backup) return six[1] + six[2];
  if (allowBackup) {
    const whole = BACKUP_IN_TEXT_RE.exec(text);
    if (whole && (backup || /[a-z-]/.test(whole[0]))) return `${whole[1]}-${whole[2]}`;
    if (backup || /[a-z]/.test(text)) {
      const compact = text.replace(/[^a-z0-9]/g, '').slice(0, 10);
      return compact.length > 5 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
    }
  }
  return text.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** Why a value cannot be sent yet — said under the field when Enter is pressed (rule 35). */
export function incompleteCodeMessage(value) {
  return /[a-z-]/i.test(String(value || ''))
    ? 'Code de secours incomplet : 10 caractères (xxxxx-xxxxx).'
    : 'Code incomplet : 6 chiffres.';
}

export default function OneTimeCodeField({
  value = '',
  onChange,
  onComplete,
  label = 'Code à 6 chiffres',
  allowBackup = false,
  primaryLinkLabel = 'Utiliser le code de l’application',
  error = '',
  helperText,
  autoFocus,
  disabled,
  readOnly,
  id,
}) {
  const [backupMode, setBackupMode] = useState(false);
  const [focused, setFocused] = useState(false);
  const [allSelected, setAllSelected] = useState(false);
  const [shakes, setShakes] = useState(0);
  const inputRef = useRef(null);
  const autoId = useId();
  const inputId = id || `otp-${autoId}`;
  const messageId = `${inputId}-message`;

  const hasLetters = /[a-z]/i.test(value);
  const textMode = allowBackup && (backupMode || hasLetters);
  const shownLabel = allowBackup && backupMode ? BACKUP_LABEL : label;
  const clean = (raw) => extractCode(raw, { allowBackup, backup: allowBackup && backupMode });

  // A refusal: shake once, and select the digits so the next keystroke replaces them.
  useEffect(() => {
    if (!error) return;
    setShakes((n) => n + 1);
    const input = inputRef.current;
    if (input && input.value) {
      input.focus();
      input.select();
      setAllSelected(true);
    }
  }, [error]);

  const handleChange = (e) => {
    const raw = e.target.value;
    // A REFUSED complete code that receives more: keep what was just inserted (it ends at the caret), not
    // the first characters of the refused code followed by the new ones. Without a refusal an extra digit
    // after a complete code is still dropped (rule 35): the code may already be on its way.
    const grew = raw.length - value.length;
    const caret = e.target.selectionStart;
    const inserted = error && isCompleteCode(value, allowBackup) && grew > 0 && Number.isInteger(caret) && caret >= grew ? raw.slice(caret - grew, caret) : raw;
    const next = clean(inserted);
    setAllSelected(false);
    onChange(next);
    if (onComplete && next !== value && isCompleteCode(next, allowBackup)) onComplete(next);
  };

  const selectWhole = () => {
    const input = inputRef.current;
    if (input && isCompleteCode(input.value, allowBackup)) input.select();
  };

  const handleSelect = (e) => {
    const { selectionStart, selectionEnd, value: v } = e.target;
    setAllSelected(Boolean(v) && selectionStart === 0 && selectionEnd === v.length);
  };

  const switchMode = () => {
    setBackupMode((on) => !on);
    setAllSelected(false);
    onChange('');
    if (inputRef.current) inputRef.current.focus();
  };

  const cellSx = (active, selected) => ({
    display: 'grid',
    placeItems: 'center',
    minWidth: 0,
    borderRadius: '12px',
    border: '1px solid',
    borderColor: error ? 'error.main' : (theme) => alpha(theme.palette.text.primary, 0.3),
    bgcolor: selected ? (theme) => alpha(theme.palette.primary.main, 0.12) : 'background.paper',
    boxShadow: active ? (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
    ...(active ? { borderColor: error ? 'error.main' : 'primary.main' } : {}),
    fontSize: '1.4rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'text.primary',
    transition: 'border-color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out',
  });

  const cells = textMode ? (
    <Box sx={{ ...cellSx(focused && !allSelected, allSelected && Boolean(value)), fontSize: '1.15rem', letterSpacing: '0.06em' }}>
      {value || <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>{BACKUP_PLACEHOLDER}</Box>}
    </Box>
  ) : Array.from({ length: CODE_LENGTH }, (_, i) => (
    <Box
      key={i}
      data-testid="otp-cell"
      sx={cellSx(focused && !allSelected && i === Math.min(value.length, CODE_LENGTH - 1), allSelected && Boolean(value[i]))}
    >
      {value[i] || ''}
    </Box>
  ));

  const message = error || helperText;

  return (
    <Box sx={{ maxWidth: 420 }}>
      <Box
        sx={{
          position: 'relative',
          height: 56,
          opacity: disabled ? 0.6 : 1,
          '@keyframes gf-otp-shake': {
            '20%, 60%': { transform: 'translateX(-6px)' },
            '40%, 80%': { transform: 'translateX(6px)' },
          },
        }}
      >
        <Box
          key={shakes}
          aria-hidden="true"
          sx={{
            display: 'grid',
            gridTemplateColumns: textMode ? '1fr' : `repeat(${CODE_LENGTH}, minmax(0, 1fr))`,
            gap: 1,
            height: '100%',
            pointerEvents: 'none',
            animation: shakes > 0 ? 'gf-otp-shake 320ms cubic-bezier(.36,.07,.19,.97)' : 'none',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {cells}
        </Box>
        <Box
          component="input"
          ref={inputRef}
          id={inputId}
          name="one-time-code"
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onFocus={() => { setFocused(true); setTimeout(selectWhole, 0); }}
          onClick={selectWhole}
          onBlur={() => { setFocused(false); setAllSelected(false); }}
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          inputMode={textMode ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={shownLabel}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={message ? messageId : undefined}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            m: 0,
            p: 0,
            border: 0,
            outline: 'none',
            bgcolor: 'transparent',
            // Transparent ink rather than `opacity: 0`, which password managers read as a hidden field.
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            caretColor: 'transparent',
            fontSize: 16,
            cursor: disabled ? 'default' : 'text',
            '&::selection': { background: 'transparent', color: 'transparent' },
            '&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus': {
              WebkitTextFillColor: 'transparent',
              WebkitBoxShadow: '0 0 0 1000px transparent inset',
              transition: 'background-color 600000s 0s',
            },
          }}
        />
      </Box>
      <Typography
        id={messageId}
        variant="body2"
        role={error ? 'alert' : undefined}
        aria-live={error ? undefined : 'polite'}
        sx={{ minHeight: '1.5em', mt: 0.75, color: error ? 'error.main' : 'text.secondary' }}
      >
        {message || ''}
      </Typography>
      {allowBackup && (
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={switchMode}
          disabled={disabled}
          sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          {backupMode ? primaryLinkLabel : 'Utiliser un code de secours'}
        </Link>
      )}
    </Box>
  );
}
