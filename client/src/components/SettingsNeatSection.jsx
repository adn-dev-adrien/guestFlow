/**
 * SettingsNeatSection — « Assurance annulation (Neat) » card
 * (specs/neat-cancellation-insurance-subscription.md §6.1).
 *
 * Fetches its own state from GET /api/neat/settings; everything shown here is derived server-side
 * (status, counters, contract fields, source catalogue) — the card renders and posts.
 *
 * It no longer carries its own Save buttons. Since
 * specs/settings-one-save-and-automatic-webhook.md rule 1, the page's action bar is the only place
 * that writes, so the card publishes two things upward: `onDirtyChange` so the bar knows it has
 * something to save, and `save()` through a ref so the bar can write. Its three blocks keep their
 * three endpoints — folding them into the general settings payload would put a second feature's
 * shape inside it — and `save()` posts only the blocks that changed (rule 2).
 *
 * Blocks, top to bottom:
 *   1. credentials  — environment select, clientId, secret (MaskedTextField), margin %, + test
 *   2. selection    — sales channel / contract / payment method, fed by GET /api/neat/discovery
 *   3. mapping      — one row per contract serviceField, bound to a GuestFlow source
 *   4. summary      — SummaryItem lines + pending/failed counters
 *
 * Props:
 *   onDirtyChange {(dirty: boolean) => void}  fired whenever the card gains or loses unsaved changes
 * Ref:
 *   { save: () => Promise<void>, isDirty: () => boolean }
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import {
  Card, CardContent, Stack, Typography, Box, Button, Alert, CircularProgress, TextField,
  Select, MenuItem, FormControl, InputLabel, InputAdornment,
} from '@mui/material';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import api from '../api';
import MaskedTextField from './MaskedTextField';
import StatusBadge from './StatusBadge';
import SummaryItem from './SummaryItem';
import ErrorAlert from './ErrorAlert';

// Server error codes → French copy for the mapping rows (the 422 payload carries codes, not text).
const MAPPING_ERROR_LABELS = {
  REQUIRED_UNMAPPED: 'Champ requis non mappé.',
  UNKNOWN_SOURCE: 'Source inconnue.',
  TYPE_MISMATCH: 'Source incompatible avec le type du champ.',
  CONSTANT_REQUIRED: 'Valeur fixe manquante.',
  CONSTANT_NOT_IN_OPTIONS: 'Valeur hors de la liste du contrat.',
  CONSTANT_NOT_NUMERIC: 'Valeur fixe non numérique.',
};

function statusBadgeFor(settings) {
  if (!settings) return null;
  const { status } = settings;
  if (!status.credentialsSet) return { status: 'neutral', label: 'Non configurée' };
  if (!status.subscriptionActive) return { status: 'warning', label: 'Configuration incomplète' };
  if (status.environment === 'staging') return { status: 'warning', label: 'Connectée — staging' };
  return { status: 'success', label: 'Connectée' };
}

/** The margin is stored as a number or null, and edited as a string: compare them on one form. */
const marginText = (value) => (value === null || value === undefined ? '' : String(value));

