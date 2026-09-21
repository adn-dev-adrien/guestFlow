/**
 * VatFiscalSettingsPage — Paramètres → TVA & exercice (specs/settings-rationalization.md rule 2).
 *
 * The stay VAT rate and the accounting closing month. The commission and cancellation-indemnity
 * rates live on Plan comptable (rule 14), linked from here.
 */
import React from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { Link, Typography } from '@mui/material';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsVatSection from '../../components/SettingsVatSection';
import SettingsFiscalYearSection from '../../components/SettingsFiscalYearSection';

export default function VatFiscalSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['vat', 'accounting'], navigate });
  const disabled = form.loading || form.saving;

  return (
    <SettingsFormPage title="TVA & exercice" form={form}>
      <SettingsVatSection
        values={form.draft.vat}
        errors={form.errors}
        onChange={(key, value) => form.setField('vat', key, value)}
        disabled={disabled}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 3 }}>
        Les taux sur les commissions et les indemnités d'annulation se règlent dans le{' '}
        <Link component={RouterLink} to="/comptabilite/plateformes">Plan comptable</Link>.
      </Typography>
      <SettingsFiscalYearSection
        values={form.draft.accounting}
        errors={form.errors}
        onChange={(key, value) => form.setField('accounting', key, value)}
        disabled={disabled}
      />
    </SettingsFormPage>
  );
}
