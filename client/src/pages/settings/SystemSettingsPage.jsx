/**
 * SystemSettingsPage — Paramètres → Système (specs/settings-rationalization.md rule 2).
 *
 * The installed version and its updates, the translation catalogue — downloaded, filled in outside
 * GuestFlow and sent back (specs/translation-catalogue.md rule 20) — and the public URL of the
 * application, used in the emails, the Google return address and the Qonto notifications, so it
 * lives here rather than in the SMTP card (rule 16). It is typed, never guessed from a request host.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, Stack, Typography, TextField } from '@mui/material';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsSystemUpdateSection from '../../components/SettingsSystemUpdateSection';
import TranslationCatalogueCard from '../../components/TranslationCatalogueCard';

export default function SystemSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['smtp'], navigate });
  const smtp = form.draft.smtp || {};

  return (
    <SettingsFormPage title="Système" form={form}>
      <SettingsSystemUpdateSection />
      <TranslationCatalogueCard />
      <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Typography variant="sectionHeader">Adresse de l'application</Typography>
            <TextField
              label="URL publique"
              value={smtp.publicUrl || ''}
              onChange={(e) => form.setField('smtp', 'publicUrl', e.target.value)}
              disabled={form.loading || form.saving}
              error={Boolean(form.errors.publicUrl)}
              helperText={form.errors.publicUrl
                || 'Utilisée dans les emails, le retour Google et les notifications Qonto (ex. https://guestflow.adn-dev.fr).'}
              fullWidth
              size="small"
            />
          </Stack>
        </CardContent>
      </Card>
    </SettingsFormPage>
  );
}
