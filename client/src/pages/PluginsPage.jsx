/**
 * PluginsPage — Paramètres › Plugins (specs/plugins-phase-0-foundation.md §3.E).
 *
 * Two tabs, « Installés » and « Disponibles », a search field and one PluginCard per plugin. Every
 * action is immediate (no Save): the server answers with the new state, or a refusal the card shows
 * in red. After each change the auth context is refreshed, so the menu and every PluginGate follow
 * without a reload.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Grid, TextField } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import PageActionBar from '../components/PageActionBar';
import PageTabs from '../components/PageTabs';
import PluginCard from '../components/PluginCard';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import api from '../api';

const ACTIONS = {
  install: api.installPlugin,
  activate: api.activatePlugin,
  deactivate: api.deactivatePlugin,
  uninstall: api.uninstallPlugin,
};

export default function PluginsPage() {
  const { refresh } = useAuth();
  const [plugins, setPlugins] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    try {
      const list = await api.getPlugins();
      setPlugins(list);
      setLoadError(null);
      setTab((current) => current || (list.some((p) => p.state !== 'available') ? 'installed' : 'available'));
    } catch (e) {
      setLoadError(e.message || 'Impossible de charger les plugins.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (plugin, action, options) => {
    setBusyId(plugin.id);
    setErrors((prev) => ({ ...prev, [plugin.id]: null }));
    try {
      await (options ? ACTIONS[action](plugin.id, options) : ACTIONS[action](plugin.id));
      if (action === 'install') setTab('installed');
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [plugin.id]: e.message || 'L’action a échoué.' }));
    } finally {
      setBusyId(null);
    }
  };

  const installed = useMemo(() => (plugins || []).filter((p) => p.state !== 'available'), [plugins]);
  const available = useMemo(() => (plugins || []).filter((p) => p.state === 'available'), [plugins]);

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
      <PageActionBar title="Plugins" tabs={tabs} />
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <TextField
          type="search"
          size="small"
          fullWidth
          placeholder="Chercher un plugin…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Chercher un plugin' } }}
          sx={{ mb: 2, maxWidth: { md: 420 } }}
        />
        {empty ? (
          <EmptyState icon={<ExtensionIcon />} message={empty} />
        ) : (
          <Grid container spacing={1.5}>
            {shown.map((plugin) => (
              <Grid key={plugin.id} size={{ xs: 12, md: 6 }}>
                <PluginCard
                  plugin={plugin}
                  busy={busyId === plugin.id}
                  error={errors[plugin.id]}
                  onAction={(action, options) => handleAction(plugin, action, options)}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Box>
  );
}
