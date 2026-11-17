/**
 * MollieConnectionCard — « Compte Mollie » of Réglages → Paiements en ligne, under the bank connection
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rules 14-17). Optional: without a token the
 * reconciliation works by amounts; with one, a grouped transfer is detailed payment by payment.
 *
 * Self-contained like the reconciliation card: it reads and writes the plugin's generic settings
 * (`mollieAccessToken`, `mollieProfileId`; `mollieBalance` read-only: what Mollie still holds), so its own « Enregistrer » is not the page's. The token is a secret:
 * the server never sends it back (`mollieAccessTokenSet`), `MaskedTextField` shows « •••• » until « Modifier ». A
 * refusal (a token that does not start with `access_`, a malformed profile id) is the server's, shown on the
 * field and nothing is saved. « Tester » asks the server to call Mollie with the typed token — or the stored one —
 * and says in words what it found; the typed token is never stored by the test.
 *
 * « Relevés dans Qonto » (specs/mollie-settlement-receipts.md rules 2-3, 13): a switch and a start date (one setting,
 * `mollieStatementsSince`), saved when the switch moves or the date field loses focus / takes Enter, never while a date is
 * being typed, and the counters the server computes. Drawn only when the server says the
 * feature exists — Qonto connected and a Mollie token saved.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api, DateField, formatCurrency, MaskedTextField, StatusBadge, useServerToday, useToast } from '../sdk/ui';

const PLUGIN = 'online-payment';
const HELP = 'Dans Mollie : Développeurs → Clés API → « + Créer une clé API ». Type « Jeton d\'accès avancé », aucune restriction de profil, mode « En direct », autorisations en lecture seule : payments.read, settlements.read, balances.read, balance-reports.read, invoices.read, refunds.read, profiles.read, organizations.read ; signature des demandes désactivée.';
const WITHOUT_TOKEN = 'Sans jeton, le rapprochement se fait par les montants. Avec un jeton, les versements groupés sont détaillés paiement par paiement.';

const COUNTER_LABELS = [['attached', 'success', 'joint'], ['pending', 'neutral', 'en attente'], ['toReview', 'warning', 'à revoir']];
const NO_DATE = 'Une date est nécessaire tant que l’envoi est activé.';
const FUTURE_DATE = 'La date ne peut pas être dans le futur.';

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const stamp = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
};

/**
 * The « Relevés dans Qonto » section: switch on → the first day of the current month is proposed (the operator may move it
 * back to cover past credits); a refused date keeps the stored one and says why on the field. Saves go one after the other.
 * `onSaved(value)` refreshes the section only, so a profile id being typed in the card is left alone.
 */
function StatementsSection({ status, since, onSaved }) {
  const { showError, showSuccess } = useToast();
  const today = useServerToday();
  const [draft, setDraft] = useState(since);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const queue = useRef(Promise.resolve());
  const inFlight = useRef(null);
  useEffect(() => { setDraft(since); }, [since]);

  const save = async (value, done) => {
    setBusy(true);
    try {
      await api.savePluginSettings(PLUGIN, { mollieStatementsSince: value });
      setError('');
      await onSaved(value);
      showSuccess(done);
    } catch (err) {
      setError((err && err.errors && err.errors.mollieStatementsSince) || '');
      showError((err && err.errors) ? 'Date à vérifier : rien n’a été enregistré.' : ((err && err.message) || 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  };
  const write = (value, done) => {
    queue.current = queue.current.then(() => save(value, done));
    return queue.current;
  };

  const on = since !== '';
  const toggle = (checked) => {
    if (!checked) { write('', 'Relevés désactivés : plus aucun envoi.'); return; }
    const first = `${(today || '').slice(0, 8)}01`;
    write(first, 'Relevés activés.');
  };
  const change = (value) => {
    setDraft(value);
    if (!value) setError(NO_DATE);
    else if (today && value > today) setError(FUTURE_DATE);
    else setError('');
  };
  // The value comes from the event, not from `draft`: a calendar pick blurs the field in the same tick as its change.
  const commit = (value) => {
    if (!value || value === since || value === inFlight.current || (today && value > today)) return;
    inFlight.current = value;
    write(value, 'Date enregistrée.').finally(() => { inFlight.current = null; });
  };

  const { counts } = status;
  const shown = COUNTER_LABELS.filter(([key]) => counts[key] > 0);
  return (
    <Box data-testid="mollie-statements">
      <Divider sx={{ mb: 2 }} />
      <Typography variant="sectionHeader" component="h3" sx={{ mb: 1 }}>Relevés dans Qonto</Typography>
      <FormControlLabel
        control={<Switch checked={on} disabled={busy || !today} onChange={(e) => toggle(e.target.checked)} />}
        label="Joindre le relevé de chaque versement Mollie dans Qonto"
        sx={{ alignItems: 'flex-start', mb: 1 }}
      />
      {on && (
        <Stack gap={1.5}>
          <DateField
            label="À partir du"
            value={draft}
            onChange={(e) => change(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(e.target.value); }}
            error={Boolean(error)}
            helperText={error || 'Les versements crédités avant cette date ne reçoivent rien.'}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today || undefined } }}
            sx={{ maxWidth: { sm: 240 } }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }} data-testid="mollie-statements-counters">
            {shown.length === 0
              ? <StatusBadge status="neutral" label="Aucun versement depuis cette date" />
              : shown.map(([key, tone, label]) => <StatusBadge key={key} status={tone} label={`${counts[key]} ${label}`} />)}
          </Box>
          {status.reauth && <Alert severity="warning">Qonto refuse les pièces jointes : reconnecter Qonto pour joindre les relevés.</Alert>}
        </Stack>
      )}
    </Box>
  );
}

export default function MollieConnectionCard() {
  const { showError, showSuccess } = useToast();
  const [stored, setStored] = useState(null);
  const [statements, setStatements] = useState(null);
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
        balance: parse(s.mollieBalance),
        statementsSince: s.mollieStatementsSince || '',
      });
      setProfileId(s.mollieProfileId || '');
    } catch { setStored(null); return; }
    try {
      setStatements(await api.getMollieStatementsStatus());
    } catch { setStatements(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const refreshStatements = useCallback(async (since) => {
    setStored((prev) => (prev ? { ...prev, statementsSince: since } : prev));
    try {
      setStatements(await api.getMollieStatementsStatus());
    } catch { setStatements(null); }
  }, []);

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
          {stored.balance && (
            <Typography variant="body2" color="text.secondary" data-testid="mollie-pending">
              Encore chez Mollie : {formatCurrency(stored.balance.pendingCents / 100)} (réserves non libérées) · lu le {stamp(stored.balance.at)}
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

        {statements && statements.available && <Box sx={{ mt: 3 }}><StatementsSection status={statements} since={stored.statementsSince} onSaved={refreshStatements} /></Box>}
      </CardContent>
    </Card>
  );
}
