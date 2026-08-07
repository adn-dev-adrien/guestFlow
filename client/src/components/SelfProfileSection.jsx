/**
 * SelfProfileSection — "Mes informations" card on /account.
 *
 * Every authenticated user (admin OR accountant) can edit their own identity fields here.
 * Email IS editable since 2026-06-02 — the bootstrap admin needs to replace the
 * `admin@guestflow.local` seed with a real address. When that seed is still in use, the email
 * field gets a red border + helper text prompting the operator to change it. Roles are NOT
 * exposed — the server's `PUT /api/users/me` endpoint also ignores any roles key in the body
 * (privilege-escalation guard).
 *
 * Owns its draft state + per-field errors. The parent provides the initial values (current user
 * from useAuth), an optional `emailStatus = { defaultStillUsed }` for the red warning, and the
 * submit handler; success / error messaging is driven by the parent's snackbar so it stays
 * consistent with the rest of the page.
 *
 * Props:
 *   initialValues:  { firstName, lastName, email, companyName, notes } — current safe user
 *   emailStatus:    { defaultStillUsed: boolean } — drives the red highlight on the email field
 *   fieldErrors:    { firstName?, lastName?, email? } — server-side validation hints
 *   busy:           boolean — submit spinner + disables every field
 *   onSubmit:       (payload) => Promise — parent does the API call + snackbar
 */
import React, { useEffect, useState } from 'react';
import {
  Card, CardContent, Stack, Typography, TextField, Box, Button, CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

const DEFAULT_ADMIN_EMAIL = 'admin@guestflow.local';

const EMPTY = { firstName: '', lastName: '', email: '', companyName: '', notes: '' };

function pickIdentityFields(values) {
  return {
    firstName: values.firstName || '',
    lastName: values.lastName || '',
    email: values.email || '',
    companyName: values.companyName || '',
    notes: values.notes || '',
  };
}

function shallowEqual(a, b) {
  return a.firstName === b.firstName
    && a.lastName === b.lastName
    && a.email === b.email
    && a.companyName === b.companyName
    && a.notes === b.notes;
}

export default function SelfProfileSection({
  initialValues,
  emailStatus,
  fieldErrors = {},
  busy = false,
  onSubmit,
}) {
  const [draft, setDraft] = useState(EMPTY);
  // Snapshot of the last server-confirmed values, used to compute `isDirty` and to handle Cancel.
  const [saved, setSaved] = useState(EMPTY);

  useEffect(() => {
    if (initialValues) {
      const next = pickIdentityFields(initialValues);
      setDraft(next);
      setSaved(next);
    }
  }, [initialValues]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const isDirty = !shallowEqual(draft, saved);

  // True when the current draft email is still the bootstrap seed (`admin@guestflow.local`).
  // The server-side `defaultStillUsed` is a system-wide flag (any user with that email anywhere)
  // — we ONLY surface the warning if MY email is the default one, otherwise it'd be confusing.
  const isUsingDefaultEmail = String(draft.email || '').trim().toLowerCase() === DEFAULT_ADMIN_EMAIL;
  const showDefaultEmailWarning = isUsingDefaultEmail && Boolean(emailStatus?.defaultStillUsed);

  const handleSave = () => {
    onSubmit({
      firstName: String(draft.firstName || '').trim(),
      lastName: String(draft.lastName || '').trim(),
      email: String(draft.email || '').trim(),
      companyName: String(draft.companyName || '').trim(),
      notes: String(draft.notes || '').trim(),
    });
  };
  const handleCancel = () => setDraft(saved);

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Mes informations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Mettez à jour votre prénom, votre nom, votre société et vos notes. L'email reste
              celui utilisé pour vous connecter.
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              label="Prénom"
              value={draft.firstName}
              onChange={set('firstName')}
              required
              error={Boolean(fieldErrors.firstName)}
              helperText={fieldErrors.firstName || ''}
              fullWidth
              disabled={busy}
            />
            <TextField
              label="Nom"
              value={draft.lastName}
              onChange={set('lastName')}
              required
              error={Boolean(fieldErrors.lastName)}
              helperText={fieldErrors.lastName || ''}
              fullWidth
              disabled={busy}
            />
          </Box>

          <TextField
            label="Email"
            type="email"
            value={draft.email}
            onChange={set('email')}
            required
            error={Boolean(fieldErrors.email) || showDefaultEmailWarning}
            helperText={
              fieldErrors.email
                || (showDefaultEmailWarning
                  ? 'Vous utilisez encore l\'adresse par défaut. Remplacez-la par votre vraie adresse — c\'est avec elle que vous vous connecterez.'
                  : 'C\'est l\'adresse utilisée pour vous connecter.')
            }
            fullWidth
            disabled={busy}
          />

          <TextField
            label="Société (optionnel)"
            value={draft.companyName}
            onChange={set('companyName')}
            fullWidth
            disabled={busy}
          />

          <TextField
            label="Note (optionnel)"
            value={draft.notes}
            onChange={set('notes')}
            multiline
            minRows={3}
            fullWidth
            disabled={busy}
          />

          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
            <Button
              onClick={handleCancel}
              disabled={busy || !isDirty}
              variant="text"
            >
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={busy || !isDirty}
              variant="contained"
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            >
              Enregistrer
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
