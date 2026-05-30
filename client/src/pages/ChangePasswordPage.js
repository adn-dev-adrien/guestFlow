import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Alert } from '@mui/material';
import PageActionBar from '../components/PageActionBar';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { useAuth } from '../hooks/useAuth';

/**
 * Page de changement de mot de passe — commune à tous les utilisateurs authentifiés
 * (admin et comptable). Route: /settings/password.
 *
 * Le serveur autorise déjà POST /api/auth/change-password pour n'importe quel rôle (route self).
 */
export default function ChangePasswordPage() {
  const { user, changePassword } = useAuth();
  const [message, setMessage] = useState(null);

  return (
    <Box>
      <PageActionBar
        title="Changer le mot de passe"
        subtitle={user?.email ? (
          <Typography variant="caption" color="text.disabled">
            {user.email}
          </Typography>
        ) : null}
      />

      <Box sx={{ maxWidth: { xs: '100%', md: 480 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Choisissez un nouveau mot de passe d'au moins 10 caractères.
            </Typography>
            {message && (
              <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
                {message}
              </Alert>
            )}
            <ChangePasswordForm
              onSubmit={changePassword}
              onSuccess={() => setMessage('Mot de passe mis à jour.')}
            />
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
