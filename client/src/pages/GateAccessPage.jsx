/**
 * GateAccessPage — Réglages › Accès portail (specs/gate-access-portier.md §3.4-§3.5, §6).
 *
 * Every gate access — the stays guestFlow pushes and the owner's own — is kept by Portier and shown
 * here, behind guestFlow's login, to admins only. The list is the one validated on 2026-09-14
 * (specs/guest-gate-access-maquettes.html) without « Révoquer ce téléphone », with the two key actions of
 * specs/gate-access-portier.html: « Nouvelle invitation » and « Régénérer l'accès », each saying what it
 * does before it is confirmed.
 *
 * Portier is read when the page is displayed and when it comes back to the foreground — never on a
 * timer. When Portier does not answer the page says so and shows nothing cached as current. Every
 * sentence (validity, hours, last use, confirmations, house line) comes from the server; the editors
 * only compare the server's wall-clock strings to refuse while typing (utils/gateAccessValidation.js).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert, Box, Button, Card, CardContent, FormControl, FormControlLabel, InputLabel, MenuItem, Radio,
  RadioGroup, Select, Stack, Tab, TableCell, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PageActionBar from '../components/PageActionBar';
import ResponsiveTable from '../components/ResponsiveTable';
import StatusBadge from '../components/StatusBadge';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/DialogProvider';
import api from '../api';
import { manualAccessErrors, stayOverridesErrors, hasErrors } from '../utils/gateAccessValidation';

const VIEWS = [
  ['current', 'En service et à venir'],
  ['active', 'Actifs seulement'],
  ['suspended', 'Suspendus seulement'],
  ['finished', 'Séjours terminés (7 derniers jours)'],
];
const KINDS = [['all', 'Tous les accès'], ['mine', 'Créés par moi'], ['guestflow', 'Créés par guestFlow']];
const STATE_BADGE = { before: 'neutral', active: 'success', suspended: 'warning', revoked: 'error', after: 'neutral' };
const LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TOUCH = { minHeight: { xs: 44, sm: 32 } };
const PANEL_BG = (theme) => theme.palette.warning.soft;

// ── Editor fields ──────────────────────────────────────────────────────────────────────────────

/** A date and a time, as the server's `YYYY-MM-DDTHH:MM`. A date alone takes 11:00. */
function DateTimeField({ label, value, onChange }) {
  const [date = '', time = ''] = value ? value.split('T') : [];
  const change = (nextDate, nextTime) => onChange(nextDate ? `${nextDate}T${nextTime || '11:00'}` : '');
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{label}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField type="date" size="small" value={date} onChange={(e) => change(e.target.value, time)} slotProps={{ htmlInput: { 'aria-label': `${label} — date` } }} />
        <TextField type="time" size="small" value={time} onChange={(e) => change(date, e.target.value)} disabled={!date} slotProps={{ htmlInput: { 'aria-label': `${label} — heure` } }} />
        <Button size="small" onClick={() => onChange('')} disabled={!value} sx={TOUCH}>Effacer</Button>
      </Stack>
    </Box>
  );
}

function TimeWindowsEditor({ windows, onChange }) {
  const set = (index, key, value) => onChange(windows.map((w, i) => (i === index ? { ...w, [key]: value } : w)));
  return (
    <Stack spacing={1}>
      {windows.map((w, index) => (
        // eslint-disable-next-line react/no-array-index-key -- rows have no identity but their position
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField type="time" size="small" value={w.from} onChange={(e) => set(index, 'from', e.target.value)} slotProps={{ htmlInput: { 'aria-label': `Plage ${index + 1} — début` } }} />
          <Typography color="text.secondary">→</Typography>
          <TextField type="time" size="small" value={w.until} onChange={(e) => set(index, 'until', e.target.value)} slotProps={{ htmlInput: { 'aria-label': `Plage ${index + 1} — fin` } }} />
          <Button size="small" onClick={() => onChange(windows.filter((_, i) => i !== index))} sx={TOUCH}>Retirer</Button>
        </Stack>
      ))}
      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...windows, { from: '08:00', until: '20:00' }])} sx={TOUCH}>
          Ajouter une plage
        </Button>
      </Box>
    </Stack>
  );
}

const FieldError = ({ children }) => (children ? <Typography variant="body2" color="error">{children}</Typography> : null);

