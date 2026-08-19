import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Typography } from '@mui/material';
import api from '../api';
import { setFavicon } from '../utils/setFavicon';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import { useToast } from '../components/DialogProvider';
import ConfirmDialog from '../components/ConfirmDialog';
import SettingsCompanySection from '../components/SettingsCompanySection';
import SettingsQuoteSection from '../components/SettingsQuoteSection';
import SettingsVatSection from '../components/SettingsVatSection';
import SettingsFiscalYearSection from '../components/SettingsFiscalYearSection';
import SettingsReservationLockSection from '../components/SettingsReservationLockSection';
import SettingsGoogleCalendarSection from '../components/SettingsGoogleCalendarSection';
import SettingsSmtpSection from '../components/SettingsSmtpSection';
import SettingsNotificationsSection from '../components/SettingsNotificationsSection';
import SettingsWeatherSection from '../components/SettingsWeatherSection';
import SettingsPushNotificationsSection from '../components/SettingsPushNotificationsSection';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';

const EMPTY_FORM = {
  company: {
    name: '', address: '', email: '', phone: '',
    siret: '', tva: '', iban: '', bic: '', bankName: '',
    portalCode: '',
    logoPath: '',
  },
  quote: { footerText: '', footerTextEn: '', validityDays: 30 },
  vat: { rate: 10, rateCommission: 20, rateCancellationCompensation: 0 },
  // Accounting closing month (specs/fiscal-year-and-nights-sold.md §3.1). 12 = calendar year.
  accounting: { fiscalYearEndMonth: 12 },
  smtp: {
    host: '', port: 587, secure: false,
    username: '',
    passwordSet: false,
    fromEmail: '', fromName: 'GuestFlow',
    publicUrl: '',
    passwordDraft: undefined, // undefined = preserve; '' = clear; 'value' = store
  },
  // Admin escape hatch (specs/admin-unlock-past-reservations.md). OFF by default.
  reservations: {
    allowEditPastReservations: false,
  },
  // Weekly bed-linen tracking (specs/weekly-bed-linen-tracking.md). Day of week, default Tue.
  laundry: {
    weekday: 2,
  },
  // Booking notifications (specs/site-booking-notifications.md). ON by default; empty recipient
  // falls back to the SMTP sender server-side.
  notifications: {
    enabled: true,
    icalReservationEnabled: true,
    recipientEmail: '',
  },
  // Weather alerts (specs/checkin-weather-alerts.md). The Météo-France key is a masked secret; the
  // server returns only `apiKeySet`. apiKeyDraft: same 3-way semantics as smtp.passwordDraft.
  weather: {
    apiKeySet: false,
    apiKeyDraft: undefined,
  },
};

function diffFields(draftGroup, savedGroup) {
  const out = {};
  for (const key of Object.keys(draftGroup)) {
    if (JSON.stringify(draftGroup[key]) !== JSON.stringify(savedGroup[key])) {
      out[key] = draftGroup[key];
    }
  }
  return out;
}

function buildPayloadFromDraft(draft, saved) {
  const payload = {};

  const companyDirty = diffFields(draft.company, saved.company);
  // logoPath is committed via its own endpoint, never via the main save.
  delete companyDirty.logoPath;
  if (Object.keys(companyDirty).length > 0) payload.company = companyDirty;

  const quoteDirty = diffFields(draft.quote, saved.quote);
  if (Object.keys(quoteDirty).length > 0) payload.quote = quoteDirty;

  const vatDirty = diffFields(draft.vat, saved.vat);
  if (Object.keys(vatDirty).length > 0) payload.vat = vatDirty;

  // Accounting — single integer month, same per-field diff as the other simple groups.
  const accountingDirty = diffFields(draft.accounting, saved.accounting);
  if (Object.keys(accountingDirty).length > 0) payload.accounting = accountingDirty;

  // SMTP — same per-field 3-way pattern as the other groups, with passwordDraft as the
  // masked secret (specs/admin-account-management.md M3).
  const smtpDirty = {};
  for (const key of ['host', 'port', 'secure', 'username', 'fromEmail', 'fromName', 'publicUrl']) {
    if (JSON.stringify(draft.smtp[key]) !== JSON.stringify(saved.smtp[key])) {
      smtpDirty[key] = draft.smtp[key];
    }
  }
  if (draft.smtp.passwordDraft !== undefined) {
    smtpDirty.password = draft.smtp.passwordDraft;
  }
  if (Object.keys(smtpDirty).length > 0) payload.smtp = smtpDirty;

  // Reservations escape hatch — single boolean, no draft semantics.
  const reservationsDirty = diffFields(draft.reservations, saved.reservations);
  if (Object.keys(reservationsDirty).length > 0) payload.reservations = reservationsDirty;

  // Laundry — single integer weekday, same per-field diff as the other simple groups.
  const laundryDirty = diffFields(draft.laundry, saved.laundry);
  if (Object.keys(laundryDirty).length > 0) payload.laundry = laundryDirty;

  // Notifications — toggle + optional recipient, same per-field diff.
  const notificationsDirty = diffFields(draft.notifications, saved.notifications);
  if (Object.keys(notificationsDirty).length > 0) payload.notifications = notificationsDirty;

  // Weather — masked API key, 3-way like the SMTP password (only sent when touched).
  if (draft.weather.apiKeyDraft !== undefined) {
    payload.weather = { apiKey: draft.weather.apiKeyDraft };
  }

  return payload;
}

