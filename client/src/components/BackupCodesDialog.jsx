/**
 * BackupCodesDialog — the backup codes shown once after « Nouveaux codes de secours »
 * (specs/hosting-h2-account-security.md rules 6, 45). Full screen on a phone (§6). Only « Terminé »
 * closes it — neither a click outside nor Escape — and « Terminé » waits for the codes to be saved
 * (BackupCodesPanel: copied, downloaded, or the box ticked).
 *
 * Props: open, codes: string[], account (the email, written in the downloaded file), onClose.
 */
import React, { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import BackupCodesPanel from './BackupCodesPanel';

export default function BackupCodesDialog({ open, codes = [], account = '', onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (open) setSaved(false); }, [open, codes]);

  return (
    // Closed by « Terminé » only: a stray tap outside or Escape must not lose codes shown once.
    <Dialog open={open} fullScreen={fullScreen} maxWidth="xs" fullWidth>
      <DialogTitle>Codes de secours</DialogTitle>
      <DialogContent>
        <BackupCodesPanel codes={codes} account={account} onSavedChange={setSaved} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Button variant="contained" onClick={onClose} disabled={!saved} sx={{ minHeight: 44 }}>Terminé</Button>
      </DialogActions>
    </Dialog>
  );
}
