/**
 * DerivedValueField — a setting that defaults to another one unless the operator overrides it
 * (specs/settings-rationalization.md rule 12: « same as X unless … »).
 *
 * Empty override → a read-only field showing the derived value, « = <source> » below it, and a
 * link revealing an editable field. Non-empty override (or link clicked) → an editable field whose
 * placeholder is the derived value, and a link going back to the derived value (clears the override).
 *
 * Props:
 *   label:         string   — field label
 *   value:         string   — the override ('' = derived)
 *   derivedValue:  string   — what the setting is when the override is empty (server-computed)
 *   derivedFrom:   string   — the source, in words (« l'email de contact de l'Établissement »)
 *   overrideLabel: string   — the link revealing the field (« Utiliser une autre adresse »)
 *   onChange:      (value: string) => void
 *   error?:        string   — server validation message
 *   helperText?:   string   — shown under the editable field
 *   disabled?:     boolean
 *   type?:         string   — input type (e.g. 'email')
 */
import React, { useState } from 'react';
import { Box, Link, TextField } from '@mui/material';

export default function DerivedValueField({
  label,
  value,
  derivedValue,
  derivedFrom,
  overrideLabel,
  onChange,
  error,
  helperText,
  disabled = false,
  type = 'text',
}) {
  const [editing, setEditing] = useState(false);
  const overridden = String(value || '') !== '';
  const open = overridden || editing || Boolean(error);

  const backToDerived = () => {
    setEditing(false);
    onChange('');
  };

  if (!open) {
    return (
      <Box>
        <TextField
          label={label}
          value={derivedValue || ''}
          placeholder="Non renseigné"
          fullWidth
          size="small"
          disabled={disabled}
          helperText={`= ${derivedFrom}`}
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'action.hover' } }}
        />
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => setEditing(true)}
          disabled={disabled}
          sx={{ mt: 0.5 }}
        >
          {overrideLabel}
        </Link>
      </Box>
    );
  }

  return (
    <Box>
      <TextField
        label={label}
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={derivedValue || ''}
        fullWidth
        size="small"
        autoFocus={editing && !overridden}
        disabled={disabled}
        error={Boolean(error)}
        helperText={error || helperText || `Vide : ${derivedFrom}.`}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Link
        component="button"
        type="button"
        variant="body2"
        onClick={backToDerived}
        disabled={disabled}
        sx={{ mt: 0.5 }}
      >
        Revenir à la valeur déduite
      </Link>
    </Box>
  );
}
