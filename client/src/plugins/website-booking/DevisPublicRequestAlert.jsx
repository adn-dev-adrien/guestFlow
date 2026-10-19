/**
 * DevisPublicRequestAlert — the devis created from the public website (booking requests) still
 * waiting to be handled (specs/site-booking-notifications.md §3 rule 5), as a subject of the home:
 * count and « N devis en attente » from the server (specs/shell-and-home-day-first.md rule 6), drawn
 * by `AttentionCard`. « Voir les devis » opens the Devis list.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { AttentionCard } from '../sdk';

export default function DevisPublicRequestAlert({ attention }) {
  const navigate = useNavigate();
  return <AttentionCard attention={attention} actions={[{ label: 'Voir les devis', onClick: () => navigate('/devis') }]} />;
}
