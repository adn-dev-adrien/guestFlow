/**
 * ExtraTripButton — « Ajouter un voyage blanchisserie exceptionnel », a button of the planning's
 * action bar (slot `planning.actions`, specs/plugins-phase-2-hosts.md rule 6;
 * specs/laundry-extra-trip.md §3.5 rule 17). Opens the create dialog, then reloads the laundry.
 *
 * Admin only: the reception sees the extra trips read-only, and the server refuses its writes.
 *
 * Props: reload() — reloads the plugin's planning cards.
 */
import React, { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import { api, useAuth, useToast, isReceptionOnly } from '../sdk';
import LaundryExtraTripDialog from './LaundryExtraTripDialog';

const TOOLTIP = 'Ajouter un voyage blanchisserie exceptionnel';

export default function ExtraTripButton({ reload }) {
  const { user } = useAuth();
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isReceptionOnly(user)) return null;

  const save = async (date, payload) => {
    setSaving(true);
    try {
      await api.setLaundryExtraTrip(date, payload);
      await reload();
      setOpen(false);
    } catch (err) {
      showError(`Impossible d'enregistrer le voyage exceptionnel. ${err?.message || ''}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip title={TOOLTIP} enterDelay={500} enterNextDelay={500}>
        <IconButton
          aria-label={TOOLTIP}
          color="info"
          onClick={() => setOpen(true)}
          sx={{ border: '1px solid', borderColor: 'info.main', borderRadius: 1 }}
        >
          <LocalLaundryServiceIcon />
        </IconButton>
      </Tooltip>
      <LaundryExtraTripDialog
        open={open}
        mode="create"
        date={null}
        current={null}
        saving={saving}
        onClose={() => setOpen(false)}
        onSave={save}
      />
    </>
  );
}
