/**
 * EstablishmentSettingsPage — Paramètres → Établissement (specs/settings/settings-rationalization.md rule 2).
 *
 * Identity, logo, contact, bank details, gate code, the devis settings (validity, FR / EN
 * footers) and the online booking horizon. The contact email is also the source every sending address falls back to (rule 12).
 * The logos (day, and the night one of the guest emails) are written through their own endpoints, never through the page Save.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api';
import { setFavicon } from '../../utils/setFavicon';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsCompanySection from '../../components/SettingsCompanySection';
import SettingsQuoteSection from '../../components/SettingsQuoteSection';
import SettingsBookingSection from '../../components/SettingsBookingSection';

export default function EstablishmentSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['company', 'quote', 'booking'], navigate });
  const disabled = form.loading || form.saving;
  // Rule 18 (R25-C4) — a new file of the same format keeps the same path: the preview asks for the new bytes.
  const [logoVersion, setLogoVersion] = useState('');
  const [logoDarkVersion, setLogoDarkVersion] = useState('');

  const handleUploadLogo = async (file) => {
    const formData = new FormData();
    formData.append('logo', file);
    const res = await api.uploadCompanyLogo(formData);
    const newPath = res && res.company && res.company.logoPath;
    if (newPath != null) {
      const version = String(Date.now());
      form.replaceSaved('company', 'logoPath', newPath);
      setLogoVersion(version);
      // Version-bust so a re-upload of the same filename still refreshes the tab icon.
      setFavicon({ href: newPath, version });
    }
  };

  const handleDeleteLogo = async () => {
    const res = await api.deleteCompanyLogo();
    const newPath = res && res.company && res.company.logoPath;
    form.replaceSaved('company', 'logoPath', newPath || '');
    setFavicon({ href: null });
  };

  // specs/emails/guest-email-branding.md rule 4bis — the night logo of the guest emails: same flow, no tab icon.
  const handleUploadLogoDark = async (file) => {
    const formData = new FormData();
    formData.append('logo', file);
    const res = await api.uploadCompanyLogoDark(formData);
    const newPath = res && res.company && res.company.logoDarkPath;
    if (newPath != null) {
      form.replaceSaved('company', 'logoDarkPath', newPath);
      setLogoDarkVersion(String(Date.now()));
    }
  };

  const handleDeleteLogoDark = async () => {
    const res = await api.deleteCompanyLogoDark();
    form.replaceSaved('company', 'logoDarkPath', (res && res.company && res.company.logoDarkPath) || '');
  };

  return (
    <SettingsFormPage title="Établissement" form={form}>
      <SettingsCompanySection
        values={form.draft.company}
        errors={form.errors}
        onChange={(key, value) => form.setField('company', key, value)}
        onUploadLogo={handleUploadLogo}
        onDeleteLogo={handleDeleteLogo}
        logoVersion={logoVersion}
        onUploadLogoDark={handleUploadLogoDark}
        onDeleteLogoDark={handleDeleteLogoDark}
        logoDarkVersion={logoDarkVersion}
        disabled={disabled}
      />
      <SettingsQuoteSection
        values={form.draft.quote}
        errors={form.errors}
        onChange={(key, value) => form.setField('quote', key, value)}
        disabled={disabled}
      />
      <SettingsBookingSection
        values={form.draft.booking}
        errors={form.errors}
        onChange={(key, value) => form.setField('booking', key, value)}
        disabled={disabled}
      />
    </SettingsFormPage>
  );
}
