import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Alert } from '@mui/material';
import api from '../api';
import { setFavicon } from '../utils/setFavicon';
import PageActionBar from '../components/PageActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import SettingsCompanySection from '../components/SettingsCompanySection';
import SettingsQuoteSection from '../components/SettingsQuoteSection';
import SettingsVatSection from '../components/SettingsVatSection';
import SettingsReservationLockSection from '../components/SettingsReservationLockSection';
import SettingsGoogleCalendarSection from '../components/SettingsGoogleCalendarSection';
import SettingsSmtpSection from '../components/SettingsSmtpSection';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';

const EMPTY_FORM = {
  company: {
    name: '', address: '', email: '', phone: '',
    siret: '', tva: '', iban: '', bic: '', bankName: '',
    logoPath: '',
  },
  quote: { footerText: '', validityDays: 30 },
  vat: { accommodationRate: 10, standardRate: 20 },
  googleCalendar: {
    calendarId: '',
    serviceAccountEmail: '',
    privateKeyMasked: '',
    privateKeyFingerprint: null,
    configured: false,
    statusLabel: 'Synchronisation non configurée',
    privateKeyDraft: undefined, // undefined = preserve; '' = clear; 'value' = store
  },
  smtp: {
    host: '', port: 587, secure: false,
    username: '',
    passwordSet: false,
    fromEmail: '', fromName: 'GuestFlow',
    publicUrl: '',
    passwordDraft: undefined, // same 3-way semantics as privateKeyDraft
  },
  // Admin escape hatch (specs/admin-unlock-past-reservations.md). OFF by default.
  reservations: {
    allowEditPastReservations: false,
  },
};

function diffFields(draftGroup, savedGroup) {
  const out = {};
  for (const key of Object.keys(draftGroup)) {
    if (key === 'privateKeyDraft') continue;
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

  const gcDirty = {};
  if (draft.googleCalendar.calendarId !== saved.googleCalendar.calendarId) {
    gcDirty.calendarId = draft.googleCalendar.calendarId;
  }
  if (draft.googleCalendar.serviceAccountEmail !== saved.googleCalendar.serviceAccountEmail) {
    gcDirty.serviceAccountEmail = draft.googleCalendar.serviceAccountEmail;
  }
  // privateKeyDraft: only include in payload when defined (= touched).
  if (draft.googleCalendar.privateKeyDraft !== undefined) {
    gcDirty.privateKey = draft.googleCalendar.privateKeyDraft;
  }
  if (Object.keys(gcDirty).length > 0) payload.googleCalendar = gcDirty;

  // SMTP — same per-field 3-way pattern as the other groups, with passwordDraft mirroring
  // privateKeyDraft (specs/admin-account-management.md M3).
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

  return payload;
}

function fromServer(settings) {
  if (!settings) return EMPTY_FORM;
  return {
    company: { ...EMPTY_FORM.company, ...(settings.company || {}) },
    quote: { ...EMPTY_FORM.quote, ...(settings.quote || {}) },
    vat: { ...EMPTY_FORM.vat, ...(settings.vat || {}) },
    googleCalendar: {
      ...EMPTY_FORM.googleCalendar,
      ...(settings.googleCalendar || {}),
      privateKeyDraft: undefined,
    },
    smtp: {
      ...EMPTY_FORM.smtp,
      ...(settings.smtp || {}),
      passwordDraft: undefined,
    },
    reservations: {
      ...EMPTY_FORM.reservations,
      ...(settings.reservations || {}),
    },
  };
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [errors, setErrors] = useState({});
  const [globalMessage, setGlobalMessage] = useState(null);
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
        if (mounted) setGlobalMessage({ severity: 'error', text: err.message || 'Impossible de charger les paramètres.' });
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

  const updatePrivateKey = (value) => {
    setDraft((prev) => ({
      ...prev,
      googleCalendar: { ...prev.googleCalendar, privateKeyDraft: value },
    }));
    if (errors.googleServiceAccountPrivateKey) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.googleServiceAccountPrivateKey;
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
    setGlobalMessage(null);
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
      setGlobalMessage({ severity: 'success', text: 'Paramètres enregistrés.' });
    } catch (err) {
      if (err && err.errors) {
        setErrors(err.errors);
      } else {
        setGlobalMessage({ severity: 'error', text: err.message || "Impossible d'enregistrer les paramètres." });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(savedForm);
    setErrors({});
    setGlobalMessage(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const out = await api.testGoogleCalendarConnection();
      setTestResult({ severity: 'success', message: out.message });
    } catch (err) {
      setTestResult({ severity: 'error', message: err.error || err.message || 'Échec du test.' });
    } finally {
      setTesting(false);
    }
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

      <Box sx={{ maxWidth: { xs: '100%', md: 920 }, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        {globalMessage && (
          <Alert
            severity={globalMessage.severity}
            sx={{ mb: 2 }}
            onClose={() => setGlobalMessage(null)}
          >
            {globalMessage.text}
          </Alert>
        )}

        <SettingsCompanySection
          values={draft.company}
          errors={errors}
          onChange={updateGroup('company')}
          onUploadLogo={handleUploadLogo}
          onDeleteLogo={handleDeleteLogo}
          disabled={loading || saving}
        />

        <SettingsQuoteSection
          values={draft.quote}
          errors={errors}
          onChange={updateGroup('quote')}
          disabled={loading || saving}
        />

        <SettingsVatSection
          values={draft.vat}
          errors={errors}
          onChange={updateGroup('vat')}
          disabled={loading || saving}
        />

        <SettingsReservationLockSection
          value={draft.reservations.allowEditPastReservations}
          onChange={(next) => updateGroup('reservations')('allowEditPastReservations', next)}
          disabled={loading || saving}
        />

        <SettingsGoogleCalendarSection
          values={draft.googleCalendar}
          errors={errors}
          statusLabel={draft.googleCalendar.statusLabel}
          onChange={updateGroup('googleCalendar')}
          onChangePrivateKey={updatePrivateKey}
          onTest={handleTest}
          testing={testing}
          testResult={testResult}
          disabled={loading || saving}
        />

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
      validityDays: 'quoteValidityDays',
    })[key];
  }
  if (group === 'vat') {
    return ({
      accommodationRate: 'vatRateAccommodation',
      standardRate: 'vatRateStandard',
    })[key];
  }
  if (group === 'googleCalendar') {
    return ({
      calendarId: 'googleCalendarId',
      serviceAccountEmail: 'googleServiceAccountEmail',
    })[key];
  }
  if (group === 'smtp') {
    return ({
      host: 'smtpHost',
      port: 'smtpPort',
      fromEmail: 'smtpFromEmail',
      publicUrl: 'publicUrl',
    })[key];
  }
  return null;
}
