/**
 * SettingsGateAccessSection — « Accès portail (Sowel) », a self-contained card of Réglages →
 * Intégrations (specs/gate-access-sowel-connector.md §3.6 rule 29).
 *
 * It configures nothing: the keys live in Sowel, whose `guestflow` plugin reads guestFlow's list
 * every hour. What this card answers is whether that is happening — when Sowel last read the list
 * (and whether that is more than 3 h ago), how many keys it reports as created — and it hands the
 * admin the three values the plugin's settings need, labelled like the plugin's own fields
 * (rules 29b-29c): the address, masked-by-default secrets, each with « Afficher » and « Copier ».
 * The page is admin-only, and so is the endpoint that serves them (no-store).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Stack, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import SecretRevealField from './SecretRevealField';
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
  const [secrets, setSecrets] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await api.getGateConnector());
    } catch {
      setState(null);
    }
    try {
      setSecrets(await api.getGateConnectorSecrets());
    } catch {
      setSecrets(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!state) return null;

  const read = Boolean(state.lastReadAt);
  const badge = !state.configured
    ? { status: 'neutral', label: 'Non configuré' }
    : !read
      ? { status: 'warning', label: 'Jamais lu par Sowel' }
      : state.stale
        ? { status: 'error', label: 'Sowel ne lit plus' }
        : { status: 'success', label: 'Sowel lit les clés' };
  const address = secrets && secrets.address ? secrets.address : { value: '', source: 'none' };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="sectionHeader">Accès portail (Sowel)</Typography>
          <StatusBadge status={badge.status} label={badge.label} />
        </Stack>

        <Stack spacing={0.25}>
          <SummaryItem label="Dernière lecture" value={formatDateTime(state.lastReadAt)} valuePlaceholder="jamais" />
          <SummaryItem label="Clés créées" value={String(state.keysCreated ?? 0)} />
        </Stack>

        {secrets ? (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <SecretRevealField
              label="guestFlow address"
              value={address.value}
              masked={false}
              helperText={address.source === 'request'
                ? "Adresse déduite de ce navigateur : l'URL publique n'est pas renseignée (Réglages → Système)."
                : null}
            />
            <SecretRevealField label="API key (GATE_API_KEY)" value={secrets.apiKey} />
            <SecretRevealField label="Signing secret (GATE_SIGNING_SECRET)" value={secrets.signingSecret} />
          </Stack>
        ) : null}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Ces trois valeurs se recopient dans le plugin « guestflow » de Sowel, qui lit la liste des clés
          chaque heure. Les secrets sont conservés dans <code>{state.secretsFile}</code>. Les clés, leurs codes et leurs horaires vivent dans Sowel ; guestFlow n&apos;ouvre
          jamais le portail lui-même.
        </Typography>
      </CardContent>
    </Card>
  );
}
