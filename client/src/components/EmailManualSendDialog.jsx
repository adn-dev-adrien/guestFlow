/**
 * EmailManualSendDialog — pick a template, preview the rendered email, edit if needed,
 * send. Used by the reservation page's "Envoyer un email" button AND by the pending list's
 * "Voir & envoyer" row action. See specs/email-automation.md §6.4.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  Typography, Stack, FormControl, InputLabel, Select, MenuItem, TextField,
  CircularProgress, Chip, Tooltip, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MailOutlineIcon from '@mui/icons-material/MailOutlined';
import SendIcon from '@mui/icons-material/Send';
import api from '../api';
import ConfirmDialog from './ConfirmDialog';
import LanguageBadge from './LanguageBadge';
import { displayDateTime } from '../utils/formatters';
import useLatestRequest from '../hooks/useLatestRequest';
import { ENGLISH_MISSING, ENGLISH_MISSING_TAG, NO_RECIPIENT, sendErrorMessage } from '../constants/emailSendErrors';

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

/**
 * One dialog serves many rows (pending queue, history): every opening starts from a fresh state, so
 * nothing of the previous row — template, edits, recipient, language — can leave in the next email
 * (specs/email-automation.md rule 21).
 */
export default function EmailManualSendDialog(props) {
  const [wasOpen, setWasOpen] = useState(Boolean(props.open));
  const [opening, setOpening] = useState(0);
  if (props.open !== wasOpen) {
    setWasOpen(Boolean(props.open));
    if (props.open) setOpening(opening + 1);
  }
  return <EmailManualSendForm key={opening} {...props} />;
}

