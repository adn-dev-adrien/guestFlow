/**
 * Infos du logement — the lodging's own facts (rules 11ter, 11quater, 48): in the app or not, its name (GuestFlow's,
 * read live), its hero photo, its wifi (one source for the wifi tile and the booklet's wifi block) and its emergency
 * contacts. Saved with the bar.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, IconButton, Link, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import StudioPage from '../components/StudioPage';
import Section from '../components/Section';
import MediaPicker from '../components/MediaPicker';
import PhonePreview from '../components/PhonePreview';
import { GUESTFLOW_LINKS } from '../constants/studio';
import { useLoad } from '../hooks/useLoad';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { usePreviewLang } from '../hooks/usePreviewLang';
import { homeView } from '../utils/previewViews';
import { api } from '../services/api';

const MAX_CONTACTS = 10;
const formOf = (config) => ({
  enabled: config.enabled,
  heroMediaId: config.heroMediaId || null,
  wifi: {
    available: config.wifi.available, network: config.wifi.network || '', password: config.wifi.password || '', note: config.wifi.note || '',
  },
  contacts: (config.contacts || []).map((c) => ({ name: c.name || '', role: c.role || '', phone: c.phone || '' })),
});
const payloadOf = (form) => ({
  enabled: form.enabled,
  heroMediaId: form.heroMediaId,
  wifi: form.wifi,
  contacts: form.contacts.map((c) => Object.fromEntries(Object.entries({ name: c.name.trim(), role: c.role.trim(), phone: c.phone.trim() }).filter(([k, v]) => k === 'name' || v))),
});

export default function LodgingInfoPage({ lodging, onLodgingChange }) {
  const id = lodging.propertyId;
  const data = useLoad(() => Promise.all([api.lodging(id), api.settings(), api.media()]).then(([config, settings, media]) => ({ config, settings, media })), [id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lang, setLang] = usePreviewLang();

  const saved = data.data ? formOf(data.data.config) : null;
  useEffect(() => { if (data.data) setForm(formOf(data.data.config)); }, [data.data]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  useDirtyGuard(dirty);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setWifi = (patch) => setForm((f) => ({ ...f, wifi: { ...f.wifi, ...patch } }));
  const setContact = (index, patch) => setForm((f) => ({ ...f, contacts: f.contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = await api.saveLodging(id, payloadOf(form));
      data.setData((d) => ({ ...d, config }));
      onLodgingChange({ enabled: config.enabled, hasLodgingCode: config.hasLodgingCode, stateLabel: config.enabled ? null : 'Hors application' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const view = useMemo(() => (form && data.data ? homeView({
    lodgingName: lodging.name, modules: data.data.config.modules, heroMediaId: form.heroMediaId, media: data.data.media, settings: data.data.settings, lang,
  }) : null), [form, data.data, lodging.name, lang]);

  const bar = (
    <PageActionBar
      title="Infos du logement"
      subtitle={<Chip size="small" label={lodging.name} />}
      onSave={save}
      saveDisabled={!dirty || busy}
      saveBusy={busy}
      onCancel={() => { setForm(saved); setError(null); }}
      cancelDisabled={!dirty || busy}
    />
  );
  if (!form) {
    return <StudioPage bar={bar}>{data.error ? <ErrorAlert message={data.error.message} onRetry={data.reload} /> : <LoadingState />}</StudioPage>;
  }
  return (
    <StudioPage
      bar={bar}
      preview={<PhonePreview view={view} title={`Aperçu · ${lodging.name}`} caption="Ce que verront les clients après « Enregistrer »." lang={lang} onLang={setLang} />}
    >
      {error ? <ErrorAlert message={error} /> : null}
      <Section
        id="enabled"
        title="Application clients pour ce logement"
        description={form.enabled
          ? 'Ses clients ouvrent l’app avec leur lien de séjour ou le QR du logement.'
          : 'Coupée : le QR du logement ne mène plus à l’app, et « Retrouver mon séjour » ne trouve plus ses séjours.'}
        action={<Switch checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} slotProps={{ input: { 'aria-label': `Application clients pour ${lodging.name}` } }} />}
      />
      <Section id="presentation" title="Présentation">
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Nom</Typography>
            <Typography sx={{ fontWeight: 600, mb: 1 }}>{lodging.name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Le nom du logement dans GuestFlow. <Link href={GUESTFLOW_LINKS.properties} target="_blank" rel="noopener">Modifier dans GuestFlow</Link>
            </Typography>
          </Box>
          <MediaPicker
            label="Photo d’accueil"
            mediaId={form.heroMediaId}
            media={data.data.media}
            onChange={(heroMediaId) => set({ heroMediaId })}
            ratio="4:5"
            helperText="4:5 sur téléphone, 16:9 sur ordinateur. Sans photo : la vue aérienne du domaine."
          />
        </Box>
      </Section>
      <Section
        id="wifi"
        title="Wifi"
        description="Une seule source : la tuile Wifi et le bloc wifi du livret lisent ces champs."
        action={<Switch checked={form.wifi.available} onChange={(e) => setWifi({ available: e.target.checked })} slotProps={{ input: { 'aria-label': 'Wifi disponible' } }} />}
      >
        {form.wifi.available ? (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField label="Nom du réseau" required value={form.wifi.network} onChange={(e) => setWifi({ network: e.target.value })} slotProps={{ htmlInput: { maxLength: 64, autoCapitalize: 'off', spellCheck: false } }} />
            <TextField label="Mot de passe" value={form.wifi.password} onChange={(e) => setWifi({ password: e.target.value })} helperText={`${form.wifi.password.length}/128`} slotProps={{ htmlInput: { maxLength: 128, autoCapitalize: 'off', autoComplete: 'off', spellCheck: false } }} />
            <TextField label="Précision (facultatif)" placeholder="Wifi seulement dans la pièce principale" value={form.wifi.note} onChange={(e) => setWifi({ note: e.target.value })} helperText={`${form.wifi.note.length}/200`} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Pas de wifi : pas de tuile Wifi, et le livret affiche le message « Pas de wifi ».</Typography>
        )}
      </Section>
      <Section
        id="contacts"
        title="Contacts d’urgence"
        action={(
          <Button variant="outlined" startIcon={<AddIcon />} disabled={form.contacts.length >= MAX_CONTACTS} onClick={() => set({ contacts: [...form.contacts, { name: '', role: '', phone: '' }] })} sx={{ minHeight: 44 }}>
            Ajouter
          </Button>
        )}
      >
        {!form.contacts.length ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>Aucun contact : la tuile Urgences ne s’affiche pas.</Typography> : null}
        {form.contacts.map((c, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Box key={i} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 44px', sm: '1fr 1fr 1fr 44px' }, alignItems: 'start' }}>
            <TextField label="Nom" required value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} sx={{ gridColumn: { xs: '1', sm: 'auto' } }} />
            <TextField label="Rôle" value={c.role} onChange={(e) => setContact(i, { role: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} sx={{ gridColumn: { xs: '1', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' } }} />
            <TextField label="Téléphone" type="tel" value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} slotProps={{ htmlInput: { maxLength: 30, inputMode: 'tel' } }} sx={{ gridColumn: { xs: '1', sm: 'auto' }, gridRow: { xs: 3, sm: 'auto' } }} />
            <Tooltip title="Retirer ce contact">
              <IconButton aria-label={`Retirer ${c.name || 'ce contact'}`} color="error" onClick={() => set({ contacts: form.contacts.filter((_, j) => j !== i) })} sx={{ width: 44, height: 44, border: 1, borderColor: 'error.main', mt: 0.5, gridColumn: { xs: 2, sm: 'auto' }, gridRow: { xs: 1, sm: 'auto' } }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Section>
    </StudioPage>
  );
}
