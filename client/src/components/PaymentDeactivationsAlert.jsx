/**
 * PaymentDeactivationsAlert — withdrawn payment links a guest could still pay at the provider
 * (specs/payment-link-lifecycle.md rule 67). The server words the card and every row
 * (GET /api/dashboard/payment-deactivations: kind, amount, reference, stay, reason, date); the card lists them, so the
 * operator can find each link at the provider, and offers the way to the Paiements en ligne page where the connection
 * is restored. Renders the summary alone while the list loads or when it cannot be read.
 */
import React, { useEffect, useState } from 'react';
import { Box, Divider, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import { canSeeRoute } from '../constants/roles';
import AttentionCard from './AttentionCard';
import { touchHitArea } from '../utils/touchHitArea';

export default function PaymentDeactivationsAlert({ attention }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [links, setLinks] = useState([]);

  useEffect(() => {
    let alive = true;
    api.getPaymentDeactivations()
      .then((payload) => { if (alive) setLinks(Array.isArray(payload?.links) ? payload.links : []); })
      .catch(() => { if (alive) setLinks([]); });
    return () => { alive = false; };
  }, []);

  const actions = canSeeRoute(user, '/parametres/paiements')
    ? [{ label: 'Ouvrir les paiements en ligne', primary: true, onClick: () => navigate('/parametres/paiements') }]
    : [];

  return (
    <AttentionCard attention={attention} actions={actions}>
      {links.length > 0 && (
        <Stack divider={<Divider flexItem />} spacing={0.75}>
          {links.map((link) => (
            <Box key={link.id} sx={{ py: 0.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {link.kindLabel} · {link.amountLabel}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {link.stayUrl ? (
                  <Link component={RouterLink} to={link.stayUrl} color="inherit" underline="always" sx={touchHitArea}>{link.stayLabel}</Link>
                ) : link.stayLabel}
                {` · ${link.reasonLabel}${link.sinceLabel ? ` · ${link.sinceLabel}` : ''}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                {`Référence ${link.providerLabel} : ${link.reference}`}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
    </AttentionCard>
  );
}
