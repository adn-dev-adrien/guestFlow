/**
 * BackupCodesDialog — the 10 backup codes, shown once, with « Copier » and « Télécharger »
 * (specs/hosting-h2-account-security.md rule 6). Full screen on a phone (§6).
 *
 * Props: open, codes: string[], account (the email, written in the downloaded file), onClose.
 */
import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';

export default function BackupCodesDialog({ open, codes = [], account = '', onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([`Codes de secours GuestFlow — ${account}\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guestflow-codes-de-secours.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="xs" fullWidth>
      <DialogTitle>Codes de secours</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>Affichés une seule fois. Chaque code remplace le second code une fois.</Alert>
        <Box
          data-testid="backup-codes"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 1,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 17,
            textAlign: 'center',
          }}
        >
          {codes.map((code) => <Box key={code}>{code}</Box>)}
        </Box>
        {copied && <Alert severity="success" sx={{ mt: 2 }}>Codes copiés.</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button startIcon={<ContentCopyIcon />} onClick={copy}>Copier</Button>
          <Button startIcon={<DownloadIcon />} onClick={download}>Télécharger</Button>
          <Button variant="contained" onClick={onClose}>Terminé</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
