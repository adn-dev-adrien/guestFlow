/**
 * UpdateAvailableAlert — a published GuestFlow version (specs/self-update-and-releases.md §6.1), as a
 * subject of the home: the server decides it shows (not postponed, not running) and words it
 * (specs/shell-and-home-day-first.md rule 6). Nothing is ever installed from here — « Voir les
 * nouveautés » opens the dialog that shows what changed first; « Plus tard » postpones this version.
 */
import React, { useState } from 'react';
import useAppUpdate from '../hooks/useAppUpdate';
import AttentionCard from './AttentionCard';
import UpdateDialog from './UpdateDialog';

export default function UpdateAvailableAlert({ attention }) {
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
