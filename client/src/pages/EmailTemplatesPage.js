/**
 * EmailTemplatesPage — CRUD UI for the email templates library.
 * See specs/email-automation.md §6.1.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, TableRow, TableCell, IconButton, Chip, Typography, Switch, Button,
  Stack, FormControl, InputLabel, Select, MenuItem, TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import { Link as RouterLink } from 'react-router-dom';
import DataPageScaffold from '../components/DataPageScaffold';
import FormDialog from '../components/FormDialog';
import api from '../api';
import { useAppDialogs } from '../components/DialogProvider';

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
  { label: 'Config lits',      token: '{{bedConfig}}' },
  // Entreprise
  { label: 'Société',          token: '{{companyName}}' },
  { label: 'Téléphone société',token: '{{companyPhone}}' },
];

const CONDITION_BUTTONS = [
  { label: 'Si linge de lit',       token: '{{#if hasBedLinenOption}}' },
  { label: 'Si caution non encaissée', token: '{{#if cautionNotBanked}}' },
  { label: 'Si options',            token: '{{#if hasOptions}}' },
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplate);
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const [focusedField, setFocusedField] = useState('body');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getEmailTemplates();
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      await reload();
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
      await reload();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de supprimer le modèle.' });
    }
  };

  const handleToggleEnabled = async (row, next) => {
    try {
      await api.updateEmailTemplate(row.id, { enabled: next });
      await reload();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de modifier le modèle.' });
    }
  };

  return (
    <Box>
      <DataPageScaffold
        title="Modèles d'emails"
        actionLabel="Nouveau modèle"
        actionIcon={<AddIcon />}
        onAction={() => handleOpen(null)}
        topContent={(
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button startIcon={<HistoryIcon />} component={RouterLink} to="/emails/historique" variant="outlined" size="small">
              Voir l'historique
            </Button>
          </Box>
        )}
        minWidth={860}
        head={(
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Quand</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Activé</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
          </TableRow>
        )}
        hasItems={items.length > 0}
        emptyColSpan={5}
        emptyText={loading ? 'Chargement…' : 'Aucun modèle d\'email'}
      >
        {items.map((row) => (
          <TableRow key={row.id} hover>
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
            <TableCell>
              <Switch
                checked={Boolean(row.enabled)}
                onChange={(e) => handleToggleEnabled(row, e.target.checked)}
                size="small"
              />
            </TableCell>
            <TableCell align="right">
              <IconButton onClick={() => handleOpen(row)} size="small"><EditIcon fontSize="small" /></IconButton>
              <IconButton onClick={() => handleDelete(row)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton>
            </TableCell>
          </TableRow>
        ))}
      </DataPageScaffold>

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
