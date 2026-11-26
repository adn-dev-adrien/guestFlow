/**
 * EmailPendingAlert — the manual emails waiting to be read and sent (specs/emails/email-automation.md §3
 * rule 8, §6.2). Drawn by `AttentionCard` with the server's count and detail (« 2 messages à
 * envoyer · 1 client sans adresse », specs/planning/shell-and-home-day-first.md rule 6); « Voir et envoyer »
 * opens the Emails page where the queue is reviewed inline.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import AttentionCard from './AttentionCard';

export default function EmailPendingAlert({ attention }) {
  const navigate = useNavigate();
  return <AttentionCard attention={attention} actions={[{ label: 'Voir et envoyer', onClick: () => navigate('/emails') }]} />;
}
