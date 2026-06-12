/**
 * EmailTemplatesPage — CRUD UI for the email templates library.
 * See specs/email-automation.md §6.1.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  IconButton, Chip, Typography, Switch, Button, Stack, FormControl, InputLabel,
  Select, MenuItem, TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import FormDialog from '../components/FormDialog';
import EmailPendingList from '../components/EmailPendingList';
import EmailManualSendDialog from '../components/EmailManualSendDialog';
import EmailComposeDialog from '../components/EmailComposeDialog';
import ClientFormFields from '../components/ClientFormFields';
import api from '../api';
import { useAppDialogs } from '../components/DialogProvider';
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
  // Options
  { label: 'Liste options',    token: '{{optionsList}}' },
  { label: 'Liste ressources', token: '{{resourcesList}}' },
  { label: 'Config lits',      token: '{{bedConfig}}' },
  // Entreprise
  { label: 'Société',          token: '{{companyName}}' },
  { label: 'Nom expéditeur',   token: '{{senderName}}' },
  { label: 'Téléphone société',token: '{{companyPhone}}' },
];

const CONDITION_BUTTONS = [
  { label: 'Si linge de lit',       token: '{{#if hasBedLinenOption}}' },
  { label: 'Si ménage',             token: '{{#if hasCleaningOption}}' },
  { label: 'Si caution non encaissée', token: '{{#if cautionNotBanked}}' },
  { label: 'Si caution non reçue',  token: '{{#if cautionNotReceived}}' },
  { label: 'Si options',            token: '{{#if hasOptions}}' },
  { label: 'Si ressources',         token: '{{#if hasResources}}' },
  { label: 'Sinon',                 token: '{{else}}' },
  { label: 'Fin si',                token: '{{/if}}' },
];

const emptyTemplate = {
  id: null,
  name: '',
  subject: '',
  body: '',
  dayOffset: -7,
  sendMode: 'manual',
  enabled: true,
};

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
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplate);
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const [focusedField, setFocusedField] = useState('body');

  const [pending, setPending] = useState([]);
  const [sending, setSending] = useState(null); // { reservationId, templateId, reservationStartDate }
  // Inline "fix missing email" — edit the client fiche from the pending list (focus the email field).
  const [fixClient, setFixClient] = useState(null);   // form data; non-null = dialog open
  const [fixClientId, setFixClientId] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getEmailTemplates();
      setItems(rows);
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
    }
  }, []);

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
    const ref = focusedField === 'subject' ? subjectRef : bodyRef;
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Typography variant="h4">Emails</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setComposeOpen(true)} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Créer un email
          </Button>
          <Button startIcon={<HistoryIcon />} component={RouterLink} to="/emails/historique" variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Voir l'historique
          </Button>
        </Stack>
      </Box>

      {pending.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <Box sx={{ px: 2, pt: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Emails à envoyer</Typography>
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
          <Typography variant="h6" sx={{ fontWeight: 600 }}>Modèles d'emails</Typography>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => handleOpen(null)} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Nouveau modèle
          </Button>
        </Box>
        <TableContainer>
          <Table size="small" sx={{ minWidth: 860 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quand</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Activé</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {loading ? 'Chargement…' : 'Aucun modèle d\'email'}
                  </TableCell>
                </TableRow>
              ) : items.map((row) => (
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
                  <TableCell>
                    <Chip
                      label={row.sendMode === 'auto' ? 'Auto' : 'Manuel'}
                      size="small"
                      color={row.sendMode === 'auto' ? 'success' : 'info'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={Boolean(row.enabled)}
                      onChange={(e) => handleToggleEnabled(row, e.target.checked)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton onClick={() => handleDelete(row)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
