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
import useVatRegime from '../../hooks/useVatRegime';
import VatRegimeSwitchDialog from '../../components/VatRegimeSwitchDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../components/DialogProvider';
import { VAT_TEXTS } from '../../constants/vatRegime';
import Slot from '../../plugins/sdk/Slot';

export default function VatFiscalSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['vat', 'accounting'], navigate });
  const disabled = form.loading || form.saving;
  const { showSuccess, showError } = useToast();
  const vat = useVatRegime();
  // Rule 33: an emptied rate is refused on screen, never sent (the server refuses it too).
  const rateBlank = form.draft.vat?.regime !== 'not_subject' && (form.draft.vat?.rate === '' || form.draft.vat?.rate == null);
  const [switching, setSwitching] = useState(false);
  const [undoing, setUndoing] = useState(null);
  // The switch writes through its own endpoint: the page's saved values follow what the server now holds.
  const adoptRegime = (next) => {
    if (!next || !next.inForce) return;
    const subject = next.inForce.regime === 'subject';
    form.replaceSaved('vat', 'regime', next.inForce.regime);
    form.replaceSaved('vat', 'rate', subject ? next.inForce.rate : 0);
    form.replaceSaved('vat', 'legalMention', subject ? null : next.inForce.legalMention);
  };
  // specs/finance-dashboard-redesign.md §3.8 — the exercises the goal fields name, from the server.
  const [goalContext, setGoalContext] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.getFinanceGoalContext().then((ctx) => { if (mounted) setGoalContext(ctx); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <SettingsFormPage title="TVA & exercice" form={form} saveBlocked={hasInvalidRevenueGoal(form.draft.accounting?.revenueGoals) || rateBlank}>
      <SettingsVatSection
        values={form.draft.vat}
        errors={rateBlank ? { ...form.errors, vatRate: VAT_TEXTS.rateRequired } : form.errors}
        onChange={(key, value) => form.setField('vat', key, value)}
        disabled={disabled}
        regime={vat.state}
        onSwitch={() => setSwitching(true)}
        onUndo={setUndoing}
      />
      {vat.state && (
        <VatRegimeSwitchDialog
          open={switching}
          onClose={() => setSwitching(false)}
          inForce={vat.state.inForce}
          latest={vat.state.latest}
          onStale={vat.reload}
          mentions={vat.state.mentions}
          preview={vat.preview}
          onSubmit={vat.switchRegime}
          onDone={async (done) => {
            setSwitching(false);
            adoptRegime(await vat.reload());
            showSuccess(done && done.reassigned ? 'Régime modifié.' : 'Changement enregistré.');
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(undoing)}
        onClose={() => setUndoing(null)}
        title={VAT_TEXTS.undoConfirmTitle}
        message={VAT_TEXTS.undoConfirmMessage}
        confirmLabel={VAT_TEXTS.undo}
        confirmColor="primary"
        cancelLabel={VAT_TEXTS.keep}
        onConfirm={async () => {
          const period = undoing;
          setUndoing(null);
          try {
            const undone = await vat.deletePeriod(period.id);
            adoptRegime(undone.state);
            const n = undone.notRepriced.length;
            if (n) showError(n === 1 ? 'Changement annulé. 1 séjour garde sa taxe de séjour enregistrée.' : `Changement annulé. ${n} séjours gardent leur taxe de séjour enregistrée.`);
            else showSuccess('Changement annulé.');
          } catch (err) {
            showError((err && err.message) || 'Annulation impossible.');
          }
        }}
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
