/**
 * EmailReadinessAlert — « Emails incomplets » (specs/guest-email-texts-made-simple.md rule 7): what
 * the server found missing for a stay within 14 days. Drawn by `AttentionCard` with the server's count
 * and detail (specs/shell-and-home-day-first.md rule 6); « Compléter » opens « Textes des emails ».
 */
import React from 'react';
import { useNavigate } from 'react-router';
import AttentionCard from './AttentionCard';

export default function EmailReadinessAlert({ attention }) {
  const navigate = useNavigate();
  return <AttentionCard attention={attention} actions={[{ label: 'Compléter', onClick: () => navigate('/settings/emails/textes') }]} />;
}
