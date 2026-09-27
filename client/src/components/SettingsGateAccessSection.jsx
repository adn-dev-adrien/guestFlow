/**
 * SettingsGateAccessSection — « Accès portail (Sowel) », a self-contained card of Réglages →
 * Intégrations (specs/gate-access-sowel-connector.md §3.6 rule 29).
 *
 * It configures nothing: the keys live in Sowel, whose `guestflow` plugin reads guestFlow's list
 * every hour. What this card answers is whether that is happening — when Sowel last read the list,
 * how many keys it reports as created — and where the two secrets to paste into the plugin live.
 * Their values are never displayed: a key an API can hand back is a key a stolen session can read.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Stack, Typography } from '@mui/material';
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

  const read = Boolean(state.lastReadAt);
  const names = Array.isArray(state.secretNames) ? state.secretNames : [];

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="sectionHeader">Accès portail (Sowel)</Typography>
          <StatusBadge
            status={!state.configured ? 'neutral' : read ? 'success' : 'warning'}
            label={!state.configured ? 'Non configuré' : read ? 'Sowel lit les clés' : 'Jamais lu par Sowel'}
          />
        </Stack>

        <Stack spacing={0.25}>
          <SummaryItem label="Dernière lecture" value={formatDateTime(state.lastReadAt)} valuePlaceholder="jamais" />
          <SummaryItem label="Clés créées" value={String(state.keysCreated ?? 0)} />
          <SummaryItem
            label="Secrets"
            value={(
              <Typography component="span" variant="body2" sx={{ wordBreak: 'break-word' }}>
                <code>{names.join(' et ')}</code> dans <code>{state.secretsFile}</code>
              </Typography>
            )}
          />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Ces deux secrets se recopient dans le plugin « guestflow » de Sowel, qui lit la liste des clés
          chaque heure. Les clés, leurs codes et leurs horaires vivent dans Sowel ; guestFlow n&apos;ouvre
          jamais le portail lui-même.
        </Typography>
      </CardContent>
    </Card>
  );
}
