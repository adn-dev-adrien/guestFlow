import React, { useState } from 'react';
import { TextField, InputAdornment, IconButton, Tooltip } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

/**
 * PasswordField — MUI TextField for passwords with a show/hide (eye) toggle.
 *
 * Props: forwards every TextField prop (label, value, onChange, autoComplete, fullWidth, required,
 * helperText, error, …). Manages only the local visibility state; the eye toggle flips the input
 * between `password` and `text`. The toggle is `tabIndex={-1}` so keyboard focus flows field → field
 * → submit without landing on it.
 *
 * Use anywhere a password is typed (login, change-password, future user creation) for a consistent UX.
 */
export default function PasswordField({ InputProps, ...props }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={label}>
              <IconButton
                onClick={() => setVisible((v) => !v)}
                edge="end"
                aria-label={label}
                tabIndex={-1}
              >
                {visible ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  );
}