function EmailManualSendForm({
  open, reservationId, reservationStartDate, defaultTemplateId, occurrenceKey, onClose, onSent,
}) {
  // Full screen on a phone, like every dialog (specs/ds-components.md rule 22).
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(defaultTemplateId || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  // The template the subject / body on screen were rendered for: « Envoyer » waits until it is the one
  // picked (specs/email-automation.md rule 22).
  const [previewedTemplateId, setPreviewedTemplateId] = useState(null);
  const beginPreview = useLatestRequest();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [manualEmail, setManualEmail] = useState(''); // operator-typed recipient when the client has none
  const [missingVariables, setMissingVariables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // specs/guest-email-sequence.md rule 13bis — a sequence email already sent is only re-sent after an
  // explicit confirmation; the server's 409 carries the date it left.
  const [alreadySentAt, setAlreadySentAt] = useState(null);
  // The language this message will actually leave in. `resolvedLang` is what the server decided —
  // the guest's own language — and `langOverride` is the operator saying "not this time". The
  // override applies to THIS send: it never rewrites the guest's record
  // (specs/site-english-version.md §6).
  const [resolvedLang, setResolvedLang] = useState('fr');
  const [langOverride, setLangOverride] = useState(null);
  // specs/email-language-fr-en.md rule 9 — the server says this template has no English version for
  // an English-speaking guest: it is shown, never sent.
  const [englishMissing, setEnglishMissing] = useState(false);

  // Load template list once when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    setManualEmail('');
    setLangOverride(null);
    api.getEmailTemplates('picker')
      .then((rows) => {
        const enabled = rows.filter((r) => r.enabled !== 0);
        // When resending from the history, the original template may be disabled: keep it
        // selectable so the resend uses the exact template it was sent with, never a silent
        // fallback to the first enabled one.
        const forced = defaultTemplateId
          ? rows.find((r) => Number(r.id) === Number(defaultTemplateId) && r.enabled === 0)
          : null;
        setTemplates(forced ? [...enabled, forced] : enabled);
        if (!templateId && (enabled.length > 0 || forced)) {
          setTemplateId(defaultTemplateId || enabled[0].id);
        }
      })
      .catch((e) => setError(e?.message || 'Erreur lors du chargement des modèles.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTemplateId]);

  const refreshPreview = useCallback(async () => {
    if (!templateId || !reservationId) return;
    const current = beginPreview();
    setLoading(true);
    setError('');
    setPreviewedTemplateId(null);
    setPreviewFailed(false);
    try {
      const res = await api.previewEmail({ reservationId, templateId, lang: langOverride || undefined, occurrenceKey });
      if (!current()) return;
      setPreviewedTemplateId(templateId);
      setSubject(res.subject || '');
      setBody(res.body || '');
      setTo(res.to || '');
      setResolvedLang(res.lang || 'fr');
      setEnglishMissing(Boolean(res.englishMissing));
      setMissingVariables(res.missingVariables || []);
    } catch (e) {
      if (!current()) return;
      setPreviewFailed(true);
      setError(e?.message || 'Impossible de générer l\'aperçu.');
      setSubject(''); setBody(''); setTo(''); setMissingVariables([]); setEnglishMissing(false);
    } finally {
      if (current()) setLoading(false);
    }
  }, [templateId, reservationId, langOverride, occurrenceKey, beginPreview]);

  useEffect(() => { if (open) refreshPreview(); }, [open, refreshPreview]);

  const selected = useMemo(
    () => templates.find((t) => Number(t.id) === Number(templateId)),
    [templates, templateId],
  );

  const recipient = to || manualEmail.trim();

  const handleSend = async (confirmResend = false) => {
    if (!recipient) {
      setError(NO_RECIPIENT);
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await api.sendEmail({
        reservationId,
        templateId,
        // When the client has no email on file, pass the operator-typed one — the server
        // sends to it AND saves it on the client record.
        overrides: { subject, body, ...(to ? {} : { to: manualEmail.trim() }) },
        confirmResend,
        lang: langOverride || undefined,
        occurrenceKey,
      });
      if (onSent) onSent(res);
      if (onClose) onClose();
    } catch (e) {
      if (e?.error === 'ALREADY_SENT' || e?.message === 'ALREADY_SENT') {
        // The server words the time in Europe/Paris (specs/email-history-rolling-window.md rule 8).
        setAlreadySentAt(e.sentAtLabel || (e.sentAt ? displayDateTime(e.sentAt) : ''));
      } else {
        setError(sendErrorMessage(e));
      }
    } finally {
      setSending(false);
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  const sendDisabled = sending || loading || !templateId || previewedTemplateId !== templateId || !emailValid || englishMissing;

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Aperçu de l'email</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              p: 1.5,
              bgcolor: 'info.soft',
              border: '1px solid',
              borderColor: 'info.light',
              borderRadius: 1,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
              <MailOutlineIcon fontSize="small" color="info" />
              {to ? (
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Destinataire
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {to}
                  </Typography>
                </Box>
              ) : (
                <TextField
                  label="Adresse email du client"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  type="email"
                  size="small"
                  fullWidth
                  disabled={sending}
                  helperText="Aucune adresse sur la fiche client — elle y sera enregistrée à l'envoi."
                  sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 0 }}
                />
              )}
            </Stack>
            {/* An operator about to write to a guest should not have to guess which language the
                message will leave in — nor open the client's record to find out. */}
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <LanguageBadge
                lang={resolvedLang}
                origin={langOverride
                  ? 'choisi pour cet envoi seulement'
                  : 'langue du client — l\'e-mail partira ainsi'}
              />
              <Tooltip title={`Écrire cet e-mail en ${resolvedLang === 'en' ? 'français' : 'anglais'} — pour cet envoi seulement, la fiche client n'est pas modifiée`}>
                <span>
                  <Button
                    size="small"
                    variant="text"
                    disabled={loading || sending}
                    onClick={() => setLangOverride(resolvedLang === 'en' ? 'fr' : 'en')}
                  >
                    {resolvedLang === 'en' ? 'Passer en FR' : 'Passer en EN'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel>Modèle</InputLabel>
            <Select label="Modèle" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.displayName || t.name} ({t.whenLabel || offsetLabel(t.dayOffset)})
                  {resolvedLang === 'en' && t.hasEnglish === false ? ` — ${ENGLISH_MISSING_TAG}` : ''}
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

        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {/* Next to the buttons, so a failure is seen without scrolling back through the body. */}
        {englishMissing && !error ? (
          <Typography role="alert" variant="body2" color="warning.main" sx={{ flex: '1 1 100%', px: 1 }}>{ENGLISH_MISSING}</Typography>
        ) : null}
        {error ? (
          <Typography role="alert" variant="body2" color="error.main" sx={{ flex: '1 1 100%', px: 1 }}>{error}</Typography>
        ) : null}
        {error && previewFailed ? <Button onClick={refreshPreview} disabled={loading}>Réessayer</Button> : null}
        <Button onClick={onClose} disabled={sending}>Annuler</Button>
        <Button
          onClick={() => handleSend(false)}
          variant="contained"
          disabled={sendDisabled}
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
        >
          Envoyer
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={alreadySentAt !== null}
        title="Déjà envoyé"
        message={`Ce mail a déjà été envoyé${alreadySentAt ? ` le ${alreadySentAt}` : ''}. Le renvoyer quand même ?`}
        confirmLabel="Renvoyer"
        confirmColor="primary"
        onClose={() => setAlreadySentAt(null)}
        onConfirm={() => { setAlreadySentAt(null); handleSend(true); }}
      />
    </Dialog>
  );
}
