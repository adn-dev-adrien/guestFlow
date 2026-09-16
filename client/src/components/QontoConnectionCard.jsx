/**
 * QontoConnectionCard — the single « Connexion bancaire » card of Réglages → Paiements.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rules 6, 12, 13, and
 * specs/qonto-settings-in-app.md §6 for the diagnosis it renders.
 *
 * Replaces the pair « Application Qonto » + « Connexion bancaire (Qonto) », which split one
 * connection across two cards, four buttons and two notions of « is it working ».
 *
 * Feature-local by design: every field names a Qonto concept. What is generic — the masked secret
 * field, the badge, the summary line — is consumed from `components/`.
 *
 * It owns no state: the page holds the draft so the action bar's Save can write it (rule 1).
 *
 * Props:
 *   credentials  {object}   server payload: environment, clientId, redirectUri, secrets{}
 *   draft        {object}   the operator's unsaved edits; a key left `undefined` means "unchanged"
 *   onChange     {(key, value) => void}
 *   badge        {{status, label}}  the verified state (specs/qonto-settings-in-app.md rule 11)
 *   health       {object}   the verified state: { state, title, explanation, action, code, detail }
 *   testResult   {object?}  the last connection-test result, same shape as `health`
 *   lastCheckLabel {string} formatted date of the last verification, '' when never tested
 *   dirty        {boolean}  the page holds unsaved changes → the two actions are unavailable (rule 13)
 *   canConnect   {boolean}  credentials present enough to start an authorisation
 *   testing      {boolean}
 *   onConnect    {() => void}
 *   onTest       {() => void}
 */

import React from 'react';
import {
  Box, Card, CardContent, Typography, Button, Alert, AlertTitle,
  Select, MenuItem, FormControl, InputLabel, IconButton, Tooltip, Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import MaskedTextField from './MaskedTextField';
import HelpedTextField from './HelpedTextField';
import SummaryItem from './SummaryItem';
import StatusBadge from './StatusBadge';

const PORTAL_HELP = { href: 'https://developers.qonto.com', label: 'Portail développeur Qonto' };

const DIRTY_HINT = 'Enregistre d’abord tes modifications.';

const severityFor = (state) => {
  if (state === 'ok') return 'success';
  if (state === 'not_configured' || state === 'unverified') return 'info';
  return 'warning';
};

/**
 * MUI does not fire a tooltip on a disabled button, so the wrapper span carries the hover — that is
 * the whole point of rule 13: the operator must learn *why* the button is grey.
 */
function GuardedAction({ disabled, hint, children }) {
  const button = <span>{children}</span>;
  return disabled && hint ? <Tooltip title={hint}>{button}</Tooltip> : button;
}

export default function QontoConnectionCard({
  credentials, draft, onChange, badge, health, testResult, lastCheckLabel,
  dirty = false, canConnect = false, testing = false, onConnect, onTest,
}) {
  const valueOf = (key, stored) => (draft[key] === undefined ? (stored || '') : draft[key]);
  const environment = valueOf('environment', credentials.environment);
  const secrets = credentials.secrets || {};

  const copyRedirectUri = () => {
    if (navigator.clipboard && credentials.redirectUri) navigator.clipboard.writeText(credentials.redirectUri);
  };

  // The test result is the fresher truth; the stored health is what the page opens on.
  const shown = testResult || health;

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Typography variant="sectionHeader">Connexion bancaire</Typography>
          {badge && <StatusBadge status={badge.status} label={badge.label} />}
        </Box>
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

        {/* Rule 12 — the redirect URI opens the card: it is the first thing to declare at Qonto, and
            the one value the operator needs before anything else can work. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
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

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <FormControl fullWidth size="small">
            <InputLabel id="qonto-env-label">Environnement</InputLabel>
            <Select
              labelId="qonto-env-label"
              label="Environnement"
              value={environment}
              onChange={(e) => onChange('environment', e.target.value)}
            >
              <MenuItem value="sandbox">Bac à sable (test)</MenuItem>
              <MenuItem value="production">Production</MenuItem>
            </Select>
          </FormControl>

          <HelpedTextField
            label="Client ID"
            size="small"
            value={valueOf('clientId', credentials.clientId)}
            onChange={(v) => onChange('clientId', v)}
            helperText="Doit être identique à celui affiché par le portail Qonto."
            helpLink={PORTAL_HELP}
          />

          <MaskedTextField
            label="Client secret"
            hasValue={Boolean(secrets.clientSecret?.configured)}
            value={draft.clientSecret}
            onChange={(v) => onChange('clientSecret', v)}
            helperText="Qonto le régénère quand l’application change : c’est la panne la plus fréquente."
          />

          {environment === 'sandbox' && (
            <MaskedTextField
              label="Jeton bac à sable"
              hasValue={Boolean(secrets.stagingToken?.configured)}
              value={draft.stagingToken}
              onChange={(v) => onChange('stagingToken', v)}
              helperText="En-tête X-Qonto-Staging-Token, section « Sandbox access » du portail."
            />
          )}

          {/* Rule 6 — no webhook-secret field: the server generates it and Qonto is subscribed
              automatically. A secret typed into a form is a secret on a screen. */}

          <HelpedTextField
            label="Origine publique du site"
            size="small"
            value={valueOf('publicSiteOrigin', credentials.publicSiteOrigin)}
            onChange={(v) => onChange('publicSiteOrigin', v)}
            helperText="L’adresse à laquelle le client revient après avoir payé, ex. https://www.domainesolio.com"
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <SummaryItem label="Dernière vérification" value={lastCheckLabel} valuePlaceholder="jamais testée" />
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <GuardedAction disabled={dirty} hint={DIRTY_HINT}>
            <Button variant="outlined" onClick={onConnect} disabled={dirty || !canConnect} fullWidth>
              Connexion
            </Button>
          </GuardedAction>
          <GuardedAction disabled={dirty} hint={DIRTY_HINT}>
            <Button variant="outlined" onClick={onTest} disabled={dirty || testing} fullWidth>
              {testing ? 'Test en cours…' : 'Test'}
            </Button>
          </GuardedAction>
        </Stack>
      </CardContent>
    </Card>
  );
}
