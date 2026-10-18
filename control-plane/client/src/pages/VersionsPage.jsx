/**
 * « Versions » (specs/hosting-h1-fleet-runtime.md rules 8, 10, 11): the releases installed on the
 * host and the instances on each, the newest published version and its installation, the update of
 * one customer, a selection or the whole fleet — followed live, one instance after the other — and
 * the last updates. With the plugin registry (phase 4), a plugin update is pushed the same way.
 * Every label, count and state comes from the server.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, FormControlLabel, MenuItem, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import PageActionBar from '@gf/components/PageActionBar';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import StatusBadge from '@gf/components/StatusBadge';
import { useAppDialogs, useToast } from '@gf/components/DialogProvider';
import api from '../api';

const ITEM_STATUS = { pending: 'neutral', running: 'info', done: 'success', rolled_back: 'error', skipped: 'neutral' };
const UPDATE_STATUS = { running: 'info', done: 'success', failed: 'error' };

function Section({ title, children, action }) {
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader" component="h2">{title}</Typography>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

function Progress({ update }) {
  return (
    <Stack component="ul" aria-label={`Mise à jour ${update.title}`} sx={{ m: 0, p: 0 }} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {update.items.map((it) => (
        <Box component="li" key={it.customerId} sx={{ listStyle: 'none', display: 'flex', gap: 1, alignItems: 'center', py: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{it.companyName}</Typography>
            <Typography variant="caption" color={it.state === 'rolled_back' ? 'error' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>{it.detail}</Typography>
          </Box>
          {it.state === 'running' && <CircularProgress size={16} />}
          <StatusBadge status={ITEM_STATUS[it.state] || 'neutral'} label={it.stateLabel} />
        </Box>
      ))}
    </Stack>
  );
}

export default function VersionsPage() {
  const [params] = useSearchParams();
  const preselected = Number(params.get('client')) || null;
  const { showError, showSuccess } = useToast();
  const { confirm } = useAppDialogs();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState('');
  // H1 rule 28: nothing is preselected — the whole fleet is a choice, never a default.
  const [scope, setScope] = useState(preselected ? 'selection' : null);
  const [chosen, setChosen] = useState(preselected ? [preselected] : []);
  const [pluginVersions, setPluginVersions] = useState({});
  const pluginVersion = (pl) => pluginVersions[pl.id] || pl.defaultVersion || '';

  const load = useCallback(() => {
    setError(null);
    api.versions().then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  // A running update or installation is followed every second.
  const live = Boolean(data && (data.running || (data.install && data.install.state === 'running')));
  useEffect(() => {
    if (!live) return undefined;
    const t = setTimeout(() => api.versions().then(setData).catch(() => {}), 1000);
    return () => clearTimeout(t);
  }, [live, data]);

  useEffect(() => {
    if (data && !target && data.defaultTarget) setTarget(data.defaultTarget);
  }, [data, target]);

  const selected = useMemo(() => (scope === 'selection' ? chosen : null), [scope, chosen]);

  async function check() {
    setChecking(true);
    try {
      setData(await api.checkVersions());
    } catch (err) {
      showError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function install(version) {
    try {
      setData(await api.installRelease(version));
    } catch (err) {
      showError(err.message);
    }
  }

  async function update() {
    const count = selected ? selected.length : data.instances.length;
    const ok = await confirm({
      title: `Mettre à jour vers ${target} ?`,
      message: `${selected ? `${count} client${count > 1 ? 's' : ''}` : 'Toute la flotte'}, une instance après l’autre. Un contrôle de santé raté remet l’instance sur sa version et arrête la mise à jour.`,
      confirmLabel: 'Mettre à jour',
    });
    if (!ok) return;
    try {
      setData(await api.startUpdate(target, selected));
      showSuccess('Mise à jour lancée.');
    } catch (err) {
      showError(err.message);
    }
  }

  async function push(pl, version) {
    const ok = await confirm({
      title: `Pousser ${pl.name} ${version} ?`,
      message: `Les instances qui l’ont (${pl.count}), une après l’autre. Un contrôle de santé raté remet l’instance sur son paquet et sa base, et arrête la mise à jour.`,
      confirmLabel: 'Pousser',
    });
    if (!ok) return;
    try {
      setData(await api.pushPlugin(pl.id, version));
      showSuccess('Mise à jour lancée.');
    } catch (err) {
      showError(err.message);
    }
  }

  const bar = (
    <PageActionBar
      title="Versions"
      titleOnXs
      actionsBefore={[{ icon: checking ? <CircularProgress size={18} /> : <SyncIcon />, tooltip: 'Vérifier les versions publiées', onClick: check, color: 'info', disabled: checking }]}
    />
  );
  if (error) return <>{bar}<Box sx={{ p: 2 }}><ErrorAlert message={error} onRetry={load} /></Box></>;
  if (!data) return <>{bar}<LoadingState /></>;

  const toggle = (id) => setChosen((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const p = data.published;

  return (
    <>
      {bar}
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' } }}>
          <Section title="Installées sur l’hôte">
            {data.releases.length === 0 ? <Typography variant="body2" color="text.secondary">Aucune version installée.</Typography> : (
              <Stack component="ul" sx={{ m: 0, p: 0 }} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {data.releases.map((r) => (
                  <Box component="li" key={r.version} sx={{ listStyle: 'none', py: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.version}</Typography>
                      <StatusBadge status={r.failed ? 'error' : r.count ? 'success' : 'neutral'} label={r.statusLabel} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {[`installée le ${r.installedAt}`, r.names.join(', ')].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Section>
          <Section title="Publiée">
            {!p ? <Typography variant="body2" color="text.secondary">Pas encore vérifiée.</Typography> : (
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.version}</Typography>
                  <StatusBadge status={p.installed ? 'success' : 'info'} label={p.installed ? 'Installée' : 'À installer'} />
                </Box>
                <Typography variant="caption" color="text.secondary">Vérifiée le {p.checkedAt}</Typography>
                {!p.installed && (
                  <Button variant="outlined" startIcon={<SystemUpdateAltIcon />} onClick={() => install(p.version)}
                    disabled={Boolean(data.install && data.install.state === 'running')}
                    sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, minHeight: 44 }}>
                    Installer la {p.version}
                  </Button>
                )}
              </Stack>
            )}
            {data.install && (
              <Alert sx={{ mt: 1 }} severity={data.install.state === 'failed' ? 'error' : data.install.state === 'done' ? 'success' : 'info'}
                icon={data.install.state === 'running' ? <CircularProgress size={18} /> : undefined}>
                {data.install.label}
              </Alert>
            )}
          </Section>
        </Box>

        <Section title="Mettre à jour">
          {data.instances.length === 0 ? <Typography variant="body2" color="text.secondary">Aucune instance en service.</Typography> : (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' } }}>
                <TextField select size="small" label="Version cible" value={target} onChange={(e) => setTarget(e.target.value)} sx={{ minWidth: 160 }}>
                  {data.releases.map((r) => <MenuItem key={r.version} value={r.version}>{r.failed ? `${r.version} — en échec` : r.version}</MenuItem>)}
                </TextField>
                <ToggleButtonGroup exclusive value={scope} onChange={(e, v) => v && setScope(v)} size="small" aria-label="Portée" sx={{ flexWrap: 'wrap' }}>
                  <ToggleButton value="all" sx={{ minHeight: 44 }}>Toute la flotte</ToggleButton>
                  <ToggleButton value="selection" sx={{ minHeight: 44 }}>Sélection</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {scope === 'selection' && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', lg: 'repeat(3, minmax(0,1fr))' } }}>
                  {data.instances.map((i) => (
                    <FormControlLabel key={i.id} sx={{ minHeight: 44 }} label={`${i.companyName} — ${i.version}`}
                      control={<Checkbox checked={chosen.includes(i.id)} onChange={() => toggle(i.id)} />} />
                  ))}
                </Box>
              )}
              <Button variant="contained" startIcon={<SystemUpdateAltIcon />} onClick={update}
                disabled={!target || !scope || Boolean(data.running) || (scope === 'selection' && chosen.length === 0)}
                sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, minHeight: 44 }}>
                Mettre à jour
              </Button>
            </Stack>
          )}
          {data.running && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Vers {data.running.title} — {data.running.scopeLabel}</Typography>
              <Progress update={data.running} />
            </Box>
          )}
        </Section>

        {data.pluginPush.available && data.pluginPush.plugins.length > 0 && (
          <Section title="Plugins">
            <Stack spacing={1.5} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
              {data.pluginPush.plugins.map((pl) => (
                <Box key={pl.id} sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{pl.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{pl.runningLabel}</Typography>
                  </Box>
                  {pl.versions.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">Aucune version au registre.</Typography>
                  ) : (
                    <>
                      <TextField select size="small" label="Version" value={pluginVersion(pl)} sx={{ minWidth: 120 }}
                        onChange={(e) => setPluginVersions((v) => ({ ...v, [pl.id]: e.target.value }))}>
                        {pl.versions.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                      <Button variant="outlined" sx={{ minHeight: 44 }} disabled={!pluginVersion(pl) || Boolean(data.running)}
                        onClick={() => push(pl, pluginVersion(pl))}>
                        Pousser
                      </Button>
                    </>
                  )}
                </Box>
              ))}
            </Stack>
          </Section>
        )}

        {data.history.length > 0 && (
          <Section title="Dernières mises à jour">
            <Stack spacing={2}>
              {data.history.map((u) => (
                <Box key={u.id}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.startedAt} — vers {u.title}, {u.scopeLabel}</Typography>
                    <StatusBadge status={UPDATE_STATUS[u.state] || 'neutral'} label={u.stateLabel} />
                  </Box>
                  {u.error && <Typography variant="body2" color="error" sx={{ mb: 0.5 }}>{u.error}</Typography>}
                  <Progress update={u} />
                </Box>
              ))}
            </Stack>
          </Section>
        )}
      </Stack>
    </>
  );
}
