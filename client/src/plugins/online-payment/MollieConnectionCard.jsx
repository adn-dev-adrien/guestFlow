/**
 * MollieConnectionCard — « Compte Mollie » of Réglages → Paiements en ligne, under the bank connection
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rules 14-17). Optional: without a token the
 * reconciliation works by amounts; with one, a grouped transfer is detailed payment by payment.
 *
 * Self-contained like the reconciliation card: it reads and writes the plugin's generic settings
 * (`mollieAccessToken`, `mollieProfileId`), so its own « Enregistrer » is not the page's. The token is a secret:
 * the server never sends it back (`mollieAccessTokenSet`), `MaskedTextField` shows « •••• » until « Modifier ». A
 * refusal (a token that does not start with `access_`, a malformed profile id) is the server's, shown on the
 * field and nothing is saved. « Tester » asks the server to call Mollie with the typed token — or the stored one —
 * and says in words what it found; the typed token is never stored by the test.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { api, MaskedTextField, StatusBadge, useToast } from '../sdk/ui';

const PLUGIN = 'online-payment';
const HELP = 'Dans Mollie : Développeurs → Clés API → « + Créer une clé API ». Type « Jeton d\'accès avancé », aucune restriction de profil, mode « En direct », autorisations en lecture seule : payments.read, settlements.read, balances.read, balance-reports.read, invoices.read, refunds.read, profiles.read, organizations.read ; signature des demandes désactivée.';
const WITHOUT_TOKEN = 'Sans jeton, le rapprochement se fait par les montants. Avec un jeton, les versements groupés sont détaillés paiement par paiement.';

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const stamp = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
};

export default function MollieConnectionCard() {
  const { showError, showSuccess } = useToast();
  const [stored, setStored] = useState(null);
  const [tokenDraft, setTokenDraft] = useState(undefined);
  const [profileId, setProfileId] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getPluginSettings(PLUGIN);
      setStored({
        tokenSet: Boolean(s.mollieAccessTokenSet),
        profileId: s.mollieProfileId || '',
        lastRead: parse(s.mollieLastRead),
        lastError: parse(s.mollieLastError),
      });
      setProfileId(s.mollieProfileId || '');
    } catch { setStored(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!stored) return null;

  const dirty = tokenDraft !== undefined || profileId !== stored.profileId;
  const badge = stored.tokenSet
    ? { status: stored.lastError ? 'warning' : 'success', label: stored.lastError ? 'À vérifier' : 'Connecté' }
    : { status: 'neutral', label: 'Facultatif' };

  const save = async (values) => {
    setBusy(true);
    try {
      await api.savePluginSettings(PLUGIN, values);
      setErrors({});
      setTokenDraft(undefined);
      setTestResult(null);
      await load();
      showSuccess('Compte Mollie enregistré.');
    } catch (err) {
      setErrors(err && err.errors ? err.errors : {});
      showError((err && err.errors) ? 'Valeurs à vérifier : rien n’a été enregistré.' : ((err && err.message) || 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const saveForm = () => save({
    ...(tokenDraft !== undefined && tokenDraft !== '' ? { mollieAccessToken: tokenDraft } : {}),
    mollieProfileId: profileId,
  });

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const typed = tokenDraft !== undefined && tokenDraft !== '' ? tokenDraft : undefined;
      setTestResult(await api.testMollieConnection(typed));
      if (typed === undefined) await load();
    } catch (err) {
      setTestResult({ ok: false, error: (err && err.message) || 'Le test n’a pas abouti.' });
    } finally {
      setTesting(false);
    }
  };

  const lastRead = stored.lastRead;
  return (
    <Card variant="outlined" data-testid="mollie-card">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Typography variant="sectionHeader">Compte Mollie</Typography>
          <StatusBadge status={badge.status} label={badge.label} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{WITHOUT_TOKEN}</Typography>

        <Stack gap={2}>
          <MaskedTextField
            label="Jeton d’accès (lecture seule)"
            hasValue={stored.tokenSet}
            value={tokenDraft}
            onChange={setTokenDraft}
            error={errors.mollieAccessToken}
            helperText={HELP}
          />
          <TextField
            label="Identifiant de profil"
            value={profileId}
            onChange={(e) => { setProfileId(e.target.value); setErrors((er) => ({ ...er, mollieProfileId: undefined })); }}
            error={Boolean(errors.mollieProfileId)}
            helperText={errors.mollieProfileId || 'pfl_… — rempli par « Tester » quand le jeton le permet.'}
            slotProps={{ htmlInput: { autoComplete: 'off', autoCapitalize: 'none' } }}
          />

          {testResult && (
            <Alert severity={testResult.ok ? 'success' : 'warning'} role="status">
              {testResult.ok
                ? `Mollie répond : ${testResult.settlements > 0 ? 'des règlements sont lisibles' : 'aucun règlement à lire pour l’instant'}${testResult.profileId ? ` · profil ${testResult.profileId}` : ''}.`
                : testResult.error}
            </Alert>
          )}
          {lastRead && (
            <Typography variant="body2" color="text.secondary">
              Dernière lecture : {stamp(lastRead.at)} · {lastRead.settlements} règlement{lastRead.settlements > 1 ? 's' : ''}
              {lastRead.unknownPayments > 0 ? ` · ${lastRead.unknownPayments} paiement${lastRead.unknownPayments > 1 ? 's' : ''} inconnu${lastRead.unknownPayments > 1 ? 's' : ''} de GuestFlow` : ''}
            </Typography>
          )}
          {stored.lastError && (
            <Alert severity="error">Dernier échec de lecture ({stamp(stored.lastError.at)}) : {stored.lastError.message}</Alert>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <Button variant="contained" onClick={saveForm} disabled={busy || !dirty} sx={{ minHeight: 44, textTransform: 'none' }}>Enregistrer</Button>
            <Button variant="outlined" onClick={test} disabled={testing || (!stored.tokenSet && !tokenDraft)} sx={{ minHeight: 44, textTransform: 'none' }}>
              {testing ? 'Test en cours…' : 'Tester'}
            </Button>
            {stored.tokenSet && (
              <Button variant="text" color="inherit" onClick={() => save({ mollieAccessToken: null })} disabled={busy} sx={{ minHeight: 44, textTransform: 'none' }}>Retirer le jeton</Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
