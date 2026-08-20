/**
 * UpdateAvailableAlert — Dashboard card announcing a published GuestFlow version
 * (specs/self-update-and-releases.md §6.1).
 *
 * Admin-only, and silent unless there is something to say: no update, an update the operator has
 * postponed, or an update already running all render nothing. Nothing is ever installed from here —
 * the button opens the dialog that shows what changed first.
 *
 * Mirrors the other dashboard alerts (EmailPendingAlert, IcalNewReservationsAlert): renders null on
 * error, because a dashboard card must never break the page.
 */
import React, { useState } from 'react';
import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import useAppUpdate from '../hooks/useAppUpdate';
import UpdateDialog from './UpdateDialog';

export default function UpdateAvailableAlert() {
  const { isAdmin, info, start, dismiss, starting } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin || !info || !info.updateAvailable) return null;
  if (info.dismissedVersion === info.latest) return null;
  if (info.updateInProgress) return null;

  return (
    <>
      <Alert
        severity="info"
        variant="outlined"
        icon={<SystemUpdateAltIcon fontSize="inherit" />}
        sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>GuestFlow {info.latest} est disponible</AlertTitle>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1.5,
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            Vous utilisez la version {info.current}.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
            <Button size="small" variant="contained" onClick={() => setDialogOpen(true)}>
              Voir les nouveautés
            </Button>
            <Button size="small" color="inherit" onClick={() => dismiss(info.latest)}>
              Plus tard
            </Button>
          </Box>
        </Box>
      </Alert>

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
