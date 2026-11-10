/**
 * Application — the settings every lodging shares (rules 15, 15bis, 37, 48, 52): the app's name, its address,
 * Soliomap (address, « Intégrer dans l'app »), the order ceiling; « Synchroniser » for the only data read from
 * outside GuestFlow (Soliomap's events); and each lodging's QR code — the A4 poster, « Régénérer ».
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControlLabel, InputAdornment, Switch, TextField, Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import ConfirmDialog from '@guestflow/components/ConfirmDialog';
import StatusBadge from '@guestflow/components/StatusBadge';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { api } from '../services/api';

const FIELDS = ['appName', 'guestHost', 'soliomapUrl', 'soliomapEmbed', 'maxOrderTotal'];
const formOf = (s) => Object.fromEntries(FIELDS.map((f) => [f, s[f]]));

export default function SettingsPage({ lodgings, onLodgingChange }) {
  const settings = useLoad(() => api.settings(), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [regenerate, setRegenerate] = useState(null);

  const saved = settings.data ? formOf(settings.data) : null;
  useEffect(() => { if (settings.data) setForm(formOf(settings.data)); }, [settings.data]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  useDirtyGuard(dirty);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const act = async (work, message) => {
    setError(null);
    setNotice(null);
    try {
      await work();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async () => {
    setBusy(true);
    // An emptied ceiling is sent as null, which the server reads as its default (500 €) — never `Number('')`, 0.
    const value = (f) => (f !== 'maxOrderTotal' ? form[f] : form[f] === '' || form[f] === null ? null : Number(form[f]));
    const patch = Object.fromEntries(FIELDS.filter((f) => form[f] !== saved[f]).map((f) => [f, value(f)]));
    await act(async () => settings.setData(await api.saveSettings(patch)), 'Réglages enregistrés.');
    setBusy(false);
  };

  const sync = async () => {
    setSyncing(true);
    await act(async () => {
      const soliomap = await api.syncSoliomap();
      settings.setData((s) => ({ ...s, soliomap }));
    });
    setSyncing(false);
  };

  const regenerateQr = async () => {
    const lodging = regenerate;
    setRegenerate(null);
    await act(async () => {
      const view = await api.regenerateQr(lodging.propertyId);
      onLodgingChange(lodging.propertyId, { hasLodgingCode: view.hasLodgingCode });
    }, `Nouveau QR pour ${lodging.name} : nouvelle affiche à imprimer, l’ancienne ne mène plus à l’app.`);
  };

  const bar = (
    <PageActionBar
      title="Application"
      subtitle={<Chip size="small" label="Tous les logements" />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setForm(saved); setError(null); }}
      cancelDisabled={!dirty || busy}
    />
  );
  if (!form) return <StudioPage bar={bar}>{settings.error ? <ErrorAlert message={settings.error.message} onRetry={settings.reload} /> : <LoadingState />}</StudioPage>;
  const soliomap = settings.data.soliomap || {};
  const hostMissing = !settings.data.guestHost;

  return (
    <StudioPage bar={bar}>
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
      <Section id="app">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <TextField label="Nom de l’app" value={form.appName} onChange={(e) => set({ appName: e.target.value })} helperText="Écran d’accueil du téléphone et en-tête." slotProps={{ htmlInput: { maxLength: 40 } }} />
          <TextField label="Adresse de l’app clients" value={form.guestHost} onChange={(e) => set({ guestHost: e.target.value })} placeholder="sejour.domainesolio.com" helperText="Le nom d’hôte seul, sans https://. Les liens de séjour et les QR la reprennent." slotProps={{ htmlInput: { autoCapitalize: 'off', spellCheck: false, inputMode: 'url' } }} />
          <TextField label="Adresse de Soliomap" value={form.soliomapUrl} onChange={(e) => set({ soliomapUrl: e.target.value })} placeholder="https://map.domainesolio.com" slotProps={{ htmlInput: { autoCapitalize: 'off', spellCheck: false, inputMode: 'url' } }} />
          <Box>
            <FormControlLabel control={<Switch checked={Boolean(form.soliomapEmbed)} onChange={(e) => set({ soliomapEmbed: e.target.checked })} />} label="Intégrer dans l’app" />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Seulement si Soliomap autorise l’adresse de l’app. Coupé : la tuile et la suggestion ouvrent Soliomap dans un nouvel onglet.
            </Typography>
          </Box>
          <TextField
            label="Montant maximal d’une commande"
            type="number"
            value={form.maxOrderTotal}
            onChange={(e) => set({ maxOrderTotal: e.target.value === '' ? '' : Number(e.target.value) })}
            slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' }, input: { endAdornment: <InputAdornment position="end">€</InputAdornment> } }}
          />
        </Box>
      </Section>

      <Section
        id="data"
        title="Données de GuestFlow et de Soliomap"
        description="Logements, noms, articles, prix et stock sont lus dans GuestFlow à chaque ouverture : rien à synchroniser. Seul le fil d’événements de Soliomap est gardé une heure."
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<SyncIcon />} disabled={syncing || !settings.data.soliomapUrl} onClick={sync} sx={{ minHeight: 44 }}>
            {syncing ? 'Synchronisation…' : 'Synchroniser'}
          </Button>
          <Typography variant="body2" sx={{ color: soliomap.ok === false ? 'error.main' : 'text.secondary' }} aria-live="polite">
            {settings.data.soliomapUrl ? soliomap.syncedLabel : 'Il manque l’adresse de Soliomap.'}
            {soliomap.ok && soliomap.count !== null && soliomap.count !== undefined ? ` · ${soliomap.count} événement${soliomap.count > 1 ? 's' : ''}` : ''}
          </Typography>
        </Box>
      </Section>

      {lodgings.map((l) => (
        <Section
          key={l.propertyId}
          id={`qr-${l.propertyId}`}
          title={`QR code · ${l.name}`}
          description={l.enabled ? 'Il ouvre l’app sur ce logement, en mode visiteur. Le régénérer rend l’ancien inutilisable immédiatement.' : 'Ce logement est hors de l’application : il n’a pas de QR.'}
        >
          {l.enabled ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant="outlined"
                startIcon={<PrintOutlinedIcon />}
                component="a"
                href={api.qrPosterUrl(l.propertyId)}
                disabled={hostMissing}
                sx={{ minHeight: 44 }}
              >
                Imprimer l’affiche (PDF)
              </Button>
              <Button variant="outlined" color="error" startIcon={<AutorenewIcon />} onClick={() => setRegenerate(l)} sx={{ minHeight: 44 }}>Régénérer</Button>
              {hostMissing ? <StatusBadge status="warning" label="Adresse de l’app à renseigner pour imprimer l’affiche" /> : null}
            </Box>
          ) : <StatusBadge status="neutral" label="Hors application" />}
        </Section>
      ))}

      <ConfirmDialog
        open={Boolean(regenerate)}
        onClose={() => setRegenerate(null)}
        onConfirm={regenerateQr}
        title={regenerate ? `Régénérer le QR de ${regenerate.name} ?` : ''}
        message="L’affiche imprimée ne mènera plus à l’app : il faudra imprimer et poser la nouvelle. Les clients déjà dans l’app ne sont pas déconnectés."
        confirmLabel="Régénérer"
      />
    </StudioPage>
  );
}
