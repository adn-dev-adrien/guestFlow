/**
 * PlanningLaundryCard — the laundry card of a planning day, with the dialogs it opens
 * (specs/plugins-phase-2-hosts.md rules 5 and 7; specs/skip-laundry-trip.md,
 * specs/manual-laundry-additions.md, specs/laundry-extra-trip.md).
 *
 * Rendered by the planning's `planning.days` slot. After any write it calls `reload()`, which
 * reloads the laundry of the window shown: a skip or a manual line moves the next trips and the stock
 * line too.
 *
 * Props: date (ISO), entry ({ data, inventoryAfter, isSkipped, manualAddition, extraTrip }), reload().
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, useAuth, useToast, isReceptionOnly, ConfirmDialog } from '../sdk';
import LaundryDayCard from './LaundryDayCard';
import LaundryManualAdditionsDialog from './LaundryManualAdditionsDialog';
import LaundryExtraTripDialog from './LaundryExtraTripDialog';

export default function PlanningLaundryCard({ date, entry, reload }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showError } = useToast();
  // specs/laundry-extra-trip.md §3.5 rule 17 — the reception sees the extra trips read-only.
  const receptionMode = isReceptionOnly(user);
  // Optimistic skip flag (specs/skip-laundry-trip.md §3.3 rule 12): flipped at once, reverted on error.
  const [skipped, setSkipped] = useState(Boolean(entry.isSkipped));
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraSaving, setExtraSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setSkipped(Boolean(entry.isSkipped)); }, [entry.isSkipped]);

  const toggleSkip = async (day, nextValue) => {
    setSkipped(nextValue);
    try {
      if (nextValue) await api.addLaundrySkip(day);
      else await api.removeLaundrySkip(day);
      await reload();
    } catch (err) {
      setSkipped(!nextValue);
      showError(`Impossible d'enregistrer le voyage non réalisé. ${err?.message || ''}`);
    }
  };

  const saveManual = async (day, counts) => {
    setManualSaving(true);
    try {
      await api.setLaundryManualAddition(day, counts);
      await reload();
      setManualOpen(false);
    } catch (err) {
      showError(`Impossible d'enregistrer l'ajout manuel. ${err?.message || ''}`);
    } finally {
      setManualSaving(false);
    }
  };

  const saveExtra = async (day, payload) => {
    setExtraSaving(true);
    try {
      await api.setLaundryExtraTrip(day, payload);
      await reload();
      setExtraOpen(false);
    } catch (err) {
      showError(`Impossible d'enregistrer le voyage exceptionnel. ${err?.message || ''}`);
    } finally {
      setExtraSaving(false);
    }
  };

  const deleteExtra = async () => {
    setConfirmDelete(false);
    try {
      await api.deleteLaundryExtraTrip(date);
      await reload();
    } catch (err) {
      showError(`Impossible de supprimer le voyage exceptionnel. ${err?.message || ''}`);
    }
  };

  return (
    <>
      <LaundryDayCard
        data={entry.data}
        inventoryAfter={entry.inventoryAfter}
        date={date}
        isSkipped={skipped}
        onToggleSkip={toggleSkip}
        manualAddition={entry.manualAddition}
        onEditManual={() => setManualOpen(true)}
        onOpenReservation={(id) => navigate(`/reservations/${id}`)}
        onEditExtra={receptionMode ? undefined : () => setExtraOpen(true)}
        onDeleteExtra={receptionMode ? undefined : () => setConfirmDelete(true)}
      />
      <LaundryManualAdditionsDialog
        open={manualOpen}
        date={date}
        current={entry.manualAddition}
        saving={manualSaving}
        onClose={() => setManualOpen(false)}
        onSave={saveManual}
      />
      <LaundryExtraTripDialog
        open={extraOpen}
        mode="edit"
        date={date}
        current={entry.extraTrip}
        saving={extraSaving}
        onClose={() => setExtraOpen(false)}
        onSave={saveExtra}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce voyage exceptionnel ?"
        message="Le linge de cette date retournera dans le calcul du voyage suivant."
        confirmLabel="Supprimer"
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteExtra}
      />
    </>
  );
}
