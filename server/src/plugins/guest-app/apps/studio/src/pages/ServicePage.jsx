/**
 * Service — what every lodging shares (rules 40-42, 41bis): delivered to the lodging or picked up (with the pickup
 * place, required), the week's service ranges and the exception dates. The hours are shared by default; a lodging
 * may hold its own, and saving its hours empty sends it back to the shared ones. Saved with the bar.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import RangesEditor from '../components/RangesEditor';
import { WEEKDAYS } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { api } from '../services/api';

const SHARED = 'shared';
const hoursOf = (config) => ({
  weekly: Object.fromEntries(WEEKDAYS.map((d) => [d.key, (config.weekly && config.weekly[d.key]) || []])),
  exceptions: (config.exceptions || []).map((e) => (e.closed ? { date: e.date, closed: true } : { date: e.date, ranges: e.ranges || [] })),
});
const EMPTY_HOURS = { weekly: Object.fromEntries(WEEKDAYS.map((d) => [d.key, []])), exceptions: [] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** « mar. 3 nov. » for an exception's date (`YYYY-MM-DD`, read as a calendar day). */
function dayLabel(ymd) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));
}

export default function ServicePage({ lodgings }) {
  const [scope, setScope] = useState(SHARED);
  const settings = useLoad(() => api.settings(), []);
  const hours = useLoad(() => (scope === SHARED ? api.serviceHours() : api.serviceHours(scope)), [scope]);
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState(null);
  const [own, setOwn] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const savedMode = settings.data ? { fulfilment: settings.data.fulfilment, pickupPlace: settings.data.pickupPlace } : null;
  const savedHours = hours.data ? hoursOf(hours.data) : null;
  const followsShared = Boolean(hours.data && scope !== SHARED && hours.data.shared);
  useEffect(() => { if (savedMode) setMode(savedMode); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (savedHours) { setDraft(savedHours); setOwn(false); } }, [hours.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const modeDirty = Boolean(mode && savedMode && !same(mode, savedMode));
  const hoursDirty = Boolean(draft && savedHours && (own || !same(draft, savedHours)));
  const dirty = modeDirty || hoursDirty;
  useDirtyGuard(dirty);
  // A lodging that follows the shared hours shows them `inert`: neither the pointer, the keyboard nor a screen reader
  // reaches fields it cannot change.
  const editable = scope === SHARED || !followsShared || own;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (modeDirty) {
        const next = await api.saveSettings({ fulfilment: mode.fulfilment, pickupPlace: mode.pickupPlace });
        settings.setData(next);
      }
      if (hoursDirty) {
        const next = await api.saveServiceHours(draft, scope === SHARED ? null : scope);
        hours.setData(next);
      }
      setNotice('Enregistré.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const backToShared = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveServiceHours(EMPTY_HOURS, scope);
      hours.setData(next);
      setNotice('Ce logement suit de nouveau les horaires communs.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const scopeSelect = (
    <TextField select size="small" label="Horaires de" value={scope} disabled={dirty} onChange={(e) => setScope(e.target.value === SHARED ? SHARED : Number(e.target.value))} sx={{ minWidth: 220 }}>
      <MenuItem value={SHARED}>Tous les logements</MenuItem>
      {lodgings.map((l) => <MenuItem key={l.propertyId} value={l.propertyId}>{l.name}</MenuItem>)}
    </TextField>
  );
  const bar = (
    <PageActionBar
      title="Service"
      subtitle={<Chip size="small" label="Tous les logements" />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setMode(savedMode); setDraft(savedHours); setOwn(false); setError(null); }}
      cancelDisabled={!dirty || busy}
    />
  );
  const scopeName = useMemo(() => (scope === SHARED ? null : (lodgings.find((l) => l.propertyId === scope) || {}).name), [scope, lodgings]);

  if (!mode || !draft) {
    const failed = settings.error || hours.error;
    return <StudioPage bar={bar}>{failed ? <ErrorAlert message={failed.message} onRetry={() => { settings.reload(); hours.reload(); }} /> : <LoadingState />}</StudioPage>;
  }

  const setDay = (key, ranges) => setDraft((d) => ({ ...d, weekly: { ...d.weekly, [key]: ranges } }));
  const setException = (date, patch) => setDraft((d) => ({ ...d, exceptions: d.exceptions.map((e) => (e.date === date ? patch : e)) }));
  const addException = (closed) => {
    if (!newDate || draft.exceptions.some((e) => e.date === newDate)) return;
    setDraft((d) => ({ ...d, exceptions: [...d.exceptions, closed ? { date: newDate, closed: true } : { date: newDate, ranges: [{ from: '09:00', to: '12:00' }] }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setNewDate('');
  };

  return (
    <StudioPage bar={bar}>
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      <Section
        id="fulfilment"
        title="Livraison ou retrait"
        description="Un seul réglage pour tous les logements. Le client voit l’heure à laquelle sa commande sera prête, calculée sur le plus long délai de préparation de son panier. Les activités comme le bain gardent leur créneau."
      >
        <ToggleButtonGroup exclusive fullWidth value={mode.fulfilment} onChange={(e, next) => next && setMode((m) => ({ ...m, fulfilment: next }))} aria-label="Les commandes sont">
          <ToggleButton value="delivery" sx={{ minHeight: 44, textTransform: 'none' }}>Livrées au logement</ToggleButton>
          <ToggleButton value="pickup" sx={{ minHeight: 44, textTransform: 'none' }}>À retirer</ToggleButton>
        </ToggleButtonGroup>
        {mode.fulfilment === 'pickup' ? (
          <TextField
            label="Lieu de retrait"
            required
            value={mode.pickupPlace}
            onChange={(e) => setMode((m) => ({ ...m, pickupPlace: e.target.value }))}
            placeholder="À l’accueil, maison principale — sonnez à la porte verte"
            error={!mode.pickupPlace.trim()}
            helperText={mode.pickupPlace.trim() ? 'Relayé tel quel au client, en français et en anglais.' : 'Lieu où le client récupère sa commande.'}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>L’équipe dépose la commande au logement, à l’heure choisie par le client.</Typography>
        )}
      </Section>

      <Section
        id="weekly"
        title="Semaine type"
        description="Jusqu’à trois plages par jour. Hors plages, les clients commandent pour plus tard ; un bain froid ne s’allume qu’à l’intérieur."
        action={scopeSelect}
      >
        {followsShared && !own ? (
          <Alert
            severity="info"
            action={<Button color="inherit" onClick={() => { setOwn(true); }} sx={{ minHeight: 44 }}>Définir ses propres horaires</Button>}
          >
            {scopeName} suit les horaires communs à tous les logements.
          </Alert>
        ) : null}
        {scope !== SHARED && !followsShared ? (
          <Alert severity="info" action={<Button color="inherit" disabled={busy || dirty} onClick={backToShared} sx={{ minHeight: 44 }}>Revenir aux horaires communs</Button>}>
            {scopeName} a ses propres horaires.
          </Alert>
        ) : null}
        <Box sx={{ display: 'grid', opacity: editable ? 1 : 0.6 }} inert={!editable}>
          {WEEKDAYS.map((d) => (
            <Box key={d.key} role="group" aria-label={d.label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px 1fr' }, gap: 1, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'start' }}>
              <Typography sx={{ fontWeight: 600, pt: { sm: 1.25 } }}>{d.label}</Typography>
              <Box>
                <RangesEditor ranges={draft.weekly[d.key]} label={d.label} onChange={(ranges) => setDay(d.key, ranges)} />
                {!draft.weekly[d.key].length ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>Fermé.</Typography> : null}
              </Box>
            </Box>
          ))}
        </Box>
      </Section>

      <Section
        id="exceptions"
        title="Exceptions"
        description="Jour férié, absence : un jour fermé ou des plages différentes. Les fermetures de l’établissement dans GuestFlow ferment aussi le service."
      >
        <Box sx={{ display: 'grid', gap: 1.5, opacity: editable ? 1 : 0.6 }} inert={!editable}>
          {!draft.exceptions.length ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>Aucune exception.</Typography> : null}
          {draft.exceptions.map((e) => (
            <Box key={e.date} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 44px', sm: '160px 1fr 44px' }, gap: 1, alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 600 }}>{dayLabel(e.date)}</Typography>
              <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' } }}>
                {e.closed ? (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip icon={<EventBusyIcon />} label="Fermé" />
                    <Button onClick={() => setException(e.date, { date: e.date, ranges: [{ from: '09:00', to: '12:00' }] })} sx={{ minHeight: 44 }}>Ouvrir avec des plages</Button>
                  </Box>
                ) : (
                  <RangesEditor ranges={e.ranges} label={dayLabel(e.date)} onChange={(ranges) => setException(e.date, { date: e.date, ranges })} />
                )}
              </Box>
              <Tooltip title="Retirer l’exception">
                <IconButton aria-label={`Retirer l’exception du ${dayLabel(e.date)}`} onClick={() => setDraft((d) => ({ ...d, exceptions: d.exceptions.filter((x) => x.date !== e.date) }))} sx={{ width: 44, height: 44 }}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField type="date" size="small" label="Date" value={newDate} onChange={(ev) => setNewDate(ev.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <Button variant="outlined" startIcon={<EventBusyIcon />} disabled={!newDate} onClick={() => addException(true)} sx={{ minHeight: 44 }}>Fermer ce jour</Button>
            <Button variant="outlined" startIcon={<ScheduleIcon />} disabled={!newDate} onClick={() => addException(false)} sx={{ minHeight: 44 }}>Horaires différents</Button>
          </Box>
        </Box>
      </Section>
    </StudioPage>
  );
}
