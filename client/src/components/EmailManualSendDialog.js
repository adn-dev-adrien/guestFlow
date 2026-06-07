/**
 * EmailManualSendDialog — pick a template, preview the rendered email, edit if needed,
 * send. Used by the reservation page's "Envoyer un email" button AND by the pending list's
 * "Voir & envoyer" row action. See specs/email-automation.md §6.4.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  Typography, Stack, FormControl, InputLabel, Select, MenuItem, TextField,
  CircularProgress, Chip,
} from '@mui/material';
import api from '../api';

function offsetLabel(n) {
  const num = Number(n);
  if (num === 0) return 'Jour J';
  if (num < 0) return `J${num}`;
  return `J+${num}`;
}

// Format a JS Date as `dd/mm/yyyy` — matches the rest of the app's date display.
function formatTargetDate(startDateIso, dayOffset) {
  if (!startDateIso) return '';
  try {
    const d = new Date(`${startDateIso}T00:00:00`);
    d.setDate(d.getDate() + Number(dayOffset || 0));
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export default function EmailManualSendDialog({
  open, reservationId, reservationStartDate, defaultTemplateId, onClose, onSent,
}) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(defaultTemplateId || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [missingVariables, setMissingVariables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Load template list once when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    api.getEmailTemplates()
      .then((rows) => {
        const enabled = rows.filter((r) => r.enabled !== 0);
        setTemplates(enabled);
        if (!templateId && enabled.length > 0) {
          setTemplateId(defaultTemplateId || enabled[0].id);
        }
      })
      .catch((e) => setError(e?.message || 'Erreur lors du chargement des modèles.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTemplateId]);

  const refreshPreview = useCallback(async () => {
    if (!templateId || !reservationId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.previewEmail({ reservationId, templateId });
      setSubject(res.subject || '');
      setBody(res.body || '');
      setTo(res.to || '');
      setMissingVariables(res.missingVariables || []);
    } catch (e) {
      setError(e?.message || 'Impossible de générer l\'aperçu.');
      setSubject(''); setBody(''); setTo(''); setMissingVariables([]);
    } finally {
      setLoading(false);
    }
  }, [templateId, reservationId]);

  useEffect(() => { if (open) refreshPreview(); }, [open, refreshPreview]);

  const selected = useMemo(
    () => templates.find((t) => Number(t.id) === Number(templateId)),
    [templates, templateId],
  );

  const handleSend = async () => {
    if (!to) {
      setError('Aucune adresse email destinataire — vérifie la fiche client.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await api.sendEmail({
        reservationId,
        templateId,
        overrides: { subject, body },
      });
      if (onSent) onSent(res);
      if (onClose) onClose();
    } catch (e) {
      const message = e?.message || 'Échec de l\'envoi.';
      if (message.includes('EMAIL_NOT_CONFIGURED')) {
        setError('SMTP non configuré. Configure les paramètres SMTP dans /settings avant d\'envoyer des emails.');
      } else if (message.includes('CLIENT_NO_EMAIL')) {
        setError('Le client n\'a pas d\'adresse email.');
      } else {
        setError(message);
      }
    } finally {
      setSending(false);
    }
  };

  const sendDisabled = sending || loading || !to || !templateId;

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Envoyer un email
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Destinataire : {to || '— (pas d\'adresse email sur la fiche client)'}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>Modèle</InputLabel>
            <Select label="Modèle" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} ({offsetLabel(t.dayOffset)})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selected && reservationStartDate ? (
            <Typography variant="caption" color="text.secondary">
              Date d'envoi prévue : {formatTargetDate(reservationStartDate, selected.dayOffset)}
            </Typography>
          ) : null}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <>
              <TextField
                label="Sujet"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                fullWidth
              />
              <TextField
                label="Corps du message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                fullWidth
                multiline
                minRows={12}
              />
            </>
          )}

          {missingVariables.length > 0 ? (
            <Box>
              <Typography variant="caption" color="warning.main">
                Variables non résolues (rendues vides) :
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {missingVariables.map((v) => <Chip key={v} label={`{{${v}}}`} size="small" color="warning" variant="outlined" />)}
              </Box>
            </Box>
          ) : null}

          {error ? (
            <Box sx={{ p: 1.5, bgcolor: 'error.lighter', border: '1px solid', borderColor: 'error.light', borderRadius: 1 }}>
              <Typography variant="body2" color="error.main">{error}</Typography>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>Annuler</Button>
        <Button onClick={handleSend} variant="contained" disabled={sendDisabled}>
          {sending ? <CircularProgress size={18} color="inherit" /> : 'Envoyer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
