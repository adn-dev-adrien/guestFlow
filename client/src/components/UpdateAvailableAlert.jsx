/**
 * UpdateAvailableAlert — a published GuestFlow version (specs/hosting/self-update-and-releases.md §6.1), as a
 * subject of the home: the server decides it shows (not postponed, not running) and words it
 * (specs/planning/shell-and-home-day-first.md rule 6). Nothing is ever installed from here — « Voir les
 * nouveautés » opens the dialog that shows what changed first; « Plus tard » postpones this version;
 * « Ouvrir » goes to Réglages › Système et mises à jour (specs/planning/mobile-dashboard-exercise-cash.md rule 7).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import useAppUpdate from '../hooks/useAppUpdate';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';
import AttentionCard from './AttentionCard';
import UpdateDialog from './UpdateDialog';

export default function UpdateAvailableAlert({ attention }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { info, start, dismiss, starting } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const ready = Boolean(info && info.latest);

  return (
    <>
      <AttentionCard
        attention={attention}
        actions={[
          { label: 'Voir les nouveautés', primary: true, disabled: !ready, onClick: () => setDialogOpen(true) },
          { label: 'Plus tard', color: 'inherit', disabled: !ready, onClick: () => dismiss(info.latest) },
          ...(userHasRole(user, ADMIN) ? [{ label: 'Ouvrir', color: 'inherit', onClick: () => navigate('/settings/systeme') }] : []),
        ]}
      />
      {ready ? (
        <UpdateDialog
          open={dialogOpen}
          info={info}
          starting={starting}
          onClose={() => setDialogOpen(false)}
          onConfirm={async () => {
            const ok = await start(info.latest);
            if (ok) setDialogOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
