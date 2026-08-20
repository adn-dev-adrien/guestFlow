/**
 * EmailTemplatesPage — CRUD UI for the email templates library.
 * See specs/email-automation.md §6.1.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, TableRow, TableCell,
  IconButton, Chip, Typography, Switch, Button, Stack, FormControl, InputLabel,
  Select, MenuItem, TextField, Tooltip, Alert, FormHelperText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router';
import FormDialog from '../components/FormDialog';
import EmailPendingList from '../components/EmailPendingList';
import EmailManualSendDialog from '../components/EmailManualSendDialog';
import EmailComposeDialog from '../components/EmailComposeDialog';
import ClientFormFields from '../components/ClientFormFields';
import api from '../api';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import PageActionBar from '../components/PageActionBar';
import ErrorAlert from '../components/ErrorAlert';
import LoadingState from '../components/LoadingState';
import ResponsiveTable from '../components/ResponsiveTable';
import { isValidEmail } from '../utils/validation';

const EMPTY_CLIENT = {
  lastName: '', firstName: '', streetNumber: '', street: '', postalCode: '',
  city: '', address: '', phone: '', email: '', notes: '',
};

// Variable + condition picker — labels shown in the dialog, payload = the literal {{token}} text
// inserted at the cursor. Adding a new token means: append a row + the matching var/flag in
// `utils/emailContextBuilder.js` (see specs/email-automation.md §4.4).
const VARIABLE_BUTTONS = [
  // Client
  { label: 'Prénom client',    token: '{{clientFirstName}}' },
  { label: 'Nom client',       token: '{{clientLastName}}' },
  { label: 'Nom complet',      token: '{{clientFullName}}' },
  { label: 'Email client',     token: '{{clientEmail}}' },
  { label: 'Téléphone client', token: '{{clientPhone}}' },
  // Séjour
  { label: 'Logement',         token: '{{propertyName}}' },
  { label: 'Logement + article', token: '{{propertyWithArticle}}' },
  { label: 'Date arrivée',     token: '{{startDate}}' },
  { label: 'Date départ',      token: '{{endDate}}' },
  { label: 'Heure arrivée',    token: '{{checkInTime}}' },
  { label: 'Heure départ',     token: '{{checkOutTime}}' },
  { label: 'Nuits',            token: '{{nights}}' },
  // Tarification
  { label: 'Prix final',       token: '{{finalPrice}}' },
  { label: 'Acompte',          token: '{{depositAmount}}' },
  { label: 'Solde',            token: '{{balanceAmount}}' },
  { label: 'Caution',          token: '{{cautionAmount}}' },
  { label: 'Complément',       token: '{{complementAmount}}' },
  { label: 'Texte complément', token: '{{complementNotice}}' },
  // Options
  { label: 'Liste options',    token: '{{optionsList}}' },
  { label: 'Option(s) réservée(s)', token: '{{reservedOptionsList}}' },
  { label: 'Liste ressources', token: '{{resourcesList}}' },
  { label: 'Config lits',      token: '{{bedConfig}}' },
  // Entreprise
  { label: 'Société',          token: '{{companyName}}' },
  { label: 'Nom expéditeur',   token: '{{senderName}}' },
  { label: 'Téléphone société',token: '{{companyPhone}}' },
];

const CONDITION_BUTTONS = [
  { label: 'Si linge de lit',       token: '{{#if hasBedLinenOption}}' },
  { label: 'Si linge fourni par défaut', token: '{{#if bedLinenProvidedByDefault}}' },
  { label: 'Si apporter son linge', token: '{{#if bedLinenBringYourOwn}}' },
  { label: 'Si ménage',             token: '{{#if hasCleaningOption}}' },
  { label: 'Si caution non encaissée', token: '{{#if cautionNotBanked}}' },
  { label: 'Si caution non reçue',  token: '{{#if cautionNotReceived}}' },
  { label: 'Si complément à percevoir', token: '{{#if complementToCollect}}' },
  { label: 'Si options',            token: '{{#if hasOptions}}' },
  { label: 'Si option(s) réservée(s)', token: '{{#if hasReservedOptions}}' },
  { label: 'Si ressources',         token: '{{#if hasResources}}' },
  { label: 'Sinon',                 token: '{{else}}' },
  { label: 'Fin si',                token: '{{/if}}' },
];

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

// « Automatique » only means something while automatic sending is authorised in Réglages. When it is
// not, the chip says so rather than promising a send that will never happen
// (specs/no-automatic-email-without-approval.md §3 rule 8). `autoSendBlocked` is computed server-side.
function sendModeChip(row) {
  if (row.sendMode !== 'auto') {
    return <Chip label="Manuel" size="small" color="info" variant="outlined" />;
  }
  if (row.autoSendBlocked) {
    return <Chip label="Auto désactivé" size="small" color="warning" variant="outlined" />;
  }
  return <Chip label="Auto" size="small" color="success" variant="outlined" />;
}

function describeOffset(n) {
  const num = Number(n);
  if (num === 0) return 'Jour J';
  if (num < 0) return `J${num}`;
  return `J+${num}`;
}

export default function EmailTemplatesPage() {
  const { confirm, alert } = useAppDialogs();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  // At least one enabled « Automatique » template that will not actually leave on its own
  // (specs/no-automatic-email-without-approval.md §3 rule 8). Decided server-side, per row.
  const autoSendBlocked = items.some((t) => t.autoSendBlocked);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplate);
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyEnRef = useRef(null);
  const subjectEnRef = useRef(null);
  const [focusedField, setFocusedField] = useState('body');

  const [pending, setPending] = useState([]);
  const [sending, setSending] = useState(null); // { reservationId, templateId, reservationStartDate }
  // Inline "fix missing email" — edit the client fiche from the pending list (focus the email field).
  const [fixClient, setFixClient] = useState(null);   // form data; non-null = dialog open
  const [fixClientId, setFixClientId] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await api.getEmailTemplates();
      setItems(rows);
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
      await alert({ title: 'Email invalide', message: 'Veuillez saisir une adresse email valide.' });
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
      await api.acknowledgePendingEmail({ templateId: row.templateId, reservationId: row.reservationId });
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
      await api.markEmailSent({ templateId: row.templateId, reservationId: row.reservationId });
      await reloadPending();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de marquer l\'email comme envoyé.' });
    }
  };

  const handleOpen = (row) => {
    if (row) {
      setForm({
        id: row.id,
        name: row.name || '',
        subject: row.subject || '',
        body: row.body || '',
        subjectEn: row.subjectEn || '',
        bodyEn: row.bodyEn || '',
        dayOffset: Number(row.dayOffset || 0),
        sendMode: row.sendMode || 'manual',
        enabled: row.enabled !== 0,
        stableKey: row.stableKey,
      });
    } else {
      setForm(emptyTemplate);
    }
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const insertToken = (token) => {
    const ref = { subject: subjectRef, body: bodyRef, subjectEn: subjectEnRef, bodyEn: bodyEnRef }[focusedField] || bodyRef;
    const field = ref.current;
    if (!field) {
      setForm((f) => ({ ...f, [focusedField]: (f[focusedField] || '') + token }));
      return;
    }
    const start = field.selectionStart ?? (form[focusedField] || '').length;
    const end   = field.selectionEnd   ?? start;
    const current = form[focusedField] || '';
    const next = current.slice(0, start) + token + current.slice(end);
    setForm((f) => ({ ...f, [focusedField]: next }));
    // Restore cursor position just after the inserted token.
    requestAnimationFrame(() => {
      if (field) {
        field.focus();
        const pos = start + token.length;
        field.setSelectionRange(pos, pos);
      }
    });
  };

  const handleSave = async () => {
    const payload = {
      name: String(form.name || '').trim(),
      subject: String(form.subject || ''),
      body: String(form.body || ''),
      subjectEn: String(form.subjectEn || ''),
      bodyEn: String(form.bodyEn || ''),
      dayOffset: Number(form.dayOffset || 0),
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
      await alert({ title: 'Erreur', message: e?.message || 'Impossible d\'enregistrer le modèle.' });
    }
  };

  const handleDelete = async (row) => {
    const ok = await confirm({
      title: 'Supprimer le modèle',
      message: `Confirmer la suppression de « ${row.name} » ?${row.stableKey ? '\nCe modèle est livré avec l\'application : il sera ré-inséré au prochain démarrage du serveur.' : ''}`,
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

      {autoSendBlocked && (
        <Alert
          severity="warning"
          sx={{ mt: 2, mb: 1 }}
          action={(
            <Button color="inherit" size="small" onClick={() => navigate('/settings')}>
              Modifier ce réglage
            </Button>
          )}
        >
          <strong>L'envoi automatique est désactivé.</strong> Les modèles en mode « Automatique » ne
          partent pas seuls : ils vous sont proposés ci-dessous, dans « Emails à envoyer ».
        </Alert>
      )}

      {pending.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <Box sx={{ px: 2, pt: 2 }}>
            <Typography variant="sectionHeader">Emails à envoyer</Typography>
            <Typography variant="caption" color="text.secondary">
              {autoSendBlocked
                ? "Modèles dont la date d'envoi est aujourd'hui ou dans les 7 derniers jours, et emails ajoutés manuellement. L'envoi automatique étant désactivé, les modèles « Automatique » sont proposés ici."
                : "Modèles en mode manuel dont la date d'envoi est aujourd'hui ou dans les 7 derniers jours, et emails ajoutés manuellement."}
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
          <ResponsiveTable
            items={items}
            getKey={(row) => row.id}
            minWidth={860}
            emptyText="Aucun modèle d'email"
            head={(
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quand</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Activé</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            )}
            renderRow={(row) => (
              <TableRow
                key={row.id}
                hover
                onClick={() => handleOpen(row)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography>{row.name}</Typography>
                    {row.stableKey ? <Chip label="Modèle livré" size="small" variant="outlined" /> : null}
                  </Stack>
                </TableCell>
                <TableCell>{describeOffset(row.dayOffset)}</TableCell>
                <TableCell>{sendModeChip(row)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={Boolean(row.enabled)}
                    onChange={(e) => handleToggleEnabled(row, e.target.checked)}
                    size="small"
                  />
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Supprimer">
                    <IconButton onClick={() => handleDelete(row)} size="small" color="error" aria-label="Supprimer"><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )}
            renderMobileCard={(row) => (
              <Stack onClick={() => handleOpen(row)} sx={{ cursor: 'pointer', gap: 0.5 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
                  {sendModeChip(row)}
                </Stack>
                <Typography variant="caption" color="text.secondary">{describeOffset(row.dayOffset)}</Typography>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={Boolean(row.enabled)}
                    onChange={(e) => handleToggleEnabled(row, e.target.checked)}
                    size="small"
                  />
                  <Tooltip title="Supprimer">
                    <IconButton onClick={() => handleDelete(row)} size="small" color="error" aria-label="Supprimer"><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            )}
          />
        )}
      </Card>

      <EmailManualSendDialog
        open={!!sending}
        reservationId={sending?.reservationId}
        reservationStartDate={sending?.reservationStartDate}
        defaultTemplateId={sending?.templateId}
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
        title={form.id ? 'Modifier le modèle' : 'Nouveau modèle'}
        onSubmit={handleSave}
        submitDisabled={!form.name || !form.subject || !form.body}
        maxWidth="md"
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nom du modèle"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            fullWidth
            required
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Décalage en jours"
              type="number"
              value={form.dayOffset}
              onChange={(e) => setForm({ ...form, dayOffset: e.target.value })}
              helperText="Négatif = avant le séjour ; 0 = jour J ; positif = après. Plage [-90, +90]."
              slotProps={{ htmlInput: { min: -90, max: 90 } }}
              sx={{ flex: 1 }}
            />
            <FormControl sx={{ flex: 1 }}>
              <InputLabel>Mode d'envoi</InputLabel>
              <Select
                label="Mode d'envoi"
                value={form.sendMode}
                onChange={(e) => setForm({ ...form, sendMode: e.target.value })}
              >
                <MenuItem value="manual">Manuel (revue sur dashboard)</MenuItem>
                <MenuItem value="auto">Automatique (envoi à 08:00)</MenuItem>
              </Select>
              {autoSendBlocked && form.sendMode === 'auto' ? (
                <FormHelperText>
                  L'envoi automatique est désactivé dans les Réglages — cet email sera proposé, pas envoyé.
                </FormHelperText>
              ) : null}
            </FormControl>
          </Stack>

          <TextField
            label="Sujet"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            onFocus={() => setFocusedField('subject')}
            inputRef={subjectRef}
            fullWidth
            required
          />

          <TextField
            label="Corps du message"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            onFocus={() => setFocusedField('body')}
            inputRef={bodyRef}
            fullWidth
            required
            multiline
            minRows={12}
          />

          {/* English version (specs/email-language-fr-en.md): used when the reservation's email language
              is English. Optional — leave empty to always send in French. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Version anglaise (optionnelle) — utilisée pour les réservations en anglais. Laissez vide pour envoyer en français.
          </Typography>
          <TextField
            label="Sujet (EN)"
            value={form.subjectEn || ''}
            onChange={(e) => setForm({ ...form, subjectEn: e.target.value })}
            onFocus={() => setFocusedField('subjectEn')}
            inputRef={subjectEnRef}
            fullWidth
          />
          <TextField
            label="Corps du message (EN)"
            value={form.bodyEn || ''}
            onChange={(e) => setForm({ ...form, bodyEn: e.target.value })}
            onFocus={() => setFocusedField('bodyEn')}
            inputRef={bodyEnRef}
            fullWidth
            multiline
            minRows={12}
          />

          <Box>
            <Typography variant="caption" color="text.secondary">Variables :</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {VARIABLE_BUTTONS.map((v) => (
                <Chip key={v.token} label={v.label} size="small" onClick={() => insertToken(v.token)} variant="outlined" />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Blocs conditionnels :</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {CONDITION_BUTTONS.map((c) => (
                <Chip key={c.token} label={c.label} size="small" onClick={() => insertToken(c.token)} variant="outlined" color="secondary" />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Une variable inconnue sera remplacée par une chaîne vide. Les blocs conditionnels supportent un seul niveau (pas d'imbrication).
            </Typography>
          </Box>

          <FormControl>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Switch
                checked={Boolean(form.enabled)}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <Typography variant="body2">{form.enabled ? 'Modèle activé' : 'Modèle désactivé'}</Typography>
            </Box>
          </FormControl>

          {form.stableKey ? (
            <Typography variant="caption" color="text.secondary">
              Ce modèle est livré avec l'application (clé technique : <code>{form.stableKey}</code>). Vos modifications sont conservées au prochain démarrage.
            </Typography>
          ) : null}
        </Stack>
      </FormDialog>
    </Box>
  );
}