function SettingsNeatSection({ onDirtyChange }, ref) {

  const [settings, setSettings] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);
  // Credentials draft — secret follows the MaskedTextField 3-way (undefined = preserve).
  const [environment, setEnvironment] = useState('staging');
  const [clientId, setClientId] = useState('');
  const [secretDraft, setSecretDraft] = useState(undefined);
  const [marginDraft, setMarginDraft] = useState('');
  // Selection draft (ids into the discovery payload).
  const [discovery, setDiscovery] = useState(null); // null = not loaded
  const [channelId, setChannelId] = useState('');
  const [contractId, setContractId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  // Mapping draft: { [fieldId]: { source, constant } }.
  const [mappingDraft, setMappingDraft] = useState({});
  const [mappingErrors, setMappingErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [actionResult, setActionResult] = useState(null); // { severity, message }

  const applySettings = useCallback((data) => {
    setSettings(data);
    setEnvironment(data.environment);
    setClientId(data.clientId || '');
    setSecretDraft(undefined);
    setMarginDraft(marginText(data.marginPercent));
    setChannelId(data.salesChannelId || '');
    setContractId(data.contractId || '');
    setPaymentMethodId(data.paymentMethodId || '');
    setMappingDraft(data.mapping || {});
    setMappingErrors({});
  }, []);

  const load = useCallback(async () => {
    const data = await api.getNeatSettings();
    applySettings(data);
    setLoadError(false);
  }, [applySettings]);

  useEffect(() => {
    load().catch(() => setLoadError(true));
  }, [load]);

  // ----- What has changed, and how the page saves it (rules 1-3) -----

  const credentialsDirty = Boolean(settings) && (
    environment !== settings.environment
    || clientId !== (settings.clientId || '')
    || secretDraft !== undefined
    || marginDraft !== marginText(settings.marginPercent)
  );
  const selectionDirty = Boolean(settings) && (
    channelId !== (settings.salesChannelId || '')
    || contractId !== (settings.contractId || '')
    || paymentMethodId !== (settings.paymentMethodId || '')
  );
  const mappingDirty = Boolean(settings)
    && JSON.stringify(mappingDraft || {}) !== JSON.stringify(settings.mapping || {});
  const dirty = credentialsDirty || selectionDirty || mappingDirty;

  useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const handleTest = async () => {
    setTesting(true);
    setActionResult(null);
    try {
      const r = await api.testNeatConnection();
      setActionResult({ severity: 'success', message: `Connexion Neat réussie (${r.environment}).` });
    } catch (e) {
      setActionResult({ severity: 'error', message: e.message || 'Connexion Neat impossible.' });
    } finally {
      setTesting(false);
    }
  };

  const loadDiscovery = async (forChannelId) => {
    setDiscovering(true);
    setActionResult(null);
    try {
      const d = await api.getNeatDiscovery(forChannelId || undefined);
      setDiscovery(d);
      return d;
    } catch (e) {
      setActionResult({ severity: 'error', message: e.message || 'Découverte Neat impossible.' });
      return null;
    } finally {
      setDiscovering(false);
    }
  };

  const handlePickChannel = async (id) => {
    setChannelId(id);
    setContractId('');
    setPaymentMethodId('');
    if (id) await loadDiscovery(id);
  };


  const updateMappingRow = (fieldId, patch) => {
    setMappingDraft((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] || {}), ...patch } }));
    setMappingErrors((prev) => ({ ...prev, [fieldId]: undefined }));
  };

  /**
   * Write the blocks that changed, in the order the server expects them (rule 2). The drafts are
   * read once, up front: the selection response refreshes the card's state mid-save, and the mapping
   * the operator typed must survive that refresh.
   *
   * Throws on the first refusal so the page reports it (rule 3). Whatever was written before stays
   * written, and the refused values stay in the form — a mapping refusal lands on the fields it
   * concerns.
   */
  const save = async () => {
    const drafts = { environment, clientId, secretDraft, marginDraft, channelId, contractId, paymentMethodId, mapping: mappingDraft };
    setActionResult(null);
    setSaving(true);
    try {
      if (credentialsDirty) {
        const payload = {
          environment: drafts.environment,
          clientId: drafts.clientId,
          marginPercent: drafts.marginDraft === '' ? null : drafts.marginDraft,
        };
        if (drafts.secretDraft !== undefined) payload.clientSecret = drafts.secretDraft;
        try {
          applySettings(await api.updateNeatSettings(payload));
        } catch (e) {
          throw new Error(e.errors ? Object.values(e.errors).join(' ') : (e.message || 'Réglages Neat : enregistrement impossible.'));
        }
      }

      if (selectionDirty) {
        try {
          applySettings(await api.updateNeatSelection({
            salesChannelId: drafts.channelId, contractId: drafts.contractId, paymentMethodId: drafts.paymentMethodId,
          }));
        } catch (e) {
          throw new Error(e.message || 'Neat : sélection impossible.');
        }
      }

      if (mappingDirty) {
        try {
          applySettings(await api.updateNeatMapping(drafts.mapping));
        } catch (e) {
          if (e.code === 'MAPPING_INVALID' && Array.isArray(e.errors)) {
            setMappingErrors(Object.fromEntries(e.errors.map((err) => [err.fieldId, MAPPING_ERROR_LABELS[err.error] || err.error])));
            setActionResult({ severity: 'error', message: 'Mappage incomplet — corrige les champs signalés.' });
            throw new Error('Mappage Neat incomplet — corrige les champs signalés.');
          }
          throw new Error(e.message || 'Neat : enregistrement du mappage impossible.');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save,
    isDirty: () => dirty,
    // « Annuler » in the bar reverts this card too: one Save, one Cancel, one page.
    reset: () => { if (settings) applySettings(settings); },
  }));

  const badge = statusBadgeFor(settings);
  const credentialsSet = Boolean(settings && settings.status.credentialsSet);
  const paymentMethods = (discovery && discovery.channelDetail && discovery.channelDetail.paymentMethods) || [];
  const contracts = (discovery && discovery.channelDetail && discovery.channelDetail.contracts) || [];
  const contractFields = (settings && settings.contractFields) || [];
  const sources = (settings && settings.sources) || [];

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 1,
            }}
          >
            <Box>
              <Typography variant="sectionHeader">Assurance annulation (Neat)</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Souscrit automatiquement la police Neat quand l'acompte d'une réservation assurée
                est encaissé.
              </Typography>
            </Box>
            {badge && <StatusBadge status={badge.status} label={badge.label} />}
          </Box>

          {loadError && (
            <ErrorAlert
              message="Impossible de charger les réglages Neat."
              onRetry={() => { setLoadError(false); load().catch(() => setLoadError(true)); }}
            />
          )}

          {!loadError && !settings && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {settings && (
            <>
              {/* 1 — credentials + margin */}
              <FormControl fullWidth size="small">
                <InputLabel id="neat-env-label">Environnement</InputLabel>
                <Select
                  labelId="neat-env-label"
                  label="Environnement"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  <MenuItem value="staging">Test (staging)</MenuItem>
                  <MenuItem value="production">Production</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                size="small"
                label="Identifiant client (clientId)"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <MaskedTextField
                label="Secret client"
                hasValue={Boolean(settings.clientSecretSet)}
                value={secretDraft}
                onChange={setSecretDraft}
              />
              <TextField
                fullWidth
                size="small"
                label="Marge sur la prime Neat (%)"
                value={marginDraft}
                onChange={(e) => setMarginDraft(e.target.value)}
                slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                helperText="Prix client = prime Neat + X %, arrondi à l'euro supérieur ; vide = tarif manuel des Options."
              />
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 1,
                  '& > *': { width: { xs: '100%', sm: 'auto' } },
                }}
              >
                {/* No Save button: the page's action bar writes this card
                    (specs/settings-one-save-and-automatic-webhook.md rule 1). « Tester la
                    connexion » stays — it reads, it does not write. */}
                <Button
                  variant="outlined"
                  onClick={handleTest}
                  disabled={!credentialsSet || testing || saving}
                  startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TaskAltIcon />}
                >
                  {testing ? 'Test en cours…' : 'Tester la connexion'}
                </Button>
              </Box>

              {/* 2 — channel / contract / payment method */}
              {credentialsSet && (
                <>
                  <Box>
                    <Button
                      variant="outlined"
                      onClick={() => loadDiscovery(channelId)}
                      disabled={discovering}
                      startIcon={discovering ? <CircularProgress size={16} color="inherit" /> : <TravelExploreIcon />}
                      sx={{ width: { xs: '100%', sm: 'auto' } }}
                    >
                      {discovering ? 'Chargement…' : 'Charger les canaux de vente'}
                    </Button>
                  </Box>
                  {discovery && (
                    <>
                      <FormControl fullWidth size="small">
                        <InputLabel id="neat-channel-label">Canal de vente</InputLabel>
                        <Select
                          labelId="neat-channel-label"
                          label="Canal de vente"
                          value={channelId}
                          onChange={(e) => handlePickChannel(e.target.value)}
                        >
                          {(discovery.channels || []).map((ch) => (
                            <MenuItem key={ch.id} value={ch.id}>
                              {ch.name}{ch.storeName ? ` — ${ch.storeName}` : ''}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {discovery.channelDetail && (
                        <>
                          <FormControl fullWidth size="small">
                            <InputLabel id="neat-contract-label">Contrat</InputLabel>
                            <Select
                              labelId="neat-contract-label"
                              label="Contrat"
                              value={contractId}
                              onChange={(e) => setContractId(e.target.value)}
                            >
                              {contracts.map((c) => (
                                <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {paymentMethods.length === 0 ? (
                            <Alert severity="error">
                              Ce canal ne propose pas de mode de paiement à la charge de
                              l'établissement — contacte Neat.
                            </Alert>
                          ) : (
                            <FormControl fullWidth size="small">
                              <InputLabel id="neat-pm-label">Mode de paiement</InputLabel>
                              <Select
                                labelId="neat-pm-label"
                                label="Mode de paiement"
                                value={paymentMethodId}
                                onChange={(e) => setPaymentMethodId(e.target.value)}
                              >
                                {paymentMethods.map((pm) => (
                                  <MenuItem key={pm.id} value={pm.id}>{pm.label}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* 3 — field mapping, driven by the chosen contract's own schema */}
              {contractFields.length > 0 && (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Champs du contrat Neat
                  </Typography>
                  <Stack spacing={1.5}>
                    {contractFields.map((field) => {
                      const row = mappingDraft[field.id] || {};
                      const rowError = mappingErrors[field.id];
                      return (
                        <Box
                          key={field.id}
                          sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            gap: 1,
                            alignItems: { sm: 'center' },
                          }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" noWrap>
                              {field.title}
                              {field.required && (
                                <Typography component="span" variant="caption" color="error.main" sx={{ ml: 0.75, fontWeight: 700 }}>
                                  requis
                                </Typography>
                              )}
                            </Typography>
                          </Box>
                          <FormControl size="small" sx={{ flex: 1, width: { xs: '100%', sm: 'auto' } }} error={Boolean(rowError)}>
                            <InputLabel id={`neat-map-${field.id}`}>Source GuestFlow</InputLabel>
                            <Select
                              labelId={`neat-map-${field.id}`}
                              label="Source GuestFlow"
                              value={row.source || ''}
                              onChange={(e) => updateMappingRow(field.id, { source: e.target.value || undefined })}
                            >
                              <MenuItem value="">—</MenuItem>
                              {sources.map((src) => (
                                <MenuItem key={src.key} value={src.key}>{src.label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {row.source === 'constant' && (
                            <TextField
                              size="small"
                              label="Valeur fixe"
                              value={row.constant || ''}
                              onChange={(e) => updateMappingRow(field.id, { constant: e.target.value })}
                              sx={{ width: { xs: '100%', sm: 180 } }}
                            />
                          )}
                          {rowError && (
                            <Typography variant="caption" color="error.main">{rowError}</Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                </>
              )}

              {/* 4 — summary */}
              {credentialsSet && (
                <Box>
                  <SummaryItem label="Canal de vente" value={settings.salesChannelLabel} valuePlaceholder="Non choisi" />
                  <SummaryItem label="Contrat" value={settings.contractLabel} valuePlaceholder="Non choisi" />
                  <SummaryItem label="Mode de paiement" value={settings.paymentMethodLabel} valuePlaceholder="Non choisi" />
                  <SummaryItem
                    label="Champs requis mappés"
                    value={`${settings.status.requiredFieldsMapped} / ${settings.status.requiredFieldsTotal}`}
                  />
                  <SummaryItem
                    label="Souscriptions"
                    value={`${settings.counters.pending} en attente · ${settings.counters.failed} en échec · ${settings.counters.active} active(s)`}
                  />
                </Box>
              )}
            </>
          )}

          {actionResult && (
            <Alert severity={actionResult.severity} onClose={() => setActionResult(null)}>
              {actionResult.message}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default forwardRef(SettingsNeatSection);
