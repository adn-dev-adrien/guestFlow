/**
 * BackupCodesPanel — a list of single-use codes shown once (specs/hosting-h2-account-security.md
 * rule 45): the codes in two columns (one below 360 px), « Copier », « Télécharger » and a box
 * « Codes enregistrés en lieu sûr ». Copying or downloading ticks the box; `onSavedChange(bool)` tells
 * the parent, which keeps its « Terminé » disabled until it is true. Generic: any « shown once » list
 * of secrets (the console's operator codes next).
 *
 * Props: codes: string[], account (written in the downloaded file), onSavedChange(saved: boolean),
 *        title ('Codes de secours GuestFlow' — first line of the file), filePrefix
 *        ('guestflow-codes-de-secours').
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import CheckIcon from '@mui/icons-material/Check';

const FEEDBACK_MS = 2000;

export default function BackupCodesPanel({
  codes = [],
  account = '',
  onSavedChange,
  title = 'Codes de secours GuestFlow',
  filePrefix = 'guestflow-codes-de-secours',
}) {
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const markSaved = (which) => {
    setSaved(true);
    if (onSavedChange) onSavedChange(true);
    setDone(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), FEEDBACK_MS);
  };

  const toggle = (e) => {
    setSaved(e.target.checked);
    if (onSavedChange) onSavedChange(e.target.checked);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      markSaved('copy');
    } catch {
      setDone(null);
    }
  };

  const download = () => {
    const blob = new Blob([`${title} — ${account}\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    markSaved('download');
  };

  return (
    <Stack spacing={2}>
      <Alert severity="warning">Affichés une seule fois. Chaque code ne sert qu’une fois, à la place du code de l’appli.</Alert>
      <Box
        data-testid="backup-codes"
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          '@media (max-width:359px)': { gridTemplateColumns: '1fr' },
          gap: 1,
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 17,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center',
        }}
      >
        {codes.map((code) => <Box key={code}>{code}</Box>)}
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" startIcon={done === 'copy' ? <CheckIcon /> : <ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>
          {done === 'copy' ? 'Copié' : 'Copier'}
        </Button>
        <Button variant="outlined" startIcon={done === 'download' ? <CheckIcon /> : <DownloadIcon />} onClick={download} sx={{ minHeight: 44 }}>
          {done === 'download' ? 'Téléchargé' : 'Télécharger'}
        </Button>
      </Stack>
      <FormControlLabel
        control={<Checkbox checked={saved} onChange={toggle} />}
        label="Codes enregistrés en lieu sûr"
        sx={{ minHeight: 44 }}
      />
    </Stack>
  );
}
