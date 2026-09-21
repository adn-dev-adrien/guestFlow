/**
 * PropertyPlatformsTab — « Plateformes & iCal » tab of the property page
 * (specs/settings-rationalization.md rules 18, 21).
 *
 * Only what belongs to THIS property is edited here: each platform's iCal URL, its sync, disabling
 * it, removing a configured feed, adding a platform, and the export link. The platform's global
 * settings (commission, acompte, tourist tax, payout, colour) are shown as read-only chips with a
 * link to Paramètres → Plateformes — changing them here used to change them for every property.
 *
 * A disabled calendar greys its content (chips, URL, sync line) but not the buttons that still
 * work: « Réactiver » is filled and « Retirer » keeps its colour; only « Synchroniser » is greyed.
 *
 * Props: propertyId, propertyName, canManage
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Link, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import api from '../../api';
import IcalExportCard from '../IcalExportCard';
import { useToast } from '../DialogProvider';
import { DEFAULT_PLATFORM_COLOR, normalizePlatformKey } from '../../constants/platforms';
import { displayDate } from '../../utils/formatters';

const TAX_SHORT = {
  platform: 'Taxe : plateforme → commune',
  platform_reversed: 'Taxe : plateforme → vous',
  owner: "Taxe : à l'arrivée",
};

function syncLine(row) {
  if (!row.url) return { Icon: null, text: 'Saisie manuelle : pas de synchronisation.' };
  if (row.lastSyncStatus === 'error') return { Icon: ErrorIcon, color: 'error.main', text: row.lastSyncMessage || 'Erreur de synchronisation' };
  if (row.lastSyncStatus !== 'success') return { Icon: ScheduleIcon, color: 'text.disabled', text: 'Jamais synchronisé' };
  return {
    Icon: CheckCircleIcon,
    color: 'success.main',
    text: `Synchronisé${row.lastSyncAt ? ` le ${displayDate(row.lastSyncAt.slice(0, 10))}` : ''}${row.lastSyncMessage ? ` — ${row.lastSyncMessage}` : ''}`,
  };
}

export default function PropertyPlatformsTab({ propertyId, propertyName, canManage }) {
  const { showSuccess, showError } = useToast();
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    const [res, platformSettings] = await Promise.all([
      api.getPropertyPlatforms(propertyId),
      api.getPlatformSettings().catch(() => ({ platforms: [] })),
    ]);
    setRows(res.platforms || []);
    setSettings(platformSettings.platforms || []);
  }, [propertyId]);
  useEffect(() => { load().catch(() => setRows([])); }, [load]);

  const commissionOf = useMemo(() => {
    const map = new Map(settings.map((p) => [normalizePlatformKey(p.name), p.commissionPercent]));
    return (row) => map.get(normalizePlatformKey(row.platformLabel));
  }, [settings]);

  const run = async (key, action, message) => {
    setBusyKey(key);
    try {
      await action();
      await load();
      if (message) showSuccess(message);
    } catch (err) {
      showError((err && err.message) || 'Action impossible.');
    } finally {
      setBusyKey(null);
    }
  };

  // Configure-on-demand: create this property's source row the first time, update it afterwards.
  const upsert = (row, changes) => {
    const payload = {
      platformKey: row.platformKey,
      platformLabel: row.platformLabel,
      url: changes.url !== undefined ? changes.url : (row.url || ''),
      disabled: changes.disabled !== undefined ? changes.disabled : Boolean(row.disabled),
    };
    return row.sourceId
      ? api.updatePropertyIcalSource(propertyId, row.sourceId, payload)
      : api.createPropertyIcalSource(propertyId, payload);
  };

  const saveUrl = async (row) => {
    const url = urlDraft.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setUrlError('Un lien complet (https://…), ou vide pour une saisie manuelle.');
      return;
    }
    await run(row.platformKey, () => upsert(row, { url }), 'Calendrier enregistré.');
    setEditingKey(null);
  };

  const addPlatform = async () => {
    const name = newName.trim();
    if (!name) return;
    // Registers the platform (empty colour ⇒ the built-in / grey default); its settings live in Plateformes.
    await run('new', () => api.setPlatformColor(name, ''), 'Plateforme ajoutée.');
    setNewName('');
    setAdding(false);
  };

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Commission, acompte, taxe de séjour, virement et couleur valent pour tous les logements : ils se
        modifient dans <Link component={RouterLink} to="/settings/plateformes">Plateformes</Link>. Ici,
        seulement les calendriers de ce logement.
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="sectionHeader">Calendriers importés</Typography>
            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={async () => {
                setSyncingAll(true);
                try { await api.syncAllPropertyIcalSources(propertyId); await load(); } finally { setSyncingAll(false); }
              }}
              disabled={!canManage || syncingAll || !rows.some((r) => r.url && !r.disabled)}
            >
              {syncingAll ? 'Synchronisation…' : 'Synchroniser tout'}
            </Button>
          </Box>

          {rows.map((row) => {
            const editing = editingKey === row.platformKey;
            const busy = busyKey === row.platformKey;
            const status = syncLine(row);
            const commission = commissionOf(row);
            return (
              <Box key={row.platformKey} sx={{ borderTop: '1px solid', borderColor: 'divider', py: 1.5 }} data-testid={`platform-row-${row.platformKey}`}>
                <Box sx={row.disabled ? { opacity: 0.45, filter: 'grayscale(1)' } : undefined}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: row.color || DEFAULT_PLATFORM_COLOR, flex: '0 0 auto' }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 0.5 }}>{row.platformLabel}</Typography>
                    {commission != null && <Chip size="small" label={`${commission} %`} />}
                    {!row.isDirect && <Chip size="small" label={`Acompte : ${row.platformTakesDeposit ? 'oui' : 'non'}`} />}
                    {!row.isDirect && <Chip size="small" label={TAX_SHORT[row.touristTaxCollection] || TAX_SHORT.platform} />}
                    {!row.isDirectChannel && <Chip size="small" label={`Virement ${row.payoutDueDays ?? 10} j`} />}
                    {row.disabled && <Chip size="small" label="Désactivé" />}
                  </Box>
                  {!row.isDirect && !editing && (
                    <>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, wordBreak: 'break-all' }} title={row.url || ''}>
                        {row.url || 'Pas d’URL iCal'}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        {status.Icon && <status.Icon fontSize="small" sx={{ color: status.color }} />}
                        <Typography variant="caption" color="text.secondary">{status.text}</Typography>
                      </Box>
                    </>
                  )}
                </Box>
                {editing && (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    <TextField
                      size="small"
                      fullWidth
                      autoFocus
                      label="URL iCal"
                      value={urlDraft}
                      onChange={(e) => { setUrlDraft(e.target.value); setUrlError(''); }}
                      placeholder="https://…"
                      error={Boolean(urlError)}
                      helperText={urlError || 'Vide = saisie manuelle (pas de synchronisation iCal).'}
                    />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="contained" onClick={() => saveUrl(row)} disabled={busy}>Enregistrer</Button>
                      <Button size="small" onClick={() => setEditingKey(null)} disabled={busy}>Annuler</Button>
                    </Box>
                  </Stack>
                )}
                {!editing && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                    {!row.isDirect && (
                      <Button size="small" variant="outlined" onClick={() => { setEditingKey(row.platformKey); setUrlDraft(row.url || ''); setUrlError(''); }} disabled={!canManage || busy}>
                        Modifier l&apos;URL
                      </Button>
                    )}
                    {row.url && row.sourceId && (
                      <Tooltip title={row.disabled ? 'Réactivez le calendrier pour le synchroniser' : ''}>
                        <span>
                          <Button size="small" variant="outlined" startIcon={<SyncIcon />} onClick={() => run(row.platformKey, () => api.syncPropertyIcalSource(propertyId, row.sourceId), 'Calendrier synchronisé.')} disabled={!canManage || busy || row.disabled}>
                            Synchroniser
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                    <Button
                      size="small"
                      variant={row.disabled ? 'contained' : 'outlined'}
                      onClick={() => run(row.platformKey, () => upsert(row, { disabled: !row.disabled }))}
                      disabled={!canManage || busy}
                    >
                      {row.disabled ? 'Réactiver' : 'Désactiver'}
                    </Button>
                    {row.sourceId && !row.isBuiltIn && (
                      <Button size="small" variant="outlined" color="error" onClick={() => run(row.platformKey, () => api.deletePropertyIcalSource(propertyId, row.sourceId), 'Calendrier retiré.')} disabled={!canManage || busy}>
                        Retirer
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}

          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            {adding ? (
              <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                <TextField
                  size="small"
                  label="Nom de la plateforme"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addPlatform(); }}
                  placeholder="ex: Vrbo"
                  autoFocus
                  fullWidth
                />
                <Button variant="contained" onClick={addPlatform} disabled={!newName.trim()}>Ajouter</Button>
                <Button onClick={() => { setAdding(false); setNewName(''); }}>Annuler</Button>
              </Box>
            ) : (
              <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} disabled={!canManage}>Ajouter une plateforme</Button>
            )}
          </Box>
        </CardContent>
      </Card>

      <IcalExportCard propertyId={propertyId} propertyName={propertyName} />
    </>
  );
}
