/**
 * HelpedTextField — TextField + helper text + optional external help link.
 *
 * Props:
 *   label:        string                          (required)
 *   value:        string                          (required, controlled)
 *   onChange:     (value: string) => void         (required)
 *   helperText:   string                          (descriptive guidance)
 *   helpLink?:    { href: string, label: string } (optional external link, opens new tab)
 *   error?:       string                          (validation error; replaces helperText when set)
 *   ...rest      passed through to MUI TextField
 *
 * On `xs` the link wraps naturally below the helper text (no extra layout).
 */
import React from 'react';
import { TextField, Box, Link } from '@mui/material';

export default function HelpedTextField({
  label,
  value,
  onChange,
  helperText,
  helpLink,
  error,
  ...rest
}) {
  const composedHelperText = error
    ? error
    : (
      <Box component="span" sx={{ display: 'inline' }}>
        {helperText}
        {helpLink && (
          <>
            {' '}
            <Link href={helpLink.href} target="_blank" rel="noopener noreferrer" underline="hover">
              {helpLink.label}
            </Link>
          </>
        )}
      </Box>
    );

  return (
    <TextField
      label={label}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      helperText={composedHelperText}
      error={Boolean(error)}
      fullWidth
      {...rest}
    />
  );
}
