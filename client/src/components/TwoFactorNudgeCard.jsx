/**
 * TwoFactorNudgeCard — « Protéger le compte par un second code », for an administrator without one
 * (specs/hosting-h2-account-security.md rule 10). The server decides whether it shows; it arrives as a
 * subject of the home (specs/shell-and-home-day-first.md rule 6). « Activer » opens « Mon compte »;
 * « Plus tard » hides it 30 days (the home re-reads its subjects after that write).
 */
import React from 'react';
import { useNavigate } from 'react-router';
import api from '../api';
import AttentionCard from './AttentionCard';

export default function TwoFactorNudgeCard({ attention }) {
  const navigate = useNavigate();
  const later = async () => {
    try { await api.snoozeTwoFactor(); } catch { /* shows again at the next visit */ }
  };
  return (
    <AttentionCard
      attention={attention}
      actions={[
        { label: 'Activer', primary: true, onClick: () => navigate('/mon-compte') },
        { label: 'Plus tard', color: 'inherit', onClick: later },
      ]}
    />
  );
}
