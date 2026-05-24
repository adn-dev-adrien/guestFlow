/**
 * MaskedTextField — TextField with a "Modifier" toggle for secret values
 * (private keys, passwords, tokens, etc.).
 *
 * Props:
 *   label:             string                              (required)
 *   helperText?:       ReactNode                           (passed through to TextField)
 *   hasValue:          boolean                             (true if the server holds a non-empty value)
 *   value:             string | undefined                  (current draft value; undefined = "untouched")
 *   onChange:          (value: string | undefined) => void
 *                       - call with a string when the user types
 *                       - call with undefined when the user cancels their edit
 *                         (signals: "do not include this field in the save payload")
 *   error?:            string                              (validation error to display)
 *   multiline?:        boolean
 *   minRows?:          number
 *   editToggleLabel?:  string                              (default 'Modifier')
 *   cancelEditLabel?:  string                              (default 'Annuler la modification')
 *
 * Display logic:
 *  - hasValue && value === undefined → show "••••••" + [Modifier] button
 *  - otherwise → editable TextField
 *
 * Clicking "Modifier" sets the draft to '' (empty editable input).
 * Clicking "Annuler la modification" resets the draft to undefined (preserve server value).
 */
import React from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';

const MASK = '••••••••••';

export default function MaskedTextField({
  label,
  helperText,
  hasValue,
  value,
  onChange,
  error,
  multiline = false,
  minRows = 1,
  editToggleLabel = 'Modifier',
  cancelEditLabel = 'Annuler la modification',
}) {
  const isMasked = hasValue && value === undefined;
  const errorText = error || null;
  const effectiveHelperText = errorText || helperText;

  if (isMasked) {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {label}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 1,
            bgcolor: 'background.default',
          }}
        >
          <Typography
            sx={{
              flexGrow: 1,
              fontFamily: 'monospace',
              letterSpacing: 2,
              color: 'text.secondary',
            }}
          >
            {MASK}
          </Typography>
          <Button size="small" onClick={() => onChange('')}>
            {editToggleLabel}
          </Button>
        </Box>
        {effectiveHelperText && (
          <Typography
            variant="caption"
            color={errorText ? 'error' : 'text.secondary'}
            sx={{ display: 'block', mt: 0.5, ml: 1.5 }}
          >
            {effectiveHelperText}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <TextField
        label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        helperText={effectiveHelperText}
        error={Boolean(errorText)}
        multiline={multiline}
        minRows={multiline ? minRows : undefined}
        fullWidth
      />
      {hasValue && (
        <Button
          size="small"
          onClick={() => onChange(undefined)}
          sx={{ mt: 0.5, textTransform: 'none' }}
        >
          {cancelEditLabel}
        </Button>
      )}
    </Box>
  );
}
