import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
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
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('success');
  const [companyLogoPath, setCompanyLogoPath] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);

  const EMPTY_FORM = {
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
    quoteValidityDays: 30,
  };

  const [form, setForm] = useState(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState(EMPTY_FORM);

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (!mounted) return;
        const loaded = {
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
          quoteValidityDays: settings.quoteValidityDays ?? 30,
        };
        setForm(loaded);
        setSavedForm(loaded);
        setCompanyLogoPath(settings.companyLogoPath || '');
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
      const updatedForm = {
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
        quoteValidityDays: saved.quoteValidityDays ?? 30,
      };
      setForm(updatedForm);
      setSavedForm(updatedForm);
      setSavedAt(saved.updatedAt || '');
      setStatusType('success');
      setStatusMessage('Paramètres enregistrés avec succès.');
    } catch (error) {
      setStatusType('error');
      setStatusMessage(error.message || 'Impossible d\'enregistrer les parametres.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const result = await api.uploadCompanyLogo(formData);
      setCompanyLogoPath(result.companyLogoPath || '');
    } catch (err) {
      setStatusType('error');
      setStatusMessage(err.message || 'Erreur lors de l\'upload du logo.');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoDelete = async () => {
    setLogoUploading(true);
    try {
      await api.deleteCompanyLogo();
      setCompanyLogoPath('');
    } catch (err) {
      setStatusType('error');
      setStatusMessage(err.message || 'Erreur lors de la suppression du logo.');
    } finally {
      setLogoUploading(false);
    }
  };

  const hasGoogleConfig = Boolean(
    form.googleCalendarId.trim()
    && form.googleServiceAccountEmail.trim()
    && form.googleServiceAccountPrivateKey.trim(),
  );

  const handleCancel = () => {
    setForm(savedForm);
    setStatusMessage('');
  };

  return (
    <Box sx={{ pb: 6 }}>
      {/* Blocker dialog */}
      <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()}>
        <DialogTitle>Modifications non enregistrées</DialogTitle>
        <DialogContent>
          <Typography>Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => blocker.reset?.()}>Rester</Button>
          <Button color="error" onClick={() => blocker.proceed?.()}>Quitter sans enregistrer</Button>
        </DialogActions>
      </Dialog>

      {/* ── Bandeau d'actions fixe ──────────────────────────────── */}
      <Box
        sx={{
          position: 'fixed',
          top: { xs: 56, sm: 64 },
          left: { xs: 0, md: 240 },
          width: { xs: '100%', md: 'calc(100% - 240px)' },
          zIndex: 1200,
          px: { xs: 1.5, sm: 2, md: 3 },
          py: 1,
        }}
      >
        <Box
          sx={{
            maxWidth: 920,
            mx: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            bgcolor: '#fff',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Paramètres</Typography>
            {isDirty && (
              <Typography variant="caption" color="warning.main" sx={{ fontStyle: 'italic' }}>
                Modifications non enregistrées
              </Typography>
            )}
            {savedAt && !isDirty && (
              <Typography variant="caption" color="text.disabled">
                Dernière mise à jour : {new Date(savedAt).toLocaleString('fr-FR')}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" onClick={handleCancel} disabled={!isDirty || saving || loading}>
              Annuler
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={!isDirty || saving || loading}
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Espace pour compenser le bandeau fixe */}
      <Box sx={{ height: 56, mb: 2 }} />

      {statusMessage && (
        <Alert severity={statusType === 'error' ? 'error' : 'success'} sx={{ mb: 2, maxWidth: 920, mx: 'auto' }} onClose={() => setStatusMessage('')}>
          {statusMessage}
        </Alert>
      )}

      {/* ── Informations société ───────────────────────────────────── */}
      <Box sx={{ maxWidth: 920, mx: 'auto' }}>
      <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 3 }}>
        <CardContent>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Informations société</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Ces informations apparaissent sur vos devis PDF (en-tête et pied de page).
              </Typography>
            </Box>

            {/* Logo upload */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Logo de la société</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                {companyLogoPath ? (
                  <Box
                    component="img"
                    src={companyLogoPath}
                    alt="Logo société"
                    sx={{ height: 64, maxWidth: 200, objectFit: 'contain', border: '1px solid #eee', borderRadius: 1, p: 0.5 }}
                  />
                ) : (
                  <Box sx={{ height: 64, width: 120, border: '1px dashed #ccc', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" color="text.disabled">Aucun logo</Typography>
                  </Box>
                )}
                <Stack spacing={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={logoUploading || loading}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {logoUploading ? 'Chargement...' : companyLogoPath ? 'Remplacer le logo' : 'Choisir un logo'}
                  </Button>
                  {companyLogoPath && (
                    <Tooltip title="Supprimer le logo">
                      <IconButton size="small" color="error" onClick={handleLogoDelete} disabled={logoUploading}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleLogoUpload}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Le logo s'affichera sur vos devis PDF et sera utilisé comme favicon de l'application. Max 2 Mo.
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

      {/* ── Paramètres devis ──────────────────────────────────────── */}
      <Card variant="outlined" sx={{ bgcolor: '#fff', mb: 3 }}>  
        <CardContent>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Paramètres devis</Typography>
            </Box>
            <TextField
              label="Durée de validité par défaut (jours)"
              type="number"
              value={form.quoteValidityDays}
              onChange={(e) => updateField('quoteValidityDays', Number(e.target.value) || 30)}
              inputProps={{ min: 1, max: 365 }}
              sx={{ maxWidth: 280 }}
              disabled={loading || saving}
              helperText="Nombre de jours de validité par défaut pour les nouveaux devis."
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
                {hasGoogleConfig ? 'Configuration Google complète.' : 'Configuration Google incomplète.'}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      </Box>
    </Box>
  );
}
