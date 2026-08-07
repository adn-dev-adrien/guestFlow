/**
 * BillableAmountsPage — `/parametres/tarifs`
 *
 * Dedicated page for the « Tarifs facturables » (prix du linge manquant + montants de réparation
 * facturés dans le SAS). The page OWNS the data (load / one bar-level save for both lists / dirty
 * guard — specs/ds-sweep-settings.md §3.1 rule 1: the two content « Enregistrer » rows moved into
 * the canonical PageActionBar); `SettingsBillableAmountsSection` renders the form.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useNavigate } from 'react-router';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import ConfirmDialog from '../components/ConfirmDialog';
import SettingsBillableAmountsSection from '../components/SettingsBillableAmountsSection';
import { useToast } from '../components/DialogProvider';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';
import api from '../api';

export default function BillableAmountsPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [linen, setLinen] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [savedLinen, setSavedLinen] = useState([]);
  const [savedRepairs, setSavedRepairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // No silent .catch(()=>[]) — a failed load renders the retryable ErrorAlert.
      const [l, r] = await Promise.all([api.getLinenItems(), api.getRepairAmounts()]);
      const linenRows = Array.isArray(l) ? l : [];
      const repairRows = Array.isArray(r) ? r : [];
      setLinen(linenRows);
      setRepairs(repairRows);
      setSavedLinen(linenRows);
      setSavedRepairs(repairRows);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft: { linen, repairs },
    saved: { linen: savedLinen, repairs: savedRepairs },
    navigate,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const linenPayload = linen
        .filter((it) => String(it.label || '').trim())
        .map((it) => ({ label: String(it.label).trim(), price: Math.max(0, Number(it.price) || 0), category: it.category === 'towel' ? 'towel' : 'bed' }));
      const repairsPayload = repairs
        .filter((it) => String(it.label || '').trim())
        .map((it) => ({ repairKey: it.repairKey || null, label: String(it.label).trim(), price: Math.max(0, Number(it.price) || 0) }));
      const [l, r] = await Promise.all([
        api.updateLinenItems(linenPayload),
        api.updateRepairAmounts(repairsPayload),
      ]);
      setLinen(l); setSavedLinen(l);
      setRepairs(r); setSavedRepairs(r);
      showSuccess('Tarifs facturables enregistrés.');
    } catch (e) {
      showError(e.message || "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setLinen(savedLinen);
    setRepairs(savedRepairs);
  };

  return (
    <Box>
      <PageActionBar
        title="Tarifs facturables"
        backTo="/parametres"
        onSave={handleSave}
        saveDisabled={loading || saving || !isDirty}
        saveBusy={saving}
        onCancel={handleCancel}
        cancelDisabled={loading || saving || !isDirty}
      />
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: '100%', md: 900, lg: 1240 }, mx: 'auto' }}>
        {loadError && (
          <ErrorAlert message="Impossible de charger les tarifs facturables." onRetry={load} sx={{ mb: 2 }} />
        )}
        <SettingsBillableAmountsSection
          linen={linen}
          setLinen={setLinen}
          repairs={repairs}
          setRepairs={setRepairs}
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
