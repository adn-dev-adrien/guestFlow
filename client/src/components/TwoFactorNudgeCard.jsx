/**
 * TwoFactorNudgeCard — « Protéger le compte par un second code », on the dashboard of an
 * administrator without one (specs/hosting-h2-account-security.md rule 10). « Activer » opens
 * « Mon compte »; « Plus tard » hides it 30 days. The server decides whether it shows (`nudge`).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
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

  return (
    <Alert
      severity="info"
      sx={{ mb: 2, alignItems: 'center', '& .MuiAlert-action': { pt: 0 } }}
      action={(
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button size="small" variant="contained" onClick={() => navigate('/mon-compte')}>Activer</Button>
          <Button size="small" color="inherit" onClick={later}>Plus tard</Button>
        </Stack>
      )}
    >
      Protéger le compte par un second code
    </Alert>
  );
}
