/**
 * SubscriptionBanner — where the instance's subscription stands, for admins
 * (specs/control-plane-plans-and-access.md §6).
 *
 * Driven by `GET /api/subscription` → `{ state, endsAt, daysLeft, planName, payUrl }`, which the
 * server reads from the signed licence; `state: null` (nothing enforced) and `active` render nothing.
 * Self-contained: it fetches once per session and renders nothing for other roles or on failure, so
 * wiring is just `<SubscriptionBanner />` in the layout, inside `DialogProvider`.
 *
 * For every role, it also turns the `guestflow:read-only` event (api.js, on a 402
 * SUBSCRIPTION_READ_ONLY) into the error toast, so a refused write is never silent, and refreshes
 * the banner.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './DialogProvider';
import { ADMIN, userHasRole } from '../constants/roles';
import { displayDate } from '../utils/formatters';

const READ_ONLY = 'Lecture seule : vos données restent consultables et exportables, la synchronisation des calendriers continue.';

function content({ state, endsAt, daysLeft, planName }) {
  const plan = planName ? ` ${planName}` : '';
  switch (state) {
    case 'trial':
      return { severity: 'info', text: daysLeft > 1 ? `Période d’essai : ${daysLeft} jours restants.` : 'Dernier jour de la période d’essai.' };
    case 'due':
      return { severity: 'info', text: `Votre abonnement${plan} se termine le ${displayDate(endsAt)}.` };
    case 'grace':
      return { severity: 'warning', text: `Abonnement échu depuis le ${displayDate(endsAt)} : renouvelez-le pour garder l’accès complet.` };
    case 'read_only':
    case 'suspended':
    case 'archived':
      return { severity: 'error', text: READ_ONLY };
    default:
      return null;
  }
}

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const isAdmin = userHasRole(user, ADMIN);
  const { showError } = useToast();
  const [status, setStatus] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    api.getSubscription()
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [isAdmin, refreshKey]);

  useEffect(() => {
    const onReadOnly = (e) => {
      showError(e.detail && e.detail.message);
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener('guestflow:read-only', onReadOnly);
    return () => window.removeEventListener('guestflow:read-only', onReadOnly);
  }, [showError]);

  const shown = isAdmin && status ? content(status) : null;
  if (!shown) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity={shown.severity}
        action={status.payUrl && (
          <Button color="inherit" size="small" href={status.payUrl} target="_blank" rel="noopener noreferrer" sx={{ minHeight: 44 }}>
            Renouveler
          </Button>
        )}
        sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0 } }}
      >
        {shown.text}
      </Alert>
    </Box>
  );
}
