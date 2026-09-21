/**
 * SettingsGateAccessSection — « Accès portail », a self-contained Réglages card
 * (specs/gate-access-sowel-connector.md §3.5).
 *
 * It configures nothing: gate access belongs to the house (Sowel → Administration → Accès
 * invités), and that is where everything is decided. What this card answers, and what cannot be
 * guessed otherwise, is **whether the house is talking to guestFlow, and when it last did** — the
 * only question asked here when a guest says they never received their code.
 *
 * The two secrets are deliberately not displayed: they are read from `server/.env.local`, exactly
 * like the site's key. A key an API can hand back is a key a stolen session can read.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Stack, Typography, Alert } from '@mui/material';
import StatusBadge from './StatusBadge';
import SummaryItem from './SummaryItem';
import api from '../api';

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export default function SettingsGateAccessSection() {
  const [state, setState] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await api.getGateConnector());
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!state) return null;

  const talking = Boolean(state.lastReceivedAt);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader">Accès portail</Typography>
          <StatusBadge
            status={!state.configured ? 'neutral' : talking ? 'success' : 'warning'}
            label={!state.configured ? 'Non configuré' : talking ? 'La maison parle' : 'En attente de la maison'}
          />
        </Stack>

        {!state.configured ? (
          <Alert severity="info">
            Les deux clés du connecteur n&apos;ont pas encore été générées. Elles apparaissent dans
            <code> server/.env.local </code> au prochain démarrage (<code>GATE_API_KEY</code> et
            <code> GATE_SIGNING_SECRET</code>), et se recopient dans le plugin « Accès invités » de Sowel.
          </Alert>
        ) : (
          <Stack spacing={0.25}>
            <SummaryItem label="Invitations reçues" value={String(state.invitations)} />
            <SummaryItem
              label="Dernier échange"
              value={formatDateTime(state.lastReceivedAt)}
              valuePlaceholder="jamais"
            />
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Les accès, leurs codes et leur journal vivent dans Sowel → Administration → Accès invités.
          guestFlow publie ses séjours et affiche ce que la maison lui rend ; il n&apos;ouvre jamais
          le portail lui-même.
        </Typography>
      </CardContent>
    </Card>
  );
}
