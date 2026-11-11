/**
 * SettingsWebsiteSection — the « Site internet (WordPress) » card of Paramètres › Intégrations
 * (specs/plugins-phase-2-hosts.md rules 30-31): the two values the WordPress plugin is given — the
 * address of this GuestFlow and the API key — to copy, and « Régénérer la clé ». No draft: nothing
 * here waits for the page's Save.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { ErrorAlert, SecretRevealField, api, useAppDialogs } from '../sdk';

export default function SettingsWebsiteSection() {
  const { confirm } = useAppDialogs();
  const [connection, setConnection] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // A failed read is said, never an empty card: this is where the WordPress API key lives.
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setConnection(await api.getWebsiteConnection());
    } catch (err) {
      setConnection(null);
      setLoadError(err.error === 'SUPPORT_FORBIDDEN'
        ? { message: err.message, retry: false }
        : { message: 'Site internet : connexion illisible.', retry: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return <ErrorAlert message={loadError.message} onRetry={loadError.retry ? load : undefined} sx={{ mb: 3 }} />;
  }
  if (!connection) return null;

  const address = connection.address || { value: '', source: 'none' };
  // specs/public-request-abuse-and-grouping.md, edge case: the proof of work is only required once
  // the site's plugin solves it.
  const antiBotInactive = connection.antiBot && !connection.antiBot.active;

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Régénérer la clé',
      message: 'Le site cesse de répondre jusqu’à ce que la nouvelle clé soit collée dans WordPress.',
      confirmLabel: 'Régénérer',
      confirmColor: 'error',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await api.regenerateWebsiteKey();
      setConnection((c) => ({ ...c, apiKey: next.apiKey }));
      setStatus('Nouvelle clé active. À coller dans WordPress.');
    } catch (err) {
      setStatus(err.message || 'Échec de la régénération.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Site internet (WordPress)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Ces deux valeurs se collent dans WordPress, Réglages › GuestFlow, dans les champs du même nom.
            </Typography>
          </Box>

          {antiBotInactive ? (
            <Alert severity="warning" role="status">
              Protection anti-robot inactive : mettre à jour l’extension WordPress
              {` (${connection.antiBot.requiredVersion} ou plus ; vue : ${connection.antiBot.pluginVersion || 'aucune'}).`}
            </Alert>
          ) : null}

          <SecretRevealField
            label="URL de l’API GuestFlow"
            value={address.value}
            masked={false}
            helperText={address.source === 'request'
              ? 'Adresse déduite de ce navigateur : l’adresse de l’application n’est pas renseignée (Paramètres › Système).'
              : null}
          />
          <SecretRevealField label="Clé d’API" value={connection.apiKey} />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" color="error" onClick={regenerate} disabled={busy} sx={{ minHeight: 44 }}>
              Régénérer la clé
            </Button>
            {status ? (
              <Typography variant="body2" color="text.secondary" role="status">{status}</Typography>
            ) : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
