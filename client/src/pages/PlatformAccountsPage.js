import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, Stack, Alert, Switch, TextField, Link as MuiLink,
  CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import { useAuth } from '../hooks/useAuth';
import { userHasRole, ADMIN } from '../constants/roles';

/**
 * PlatformAccountsPage — `/comptabilite/plateformes`.
 *
 * Dedicated page where admin AND accountant configure the per-platform commission accounting:
 * fallback compte commission (top card) + per-platform overrides (bottom TableCard).
 *
 * The global VAT rate applied to commissions (when a platform's "TVA déductible" Switch is ON)
 * is read-only here — it lives in Settings → Général → Taux de TVA. Admins see a link to
 * Settings; accountants see plain text (they can't reach Settings server-side either).
 *
 * Driven by:
 *   - GET /api/accounting/platform-accounts → { defaultAccount, vatRateCommission, platforms }
 *   - PUT /api/accounting/platform-accounts → saves defaultAccount + per-platform rows
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §6.
 */

function normalizeAccount(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\s+/g, '');
}

function normalizeRate(value) {
  if (value == null || value === '') return '';
  return String(value).replace(',', '.');
}

export default function PlatformAccountsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = userHasRole(user, ADMIN);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [globalMessage, setGlobalMessage] = useState(null);
  const [savedDefaultAccount, setSavedDefaultAccount] = useState('622600');
  const [vatRateCommission, setVatRateCommission] = useState(20);
  const [savedPlatforms, setSavedPlatforms] = useState([]);
  const [defaultAccount, setDefaultAccount] = useState('622600');
  const [platforms, setPlatforms] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getPlatformAccounts();
        if (!mounted) return;
        setSavedDefaultAccount(data.defaultAccount || '622600');
        setDefaultAccount(data.defaultAccount || '622600');
        setVatRateCommission(Number(data.vatRateCommission ?? 20));
        const sortedPlatforms = (data.platforms || []).map((p) => ({
          ...p,
          commissionAccountNumber: p.commissionAccountNumber || '',
          commissionRatePercent: p.commissionRatePercent == null ? '' : String(p.commissionRatePercent),
        }));
        setSavedPlatforms(sortedPlatforms);
        setPlatforms(sortedPlatforms);
      } catch (err) {
        if (mounted) setGlobalMessage({ severity: 'error', text: err.message || 'Impossible de charger la configuration.' });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const isDirty = useMemo(() => {
    if (defaultAccount !== savedDefaultAccount) return true;
    if (platforms.length !== savedPlatforms.length) return true;
    for (let i = 0; i < platforms.length; i += 1) {
      const a = platforms[i];
      const b = savedPlatforms[i];
      if (a.id !== b.id) return true;
      if ((a.commissionAccountNumber || '') !== (b.commissionAccountNumber || '')) return true;
      if (Boolean(a.hasVatOnCommission) !== Boolean(b.hasVatOnCommission)) return true;
      if (String(a.commissionRatePercent ?? '') !== String(b.commissionRatePercent ?? '')) return true;
    }
    return false;
  }, [defaultAccount, savedDefaultAccount, platforms, savedPlatforms]);

  function handleDefaultAccountChange(value) {
    setDefaultAccount(normalizeAccount(value));
    if (errors.defaultAccount) {
      setErrors((prev) => { const next = { ...prev }; delete next.defaultAccount; return next; });
    }
  }

  function updatePlatformField(id, field, value) {
    setPlatforms((prev) => prev.map((p) => p.id === id ? ({ ...p, [field]: value }) : p));
    if (errors[`platform-${id}-${field}`]) {
      setErrors((prev) => { const next = { ...prev }; delete next[`platform-${id}-${field}`]; return next; });
    }
  }

  async function handleSave() {
    setSaving(true);
    setErrors({});
    setGlobalMessage(null);
    try {
      const payload = {
        defaultAccount,
        platforms: platforms
          .filter((p) => !p.isDirect)
          .map((p) => ({
            id: p.id,
            account: normalizeAccount(p.commissionAccountNumber),
            hasVat: Boolean(p.hasVatOnCommission),
            ratePercent: p.commissionRatePercent === '' ? null : Number(normalizeRate(p.commissionRatePercent)),
          })),
      };
      const result = await api.savePlatformAccounts(payload);
      setSavedDefaultAccount(result.defaultAccount);
      setDefaultAccount(result.defaultAccount);
      const sortedPlatforms = (result.platforms || []).map((p) => ({
        ...p,
        commissionAccountNumber: p.commissionAccountNumber || '',
        commissionRatePercent: p.commissionRatePercent == null ? '' : String(p.commissionRatePercent),
      }));
      setSavedPlatforms(sortedPlatforms);
      setPlatforms(sortedPlatforms);
      setGlobalMessage({ severity: 'success', text: 'Configuration enregistrée.' });
    } catch (err) {
      const apiErrors = err?.body?.errors;
      if (apiErrors) {
        const next = {};
        if (apiErrors.defaultAccount) next.defaultAccount = apiErrors.defaultAccount;
        if (Array.isArray(apiErrors.platforms)) {
          for (const row of apiErrors.platforms) {
            if (row.account) next[`platform-${row.id}-account`] = row.account;
            if (row.ratePercent) next[`platform-${row.id}-rate`] = row.ratePercent;
          }
        }
        setErrors(next);
        setGlobalMessage({ severity: 'error', text: 'Vérifiez les champs en erreur.' });
      } else {
        setGlobalMessage({ severity: 'error', text: err?.message || 'Échec de l\'enregistrement.' });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDefaultAccount(savedDefaultAccount);
    setPlatforms(savedPlatforms);
    setErrors({});
    setGlobalMessage(null);
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <PageActionBar
        title="Plan comptable plateformes"
        backTo="/comptabilite"
        onSave={handleSave}
        saveDisabled={!isDirty || saving}
        saveBusy={saving}
        saveTooltip="Enregistrer"
        onCancel={handleCancel}
        cancelDisabled={!isDirty || saving}
        cancelTooltip="Annuler"
      />

      {globalMessage && (
        <Alert severity={globalMessage.severity} sx={{ mb: 2 }} onClose={() => setGlobalMessage(null)}>
          {globalMessage.text}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={3}>
          <Card variant="outlined">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>Compte par défaut</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Utilisé pour les plateformes qui n'ont pas leur propre compte commission renseigné.
                  </Typography>
                </Box>
                <TextField
                  label="Compte commission par défaut"
                  value={defaultAccount}
                  onChange={(e) => handleDefaultAccountChange(e.target.value)}
                  error={Boolean(errors.defaultAccount)}
                  helperText={errors.defaultAccount || '6 à 8 chiffres (ex. 622600).'}
                  sx={{ maxWidth: { sm: 320 } }}
                  slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                  disabled={saving}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1, sm: 2 } }}>
              <Box sx={{ px: { xs: 1, sm: 2 }, pt: { xs: 1, sm: 1.5 }, pb: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Par plateforme</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  TVA déductible commissions appliquée: <strong>{vatRateCommission} %</strong>
                  {isAdmin
                    ? <>{' '}(<MuiLink component="button" type="button" onClick={() => navigate('/settings')} sx={{ verticalAlign: 'baseline' }}>modifiable dans Réglages → Général</MuiLink>)</>
                    : <em> &nbsp;(modifiable par un administrateur)</em>}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Le « taux commission » est indicatif (affiché sur la fiche de réservation pour cross-check)
                  — le montant réel est saisi par l'opérateur via « Prix payé par le client ».
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Compte commission</TableCell>
                    <TableCell align="center">TVA déductible</TableCell>
                    <TableCell align="right">Taux commission (%)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {platforms.map((p) => {
                    const accountErr = errors[`platform-${p.id}-account`];
                    const rateErr = errors[`platform-${p.id}-rate`];
                    return (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontWeight: p.isDirect ? 600 : 500 }}>
                          {p.name}
                          {p.isDirect && (
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontStyle: 'italic' }}>
                              Pas de commission sur les réservations directes
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={p.commissionAccountNumber}
                            onChange={(e) => updatePlatformField(p.id, 'commissionAccountNumber', normalizeAccount(e.target.value))}
                            placeholder={p.isDirect ? '—' : `${defaultAccount || '622600'} (défaut)`}
                            disabled={p.isDirect || saving}
                            error={Boolean(accountErr)}
                            helperText={accountErr}
                            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                            sx={{ width: { xs: '100%', sm: 180 } }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={Boolean(p.hasVatOnCommission)}
                            onChange={(e) => updatePlatformField(p.id, 'hasVatOnCommission', e.target.checked)}
                            disabled={p.isDirect || saving}
                            slotProps={{ input: { 'aria-label': `TVA déductible commission ${p.name}` } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={p.commissionRatePercent}
                            onChange={(e) => updatePlatformField(p.id, 'commissionRatePercent', e.target.value)}
                            disabled={p.isDirect || saving}
                            error={Boolean(rateErr)}
                            helperText={rateErr}
                            slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1, style: { textAlign: 'right' } } }}
                            sx={{ width: { xs: '100%', sm: 120 } }}
                            placeholder={p.isDirect ? '—' : ''}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Stack>
      )}
    </Box>
  );
}
