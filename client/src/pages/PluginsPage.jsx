/**
 * PluginsPage — Paramètres › Plugins (specs/plugins-phase-0-foundation.md §3.E).
 *
 * Two tabs, « Installés » and « Disponibles », a search field and one PluginCard per plugin. Every
 * action is immediate (no Save): the server answers with the new state, or a refusal the card shows
 * in red. After each change the auth context is refreshed, so the menu and every PluginGate follow
 * without a reload.
 *
 * specs/plugins-phase-4-registry.md rules 9, 13, 18, 20–22: each card shows its version and, when a
 * newer one is offered, a « Mise à jour x.y.z » chip opening the update dialog; a banner offers
 * « Tout mettre à jour »; « Rechercher des mises à jour » reads the registry again. An update
 * restarts the instance: the page says « Redémarrage en cours » and reloads once the server answers
 * again. An install in a release reloads the page, so the browser loads the new plugin's bundle.
 *
 * Props (tests only): onReload — what « reload » means (default: window.location.reload);
 * pollMs — the restart poll interval.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Backdrop, Box, Button, CircularProgress, Grid, TextField, Typography } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import SyncIcon from '@mui/icons-material/Sync';
import PageActionBar from '../components/PageActionBar';
import PageTabs from '../components/PageTabs';
import PluginCard from '../components/PluginCard';
import PluginUpdateDialog from '../components/PluginUpdateDialog';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { BUNDLE_FAILURES } from '../plugins/runtimeModules';
import api from '../api';

const ACTIONS = {
  install: 'installPlugin',
  activate: 'activatePlugin',
  deactivate: 'deactivatePlugin',
  uninstall: 'uninstallPlugin',
  update: 'updatePlugin',
  rollback: 'rollbackPlugin',
};
const run = (action, id, options) => (options ? api[ACTIONS[action]](id, options) : api[ACTIONS[action]](id));

const RESTART_POLL_MS = 1500;
const reloadPage = () => window.location.reload();
const startTime = () => api.getRuntimeVersion().then((v) => v.startedAt).catch(() => null);

export default function PluginsPage({ onReload = reloadPage, pollMs = RESTART_POLL_MS }) {
  const { refresh } = useAuth();
  const [plugins, setPlugins] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [errors, setErrors] = useState({});
  const [dialogId, setDialogId] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [bannerError, setBannerError] = useState(null);
  const [restarting, setRestarting] = useState(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([api.getPlugins(), api.getPluginsStatus()]);
      setPlugins(list);
      setStatus(st);
      setLoadError(null);
      setTab((current) => current || (list.some((p) => p.state !== 'available') ? 'installed' : 'available'));
    } catch (e) {
      setLoadError(e.message || 'Impossible de charger les plugins.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Rule 13 — after an update the process restarts: wait until it answers with a new start time.
  useEffect(() => {
    if (!restarting) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const now = await startTime();
      if (stop) return;
      if (now && now !== restarting.startedAt) { onReload(); return; }
      setTimeout(tick, pollMs);
    };
    const first = setTimeout(tick, pollMs);
    return () => { stop = true; clearTimeout(first); };
  }, [restarting, onReload, pollMs]);

  const handleAction = async (plugin, action, options) => {
    setBusyId(plugin.id);
    setErrors((prev) => ({ ...prev, [plugin.id]: null }));
    const inDialog = dialogId === plugin.id;
    try {
      const startedAt = action === 'update' || action === 'rollback' ? await startTime() : null;
      const result = await run(action, plugin.id, options);
      if (result && result.restarting) {
        setDialogId(null);
        setRestarting({ startedAt });
        return;
      }
      if (result && result.reload) { onReload(); return; }
      if (action === 'install') setTab('installed');
      await Promise.all([load(), refresh()]);
    } catch (e) {
      const message = e.message || 'L’action a échoué.';
      if (inDialog) setDialogError(message);
      else setErrors((prev) => ({ ...prev, [plugin.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  const updateAll = async () => {
    setBannerError(null);
    setBusyId('*');
    try {
      const startedAt = await startTime();
      const result = await api.updateAllPlugins();
      if (result && result.restarting) setRestarting({ startedAt });
    } catch (e) {
      setBannerError(e.message || 'La mise à jour a échoué.');
    } finally {
      setBusyId(null);
    }
  };

  const searchUpdates = async () => {
    setSearching(true);
    setBannerError(null);
    try {
      await api.refreshPlugins();
      await load();
    } catch (e) {
      setBannerError(e.message || 'Le registre n’a pas pu être lu.');
    } finally {
      setSearching(false);
    }
  };

  const installed = useMemo(() => (plugins || []).filter((p) => p.state !== 'available'), [plugins]);
  const available = useMemo(() => (plugins || []).filter((p) => p.state === 'available'), [plugins]);
  const dialogPlugin = (plugins || []).find((p) => p.id === dialogId) || null;

  const tabs = (
    <PageTabs
      value={tab || 'installed'}
      onChange={setTab}
      ariaLabel="Plugins installés ou disponibles"
      items={[
        { value: 'installed', label: `Installés (${installed.length})` },
        { value: 'available', label: `Disponibles (${available.length})` },
      ]}
    />
  );

  // Rule 9 — without a registry nothing says so: no button, no line.
  const registryConfigured = Boolean(status && status.registry && status.registry.configured);
  const actionsBefore = registryConfigured
    ? [{ icon: searching ? <CircularProgress size={18} /> : <SyncIcon />, tooltip: 'Rechercher des mises à jour', onClick: searchUpdates, color: 'info', disabled: searching }]
    : [];

  if (loadError) {
    return (
      <Box>
        <PageActionBar title="Plugins" />
        <Box sx={{ p: { xs: 1.5, sm: 3 } }}><ErrorAlert message={loadError} onRetry={load} /></Box>
      </Box>
    );
  }
  if (!plugins) {
    return (
      <Box>
        <PageActionBar title="Plugins" />
        <LoadingState />
      </Box>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = (tab === 'available' ? available : installed)
    .filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q));

  let empty = null;
  if (!shown.length) {
    if (q) empty = `Aucun plugin ne correspond à « ${query.trim()} ».`;
    else if (tab === 'available') empty = 'Tous les plugins sont installés.';
    else empty = 'Aucun plugin installé. Tout ce qui est facultatif est dans Disponibles.';
  }

  return (
    <Box>
      <PageActionBar title="Plugins" tabs={tabs} actionsBefore={actionsBefore} />
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        {status && status.banner && (
          <Alert
            severity="info"
            sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center', '& .MuiAlert-message': { flex: 1 } }}
            action={(
              <Button color="inherit" variant="outlined" onClick={updateAll} disabled={busyId !== null} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
                Tout mettre à jour
              </Button>
            )}
          >
            {status.banner}
          </Alert>
        )}
        {bannerError && <Alert severity="warning" role="alert" sx={{ mb: 2 }}>{bannerError}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1, alignItems: { md: 'center' }, mb: 2 }}>
          <TextField
            type="search"
            size="small"
            fullWidth
            placeholder="Chercher un plugin…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Chercher un plugin' } }}
            sx={{ maxWidth: { md: 420 } }}
          />
          {status && status.registry && status.registry.label && (
            <Typography variant="caption" color="text.secondary">{status.registry.label}</Typography>
          )}
        </Box>
        {empty ? (
          <EmptyState icon={<ExtensionIcon />} message={empty} />
        ) : (
          <Grid container spacing={1.5}>
            {shown.map((plugin) => (
              <Grid key={plugin.id} size={{ xs: 12, lg: 6 }}>
                <PluginCard
                  plugin={plugin}
                  busy={busyId === plugin.id || busyId === '*'}
                  error={errors[plugin.id]}
                  bundleFailed={BUNDLE_FAILURES.has(plugin.id)}
                  onAction={(action, options) => handleAction(plugin, action, options)}
                  onOpenUpdate={() => { setDialogError(null); setDialogId(plugin.id); }}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
      <PluginUpdateDialog
        open={Boolean(dialogPlugin)}
        plugin={dialogPlugin}
        busy={busyId === dialogId}
        error={dialogError}
        onClose={() => setDialogId(null)}
        onUpdate={() => handleAction(dialogPlugin, 'update')}
      />
      <Backdrop open={Boolean(restarting)} sx={(t) => ({ zIndex: t.zIndex.modal + 1, color: '#fff', flexDirection: 'column', gap: 2 })}>
        <CircularProgress color="inherit" />
        <Typography variant="h6" component="p">Redémarrage en cours</Typography>
      </Backdrop>
    </Box>
  );
}
