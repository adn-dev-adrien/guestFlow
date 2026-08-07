/**
 * AccountFormDialog — Create/Edit form for an admin-managed user account
 * (specs/admin-account-management.md §6.2).
 *
 * Wraps FormDialog, owns its local draft + per-field error state. The parent (AccountsPage) passes
 * server-side errors via `fieldErrors`; we project them next to each field and clear them as the
 * user types.
 *
 * Props:
 *   open:           boolean
 *   mode:           'create' | 'edit'
 *   initialValues:  { firstName, lastName, email, companyName, notes, roles: string[] }
 *   isSelf:         boolean — true when the user being edited is the current admin (locks the
 *                   admin checkbox + email field so they can't lock themselves out)
 *   fieldErrors:    { firstName?, lastName?, email?, roles? } — server-side messages
 *   busy:           boolean — submit spinner
 *   onClose:        () => void
 *   onSubmit:       (payload) => Promise — the parent does the API call + closes on success
 */
import React, { useEffect, useState } from 'react';
import {
  Stack, TextField, FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText,
  FormHelperText, OutlinedInput, Chip, Box,
} from '@mui/material';
import FormDialog from './FormDialog';
import { ROLES, ROLE_LABELS, ADMIN } from '../constants/roles';

const EMPTY = { firstName: '', lastName: '', email: '', companyName: '', notes: '', roles: [] };

export default function AccountFormDialog({
  open,
  mode,
  initialValues,
  isSelf = false,
  fieldErrors = {},
  busy = false,
  onClose,
  onSubmit,
}) {
  const isEdit = mode === 'edit';
  const [draft, setDraft] = useState(EMPTY);

  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY, ...(initialValues || {}) });
    }
  }, [open, initialValues]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const handleRolesChange = (event) => {
    const value = event.target.value;
    const list = Array.isArray(value) ? value : String(value).split(',');
    // Self-protection: forbid removing admin from one's own account.
    if (isSelf && draft.roles.includes(ADMIN) && !list.includes(ADMIN)) return;
    setDraft((d) => ({ ...d, roles: list }));
  };

  const handleSubmit = () => {
    onSubmit({
      firstName: String(draft.firstName || '').trim(),
      lastName: String(draft.lastName || '').trim(),
      email: String(draft.email || '').trim(),
      companyName: String(draft.companyName || '').trim(),
      notes: String(draft.notes || '').trim(),
      roles: [...draft.roles],
    });
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Modifier le compte' : 'Ajouter un compte'}
      submitLabel={isEdit ? 'Enregistrer' : 'Créer le compte'}
      onSubmit={handleSubmit}
      submitDisabled={busy}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
          <TextField
            label="Prénom"
            value={draft.firstName}
            onChange={set('firstName')}
            required
            error={Boolean(fieldErrors.firstName)}
            helperText={fieldErrors.firstName || ''}
            fullWidth
            autoFocus
          />
          <TextField
            label="Nom"
            value={draft.lastName}
            onChange={set('lastName')}
            required
            error={Boolean(fieldErrors.lastName)}
            helperText={fieldErrors.lastName || ''}
            fullWidth
          />
        </Box>

        <TextField
          label="Email"
          type="email"
          value={draft.email}
          onChange={set('email')}
          required
          disabled={isEdit}
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email || (isEdit
            ? "L'email n'est pas modifiable depuis ce formulaire."
            : 'Utilisé pour la connexion et l\'envoi du mot de passe provisoire.')}
          fullWidth
        />

        <FormControl required error={Boolean(fieldErrors.roles)} fullWidth>
          <InputLabel id="account-roles-label">Rôles</InputLabel>
          <Select
            labelId="account-roles-label"
            multiple
            value={draft.roles}
            onChange={handleRolesChange}
            input={<OutlinedInput label="Rôles" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((r) => <Chip key={r} size="small" label={ROLE_LABELS[r] || r} />)}
              </Box>
            )}
          >
            {ROLES.map((role) => {
              const checked = draft.roles.includes(role);
              const lockedSelfAdmin = isSelf && role === ADMIN && checked;
              return (
                <MenuItem key={role} value={role} disabled={lockedSelfAdmin}>
                  <Checkbox checked={checked} disabled={lockedSelfAdmin} />
                  <ListItemText
                    primary={ROLE_LABELS[role] || role}
                    secondary={lockedSelfAdmin ? 'Vous ne pouvez pas retirer votre propre rôle admin.' : null}
                  />
                </MenuItem>
              );
            })}
          </Select>
          <FormHelperText>
            {fieldErrors.roles || 'Au moins un rôle est requis. Un compte peut cumuler plusieurs rôles.'}
          </FormHelperText>
        </FormControl>

        <TextField
          label="Société (optionnel)"
          value={draft.companyName}
          onChange={set('companyName')}
          fullWidth
        />

        <TextField
          label="Note (optionnel)"
          value={draft.notes}
          onChange={set('notes')}
          multiline
          minRows={3}
          fullWidth
        />
      </Stack>
    </FormDialog>
  );
}
