/**
 * OneTimeCodeField — the field of a one-time code: a 6-digit code from an authenticator app or an
 * email, or a backup code (« k7m2p-x9q4r ») when `allowBackup` is set
 * (specs/hosting-h2-account-security.md §6). Generic: the console's operator login can use it too.
 *
 * On a phone it opens the numeric keypad and offers the code just received
 * (`inputmode="numeric"`, `autocomplete="one-time-code"`); a backup code switches the keypad off
 * as soon as a letter is typed.
 *
 * Props: value, onChange(value: string), label ('Code à 6 chiffres'), allowBackup (false), error,
 *        helperText, autoFocus, disabled, id. Every other prop goes to the TextField.
 */
import React from 'react';
import { TextField } from '@mui/material';

export default function OneTimeCodeField({
  value,
  onChange,
  label = 'Code à 6 chiffres',
  allowBackup = false,
  error,
  helperText,
  autoFocus,
  disabled,
  ...props
}) {
  const hasLetters = /[a-z-]/i.test(value || '');
  const clean = (raw) => (allowBackup
    ? String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 11)
    : String(raw).replace(/\D/g, '').slice(0, 6));
  return (
    <TextField
      {...props}
      label={label}
      value={value}
      onChange={(e) => onChange(clean(e.target.value))}
      error={error}
      helperText={helperText}
      autoFocus={autoFocus}
      disabled={disabled}
      fullWidth
      slotProps={{
        htmlInput: {
          inputMode: allowBackup && hasLetters ? 'text' : 'numeric',
          autoComplete: 'one-time-code',
          autoCapitalize: 'off',
          spellCheck: false,
          maxLength: allowBackup ? 11 : 6,
          'aria-label': label,
          style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' },
        },
      }}
    />
  );
}
