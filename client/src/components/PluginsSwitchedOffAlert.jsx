/**
 * PluginsSwitchedOffAlert — plugins the system switched off at a core update because a plugin they now need is off
 * (specs/plugins-phase-4-registry.md rule 57). The server words it; the card only offers the way to the Plugins page.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import AttentionCard from './AttentionCard';

export default function PluginsSwitchedOffAlert({ attention }) {
  const navigate = useNavigate();
  return <AttentionCard attention={attention} actions={[{ label: 'Voir les plugins', primary: true, onClick: () => navigate('/parametres/plugins') }]} />;
}
