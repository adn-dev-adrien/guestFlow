/**
 * VatFiscalSettingsPage — Paramètres → TVA & exercice (specs/settings-rationalization.md rule 2).
 *
 * The stay VAT rate and the accounting closing month. The commission and cancellation-indemnity
 * rates live on Plan comptable (rule 14), linked from here by the accounting export
 * (slot `settings.platforms.links`, specs/plugins-phase-2-hosts.md rule 19).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsVatSection from '../../components/SettingsVatSection';
import SettingsFiscalYearSection, { hasInvalidRevenueGoal } from '../../components/SettingsFiscalYearSection';
import api from '../../api';
import Slot from '../../plugins/sdk/Slot';

export default function VatFiscalSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['vat', 'accounting'], navigate });
  const disabled = form.loading || form.saving;
  // specs/finance-dashboard-redesign.md §3.8 — the exercises the goal fields name, from the server.
  const [goalContext, setGoalContext] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.getFinanceGoalContext().then((ctx) => { if (mounted) setGoalContext(ctx); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <SettingsFormPage title="TVA & exercice" form={form} saveBlocked={hasInvalidRevenueGoal(form.draft.accounting?.revenueGoals)}>
      <SettingsVatSection
        values={form.draft.vat}
        errors={form.errors}
        onChange={(key, value) => form.setField('vat', key, value)}
        disabled={disabled}
      />
      <Slot name="settings.platforms.links" page="vat" />
      <SettingsFiscalYearSection
        values={form.draft.accounting}
        errors={form.errors}
        onChange={(key, value) => form.setField('accounting', key, value)}
        goalContext={goalContext}
        disabled={disabled}
      />
    </SettingsFormPage>
  );
}
