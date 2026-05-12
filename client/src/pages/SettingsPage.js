import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import api from '../api';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('success');
  const [form, setForm] = useState({
    googleCalendarId: '',
    googleServiceAccountEmail: '',
    googleServiceAccountPrivateKey: '',
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (!mounted) return;
        setForm({
          googleCalendarId: settings.googleCalendarId || '',
          googleServiceAccountEmail: settings.googleServiceAccountEmail || '',
          googleServiceAccountPrivateKey: settings.googleServiceAccountPrivateKey || '',
        });
        setSavedAt(settings.updatedAt || '');
      } catch (error) {
        if (!mounted) return;
        setStatusType('error');
        setStatusMessage(error.message || 'Impossible de charger les parametres.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage('');
    try {
      const saved = await api.updateSettings(form);
      setForm({
        googleCalendarId: saved.googleCalendarId || '',
        googleServiceAccountEmail: saved.googleServiceAccountEmail || '',
        googleServiceAccountPrivateKey: saved.googleServiceAccountPrivateKey || '',
      });
      setSavedAt(saved.updatedAt || '');
      setStatusType('success');
      setStatusMessage('Parametres enregistres avec succes.');
    } catch (error) {
      setStatusType('error');
      setStatusMessage(error.message || 'Impossible d\'enregistrer les parametres.');
    } finally {
      setSaving(false);
    }
  };

  const hasGoogleConfig = Boolean(
    form.googleCalendarId.trim()
    && form.googleServiceAccountEmail.trim()
    && form.googleServiceAccountPrivateKey.trim(),
  );

  return (
    <Box sx={{ maxWidth: 920, mx: 'auto' }}>
      <Card variant="outlined" sx={{ bgcolor: '#fff' }}>
        <CardContent>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Parametres</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Configurez ici les variables Google Calendar. Ces valeurs sont gerees et stockees par le backend.
              </Typography>
            </Box>

            {statusMessage && (
              <Alert severity={statusType === 'error' ? 'error' : 'success'}>
                {statusMessage}
              </Alert>
            )}

            <TextField
              label="Google Calendar ID"
              value={form.googleCalendarId}
              onChange={(e) => updateField('googleCalendarId', e.target.value)}
              fullWidth
              disabled={loading || saving}
            />

            <TextField
              label="Service Account Email"
              value={form.googleServiceAccountEmail}
              onChange={(e) => updateField('googleServiceAccountEmail', e.target.value)}
              fullWidth
              disabled={loading || saving}
            />

            <TextField
              label="Service Account Private Key"
              value={form.googleServiceAccountPrivateKey}
              onChange={(e) => updateField('googleServiceAccountPrivateKey', e.target.value)}
              fullWidth
              multiline
              minRows={6}
              disabled={loading || saving}
              helperText="Collez la cle complete (format PEM). Les sauts de ligne seront pris en charge automatiquement."
            />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" color={hasGoogleConfig ? 'success.main' : 'warning.main'}>
                {hasGoogleConfig ? 'Configuration Google complete.' : 'Configuration Google incomplete.'}
              </Typography>
              <Button variant="contained" onClick={handleSave} disabled={loading || saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer les parametres'}
              </Button>
            </Box>

            {savedAt && (
              <Typography variant="caption" color="text.secondary">
                Derniere mise a jour: {new Date(savedAt).toLocaleString('fr-FR')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
