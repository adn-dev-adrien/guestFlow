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
  Divider,
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
    companyName: '',
    companyAddress: '',
    companySiret: '',
    companyTva: '',
    companyIban: '',
    companyBic: '',
    companyBankName: '',
    quoteFooterText: '',
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
          companyName: settings.companyName || '',
          companyAddress: settings.companyAddress || '',
          companySiret: settings.companySiret || '',
          companyTva: settings.companyTva || '',
          companyIban: settings.companyIban || '',
          companyBic: settings.companyBic || '',
          companyBankName: settings.companyBankName || '',
          quoteFooterText: settings.quoteFooterText || '',
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
        companyName: saved.companyName || '',
        companyAddress: saved.companyAddress || '',
        companySiret: saved.companySiret || '',
        companyTva: saved.companyTva || '',
        companyIban: saved.companyIban || '',
        companyBic: saved.companyBic || '',
        companyBankName: saved.companyBankName || '',
        quoteFooterText: saved.quoteFooterText || '',
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

      {/* ── Informations société ───────────────────────────────────── */}
      <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 3 }}>
        <CardContent>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Informations société</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Ces informations apparaissent sur vos devis PDF (en-tête et pied de page).
              </Typography>
            </Box>

            <TextField
              label="Nom de la société / Raison sociale"
              value={form.companyName}
              onChange={(e) => updateField('companyName', e.target.value)}
              fullWidth
              disabled={loading || saving}
            />

            <TextField
              label="Adresse complète"
              value={form.companyAddress}
              onChange={(e) => updateField('companyAddress', e.target.value)}
              fullWidth
              multiline
              minRows={2}
              disabled={loading || saving}
              helperText="Vous pouvez utiliser des retours à la ligne."
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Numéro SIRET"
                value={form.companySiret}
                onChange={(e) => updateField('companySiret', e.target.value)}
                fullWidth
                disabled={loading || saving}
              />
              <TextField
                label="Numéro de TVA intracommunautaire"
                value={form.companyTva}
                onChange={(e) => updateField('companyTva', e.target.value)}
                fullWidth
                disabled={loading || saving}
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Coordonnées bancaires (RIB)</Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Nom de la banque"
                value={form.companyBankName}
                onChange={(e) => updateField('companyBankName', e.target.value)}
                fullWidth
                disabled={loading || saving}
              />
              <TextField
                label="BIC"
                value={form.companyBic}
                onChange={(e) => updateField('companyBic', e.target.value)}
                fullWidth
                disabled={loading || saving}
              />
            </Stack>

            <TextField
              label="IBAN"
              value={form.companyIban}
              onChange={(e) => updateField('companyIban', e.target.value)}
              fullWidth
              disabled={loading || saving}
              helperText="Ex : FR76 3000 6000 0112 3456 7890 189"
            />

            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Texte de pied de devis</Typography>

            <TextField
              label="Message de conclusion (affiché en bas de chaque devis PDF)"
              value={form.quoteFooterText}
              onChange={(e) => updateField('quoteFooterText', e.target.value)}
              fullWidth
              multiline
              minRows={4}
              disabled={loading || saving}
              helperText="Laissez vide pour utiliser le message par défaut (bienveillant et commercial)."
            />
          </Stack>
        </CardContent>
      </Card>

      {/* ── Google Calendar ────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ bgcolor: '#fff' }}>
        <CardContent>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Parametres Google Calendar</Typography>
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