function fromServer(settings) {
  if (!settings) return EMPTY_FORM;
  return {
    company: { ...EMPTY_FORM.company, ...(settings.company || {}) },
    quote: { ...EMPTY_FORM.quote, ...(settings.quote || {}) },
    vat: { ...EMPTY_FORM.vat, ...(settings.vat || {}) },
    accounting: { ...EMPTY_FORM.accounting, ...(settings.accounting || {}) },
    smtp: {
      ...EMPTY_FORM.smtp,
      ...(settings.smtp || {}),
      passwordDraft: undefined,
    },
    reservations: {
      ...EMPTY_FORM.reservations,
      ...(settings.reservations || {}),
    },
    laundry: {
      ...EMPTY_FORM.laundry,
      ...(settings.laundry || {}),
    },
    notifications: {
      ...EMPTY_FORM.notifications,
      ...(settings.notifications || {}),
    },
    weather: {
      ...EMPTY_FORM.weather,
      ...(settings.weather || {}),
      apiKeyDraft: undefined,
    },
  };
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  // Load failures stay persistent (ErrorAlert); save feedback goes through the shared toasts
  // (specs/ds-components.md §3.2).
  const [loadError, setLoadError] = useState(false);
  const { showSuccess, showError } = useToast();
  const [savedForm, setSavedForm] = useState(EMPTY_FORM);
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [updatedAtLabel, setUpdatedAtLabel] = useState(null);

  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft, saved: savedForm, navigate,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getSettings();
        if (!mounted) return;
        const shaped = fromServer(data);
        setSavedForm(shaped);
        setDraft(shaped);
        setUpdatedAtLabel(data && data.updatedAtLabel);
      } catch (err) {
        if (mounted) setLoadError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const updateGroup = (group) => (key, value) => {
    setDraft((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: value },
    }));
    if (errors[mapClientKeyToErrorKey(group, key)]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[mapClientKeyToErrorKey(group, key)];
        return next;
      });
    }
  };

  const updateSmtpPassword = (value) => {
    setDraft((prev) => ({
      ...prev,
      smtp: { ...prev.smtp, passwordDraft: value },
    }));
  };

  const updateWeatherApiKey = (value) => {
    setDraft((prev) => ({
      ...prev,
      weather: { ...prev.weather, apiKeyDraft: value },
    }));
  };

  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState(null);
  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const out = await api.sendSmtpTest();
      setSmtpTestResult({
        severity: 'success',
        message: `Email de test envoyé à ${out.recipient || 'votre adresse'}.`,
        onClose: () => setSmtpTestResult(null),
      });
    } catch (err) {
      const detail = err && (err.detail || err.message) || 'Échec du test.';
      setSmtpTestResult({
        severity: 'error',
        message: `Échec : ${detail}`,
        onClose: () => setSmtpTestResult(null),
      });
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrors({});
    const payload = buildPayloadFromDraft(draft, savedForm);
    if (Object.keys(payload).length === 0) {
      setSaving(false);
      return;
    }
    try {
      const updated = await api.updateSettings(payload);
      const shaped = fromServer(updated);
      setSavedForm(shaped);
      setDraft(shaped);
      setUpdatedAtLabel(updated && updated.updatedAtLabel);
      showSuccess('Paramètres enregistrés.');
    } catch (err) {
      if (err && err.errors) {
        setErrors(err.errors);
      } else {
        showError(err.message || "Impossible d'enregistrer les paramètres.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(savedForm);
    setErrors({});
  };

  const handleUploadLogo = async (file) => {
    const formData = new FormData();
    formData.append('logo', file);
    const res = await api.uploadCompanyLogo(formData);
    const newPath = res && res.company && res.company.logoPath;
    if (newPath != null) {
      setSavedForm((prev) => ({ ...prev, company: { ...prev.company, logoPath: newPath } }));
      setDraft((prev) => ({ ...prev, company: { ...prev.company, logoPath: newPath } }));
      // Push the new logo into the browser tab favicon immediately. The boot-time
      // `useDynamicFavicon` hook only re-runs on auth changes; here we want the favicon to update
      // the very second the upload succeeds. Version-bust with Date.now() so even repeated
      // re-uploads of the same filename surface a fresh icon.
      setFavicon({ href: newPath, version: String(Date.now()) });
    }
  };

  const handleDeleteLogo = async () => {
    const res = await api.deleteCompanyLogo();
    const newPath = res && res.company && res.company.logoPath;
    setSavedForm((prev) => ({ ...prev, company: { ...prev.company, logoPath: newPath || '' } }));
    setDraft((prev) => ({ ...prev, company: { ...prev.company, logoPath: newPath || '' } }));
    // Symmetric: clearing the logo restores the bundled default favicon right away.
    setFavicon({ href: null });
  };

  const subtitle = isDirty ? (
    <Typography variant="caption" color="warning.main" sx={{ fontStyle: 'italic' }}>
      Modifications non enregistrées
    </Typography>
  ) : (updatedAtLabel ? (
    <Typography variant="caption" color="text.disabled">
      Dernière mise à jour : {updatedAtLabel}
    </Typography>
  ) : null);

  return (
    <Box>
      <PageActionBar
        title="Paramètres"
        subtitle={subtitle}
        onSave={handleSave}
        saveDisabled={!isDirty || saving || loading}
        saveBusy={saving}
        onCancel={handleCancel}
        cancelDisabled={!isDirty || saving || loading}
      />

      <Box sx={{ maxWidth: { xs: '100%', md: 920, lg: 1240 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        {loadError && (
          <ErrorAlert
            message="Impossible de charger les paramètres."
            onRetry={() => window.location.reload()}
            sx={{ mb: 2 }}
          />
        )}

        {/* Masonry: 1 column ≤ md (readable), 2 balanced columns on lg+ to kill desktop
            empty space. Each section is break-inside:avoid so a card never splits across
            columns; the cards' own mb:3 provides the vertical rhythm. */}
        <Box sx={{ columnGap: { lg: 3 }, columnCount: { xs: 1, lg: 2 } }}>
          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsCompanySection
              values={draft.company}
              errors={errors}
              onChange={updateGroup('company')}
              onUploadLogo={handleUploadLogo}
              onDeleteLogo={handleDeleteLogo}
              disabled={loading || saving}
            />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsQuoteSection
              values={draft.quote}
              errors={errors}
              onChange={updateGroup('quote')}
              disabled={loading || saving}
            />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsVatSection
              values={draft.vat}
              errors={errors}
              onChange={updateGroup('vat')}
              disabled={loading || saving}
            />
          </Box>

          {/* Accounting closing month — kept next to the VAT card so the accounting settings sit
              together (specs/fiscal-year-and-nights-sold.md §6.1). */}
          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsFiscalYearSection
              values={draft.accounting}
              errors={errors}
              onChange={updateGroup('accounting')}
              disabled={loading || saving}
            />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsReservationLockSection
              value={draft.reservations.allowEditPastReservations}
              onChange={(next) => updateGroup('reservations')('allowEditPastReservations', next)}
              disabled={loading || saving}
            />
          </Box>

          {/* Google Calendar (self-contained — OAuth connect flow, not part of the global
              settings form; specs/google-calendar-oauth-rework.md §6). */}
          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsGoogleCalendarSection />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsSmtpSection
              values={draft.smtp}
              errors={errors}
              onChange={updateGroup('smtp')}
              onChangePassword={updateSmtpPassword}
              onSendTest={handleSmtpTest}
              testing={smtpTesting}
              testResult={smtpTestResult}
              disabled={loading || saving}
            />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsNotificationsSection
              values={draft.notifications}
              errors={errors}
              onChange={updateGroup('notifications')}
              disabled={loading || saving}
            />
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsWeatherSection
              values={draft.weather}
              onChangeApiKey={updateWeatherApiKey}
            />
          </Box>

          {/* Push notifications (per-user, self-contained — not part of the global settings form). */}
          <Box sx={{ breakInside: 'avoid' }}>
            <SettingsPushNotificationsSection />
          </Box>
        </Box>
      </Box>

      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}

// Map wrapped field name → server-side error column key.
function mapClientKeyToErrorKey(group, key) {
  if (group === 'company') {
    return ({
      name: 'companyName',
      address: 'companyAddress',
      email: 'companyEmail',
      phone: 'companyPhone',
      siret: 'companySiret',
      tva: 'companyTva',
      iban: 'companyIban',
      bic: 'companyBic',
      bankName: 'companyBankName',
    })[key];
  }
  if (group === 'quote') {
    return ({
      footerText: 'quoteFooterText',
      footerTextEn: 'quoteFooterTextEn',
      validityDays: 'quoteValidityDays',
    })[key];
  }
  if (group === 'vat') {
    return ({
      rate: 'vatRate',
      rateCommission: 'vatRateCommission',
      rateCancellationCompensation: 'vatRateCancellationCompensation',
    })[key];
  }
  if (group === 'smtp') {
    return ({
      host: 'smtpHost',
      port: 'smtpPort',
      fromEmail: 'smtpFromEmail',
      fromName: 'smtpFromName',
      publicUrl: 'publicUrl',
    })[key];
  }
  if (group === 'laundry') {
    return ({
      weekday: 'laundryWeekday',
    })[key];
  }
  if (group === 'notifications') {
    return ({
      recipientEmail: 'notificationRecipientEmail',
    })[key];
  }
  return null;
}
