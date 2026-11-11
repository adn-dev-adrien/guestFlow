/**
 * PaymentDeactivationsAlert — withdrawn payment links a guest could still pay at the provider
 * (specs/payment-link-lifecycle.md rule 67). The server words it; the card only offers the way to the
 * Paiements en ligne page, where the connection is restored so the deactivation can go through.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { canSeeRoute } from '../constants/roles';
import AttentionCard from './AttentionCard';

export default function PaymentDeactivationsAlert({ attention }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const actions = canSeeRoute(user, '/parametres/paiements')
    ? [{ label: 'Ouvrir les paiements en ligne', primary: true, onClick: () => navigate('/parametres/paiements') }]
    : [];
  return <AttentionCard attention={attention} actions={actions} />;
}
