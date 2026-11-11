/**
 * « Modules » on a customer's page (specs/plugin-operator-provisioning.md rules 10–14): which of the
 * plugins the plan allows run on the customer's space. One line per module with a switch that saves
 * at once; each line says what the space actually runs. Switching off asks first. A refused switch
 * snaps back and shows the server's sentence under the line. Everything shown is the server's.
 *
 * An inactive module that still holds data has a menu « Effacer les données… » (rule 22): the dialog
 * lists what will be erased, as the space counts it, and asks to type the customer's slug. One that is
 * installed without data has « Désinstaller… » (rule 38): same order, a plain confirmation.
 *
 * specs/plugin-dependencies.md rules 17–18: each line says what it needs (`requires`, an unmet one with its
 * status) and who uses it (`usedBy`); a switch that would take other modules along (`alsoOn`,
 * `alsoOff`, listed by the server) names them in its confirmation and sends `withRequirements` /
 * `withDependents`.
 *
 * Props: customerId, slug (typed to confirm an erasure), onChanged() (the page reloads its journal).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, Collapse, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography, useMediaQuery,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FormDialog from '@gf/components/FormDialog';
import StatusBadge from '@gf/components/StatusBadge';
import ErrorAlert from '@gf/components/ErrorAlert';
import LoadingState from '@gf/components/LoadingState';
import { useAppDialogs, useToast } from '@gf/components/DialogProvider';
import api from '../api';

const BADGE = { active: 'success', inactive: 'neutral', pending: 'info', failed: 'error', blocked: 'warning', unknown: 'neutral' };

function badgeStatus(line) {
  return line.stale ? 'warning' : BADGE[line.state] || 'neutral';
}

// The whole 44 px height is clickable (the hidden input follows the switchBase) with the thumb centred where it was.
// The root keeps its default overflow:hidden: that input is three times the thumb wide and would otherwise cover the neighbouring button.
const SWITCH_SX = { flexShrink: 0, height: 44, py: '15px', '& .MuiSwitch-switchBase': { top: 0, height: 44, py: '12px' } };

export default function ModulesSection({ customerId, slug, onChanged }) {
  const { confirm } = useAppDialogs();
  const { showError } = useToast();
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [optimistic, setOptimistic] = useState({});
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [showOut, setShowOut] = useState(false);
  const [menu, setMenu] = useState(null);
  const [erasing, setErasing] = useState(null);
  const [typed, setTyped] = useState('');

  const load = useCallback(() => {
    setLoadError(null);
    api.customerModules(customerId).then(setView).catch((err) => setLoadError(err.message));
  }, [customerId]);
  useEffect(load, [load]);

  // The space answers within a minute: follow it while a line is waiting.
  const waiting = Boolean(view && view.included.some((l) => l.state === 'pending'));
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setTimeout(load, 15000);
    return () => clearTimeout(t);
  }, [waiting, view, load]);

  async function change(line, on) {
    if (busyId) return;
    const along = on ? line.alsoOn : line.alsoOff;
    if (line.confirm) {
      const ok = await confirm({
        title: line.confirm.title,
        message: line.confirm.message,
        confirmLabel: line.confirm.label,
        confirmColor: 'primary',
      });
      if (!ok) return;
    }
    setRefusal(null);
    setOptimistic((o) => ({ ...o, [line.id]: on }));
    setBusy(true);
    setBusyId(line.id);
    try {
      setView(await api.toggleModule(customerId, line.id, on, ...(along.length ? [on ? { withRequirements: along.map((a) => a.id) } : { withDependents: along.map((a) => a.id) }] : [])));
      if (onChanged) onChanged();
    } catch (err) {
      if (err.status === 422) {
        setRefusal({ id: line.id, message: err.message });
        load();
      }
      else showError(err.message);
    } finally {
      setOptimistic((o) => { const next = { ...o }; delete next[line.id]; return next; });
      setBusy(false);
      setBusyId(null);
    }
  }

  function failed(err) {
    showError(err.message);
    if (err.code === 'ACTION_CHANGED') {
      setErasing(null);
      load();
    }
  }

  async function erase() {
    if (busy || typed !== slug) return;
    setBusy(true);
    try {
      setView(await api.eraseModule(customerId, erasing.id, 'erase', typed));
      setErasing(null);
      if (onChanged) onChanged();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function uninstall(line) {
    const ok = await confirm({
      title: `Désinstaller ${line.name} ?`,
      message: 'Le module est retiré de l’espace. Il ne contient aucune donnée.',
      confirmLabel: 'Désinstaller',
      confirmColor: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setView(await api.eraseModule(customerId, line.id, 'uninstall'));
      if (onChanged) onChanged();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setRefusal(null);
    setBusy(true);
    try {
      setView(await api.retryModules(customerId));
      if (onChanged) onChanged();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const renderLine = (line) => {
    const checked = optimistic[line.id] ?? line.on;
    const refused = refusal && refusal.id === line.id ? refusal.message : null;
    const describedBy = [line.stateLabel || line.detail ? `module-${line.id}-state` : null, refused ? `module-${line.id}-refusal` : null].filter(Boolean).join(' ') || undefined;
    return (
      <Box key={line.id} component="li" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.name}</Typography>
          <Box id={`module-${line.id}-state`} sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5 }}>
            {line.stateLabel && <StatusBadge status={badgeStatus(line)} label={line.stateLabel} />}
            {line.setupLabel && <StatusBadge status="warning" label={line.setupLabel} wrap />}
            {line.planChip && <StatusBadge status="neutral" label={line.planChip} />}
            {line.detail && <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{line.detail}</Typography>}
            {line.canRetry && <Button size="small" sx={{ minHeight: 44 }} disabled={busy} onClick={retry}>Réessayer</Button>}
          </Box>
          {(line.requires.length > 0 || line.usedBy.length > 0) && (
            <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25, alignItems: 'flex-start' }}>
              {line.requires.map((r) => (
                <Box key={r.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0.75, rowGap: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Nécessite <b>{r.name}</b></Typography>
                  {r.label && <StatusBadge status="warning" label={r.label} />}
                </Box>
              ))}
              {line.usedBy.length > 0 && (
                <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  Utilisé par {line.usedBy.map((u) => u.label).join(', ')}
                </Typography>
              )}
            </Box>
          )}
          {line.switchBlockedBy && <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.dark' }}>{line.switchBlockedBy}</Typography>}
          {refused && <Typography id={`module-${line.id}-refusal`} variant="caption" role="alert" sx={{ display: 'block', mt: 0.5, color: 'error.main' }}>{refused}</Typography>}
        </Box>
        {(line.canErase || line.canUninstall) && (
          <IconButton aria-label={`Plus d’actions pour ${line.name}`} sx={{ minWidth: 44, minHeight: 44 }} onClick={(e) => setMenu({ anchor: e.currentTarget, line })}>
            <MoreVertIcon />
          </IconButton>
        )}
        {line.switchable && (
          <Switch checked={checked} disabled={(Boolean(busyId) && busyId !== line.id) || Boolean(line.switchBlockedBy)} onChange={(e) => change(line, e.target.checked)}
            slotProps={{ input: { 'aria-label': line.name, 'aria-describedby': describedBy, 'aria-busy': busyId === line.id } }} sx={SWITCH_SX} />
        )}
      </Box>
    );
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, mb: 1 }}>
          <Typography variant="sectionHeader" component="h2">Modules</Typography>
          {view && view.seeded && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {view.headerParts.map((part, i) => (
                <React.Fragment key={part.text}>
                  {i > 0 && ' · '}
                  <Box component="span" sx={part.tone === 'error' ? { color: 'error.main' } : undefined}>{part.text}</Box>
                </React.Fragment>
              ))}
            </Typography>
          )}
        </Box>
        {!view && !loadError && <LoadingState />}
        {loadError && <ErrorAlert message={loadError} onRetry={load} />}
        {view && !view.seeded && (
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <ErrorAlert message={view.seedLabel} sx={{ width: '100%' }} />
            <Button variant="outlined" sx={{ minHeight: 44 }} disabled={busy} onClick={retry}>Relever maintenant</Button>
          </Stack>
        )}
        {view && view.seeded && (
          <>
            {view.empty && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{view.empty}</Typography>}
            <Box component="ul" aria-label="Modules inclus" sx={{ listStyle: 'none', m: 0, p: 0, maxWidth: 900 }}>
              {view.included.map(renderLine)}
            </Box>
            {view.outOfPlan.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" sx={{ minHeight: 44 }} aria-expanded={showOut} endIcon={<ExpandMoreIcon sx={{ transform: showOut ? 'rotate(180deg)' : 'none' }} />}
                  onClick={() => setShowOut((v) => !v)}>
                  Hors forfait ({view.outOfPlan.length})
                </Button>
                <Collapse in={showOut} unmountOnExit timeout={reduceMotion ? 0 : 'auto'}>
                  <Box component="ul" aria-label="Modules hors forfait" sx={{ listStyle: 'none', m: 0, p: 0, maxWidth: 900 }}>
                    {view.outOfPlan.map(renderLine)}
                  </Box>
                </Collapse>
              </Box>
            )}
          </>
        )}
      </CardContent>
      <Menu anchorEl={menu && menu.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu && menu.line.canUninstall
          ? <MenuItem sx={{ minHeight: 44 }} onClick={() => { const { line } = menu; setMenu(null); uninstall(line); }}>Désinstaller…</MenuItem>
          : <MenuItem sx={{ minHeight: 44 }} onClick={() => { setErasing(menu.line); setTyped(''); setMenu(null); }}>Effacer les données…</MenuItem>}
      </Menu>
      <FormDialog open={Boolean(erasing)} onClose={() => setErasing(null)} title={erasing ? `Effacer les données de ${erasing.name} ?` : ''}
        submitLabel="Effacer" submitColor="error" submitDisabled={typed !== slug} submitBusy={busy} onSubmit={erase}>
        {erasing && (
          <Stack spacing={1.5}>
            <Typography variant="body2">Seront effacées de l’espace :</Typography>
            <Box component="ul" sx={{ m: 0, pl: 3 }}>
              {erasing.eraseLines.map((l) => <li key={l}><Typography variant="body2">{l}</Typography></li>)}
            </Box>
            {erasing.eraseWarnings.map((w) => <Typography key={w} variant="body2" sx={{ color: 'text.secondary' }}>{w}</Typography>)}
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Une restauration reste possible depuis la sauvegarde de l’hébergement.</Typography>
            <TextField label={`Pour confirmer, tapez « ${slug} »`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); erase(); } }} />
          </Stack>
        )}
      </FormDialog>
    </Card>
  );
}
