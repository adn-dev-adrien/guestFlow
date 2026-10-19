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
 * Props: value, onChange(value: string), onComplete(code), label ('Code à 6 chiffres', the input's
 *        accessible name), allowBackup (false), primaryLinkLabel ('Utiliser le code de l’application'),
 *        error (string — the refusal, shown under the cells), helperText (shown when there is no error),
 *        autoFocus, disabled, id.
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

  const hasLetters = /[a-z-]/i.test(value);
  const textMode = allowBackup && (backupMode || hasLetters);
  const shownLabel = allowBackup && backupMode ? BACKUP_LABEL : label;
  const clean = (raw) => (allowBackup
    ? String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 11)
    : String(raw).replace(/\D/g, '').slice(0, CODE_LENGTH));

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
    const next = clean(e.target.value);
    setAllSelected(false);
    onChange(next);
    if (onComplete && next !== value && isCompleteCode(next, allowBackup)) onComplete(next);
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
    <Box>
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
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setAllSelected(false); }}
          autoFocus={autoFocus}
          disabled={disabled}
          inputMode={textMode ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={allowBackup ? 11 : CODE_LENGTH}
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
            color: 'transparent',
            caretColor: 'transparent',
            fontSize: 16,
            opacity: 0,
            cursor: disabled ? 'default' : 'text',
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
