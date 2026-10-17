/**
 * OneTimeCodeField — the field of a one-time code: a 6-digit code from an authenticator app or an
 * email, or a backup code (« k7m2p-x9q4r ») when `allowBackup` is set
 * (specs/hosting-h2-account-security.md §6, rule 7). Generic: the console's operator login can use it
 * too.
 *
 * On a phone it opens the numeric keypad and offers the code just received
 * (`inputmode="numeric"`, `autocomplete="one-time-code"`). With `allowBackup`, « Utiliser un code de
 * secours » switches the field to the letter keyboard (and back with `primaryLinkLabel`); a backup
 * code pasted in the numeric field is still taken as it is.
 *
 * Props: value, onChange(value: string), label ('Code à 6 chiffres'), allowBackup (false),
 *        primaryLinkLabel ('Utiliser le code de l’application'), error, helperText, autoFocus,
 *        disabled, id. Every other prop goes to the TextField.
 */
import React, { useRef, useState } from 'react';
import { Box, Link, TextField } from '@mui/material';

const BACKUP_LABEL = 'Code de secours';

export default function OneTimeCodeField({
  value,
  onChange,
  label = 'Code à 6 chiffres',
  allowBackup = false,
  primaryLinkLabel = 'Utiliser le code de l’application',
  error,
  helperText,
  autoFocus,
  disabled,
  ...props
}) {
  const [backupMode, setBackupMode] = useState(false);
  const inputRef = useRef(null);
  const hasLetters = /[a-z-]/i.test(value || '');
  const textMode = allowBackup && (backupMode || hasLetters);
  const shownLabel = allowBackup && backupMode ? BACKUP_LABEL : label;
  const clean = (raw) => (allowBackup
    ? String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 11)
    : String(raw).replace(/\D/g, '').slice(0, 6));

  const switchMode = () => {
    setBackupMode((on) => !on);
    onChange('');
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <Box>
      <TextField
        {...props}
        label={shownLabel}
        value={value}
        onChange={(e) => onChange(clean(e.target.value))}
        error={error}
        helperText={helperText}
        autoFocus={autoFocus}
        disabled={disabled}
        fullWidth
        inputRef={inputRef}
        slotProps={{
          htmlInput: {
            inputMode: textMode ? 'text' : 'numeric',
            autoComplete: 'one-time-code',
            autoCapitalize: 'off',
            spellCheck: false,
            maxLength: allowBackup ? 11 : 6,
            'aria-label': shownLabel,
            style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' },
          },
        }}
      />
      {allowBackup && (
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={switchMode}
          disabled={disabled}
          sx={{ mt: 0.5, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          {backupMode ? primaryLinkLabel : 'Utiliser un code de secours'}
        </Link>
      )}
    </Box>
  );
}
