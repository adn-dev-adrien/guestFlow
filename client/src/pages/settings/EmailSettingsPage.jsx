/**
 * EmailSettingsPage — Paramètres → Emails & notifications (specs/settings-rationalization.md rule 2).
 *
 * Sending (SMTP, with the derived identity of rule 12), the content the guest emails quote, the
 * operator's own notifications, and push on this device. Whether a guest email leaves by itself is
 * decided per template in Emails (rule 17b), not here.
 */
import React, { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { Link, Typography } from '@mui/material';
import api from '../../api';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsSmtpSection from '../../components/SettingsSmtpSection';
import SettingsEmailContentSection from '../../components/SettingsEmailContentSection';
import SettingsNotificationsSection from '../../components/SettingsNotificationsSection';
import SettingsPushNotificationsSection from '../../components/SettingsPushNotificationsSection';

export default function EmailSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['smtp', 'notifications', 'emails'], navigate });
  const disabled = form.loading || form.saving;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleSmtpTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const out = await api.sendSmtpTest();
      setTestResult({
        severity: 'success',
        message: `Email de test envoyé à ${out.recipient || 'votre adresse'}.`,
        onClose: () => setTestResult(null),
      });
    } catch (err) {
      const detail = (err && (err.detail || err.message)) || 'Échec du test.';
      setTestResult({ severity: 'error', message: `Échec : ${detail}`, onClose: () => setTestResult(null) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsFormPage title="Emails & notifications" form={form}>
      <SettingsSmtpSection
        values={form.draft.smtp}
        errors={form.errors}
        onChange={(key, value) => form.setField('smtp', key, value)}
        onChangePassword={(value) => form.setField('smtp', 'passwordDraft', value)}
        onSendTest={handleSmtpTest}
        testing={testing}
        testResult={testResult}
        disabled={disabled}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 3 }}>
        L'envoi automatique d'un mail client se choisit sur chaque modèle, dans{' '}
        <Link component={RouterLink} to="/emails">Emails</Link>.
      </Typography>
      <SettingsEmailContentSection
        values={form.draft.emails}
        errors={form.errors}
        onChange={(key, value) => form.setField('emails', key, value)}
        disabled={disabled}
      />
      <SettingsNotificationsSection
        values={form.draft.notifications}
        errors={form.errors}
        onChange={(key, value) => form.setField('notifications', key, value)}
        disabled={disabled}
      />
      <SettingsPushNotificationsSection />
    </SettingsFormPage>
  );
}
