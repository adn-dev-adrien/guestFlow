/**
 * The first password change, forced while the account still has the default password.
 *
 * The server closes the session on that change (specs/admin-account-management.md §3.3 rule 15), so
 * the page leaves for the login with the confirmation and the account's email already filled in
 * (specs/plugins-phase-p-productisation.md rule 33), instead of an empty login with no message.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { Box, Card, CardContent, Typography } from '@mui/material';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { useAuth } from '../hooks/useAuth';

export default function ForcedPasswordChangePage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const email = user?.email || '';

  const submit = async (currentPassword, newPassword) => {
    await changePassword(currentPassword, newPassword, { wasMustChange: true });
    const hint = email ? `&login_hint=${encodeURIComponent(email)}` : '';
    navigate(`/login?reason=password-changed${hint}`, { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="pageTitle" component="h1" sx={{ color: 'primary.main', mb: 1 }}>Définir le mot de passe</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Mot de passe par défaut : en choisir un nouveau pour accéder à l'application.
          </Typography>
          <ChangePasswordForm
            currentLabel="Mot de passe actuel (par défaut)"
            submitLabel="Définir le mot de passe"
            onSubmit={submit}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
