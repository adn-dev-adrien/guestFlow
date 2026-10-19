/**
 * AppVersionBadge — the way in when a newer GuestFlow exists (specs/self-update-and-releases.md §6.5),
 * and `AppVersionFooter`, the installed version at the foot of the drawer.
 *
 * Since 2026-10-19 (specs/shell-and-home-day-first.md rule 16, decision 3 of the UI/UX review) the
 * installed version is no longer in the top bar: it is a fact, read once in a while, so it sits at the
 * foot of the drawer (« GuestFlow v3.10.0 »). The top bar keeps only the offer — a `HeaderPill`,
 * because a tinted, counted pill is seen without being looked for, on every page.
 *
 * Admin-only, like every `/api/system/*` endpoint — a non-admin session makes no call at all rather
 * than collecting 403s, and simply gets neither.
 *
 * Unlike the dashboard subject, the pill **ignores « Plus tard »**: postponing is about not being
 * nagged on the dashboard, not about losing the way back to the release notes. It does step aside
 * while an update is running — `UpdateProgressOverlay` owns the screen at that point.
 */
import React, { useState } from 'react';
import { Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import useAppUpdate from '../hooks/useAppUpdate';
import HeaderPill from './HeaderPill';
import UpdateDialog from './UpdateDialog';

/** The installed version, muted, for the foot of the drawer. */
export function AppVersionFooter() {
  const { isAdmin, info } = useAppUpdate();
  if (!isAdmin || !info || !info.current) return null;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid="app-version-footer"
      sx={{ display: 'block', px: 2.5, py: 1.5, fontVariantNumeric: 'tabular-nums' }}
    >
      GuestFlow v{info.current}
    </Typography>
  );
}

export default function AppVersionBadge() {
  const { isAdmin, info, start, starting } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin || !info || !info.updateAvailable || info.updateInProgress) return null;

  return (
    <>
      <HeaderPill
        icon={<SystemUpdateAltIcon />}
        tone="primary"
        count={1}
        title={`GuestFlow ${info.latest} est disponible`}
        ariaLabel={`GuestFlow ${info.latest} est disponible — voir les nouveautés`}
        onClick={() => setDialogOpen(true)}
      />
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
    </>
  );
}
