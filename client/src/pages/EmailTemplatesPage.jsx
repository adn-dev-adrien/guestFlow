/**
 * EmailTemplatesPage — CRUD UI for the email templates library.
 * See specs/email-automation.md §6.1.
 *
 * The library reads in the order of the stay (specs/guest-email-texts-made-simple.md rule 44 — UI/UX
 * review 2026-10-18, decision 12): one name per email, grouped by moment, its « Quand » under it; the
 * mode shows only when it is « Auto »; a shipped email is switched off, never deleted; a shipped email
 * opens its texts. « Quand ? » is one sentence read by the server (rule 43, decision 11).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, ButtonBase, Card, Chip, Divider, IconButton, ListItemText, Menu, Typography, Switch, Button, Stack, FormControl, InputLabel,
  Select, MenuItem, TextField, FormHelperText, Link, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router';
import FormDialog from '../components/FormDialog';
import EmailPendingList from '../components/EmailPendingList';
import EmailManualSendDialog from '../components/EmailManualSendDialog';
import EmailComposeDialog from '../components/EmailComposeDialog';
import ClientFormFields from '../components/ClientFormFields';
import { Link as RouterLink } from 'react-router';
import api from '../api';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import TokenTextField from '../components/TokenTextField';
import RelativeDayField from '../components/RelativeDayField';
import StatusBadge from '../components/StatusBadge';
import { isValidEmail } from '../utils/validation';

const EMPTY_CLIENT = {
  lastName: '', firstName: '', streetNumber: '', street: '', postalCode: '',
  city: '', address: '', phone: '', email: '', notes: '',
};

const emptyTemplate = {
  id: null,
  name: '',
  subject: '',
  body: '',
  // Optional English side (specs/email-language-fr-en.md). Empty → reservation sends in French.
  subjectEn: '',
  bodyEn: '',
  dayOffset: -7,
  sendMode: 'manual',
  enabled: true,
};

// A template's own mode is the only switch for automatic sending (specs/settings-rationalization.md
// rule 17b): « Automatique » leaves by itself at 08:00, « Manuel » waits in « Emails à envoyer ».

const WHEN_DELAY_MS = 300;
const NEW_TEMPLATE_WHEN = { editable: true, anchorLabel: 'l’arrivée', days: 7, direction: 'before', sentence: 'Envoyé 7 jours avant l’arrivée' };

export default function EmailTemplatesPage() {
  // The chips of the template being edited, labelled by the server (specs/guest-email-texts-made-simple.md
  // rule 10), live plugins' included (specs/plugins-phase-1-sdk.md rule 13).
  const [chips, setChips] = useState({ variables: [], conditions: [] });
  const { confirm, alert } = useAppDialogs();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [menu, setMenu] = useState(null); // { anchorEl, row }
  // « Quand ? » as typed, and the server's reading of it (rule 43).
  const [when, setWhen] = useState({ days: '7', direction: 'before', error: '', example: '' });
  const [language, setLanguage] = useState('fr');
  const whenTimer = useRef(null);
  // Only the last reading counts: an earlier answer arriving late is dropped (rule 43).
  const whenSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplate);
  // A server refusal { field, message }, shown under the field it names.
  const [fieldError, setFieldError] = useState(null);

  const [pending, setPending] = useState([]);
  const [sending, setSending] = useState(null); // { reservationId, templateId, reservationStartDate }
  // Inline "fix missing email" — edit the client fiche from the pending list (focus the email field).
  const [fixClient, setFixClient] = useState(null);   // form data; non-null = dialog open
  const [fixClientId, setFixClientId] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const timeline = await api.getEmailTemplatesTimeline();
      setGroups(timeline.groups || []);
    } catch {
      // Silent before this sweep — a failed load rendered as an innocent empty list.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadPending = useCallback(async () => {
    try {
      const rows = await api.getPendingEmails();
      setPending(rows || []);
    } catch {
      setPending([]);
      showError("Impossible de charger les emails à envoyer.");
    }
  }, [showError]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { reloadPending(); }, [reloadPending]);

  const handlePreview = (row) => setSending({
    templateId: row.templateId,
    reservationId: row.reservationId,
    reservationStartDate: row.startDate,
    occurrenceKey: row.occurrenceKey || '',
  });

  const handleOpenReservation = (row) => navigate(`/reservations/${row.reservationId}`);

  // Clicking the "Adresse manquante" chip opens the client's fiche focused on the email field, so the
  // operator can add the missing address without leaving the page. Saving refreshes the queue.
  const handleFixEmail = async (row) => {
    if (!row.clientId) {
      await alert({ title: 'Client introuvable', message: "Impossible d'ouvrir la fiche : aucun client rattaché." });
      return;
    }
    setFixClientId(row.clientId);
    try {
      const c = await api.getClient(row.clientId);
      setFixClient({ ...EMPTY_CLIENT, ...(c || {}) });
    } catch {
      setFixClient({ ...EMPTY_CLIENT });
    }
  };

  const closeFixClient = () => { setFixClient(null); setFixClientId(null); };

  const handleSaveFixClient = async () => {
    if (!fixClient || !isValidEmail(fixClient.email)) {
      await alert({ title: 'Email invalide', message: 'Adresse email invalide.' });
      return;
    }
    const payload = {
      ...fixClient,
      address: [fixClient.streetNumber, fixClient.street].filter(Boolean).join(' ').trim(),
      phone: String(fixClient.phone || '').trim(),
    };
    try {
      await api.updateClient(fixClientId, payload);
      closeFixClient();
      await reloadPending();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || "Impossible d'enregistrer la fiche client." });
    }
  };

  const handleAcknowledge = async (row) => {
    const ok = await confirm({
      title: 'Ignorer cet email',
      message: `Marquer comme géré l'email "${row.templateName}" pour ${row.clientFullName || 'ce client'} ? Il n'apparaîtra plus dans les emails à envoyer.`,
      confirmLabel: 'Ignorer',
      confirmColor: 'warning',
    });
    if (!ok) return;
    try {
      await api.acknowledgePendingEmail({ templateId: row.templateId, reservationId: row.reservationId, occurrenceKey: row.occurrenceKey });
      await reloadPending();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible d\'acquitter l\'email.' });
    }
  };

  const handleMarkSent = async (row) => {
    const ok = await confirm({
      title: 'Marquer comme envoyé',
      message: `Confirmer que l'email "${row.templateName}" a bien été envoyé à ${row.clientFullName || 'ce client'} (par un autre canal, hors GuestFlow) ? Il sera enregistré comme envoyé et quittera la liste.`,
      confirmLabel: 'Marquer comme envoyé',
      confirmColor: 'success',
    });
    if (!ok) return;
    try {
      await api.markEmailSent({ templateId: row.templateId, reservationId: row.reservationId, occurrenceKey: row.occurrenceKey });
      await reloadPending();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de marquer l\'email comme envoyé.' });
    }
  };

  // Only the two bodies: what was typed elsewhere in the form stays.
  const readBodies = (id) => {
    api.getEmailTemplate(id)
      .then((full) => setForm((f) => (f.id === id ? { ...f, body: full.body || '', bodyEn: full.bodyEn || '', bodiesState: 'ready' } : f)))
      .catch(() => setForm((f) => (f.id === id ? { ...f, bodiesState: 'failed' } : f)));
  };

  const handleOpen = (row) => {
    whenSeq.current += 1;
    clearTimeout(whenTimer.current);
    if (row) {
      setForm({
        id: row.id,
        name: row.name || '',
        subject: row.subject || '',
        body: '',
        subjectEn: row.subjectEn || '',
        bodyEn: '',
        bodiesState: 'loading',
        dayOffset: Number(row.dayOffset || 0),
        sendMode: row.sendMode || 'manual',
        enabled: row.enabled !== 0,
        stableKey: row.stableKey,
        textsSection: row.textsSection,
        when: row.when,
        displayName: row.displayName,
      });
      setWhen({ days: String(row.when ? row.when.days : Math.abs(Number(row.dayOffset || 0))), direction: row.when ? row.when.direction : 'before', error: '', example: '' });
    } else {
      setForm({ ...emptyTemplate, when: NEW_TEMPLATE_WHEN });
      setWhen({ days: '7', direction: 'before', error: '', example: '' });
    }
    // The list carries no body (specs/inte-performance.md rule 11): both are read when the editor opens, and
    // « Enregistrer » waits for them so an empty body is never saved over a real one.
    if (row) readBodies(row.id);
    api.getEmailTemplateVariables(row ? row.id : null).then(setChips).catch(() => setChips({ variables: [], conditions: [] }));
    setOpen(true);
  };

  const handleClose = () => { setOpen(false); setFieldError(null); };

  // Rule 43 — the server reads « Envoyé [n] jours [avant|après] … », answers the example or refuses
  // under the number. « Enregistrer » waits for the reading, and the save sends the sentence itself
  // (`when`): the server stores the offset it reads, never one kept from an earlier answer.
  const changeWhen = (next) => {
    const seq = whenSeq.current + 1;
    whenSeq.current = seq;
    setWhen((w) => ({ ...w, ...next, pending: true, touched: true }));
    clearTimeout(whenTimer.current);
    whenTimer.current = setTimeout(async () => {
      try {
        const r = await api.describeTemplateWhen({ templateId: form.id || undefined, days: next.days, direction: next.direction });
        if (whenSeq.current !== seq) return;
        setWhen((w) => ({ ...w, pending: false, error: '', example: r.example || r.sentence }));
      } catch (e) {
        if (whenSeq.current !== seq) return;
        setWhen((w) => ({ ...w, pending: false, error: e.message || 'Moment invalide.', example: '' }));
      }
    }, WHEN_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(whenTimer.current), []);

  // The owner's rule: no guest email leaves without validation unless it is said, once, explicitly.
  const confirmAuto = () => confirm({
    title: 'Envoi automatique',
    message: 'Cet email partira sans validation, à sa date.',
    confirmLabel: 'Envoyer automatiquement',
    confirmColor: 'warning',
  });

  const handleSave = async () => {
    const wasAuto = Boolean(form.id) && (groups.flatMap((g) => g.templates).find((t) => t.id === form.id) || {}).sendMode === 'auto';
    if (form.sendMode === 'auto' && !wasAuto && !(await confirmAuto())) return;
    const editableWhen = !form.when || form.when.editable;
    const payload = {
      name: String(form.name || '').trim(),
      subject: String(form.subject || ''),
      body: String(form.body || ''),
      subjectEn: String(form.subjectEn || ''),
      bodyEn: String(form.bodyEn || ''),
      ...(editableWhen && (when.touched || !form.id)
        ? { when: { days: when.days, direction: when.direction } }
        : (form.id ? {} : { dayOffset: Number(form.dayOffset || 0) })),
      sendMode: form.sendMode || 'manual',
      enabled: !!form.enabled,
    };
    try {
      if (form.id) {
        await api.updateEmailTemplate(form.id, payload);
      } else {
        await api.createEmailTemplate(payload);
      }
      handleClose();
      // A template change (subject/body/offset/mode/enabled) reshapes the manual queue and
      // its rendered content → refresh both the library and the « Emails à envoyer » list.
      await Promise.all([reload(), reloadPending()]);
    } catch (e) {
      // specs/guest-email-texts-made-simple.md rules 27, 37 — a broken variable or condition is refused
      // by the server and named under its field, with the closest variable as a fix.
      if (e?.field === 'days' || e?.field === 'direction' || e?.field === 'when') {
        setWhen((w) => ({ ...w, error: e.message, example: '' }));
        return;
      }
      if (e?.field && ['subject', 'body', 'subjectEn', 'bodyEn'].includes(e.field)) {
        setFieldError({ field: e.field, message: e.message, unknown: e.unknown, suggestion: e.suggestion });
        return;
      }
      await alert({ title: 'Erreur', message: e?.message || 'Impossible d\'enregistrer le modèle.' });
    }
  };

  const handleDelete = async (row) => {
    const ok = await confirm({
      title: 'Supprimer le modèle',
      message: `Supprimer « ${row.displayName || row.name} » ? Les envois prévus ne partiront pas.`,
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteEmailTemplate(row.id);
      await Promise.all([reload(), reloadPending()]);
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de supprimer le modèle.' });
    }
  };

  const handleToggleEnabled = async (row, next) => {
    try {
      await api.updateEmailTemplate(row.id, { enabled: next });
      // Enabling/disabling a manual template adds/removes its rows from the queue.
      await Promise.all([reload(), reloadPending()]);
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de modifier le modèle.' });
    }
  };

  const handleToggleMode = async (row) => {
    if (row.sendMode !== 'auto' && !(await confirmAuto())) return;
    try {
      await api.updateEmailTemplate(row.id, { sendMode: row.sendMode === 'auto' ? 'manual' : 'auto' });
      await Promise.all([reload(), reloadPending()]);
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de modifier le mode d’envoi.' });
    }
  };

  // A shipped email opens its texts; a template of the operator's own opens its editor (rule 44).
  const openRow = (row) => {
    if (row.textsSection) navigate(`/settings/emails/textes#${row.textsSection}`);
    else handleOpen(row);
  };

  const rowOf = (row) => (
    <Stack key={row.id} direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 0.5, opacity: row.enabled ? 1 : 0.6, borderTop: 1, borderColor: 'divider' }}>
      <ButtonBase
        onClick={() => openRow(row)}
        aria-label={`${row.textsSection ? 'Modifier les textes' : 'Modifier'} : ${row.displayName}`}
        sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', py: 1, minHeight: 44, borderRadius: 1 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.displayName}</Typography>
            {!row.shipped && <Chip label="personnalisé" size="small" variant="outlined" />}
            {row.sendMode === 'auto' && <StatusBadge status="success" label="Auto" />}
            {/* specs/email-language-fr-en.md rule 9 — never sent to an English-speaking guest. */}
            {row.hasEnglish === false && <StatusBadge status="warning" label="EN manquant" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">{row.when ? row.when.label : row.whenLabel}</Typography>
        </Box>
      </ButtonBase>
      <Switch
        checked={Boolean(row.enabled)}
        onChange={(e) => handleToggleEnabled(row, e.target.checked)}
        slotProps={{ input: { 'aria-label': `Envoyer ${row.displayName}` } }}
      />
      <IconButton aria-label={`Plus d’actions : ${row.displayName}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchorEl: e.currentTarget, row })} sx={{ minWidth: 44, minHeight: 44 }}>
        <MoreHorizIcon />
      </IconButton>
    </Stack>
  );

  return (
    <Box>
      {/* Canonical top bar (specs/ds-sweep-settings.md §3.1) — replaces the hand-rolled h4 header;
          « Nouveau modèle » moves up from the templates-card corner. */}
      <PageActionBar
        title="Emails"
        actionsBefore={[
          { node: (
            <Button key="compose" startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setComposeOpen(true)}>
              Créer un email
            </Button>
          ) },
          { node: (
            <Button key="new-template" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => handleOpen(null)}>
              Nouveau modèle
            </Button>
          ) },
          { icon: <HistoryIcon />, tooltip: "Voir l'historique", onClick: () => navigate('/emails/historique'), color: 'info' },
        ]}
      />

      {loadError && (
        <ErrorAlert message="Impossible de charger les modèles d'emails." onRetry={reload} sx={{ mt: 2, mb: 1 }} />
      )}


      {pending.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <Box sx={{ px: 2, pt: 2 }}>
            <Typography variant="sectionHeader">Emails à envoyer</Typography>
            <Typography variant="caption" color="text.secondary">
              Modèles en mode manuel dont la date d'envoi est aujourd'hui ou dans les 7 derniers jours, et emails ajoutés manuellement.
            </Typography>
          </Box>
          <EmailPendingList
            rows={pending}
            onPreview={handlePreview}
            onOpenReservation={handleOpenReservation}
            onAcknowledge={handleAcknowledge}
            onMarkSent={handleMarkSent}
            onFixEmail={handleFixEmail}
          />
        </Card>
      )}

      <Card>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <Typography variant="sectionHeader">Modèles d'emails</Typography>
        </Box>
        {loading ? (
          <Box sx={{ px: 2, pb: 2 }}><LoadingState variant="skeleton" rows={4} /></Box>
        ) : (
          <Box sx={{ pb: 1 }}>
            {groups.length === 0 && <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>Aucun modèle d'email</Typography>}
            {groups.map((g) => (
              <Box key={g.id} component="section" aria-label={g.label}>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.5 }}>{g.label}</Typography>
                {g.templates.map(rowOf)}
              </Box>
            ))}
          </Box>
        )}
        <Menu anchorEl={menu ? menu.anchorEl : null} open={Boolean(menu)} onClose={() => setMenu(null)}>
          {menu && [
            <MenuItem key="edit" onClick={() => { const { row } = menu; setMenu(null); handleOpen(row); }}>Modifier le modèle</MenuItem>,
            menu.row.textsSection && (
              <MenuItem key="texts" onClick={() => { const { row } = menu; setMenu(null); navigate(`/settings/emails/textes#${row.textsSection}`); }}>Modifier les textes</MenuItem>
            ),
            <MenuItem key="mode" onClick={() => { const { row } = menu; setMenu(null); handleToggleMode(row); }}>
              {menu.row.sendMode === 'auto' ? 'Revenir à l’envoi manuel' : 'Envoi automatique…'}
            </MenuItem>,
            <Divider key="d" />,
            menu.row.shipped ? (
              <MenuItem key="del" disabled>
                <ListItemText primary="Supprimer" secondary="Email livré : il se coupe seulement" />
              </MenuItem>
            ) : (
              <MenuItem key="del" onClick={() => { const { row } = menu; setMenu(null); handleDelete(row); }} sx={{ color: 'error.main' }}>Supprimer</MenuItem>
            ),
          ]}
        </Menu>
      </Card>

      <EmailManualSendDialog
        open={!!sending}
        reservationId={sending?.reservationId}
        reservationStartDate={sending?.reservationStartDate}
        defaultTemplateId={sending?.templateId}
        occurrenceKey={sending?.occurrenceKey}
        onClose={() => setSending(null)}
        onSent={() => { setSending(null); reloadPending(); }}
      />

      <EmailComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onQueued={reloadPending}
      />

      {/* Fix a missing client email straight from the pending list — the client fiche opens with the
          cursor on the email field; saving updates the client and refreshes the queue. */}
      <FormDialog
        open={!!fixClient}
        onClose={closeFixClient}
        title="Modifier la fiche client"
        onSubmit={handleSaveFixClient}
        submitDisabled={!fixClient || !fixClient.lastName || !fixClient.firstName || !isValidEmail(fixClient.email)}
        submitLabel="Enregistrer"
        maxWidth="md"
      >
        {fixClient && (
          <ClientFormFields
            form={fixClient}
            setForm={setFixClient}
            cityOptions={[]}
            emailError={Boolean(fixClient.email) && !isValidEmail(fixClient.email)}
            autoFocusEmail
          />
        )}
      </FormDialog>

      <FormDialog
        open={open}
        onClose={handleClose}
        title={form.id ? (form.displayName || 'Modifier le modèle') : 'Nouveau modèle'}
        onSubmit={handleSave}
        submitDisabled={!form.name || !form.subject || !form.body || form.bodiesState === 'loading' || form.bodiesState === 'failed' || Boolean(when.error) || Boolean(when.pending)}
        maxWidth="md"
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          {/* Rule 44 — a shipped email is named by the server; only the operator's own has a name to type. */}
          {!form.stableKey && (
            <TextField
              label="Nom du modèle"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              required
            />
          )}
          {/* Rule 43 — « Quand ? » is one sentence; a moment the scheduler does not count from the day
              offset (the sequence, an action) reads as a fixed sentence. */}
          {form.when && !form.when.editable ? (
            <Box>
              <Typography variant="subtitle2">Quand</Typography>
              <Typography>{form.when.sentence}</Typography>
            </Box>
          ) : (
            <RelativeDayField
              days={when.days}
              direction={when.direction}
              anchorLabel={(form.when && form.when.anchorLabel) || 'l’arrivée'}
              onChange={changeWhen}
              error={when.error}
              example={when.example}
            />
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl sx={{ flex: 1 }}>
              <InputLabel>Mode d'envoi</InputLabel>
              <Select
                label="Mode d'envoi"
                value={form.sendMode}
                onChange={(e) => setForm({ ...form, sendMode: e.target.value })}
              >
                <MenuItem value="manual">Manuel : attend ma validation</MenuItem>
                <MenuItem value="auto">Automatique : part seul à 08:00</MenuItem>
              </Select>
              {form.sendMode === 'auto' ? (
                <FormHelperText>
                  Part sans validation, à sa date.
                </FormHelperText>
              ) : null}
            </FormControl>
          </Stack>

          {/* specs/email-automation.md rule 17 — the same view as « Textes des emails »: each variable
              by its French label, the chips insert it at the cursor; the English side is optional
              (empty: the email leaves in French). */}
          <ToggleButtonGroup size="small" exclusive value={language} onChange={(e, v) => v && setLanguage(v)} aria-label="Langue du modèle" sx={{ alignSelf: 'flex-start' }}>
            <ToggleButton value="fr" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>FR</ToggleButton>
            <ToggleButton value="en" sx={{ minWidth: 56, minHeight: 40, '@media (pointer: coarse)': { minHeight: 44 } }}>EN</ToggleButton>
          </ToggleButtonGroup>
          <TokenTextField
            id="template-subject"
            label="Sujet"
            language={language}
            fr={form.subject}
            en={form.subjectEn || ''}
            onChange={(lang, value) => { setFieldError(null); setForm((f) => ({ ...f, [lang === 'fr' ? 'subject' : 'subjectEn']: value })); }}
            tokens={chips.variables}
            errorFr={fieldError?.field === 'subject' ? fieldError : undefined}
            errorEn={fieldError?.field === 'subjectEn' ? fieldError : undefined}
          />
          {form.bodiesState === 'loading' && <LoadingState variant="skeleton" rows={4} />}
          {form.bodiesState === 'failed' && <ErrorAlert message="Impossible de charger le texte du modèle." onRetry={() => { setForm((f) => ({ ...f, bodiesState: 'loading' })); readBodies(form.id); }} />}
          {(!form.bodiesState || form.bodiesState === 'ready') && <TokenTextField
            id="template-body"
            label="Corps du message"
            language={language}
            fr={form.body}
            en={form.bodyEn || ''}
            onChange={(lang, value) => { setFieldError(null); setForm((f) => ({ ...f, [lang === 'fr' ? 'body' : 'bodyEn']: value })); }}
            tokens={chips.variables}
            flags={chips.conditions}
            minRows={10}
            errorFr={fieldError?.field === 'body' ? fieldError : undefined}
            errorEn={fieldError?.field === 'bodyEn' ? fieldError : undefined}
            helper={(
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Anglais vide : l'email part en français. Une seule condition à la fois.
              </Typography>
            )}
          />}

          <FormControl>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Switch
                checked={Boolean(form.enabled)}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <Typography variant="body2">{form.enabled ? 'Modèle activé' : 'Modèle désactivé'}</Typography>
            </Box>
          </FormControl>

          {/* specs/guest-email-texts-made-simple.md rule 12 — a shipped template is written on « Textes
              des emails », in its section; the J-7 hook too. */}
          {form.textsSection ? (
            <Link component={RouterLink} to={`/settings/emails/textes#${form.textsSection}`}>
              {form.stableKey === 'arrival_reminder_7d' ? 'Accroche par logement et phrases : Textes des emails' : 'Phrases de cet email : Textes des emails'}
            </Link>
          ) : null}

          {form.stableKey ? (
            <Typography variant="caption" color="text.secondary">
              Email livré avec l'application : les modifications sont conservées au prochain démarrage.
            </Typography>
          ) : null}
        </Stack>
      </FormDialog>
    </Box>
  );
}
