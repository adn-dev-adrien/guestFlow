/**
 * TwoFactorNudgeCard — « Protéger le compte par un second code », on the dashboard of an
 * administrator without one (specs/hosting-h2-account-security.md rule 10). « Activer » opens
 * « Mon compte »; « Plus tard » hides it 30 days. The server decides whether it shows (`nudge`).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';

export default function TwoFactorNudgeCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = userHasRole(user, ADMIN) && !(user && user.isSupport);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    api.getTwoFactorStatus()
      .then((s) => { if (alive) setShow(Boolean(s && s.nudge)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isAdmin]);

  if (!show) return null;

  const later = async () => {
    setShow(false);
    try { await api.snoozeTwoFactor(); } catch { /* shows again at the next visit */ }
  };

  // specs/plugins-phase-p-productisation.md rule 39 — on a phone the buttons wrap under the sentence
  // instead of squeezing « Plus tard » onto two lines.
  return (
    <Alert
      severity="info"
      sx={{
        mb: 2,
        alignItems: 'center',
        '& .MuiAlert-message': { flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1 },
      }}
    >
      <Box component="span" sx={{ flex: '1 1 12rem' }}>Protéger le compte par un second code</Box>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        <Button size="small" variant="contained" onClick={() => navigate('/mon-compte')} sx={{ whiteSpace: 'nowrap', minHeight: 44 }}>Activer</Button>
        <Button size="small" color="inherit" onClick={later} sx={{ whiteSpace: 'nowrap', minHeight: 44 }}>Plus tard</Button>
      </Stack>
    </Alert>
  );
}
