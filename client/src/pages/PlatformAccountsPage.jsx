import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow,
  TableCell, TableBody, TableContainer, Stack, Switch, TextField, Link as MuiLink,
  CircularProgress, Button, Tooltip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import SyncIcon from '@mui/icons-material/Sync';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import ConfirmDialog from '../components/ConfirmDialog';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';
import { useToast } from '../components/DialogProvider';
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

export default function PlatformAccountsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = userHasRole(user, ADMIN);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState({});
  // Load failures stay persistent (ErrorAlert); action feedback goes through the shared toasts
  // (specs/ds-components.md §3.2).
  const [loadError, setLoadError] = useState(false);
  const { showSuccess, showError } = useToast();
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
        }));
        setSavedPlatforms(sortedPlatforms);
        setPlatforms(sortedPlatforms);
      } catch (err) {
        if (mounted) setLoadError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Same fields the old manual comparator watched — projected so the guard's deep-equal doesn't
  // trip on unrelated platform metadata (specs/ds-sweep-settings.md §3.7).
  const dirtyProjection = (account, list) => ({
    account,
    rows: (list || []).map((x) => ({ id: x.id, c: x.commissionAccountNumber || '', v: Boolean(x.hasVatOnCommission) })),
  });
  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft: dirtyProjection(defaultAccount, platforms),
    saved: dirtyProjection(savedDefaultAccount, savedPlatforms),
    navigate,
  });

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
    try {
      const payload = {
        defaultAccount,
        platforms: platforms
          .filter((p) => !p.isDirect)
          .map((p) => ({
            id: p.id,
            account: normalizeAccount(p.commissionAccountNumber),
            hasVat: Boolean(p.hasVatOnCommission),
          })),
      };
      const result = await api.savePlatformAccounts(payload);
      setSavedDefaultAccount(result.defaultAccount);
      setDefaultAccount(result.defaultAccount);
      const sortedPlatforms = (result.platforms || []).map((p) => ({
        ...p,
        commissionAccountNumber: p.commissionAccountNumber || '',
      }));
      setSavedPlatforms(sortedPlatforms);
      setPlatforms(sortedPlatforms);
      showSuccess('Configuration enregistrée.');
    } catch (err) {
      const apiErrors = err?.body?.errors;
      if (apiErrors) {
        const next = {};
        if (apiErrors.defaultAccount) next.defaultAccount = apiErrors.defaultAccount;
        if (Array.isArray(apiErrors.platforms)) {
          for (const row of apiErrors.platforms) {
            if (row.account) next[`platform-${row.id}-account`] = row.account;
          }
        }
        setErrors(next);
        showError('Vérifiez les champs en erreur.');
      } else {
        showError(err?.message || 'Échec de l\'enregistrement.');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDefaultAccount(savedDefaultAccount);
    setPlatforms(savedPlatforms);
    setErrors({});
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await api.refreshPlatformAccounts();
      const sortedPlatforms = (result.platforms || []).map((p) => ({
        ...p,
        commissionAccountNumber: p.commissionAccountNumber || '',
      }));
      // Merge into the current draft: rows already in `platforms` keep the operator's unsaved
      // edits; brand-new rows from the rescan join the bottom of the table.
      setPlatforms((prev) => {
        const draftById = new Map(prev.map((p) => [p.id, p]));
        return sortedPlatforms.map((p) => draftById.get(p.id) || p);
      });
      setSavedPlatforms(sortedPlatforms);
      const newCount = Number(result.newCount || 0);
      showSuccess(newCount > 0
        ? `+${newCount} nouvelle${newCount > 1 ? 's' : ''} plateforme${newCount > 1 ? 's' : ''} ramassée${newCount > 1 ? 's' : ''}.`
        : 'Aucune nouvelle plateforme à ramasser — la liste est à jour.');
    } catch (err) {
      showError(err?.message || 'Échec du rafraîchissement.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <PageActionBar
        title="Plan comptable"
        backTo="/comptabilite"
        actionsBefore={[
          { icon: <SyncIcon />, tooltip: 'Rafraîchir la liste', onClick: handleRefresh, color: 'info', disabled: refreshing || saving },
        ]}
        onSave={handleSave}
        saveDisabled={!isDirty || saving}
        saveBusy={saving}
        saveTooltip="Enregistrer"
        onCancel={handleCancel}
        cancelDisabled={!isDirty || saving}
        cancelTooltip="Annuler"
      />

      {loadError && (
        <ErrorAlert
          message="Impossible de charger la configuration."
          onRetry={() => window.location.reload()}
          sx={{ mb: 2 }}
        />
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <Stack spacing={3}>
          <Card variant="outlined">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="sectionHeader">Compte par défaut</Typography>
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
              <Box sx={{ px: { xs: 1, sm: 2 }, pt: { xs: 1, sm: 1.5 }, pb: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'flex-start' }, gap: 1 }}>
                <Box>
                  <Typography variant="sectionHeader">Par plateforme</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    TVA déductible commissions appliquée: <strong>{vatRateCommission} %</strong>
                    {isAdmin
                      ? <>{' '}(<MuiLink component="button" type="button" onClick={() => navigate('/settings')} sx={{ verticalAlign: 'baseline' }}>modifiable dans Réglages → Général</MuiLink>)</>
                      : <em> &nbsp;(modifiable par un administrateur)</em>}
                  </Typography>
                </Box>
              </Box>
              {/* Scroll-contained (specs/ds-components.md §3.1) — this was the app's only raw, unwrapped <Table>. */}
              <TableContainer>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Compte commission</TableCell>
                    <TableCell align="center">TVA déductible</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {platforms.map((p) => {
                    const accountErr = errors[`platform-${p.id}-account`];
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Stack>
      )}
      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}
