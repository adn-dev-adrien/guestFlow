/**
 * EmailComposeDialog — "Créer un email" (specs/manual-email-from-template.md §6).
 *
 * Two-step compose: pick a reservation (searchable Autocomplete over all reservations) +
 * pick a template, then queue the pair into "Emails à envoyer". If that template was already
 * sent for that reservation, the server returns `alreadySent` + the last send date; we confirm
 * with the operator (Recréer / Annuler) before re-queuing with `force`.
 *
 * The parent owns the queue reload (via onQueued). Rendering only; no business logic here.
 *
 * Props:
 *   open:     boolean
 *   onClose:  () => void
 *   onQueued: () => void   — fired after a pair is successfully queued
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stack, FormControl, InputLabel, Select, MenuItem, Autocomplete, TextField,
  CircularProgress, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import api from '../api';
import { useAppDialogs } from './DialogProvider';
import { displayDateShort } from '../utils/formatters';

function offsetLabel(n) {
  const num = Number(n);
  if (num === 0) return 'Jour J';
  if (num < 0) return `J${num}`;
  return `J+${num}`;
}

function reservationLabel(r) {
  if (!r) return '';
  const who = r.clientFullName || 'Client inconnu';
  const where = r.propertyName ? ` — ${r.propertyName}` : '';
  return `${who}${where} — du ${displayDateShort(r.startDate)} au ${displayDateShort(r.endDate)}`;
}

export default function EmailComposeDialog({ open, onClose, onQueued }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { confirm } = useAppDialogs();

  const [reservations, setReservations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [reservation, setReservation] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setReservation(null);
    setTemplateId('');
    setLoading(true);
    Promise.all([api.getEmailEligibleReservations(), api.getEmailTemplates()])
      .then(([res, tpl]) => {
        setReservations(res || []);
        const enabled = (tpl || []).filter((t) => t.enabled !== 0);
        setTemplates(enabled);
      })
      .catch((e) => setError(e?.message || 'Erreur lors du chargement.'))
      .finally(() => setLoading(false));
  }, [open]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => Number(t.id) === Number(templateId)),
    [templates, templateId],
  );

  const doQueue = async (force) => {
    return api.queueEmail({ templateId, reservationId: reservation.id, force });
  };

  const handleSubmit = async () => {
    if (!reservation || !templateId) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await doQueue(false);
      if (res && res.alreadySent) {
        const proceed = await confirm({
          title: 'Email déjà envoyé',
          message: `Ce mail (« ${selectedTemplate?.name || 'modèle'} ») a déjà été envoyé le ${displayDateShort(res.lastSentAt)} pour cette réservation. Le recréer quand même ?`,
          confirmLabel: 'Recréer',
          cancelLabel: 'Annuler',
          confirmColor: 'warning',
        });
        if (!proceed) { setSubmitting(false); return; }
        await doQueue(true);
      }
      if (onQueued) onQueued();
      if (onClose) onClose();
    } catch (e) {
      setError(e?.message || 'Impossible d\'ajouter l\'email à la file.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Créer un email</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Autocomplete
              options={reservations}
              value={reservation}
              onChange={(_e, v) => setReservation(v)}
              getOptionLabel={reservationLabel}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              noOptionsText="Aucune réservation"
              renderInput={(params) => (
                <TextField {...params} label="Réservation" placeholder="Rechercher un client…" />
              )}
            />
            <FormControl fullWidth>
              <InputLabel>Modèle</InputLabel>
              <Select label="Modèle" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name} ({offsetLabel(t.dayOffset)})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {error ? (
              <Box sx={{ p: 1.5, bgcolor: 'error.lighter', border: '1px solid', borderColor: 'error.light', borderRadius: 1 }}>
                <Typography variant="body2" color="error.main">{error}</Typography>
              </Box>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Annuler</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || loading || !reservation || !templateId}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
        >
          Ajouter à la file
        </Button>
      </DialogActions>
    </Dialog>
  );
}
