/**
 * The « Code portail » field of Paramètres › Établissement, contributed by the SAS to the
 * `settings.etablissement` slot (specs/platform-settings-relay-and-review.md rule 11): the code the
 * arrival SAS hands the guest. A core setting (`portalCode`) the core no longer draws itself.
 *
 * Props (from the slot): values, onChange(key, value), disabled.
 */
import React from 'react';
import { Divider, TextField } from '@mui/material';

export default function SettingsPortalCodeField({ values, onChange, disabled = false }) {
  return (
    <>
      <Divider />
      <TextField
        label="Code portail"
        value={(values && values.portalCode) || ''}
        onChange={(e) => onChange('portalCode', e.target.value)}
        helperText="Code d’accès communiqué au client à l’arrivée (SAS)."
        disabled={disabled}
      />
    </>
  );
}
