/**
 * VatFranchiseAlert — « Seuil de franchise » on the home (specs/vat-optional-mode.md rule 42): the
 * server words the line (« 84 % atteint », « Dépassé de 1 240 € »); « Voir le suivi » opens the card in
 * the Suivi financier, where the figures and the way back to VAT are.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import AttentionCard from './AttentionCard';

export default function VatFranchiseAlert({ attention }) {
  const navigate = useNavigate();
  return <AttentionCard attention={attention} actions={[{ label: 'Voir le suivi', onClick: () => navigate('/finance') }]} />;
}
