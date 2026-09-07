/**
 * QontoApplicationCard — the Qonto application settings and the connection test.
 * See specs/qonto-settings-in-app.md §6.
 *
 * Feature-local by design: every field here names a Qonto concept. What is generic — the masked
 * secret field, the status card, the summary line — is consumed from `components/`.
 *
 * Props:
 *   credentials  {object}   the server payload: environment, clientId, hosts, redirectUri, secrets{}
 *   health       {object}   the verified state: { state, title, explanation, action, code, detail }
 *   testResult   {object?}  the last connection-test result, same shape as `health`
 *   saving       {boolean}
 *   testing      {boolean}
 *   onSave       {(payload) => void}   payload carries only the fields the operator touched
 *   onTest       {() => void}
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Alert, AlertTitle,
  Select, MenuItem, FormControl, InputLabel, IconButton, Tooltip, Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import MaskedTextField from './MaskedTextField';
import HelpedTextField from './HelpedTextField';
import SummaryItem from './SummaryItem';

const PORTAL_HELP = { href: 'https://developers.qonto.com', label: 'Portail développeur Qonto' };

/** An untouched secret stays `undefined`, which the server reads as "keep the stored one". */
const EMPTY_DRAFT = {
  environment: undefined,
  clientId: undefined,
  clientSecret: undefined,
  stagingToken: undefined,
  webhookSecret: undefined,
  publicSiteOrigin: undefined,
};

const severityFor = (state) => {
  if (state === 'ok') return 'success';
  if (state === 'not_configured' || state === 'unverified') return 'info';
  return 'warning';
};

export default function QontoApplicationCard({
  credentials, health, testResult, saving = false, testing = false, onSave, onTest,
}) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  // A save returns a fresh payload; drop the drafts so the fields show the stored state again.
  useEffect(() => { setDraft(EMPTY_DRAFT); }, [credentials]);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const valueOf = (key, stored) => (draft[key] === undefined ? (stored || '') : draft[key]);
  const touched = Object.values(draft).some((v) => v !== undefined);

  const environment = valueOf('environment', credentials.environment);
  const secrets = credentials.secrets || {};

  const handleSave = () => {
    const payload = {};
    Object.entries(draft).forEach(([key, value]) => { if (value !== undefined) payload[key] = value; });
    onSave(payload);
  };

  const copyRedirectUri = () => {
    if (navigator.clipboard && credentials.redirectUri) navigator.clipboard.writeText(credentials.redirectUri);
  };

  // The test result is the fresher truth; the stored health is what the page opens on.
  const shown = testResult || health;

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="sectionHeader" sx={{ display: 'block', mb: 1 }}>Application Qonto</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Les identifiants de ton application Qonto. Ils se recopient depuis developers.qonto.com →
          Business API access, et prennent effet immédiatement — aucun redémarrage.
        </Typography>

        {shown && (
          <Alert severity={severityFor(shown.state)} sx={{ mb: 2 }}>
            <AlertTitle>{shown.title}</AlertTitle>
            {shown.explanation}
            {shown.action ? <Box sx={{ mt: 0.5, fontWeight: 600 }}>{shown.action}</Box> : null}
            {shown.code ? (
              <Box sx={{ mt: 0.5, fontSize: '0.8rem', opacity: 0.85 }}>
                {shown.code}{shown.detail ? ` — ${shown.detail}` : ''}
              </Box>
            ) : null}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <FormControl fullWidth size="small">
            <InputLabel id="qonto-env-label">Environnement</InputLabel>
            <Select
              labelId="qonto-env-label"
              label="Environnement"
              value={environment}
              onChange={(e) => set('environment', e.target.value)}
            >
              <MenuItem value="sandbox">Bac à sable (test)</MenuItem>
              <MenuItem value="production">Production</MenuItem>
            </Select>
          </FormControl>

          <HelpedTextField
            label="Client ID"
            size="small"
            value={valueOf('clientId', credentials.clientId)}
            onChange={(v) => set('clientId', v)}
            helperText="Doit être identique à celui affiché par le portail Qonto."
            helpLink={PORTAL_HELP}
          />

          <MaskedTextField
            label="Client secret"
            hasValue={Boolean(secrets.clientSecret?.configured)}
            value={draft.clientSecret}
            onChange={(v) => set('clientSecret', v)}
            helperText="Qonto le régénère quand l’application change : c’est la panne la plus fréquente."
          />

          {environment === 'sandbox' && (
            <MaskedTextField
              label="Jeton bac à sable"
              hasValue={Boolean(secrets.stagingToken?.configured)}
              value={draft.stagingToken}
              onChange={(v) => set('stagingToken', v)}
              helperText="En-tête X-Qonto-Staging-Token, section « Sandbox access » du portail."
            />
          )}

          <MaskedTextField
            label="Secret du webhook"
            hasValue={Boolean(secrets.webhookSecret?.configured)}
            value={draft.webhookSecret}
            onChange={(v) => set('webhookSecret', v)}
            helperText="Sans lui, Qonto ne peut pas confirmer les paiements en temps réel."
          />

          <HelpedTextField
            label="Origine publique du site"
            size="small"
            value={valueOf('publicSiteOrigin', credentials.publicSiteOrigin)}
            onChange={(v) => set('publicSiteOrigin', v)}
            helperText="L’adresse à laquelle le client revient après avoir payé, ex. https://www.domainesolio.com"
          />
        </Box>

        <Box sx={{ mt: 2, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <SummaryItem label="URL de redirection à déclarer chez Qonto" value={credentials.redirectUri} />
            </Box>
            <Tooltip title="Copier l’URL de redirection">
              <span>
                <IconButton
                  size="small"
                  aria-label="Copier l’URL de redirection"
                  onClick={copyRedirectUri}
                  disabled={!credentials.redirectUri}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <SummaryItem label="Serveurs appelés" value={`${credentials.oauthBase} · ${credentials.apiBase}`} />
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSave} disabled={!touched || saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button variant="outlined" onClick={onTest} disabled={testing}>
            {testing ? 'Test en cours…' : 'Tester la connexion'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