function ValidityFields({ draft, setDraft, errors, name }) {
  return (
    <Stack spacing={1}>
      <RadioGroup row name={name} value={draft.ranged ? 'range' : 'always'} onChange={(e) => setDraft({ ...draft, ranged: e.target.value === 'range' })}>
        <FormControlLabel value="always" control={<Radio />} label="Toujours valable" />
        <FormControlLabel value="range" control={<Radio />} label="Sur une plage de dates" />
      </RadioGroup>
      {draft.ranged ? (
        <Stack spacing={1.5}>
          <DateTimeField label="Du" value={draft.validFrom} onChange={(v) => setDraft({ ...draft, validFrom: v })} />
          <DateTimeField label="Au" value={draft.validUntil} onChange={(v) => setDraft({ ...draft, validUntil: v })} />
        </Stack>
      ) : null}
      <FieldError>{errors.range}</FieldError>
    </Stack>
  );
}

function EditorActions({ saveLabel, onSave, disabled, onCancel }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <Button variant="contained" onClick={onSave} disabled={disabled} sx={TOUCH}>{saveLabel}</Button>
      <Button onClick={onCancel} sx={TOUCH}>Annuler</Button>
    </Stack>
  );
}

function useSave(run, onSaved) {
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState('');
  const save = async () => {
    setSaving(true);
    setRefusal('');
    try {
      await run();
      onSaved();
    } catch (err) {
      setRefusal(err?.message || "Portier n'a pas enregistré la modification.");
    } finally {
      setSaving(false);
    }
  };
  return { saving, refusal, save };
}

function StayEditor({ access, onSaved, onCancel }) {
  const { showSuccess } = useToast();
  const [draft, setDraft] = useState({
    earlyFrom: access.edit.earlyFrom, extendedUntil: access.edit.extendedUntil, timeWindows: access.edit.timeWindows,
  });
  const errors = stayOverridesErrors({ ...draft, stayFrom: access.edit.stayFrom, stayUntil: access.edit.stayUntil });
  const { saving, refusal, save } = useSave(async () => {
    await api.updatePortierAccess(access.id, draft);
    showSuccess(`« ${access.label} » enregistré.`);
  }, onSaved);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {access.edit.stayLabel} Ces deux bornes viennent de la réservation : si vous la modifiez, la ligne suit.
      </Typography>
      <DateTimeField label="Ouvrir dès (facultatif)" value={draft.earlyFrom} onChange={(v) => setDraft({ ...draft, earlyFrom: v })} />
      <FieldError>{errors.early}</FieldError>
      <DateTimeField label="Prolonger jusqu'au (facultatif)" value={draft.extendedUntil} onChange={(v) => setDraft({ ...draft, extendedUntil: v })} />
      <FieldError>{errors.extended}</FieldError>
      <Typography variant="caption" color="text.secondary">Plages horaires de commande — tous les jours</Typography>
      <TimeWindowsEditor windows={draft.timeWindows} onChange={(timeWindows) => setDraft({ ...draft, timeWindows })} />
      <FieldError>{errors.windows}</FieldError>
      {refusal ? <Alert severity="error">{refusal}</Alert> : null}
      <EditorActions saveLabel="Enregistrer" onSave={save} disabled={saving || hasErrors(errors)} onCancel={onCancel} />
    </Stack>
  );
}

function ManualEditor({ access, onSaved, onCancel }) {
  const { showSuccess } = useToast();
  const [draft, setDraft] = useState({
    ranged: Boolean(access.edit.validFrom || access.edit.validUntil),
    validFrom: access.edit.validFrom,
    validUntil: access.edit.validUntil,
    timeWindows: access.edit.timeWindows,
  });
  const errors = manualAccessErrors({ label: access.label, ...draft });
  const { saving, refusal, save } = useSave(async () => {
    await api.updatePortierAccess(access.id, {
      validFrom: draft.ranged ? draft.validFrom : null,
      validUntil: draft.ranged ? draft.validUntil : null,
      timeWindows: draft.timeWindows,
    });
    showSuccess(`« ${access.label} » enregistré.`);
  }, onSaved);
  return (
    <Stack spacing={2}>
      <ValidityFields draft={draft} setDraft={setDraft} errors={errors} name={`validity-${access.id}`} />
      <Typography variant="caption" color="text.secondary">Plages horaires de commande — tous les jours</Typography>
      <TimeWindowsEditor windows={draft.timeWindows} onChange={(timeWindows) => setDraft({ ...draft, timeWindows })} />
      <FieldError>{errors.windows}</FieldError>
      {refusal ? <Alert severity="error">{refusal}</Alert> : null}
      <EditorActions saveLabel="Enregistrer" onSave={save} disabled={saving || hasErrors(errors)} onCancel={onCancel} />
    </Stack>
  );
}

