/**
 * EstablishmentSettingsPage — Paramètres → Établissement (specs/settings-rationalization.md rule 2).
 *
 * Identity, logo, contact, bank details, gate code, and the devis settings (validity, FR / EN
 * footers). The contact email is also the source every sending address falls back to (rule 12).
 * The logo is written through its own endpoint, never through the page Save.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api';
import { setFavicon } from '../../utils/setFavicon';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsCompanySection from '../../components/SettingsCompanySection';
import SettingsQuoteSection from '../../components/SettingsQuoteSection';

export default function EstablishmentSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['company', 'quote'], navigate });
  const disabled = form.loading || form.saving;
  // Rule 18 (R25-C4) — a new file of the same format keeps the same path: the preview asks for the new bytes.
  const [logoVersion, setLogoVersion] = useState('');

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

  return (
    <SettingsFormPage title="Établissement" form={form}>
      <SettingsCompanySection
        values={form.draft.company}
        errors={form.errors}
        onChange={(key, value) => form.setField('company', key, value)}
        onUploadLogo={handleUploadLogo}
        onDeleteLogo={handleDeleteLogo}
        logoVersion={logoVersion}
        disabled={disabled}
      />
      <SettingsQuoteSection
        values={form.draft.quote}
        errors={form.errors}
        onChange={(key, value) => form.setField('quote', key, value)}
        disabled={disabled}
      />
    </SettingsFormPage>
  );
}
