/**
 * « Modules » on a customer's page (specs/plugin-operator-provisioning.md rules 10–14): which of the
 * plugins the plan allows run on the customer's space. One line per module with a switch that saves
 * at once; each line says what the space actually runs. Switching off asks first. A refused switch
 * snaps back and shows the server's sentence under the line. Everything shown is the server's.
 *
 * Props: customerId, onChanged() (the page reloads its journal).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Collapse, Stack, Switch, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StatusBadge from '@gf/components/StatusBadge';
import ErrorAlert from '@gf/components/ErrorAlert';
import LoadingState from '@gf/components/LoadingState';
import { useAppDialogs, useToast } from '@gf/components/DialogProvider';
import api from '../api';

const BADGE = { active: 'success', inactive: 'neutral', pending: 'info', failed: 'error', blocked: 'warning', unknown: 'neutral' };

function badgeStatus(line) {
  return line.needsSetup ? 'warning' : BADGE[line.state] || 'neutral';
}

export default function ModulesSection({ customerId, onChanged }) {
  const { confirm } = useAppDialogs();
  const { showError } = useToast();
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [optimistic, setOptimistic] = useState({});
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showOut, setShowOut] = useState(false);

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
    if (!on) {
      const ok = await confirm({
        title: `Désactiver ${line.name} ?`,
        message: 'Ses pages disparaissent de l’espace ; ses données sont conservées.',
        confirmLabel: 'Désactiver',
        confirmColor: 'primary',
      });
      if (!ok) return;
    }
    setRefusal(null);
    setOptimistic((o) => ({ ...o, [line.id]: on }));
    setBusy(true);
    try {
      setView(await api.toggleModule(customerId, line.id, on));
      if (onChanged) onChanged();
    } catch (err) {
      if (err.status === 422) setRefusal({ id: line.id, message: err.message });
      else showError(err.message);
    } finally {
      setOptimistic((o) => { const next = { ...o }; delete next[line.id]; return next; });
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
    return (
      <Box key={line.id} component="li" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.name}</Typography>
          <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            {line.stateLabel && <StatusBadge status={badgeStatus(line)} label={line.stateLabel} wrap />}
            {line.planChip && <StatusBadge status="neutral" label={line.planChip} />}
            {line.canRetry && <Button size="small" sx={{ minHeight: 44 }} disabled={busy} onClick={retry}>Réessayer</Button>}
          </Box>
          {refused && <Typography variant="caption" color="error.main" role="alert" sx={{ display: 'block', mt: 0.5 }}>{refused}</Typography>}
        </Box>
        {line.switchable && (
          <Switch checked={checked} disabled={busy} onChange={(e) => change(line, e.target.checked)} slotProps={{ input: { 'aria-label': line.name } }} sx={{ flexShrink: 0 }} />
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
            <Typography variant="body2" color={view.counts.failed ? 'error.main' : 'text.secondary'}>{view.header}</Typography>
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
            {view.empty && <Typography variant="body2" color="text.secondary">{view.empty}</Typography>}
            <Box component="ul" aria-label="Modules inclus" sx={{ listStyle: 'none', m: 0, p: 0, maxWidth: 900 }}>
              {view.included.map(renderLine)}
            </Box>
            {view.outOfPlan.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" sx={{ minHeight: 44 }} aria-expanded={showOut} endIcon={<ExpandMoreIcon sx={{ transform: showOut ? 'rotate(180deg)' : 'none' }} />}
                  onClick={() => setShowOut((v) => !v)}>
                  Hors forfait ({view.outOfPlan.length})
                </Button>
                <Collapse in={showOut} unmountOnExit>
                  <Box component="ul" aria-label="Modules hors forfait" sx={{ listStyle: 'none', m: 0, p: 0, maxWidth: 900 }}>
                    {view.outOfPlan.map(renderLine)}
                  </Box>
                </Collapse>
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