function CreateAccessForm({ onCreated, onCancel }) {
  const { showSuccess } = useToast();
  const [draft, setDraft] = useState({ label: '', ranged: false, validFrom: '', validUntil: '', timeWindows: [] });
  const errors = manualAccessErrors(draft);
  const { saving, refusal, save } = useSave(async () => {
    await api.createPortierAccess({
      label: draft.label.trim(),
      validFrom: draft.ranged ? draft.validFrom : null,
      validUntil: draft.ranged ? draft.validUntil : null,
      timeWindows: draft.timeWindows,
    });
    showSuccess('Nouvel accès créé. Il porte l’étiquette « créé par moi », et il se modifie comme les autres.');
  }, onCreated);
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="sectionHeader">Créer un accès à la main</Typography>
          <TextField
            label="Pour qui"
            placeholder="Paul (voisin), Mamie, le facteur…"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            size="small"
            error={Boolean(errors.label)}
            helperText={errors.label || ' '}
            sx={{ maxWidth: 420 }}
          />
          <Typography variant="caption" color="text.secondary">Validité</Typography>
          <ValidityFields draft={draft} setDraft={setDraft} errors={errors} name="validity-new" />
          <Typography variant="caption" color="text.secondary">Plages horaires de commande — facultatif</Typography>
          <Typography variant="body2" color="text.secondary">
            Hors de ces plages, le bouton refuse et dit pourquoi. Sans plage, l&apos;accès commande à toute heure.
          </Typography>
          <TimeWindowsEditor windows={draft.timeWindows} onChange={(timeWindows) => setDraft({ ...draft, timeWindows })} />
          <FieldError>{errors.windows}</FieldError>
          {refusal ? <Alert severity="error">{refusal}</Alert> : null}
          <EditorActions saveLabel="Créer l'accès" onSave={save} disabled={saving || hasErrors(errors)} onCancel={onCancel} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function AccessJournal({ accessId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.getPortierAccessEvents(accessId)
      .then((res) => { if (alive) setEvents(res.events || []); })
      .catch((err) => { if (alive) setError(err?.message || 'Portier ne répond pas.'); });
    return () => { alive = false; };
  }, [accessId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!events) return <LoadingState variant="skeleton" rows={2} />;
  if (events.length === 0) return <Typography variant="body2" color="text.secondary">Rien encore.</Typography>;
  return (
    <Stack spacing={0.5}>
      {events.map((event) => (
        <Box key={event.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '8rem 1fr' }, columnGap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{event.at}</Typography>
          <Typography variant="body2">{event.text}{event.who ? ` — ${event.who}` : ''}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

// ── A row, its actions and what they open ─────────────────────────────────────────────────────

const CONFIRMED = {
  invite: {
    run: (access) => api.portierAccessAction(access.id, 'invite'),
    done: (res, access) => `Nouvelle invitation : le code de « ${access.label} » devient ${res.access.code}. Les téléphones installés continuent.`,
  },
  regenerate: {
    run: (access) => api.portierAccessAction(access.id, 'regenerate'),
    done: (res, access) => `Accès « ${access.label} » régénéré : nouveau code ${res.access.code}.`,
  },
  remove: {
    run: (access) => api.deletePortierAccess(access.id),
    done: (_res, access) => `« ${access.label} » supprimé.`,
  },
};

function ConfirmPanel({ access, action, onDone, onCancel }) {
  const { showSuccess, showError } = useToast();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      const res = await CONFIRMED[action].run(access);
      showSuccess(CONFIRMED[action].done(res, access));
    } catch (err) {
      showError(err?.message || 'Portier a refusé la demande.');
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">{access.confirm[action]}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="contained" color={action === 'invite' ? 'primary' : 'error'} onClick={confirm} disabled={busy} sx={TOUCH}>Confirmer</Button>
        <Button onClick={onCancel} disabled={busy} sx={TOUCH}>Annuler</Button>
      </Stack>
    </Stack>
  );
}

function AccessPanel({ access, mode, onDone, onCancel }) {
  if (mode === 'journal') return <AccessJournal accessId={access.id} />;
  if (mode === 'edit') {
    return access.kind === 'stay'
      ? <StayEditor access={access} onSaved={onDone} onCancel={onCancel} />
      : <ManualEditor access={access} onSaved={onDone} onCancel={onCancel} />;
  }
  return <ConfirmPanel access={access} action={mode} onDone={onDone} onCancel={onCancel} />;
}

function AccessIdentity({ access }) {
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{access.label}</Typography>
        <StatusBadge status={access.tag.key === 'guestflow' ? 'info' : 'neutral'} label={access.tag.label} />
        <StatusBadge status={STATE_BADGE[access.state] || 'neutral'} label={access.stateLabel} />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {access.subtitle}{access.code ? ` · code ${access.code}` : ''}
      </Typography>
    </Stack>
  );
}

function AccessActions({ access, openMode, onOpen, onToggleSuspend, busy }) {
  const buttons = [];
  if (access.actions.edit) buttons.push(['edit', openMode === 'edit' ? 'Fermer' : 'Modifier']);
  if (access.actions.invite) buttons.push(['invite', 'Nouvelle invitation']);
  if (access.actions.regenerate) buttons.push(['regenerate', "Régénérer l'accès", 'error']);
  if (access.actions.suspend) buttons.push(['suspend', 'Suspendre']);
  if (access.actions.resume) buttons.push(['resume', 'Reprendre']);
  if (access.actions.remove) buttons.push(['remove', 'Supprimer', 'error']);
  buttons.push(['journal', openMode === 'journal' ? 'Fermer le journal' : 'Journal']);
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {buttons.map(([key, label, color]) => (
        <Button
          key={key}
          size="small"
          variant="outlined"
          color={color || 'primary'}
          disabled={busy}
          sx={TOUCH}
          onClick={() => (key === 'suspend' || key === 'resume' ? onToggleSuspend(access, key) : onOpen(access, key))}
        >
          {label}
        </Button>
      ))}
    </Stack>
  );
}

// ── The « Application des clients » tab ───────────────────────────────────────────────────────

function BrandingTab({ branding, error, onRetry, source, onSource, fileError, onFile, previewUrl }) {
  if (error) return <ErrorAlert message={error} onRetry={onRetry} />;
  if (!branding) return <LoadingState variant="skeleton" rows={3} />;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="sectionHeader">Logo de l&apos;application</Typography>
          <RadioGroup name="branding-source" value={source} onChange={(e) => onSource(e.target.value)}>
            <FormControlLabel value="guestflow" control={<Radio />} label="Logo de guestFlow (synchronisé)" />
            <Typography variant="caption" color="text.secondary" sx={{ pl: 4, mt: -0.5, mb: 1 }}>{branding.syncLabel}</Typography>
            <FormControlLabel value="custom" control={<Radio />} label="Logo personnalisé" />
            {branding.customLabel ? (
              <Typography variant="caption" color="text.secondary" sx={{ pl: 4, mt: -0.5 }}>{branding.customLabel}</Typography>
            ) : null}
          </RadioGroup>
          <Stack spacing={1} sx={{ pl: { xs: 0, sm: 4 } }}>
            <Box>
              <Button component="label" variant="outlined" disabled={source !== 'custom'} sx={TOUCH}>
                Choisir un fichier
                <input hidden type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={onFile} aria-label="Logo personnalisé" />
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              PNG, SVG ou JPEG ; 2 Mo au plus ; au moins 512 × 512 px pour une image PNG ou JPEG.
            </Typography>
            <FieldError>{fileError}</FieldError>
            {previewUrl ? (
              <Box component="img" src={previewUrl} alt="Aperçu du logo" sx={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 3 }} />
            ) : null}
          </Stack>
          <Alert severity="warning">
            Un iPhone qui a déjà installé l&apos;application garde l&apos;ancienne icône. Réglez le logo avant l&apos;arrivée des premiers clients.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────

export default function GateAccessPage() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('access');
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState('accesses');

  const [view, setView] = useState('current');
  const [kind, setKind] = useState('all');
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [branding, setBranding] = useState(null);
  const [brandingError, setBrandingError] = useState('');
  const [source, setSource] = useState('guestflow');
  const [logoFile, setLogoFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [savingBranding, setSavingBranding] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setList(await api.getPortierAccesses({ view, kind }));
      setListError(null);
    } catch (err) {
      // Nothing cached is shown as current (§3.4): a failed read empties the list.
      setList(null);
      setListError({ status: err?.status, message: err?.message || 'Portier ne répond pas.' });
    }
  }, [view, kind]);

  const loadBranding = useCallback(async () => {
    try {
      const res = await api.getPortierBranding();
      setBranding(res.branding);
      setSource(res.branding.source);
      setBrandingError('');
    } catch (err) {
      setBranding(null);
      setBrandingError(err?.message || 'Portier ne répond pas.');
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (tab === 'app') loadBranding(); }, [tab, loadBranding]);

  // Back to the foreground → read Portier again. No timer runs while the page sits in a tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (tab === 'app') loadBranding();
      else loadList();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [tab, loadList, loadBranding]);

  useEffect(() => {
    if (!highlightId || !list) return;
    const row = document.getElementById(`access-${highlightId}`);
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
  }, [highlightId, list]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const onOpen = (access, mode) => setOpen((current) => (current && current.id === access.id && current.mode === mode ? null : { id: access.id, mode }));
  const closePanel = () => setOpen(null);
  const afterPanel = () => { setOpen(null); loadList(); };

  const onToggleSuspend = async (access, action) => {
    setBusyId(access.id);
    try {
      await api.portierAccessAction(access.id, action);
      showSuccess(action === 'suspend'
        ? `« ${access.label} » suspendu : le code survit, réactivable d'un clic.`
        : `« ${access.label} » repris, même code.`);
    } catch (err) {
      showError(err?.message || 'Portier a refusé la demande.');
    } finally {
      setBusyId(null);
      loadList();
    }
  };

  const onLogoFile = (event) => {
    const file = event.target.files && event.target.files[0];
    setFileError('');
    setLogoFile(null);
    setPreviewUrl('');
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setFileError('Refusé : PNG, SVG ou JPEG seulement.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setFileError('Refusé : 2 Mo au plus.'); return; }
    const url = URL.createObjectURL(file);
    if (file.type === 'image/svg+xml') { setLogoFile(file); setPreviewUrl(url); return; }
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth < 512 || probe.naturalHeight < 512) {
        setFileError(`Refusé : au moins 512 × 512 px (${probe.naturalWidth} × ${probe.naturalHeight} reçu).`);
        URL.revokeObjectURL(url);
        return;
      }
      setLogoFile(file);
      setPreviewUrl(url);
    };
    probe.onerror = () => { setFileError("Refusé : l'image est illisible."); URL.revokeObjectURL(url); };
    probe.src = url;
  };

  const brandingDirty = Boolean(branding) && (source !== branding.source || (source === 'custom' && Boolean(logoFile)));
  const brandingSavable = brandingDirty && !(source === 'custom' && !logoFile);

  const saveBranding = async () => {
    setSavingBranding(true);
    try {
      const form = new FormData();
      form.append('source', source);
      if (source === 'custom' && logoFile) form.append('logo', logoFile);
      const res = await api.setPortierBrandingSource(form);
      setBranding(res.branding);
      setSource(res.branding.source);
      setLogoFile(null);
      showSuccess("Logo de l'application enregistré.");
    } catch (err) {
      showError(err?.message || "Portier n'a pas enregistré le logo.");
    } finally {
      setSavingBranding(false);
    }
  };

  const head = (
    <TableRow>
      {['Accès', 'Validité', 'Heures', 'Téléphones', 'Dernier usage', 'Actions'].map((h) => (
        <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>
      ))}
    </TableRow>
  );

  const panelFor = (access) => (open && open.id === access.id
    ? <AccessPanel access={access} mode={open.mode} onDone={afterPanel} onCancel={closePanel} />
    : null);

  const renderRow = (access) => (
    <React.Fragment key={access.id}>
      <TableRow id={`access-${access.id}`} selected={highlightId === access.id} sx={access.state === 'suspended' ? { bgcolor: 'action.hover' } : undefined}>
        <TableCell sx={{ minWidth: 220 }}><AccessIdentity access={access} /></TableCell>
        <TableCell>
          {access.validity}
          {access.note ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{access.note}</Typography> : null}
        </TableCell>
        <TableCell>{access.hours}</TableCell>
        <TableCell>{access.phones}</TableCell>
        <TableCell>{access.lastUse}</TableCell>
        <TableCell sx={{ minWidth: 280 }}>
          <AccessActions access={access} openMode={open && open.id === access.id ? open.mode : null} onOpen={onOpen} onToggleSuspend={onToggleSuspend} busy={busyId === access.id} />
        </TableCell>
      </TableRow>
      {open && open.id === access.id ? (
        <TableRow>
          <TableCell colSpan={6} sx={{ bgcolor: PANEL_BG }}>{panelFor(access)}</TableCell>
        </TableRow>
      ) : null}
    </React.Fragment>
  );

  const renderMobileCard = (access) => (
    <Stack spacing={1} id={`access-${access.id}`}>
      <AccessIdentity access={access} />
      <Typography variant="body2">{access.validity}</Typography>
      <Typography variant="body2" color="text.secondary">
        {access.hours} · {access.phonesLabel} · dernier usage : {access.lastUse}
      </Typography>
      {access.note ? <Typography variant="caption" color="text.secondary">{access.note}</Typography> : null}
      <AccessActions access={access} openMode={open && open.id === access.id ? open.mode : null} onOpen={onOpen} onToggleSuspend={onToggleSuspend} busy={busyId === access.id} />
      {open && open.id === access.id ? <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: PANEL_BG }}>{panelFor(access)}</Box> : null}
    </Stack>
  );

  return (
    <Box>
      <PageActionBar
        title="Accès portail"
        titleOnXs
        actionsBefore={[{
          icon: <RefreshIcon />,
          tooltip: 'Relire Portier',
          onClick: () => (tab === 'app' ? loadBranding() : loadList()),
          color: 'info',
        }]}
        onSave={tab === 'app' ? saveBranding : undefined}
        saveDisabled={!brandingSavable || savingBranding}
        saveBusy={savingBranding}
        saveTooltip="Enregistrer le logo"
      />

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile sx={{ mt: 1, mb: 2 }}>
        <Tab value="accesses" label="Accès" />
        <Tab value="app" label="Application des clients" />
      </Tabs>

      {tab === 'app' ? (
        <BrandingTab
          branding={branding}
          error={brandingError}
          onRetry={loadBranding}
          source={source}
          onSource={(value) => { setSource(value); setFileError(''); }}
          fileError={fileError}
          onFile={onLogoFile}
          previewUrl={source === 'custom' ? previewUrl : ''}
        />
      ) : (
        <Stack spacing={2}>
          {list && list.house ? (
            <Typography variant="body2" sx={{ fontWeight: 600, color: list.house.up ? 'success.main' : 'error.main' }}>
              ● {list.house.text}
            </Typography>
          ) : null}
          {list && list.pushFailing ? (
            <Alert severity="warning"><strong>{list.pushFailing.text}</strong> — {list.pushFailing.detail}</Alert>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="gate-access-kind">Filtrer</InputLabel>
              <Select labelId="gate-access-kind" label="Filtrer" value={kind} onChange={(e) => { setOpen(null); setKind(e.target.value); }}>
                {KINDS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="gate-access-view">Période</InputLabel>
              <Select labelId="gate-access-view" label="Période" value={view} onChange={(e) => { setOpen(null); setView(e.target.value); }}>
                {VIEWS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)} disabled={creating} sx={{ ...TOUCH, whiteSpace: 'nowrap', flexShrink: 0 }}>
              Nouvel accès
            </Button>
          </Stack>

          {creating ? <CreateAccessForm onCreated={() => { setCreating(false); loadList(); }} onCancel={() => setCreating(false)} /> : null}

          {listError ? (
            <ErrorAlert
              message={listError.status === 503
                ? listError.message
                : `${listError.message} La liste n'est pas affichée : rien de mis en cache n'est montré comme actuel.`}
              onRetry={loadList}
            />
          ) : null}
          {!listError && !list ? <LoadingState variant="skeleton" rows={4} /> : null}
          {list && list.groups.length === 0 ? <EmptyState message="Aucun accès ne correspond à ce filtre." py={4} /> : null}
          {list ? list.groups.map((group) => (
            <Box key={group.key}>
              <Typography variant="overline" color="text.secondary" component="h2">{group.title}</Typography>
              <ResponsiveTable
                items={group.accesses}
                getKey={(access) => access.id}
                head={head}
                renderRow={renderRow}
                renderMobileCard={renderMobileCard}
                minWidth={960}
              />
            </Box>
          )) : null}
        </Stack>
      )}
    </Box>
  );
}
