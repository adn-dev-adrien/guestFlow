/**
 * AppVersionBadge — the installed version, and the way in when a newer one exists
 * (specs/self-update-and-releases.md §6.5).
 *
 * Sits at the right end of the top bar, on every page. It replaces the old `prod <sha>` pill: a
 * commit SHA told the operator which build was running only if they could map it back to a commit,
 * whereas the release version is the thing the changelog, the GitHub release and the update dialog
 * all speak in.
 *
 * Admin-only, like every `/api/system/*` endpoint — a non-admin session makes no call at all rather
 * than collecting 403s, and simply gets no badge.
 *
 * Unlike the dashboard alert, the update pill here **ignores « Plus tard »**: postponing is about
 * not being nagged on the dashboard, not about losing the way back to the release notes. It does
 * step aside while an update is running — `UpdateProgressOverlay` owns the screen at that point.
 *
 * The offer is a `HeaderPill`, not a bare icon button: a tinted, counted pill is seen without being
 * looked for, which is the whole point of putting the affordance in the bar of every page.
 */
import React, { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import useAppUpdate from '../hooks/useAppUpdate';
import HeaderPill from './HeaderPill';
import UpdateDialog from './UpdateDialog';

export default function AppVersionBadge() {
  const { isAdmin, info, start, starting } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin || !info || !info.current) return null;

  const showUpdate = Boolean(info.updateAvailable) && !info.updateInProgress;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title="Version installée">
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          v{info.current}
        </Typography>
      </Tooltip>

      {showUpdate && (
        <HeaderPill
          icon={<SystemUpdateAltIcon />}
          tone="primary"
          count={1}
          title={`GuestFlow ${info.latest} est disponible`}
          ariaLabel={`GuestFlow ${info.latest} est disponible — voir les nouveautés`}
          onClick={() => setDialogOpen(true)}
        />
      )}

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
    </Box>
  );
}
