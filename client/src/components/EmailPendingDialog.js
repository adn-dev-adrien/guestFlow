/**
 * EmailPendingDialog — lists the pending manual emails (templateId × reservationId pairs).
 * Each row offers "Voir & envoyer" → EmailManualSendDialog, or "Ignorer" → acknowledge API.
 * See specs/email-automation.md §6.3.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Chip, Stack,
} from '@mui/material';
import api from '../api';
import EmailManualSendDialog from './EmailManualSendDialog';
import { useAppDialogs } from './DialogProvider';

function formatStayDates(startDate) {
  if (!startDate) return '';
  try {
    return new Date(`${startDate}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return startDate; }
}

export default function EmailPendingDialog({ open, onClose, onChanged }) {
  const { confirm, alert } = useAppDialogs();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(null); // { reservationId, templateId, reservationStartDate }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getPendingEmails();
      setRows(list);
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible de charger les emails en attente.' });
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  const handleAcknowledge = async (row) => {
    const ok = await confirm({
      title: 'Ignorer cet email',
      message: `Marquer comme géré l'email "${row.templateName}" pour ${row.clientFullName || 'ce client'} ? Il n'apparaîtra plus dans les emails à vérifier.`,
      confirmLabel: 'Ignorer',
      confirmColor: 'warning',
    });
    if (!ok) return;
    try {
      await api.acknowledgePendingEmail({ templateId: row.templateId, reservationId: row.reservationId });
      await reload();
      if (onChanged) onChanged();
    } catch (e) {
      await alert({ title: 'Erreur', message: e?.message || 'Impossible d\'acquitter l\'email.' });
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          Emails en attente d'envoi
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Modèles en mode manuel dont la date d'envoi est aujourd'hui ou dans les 7 derniers jours.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
              <Typography>Tous les emails manuels sont à jour.</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Modèle</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.templateId}-${r.reservationId}`} hover>
                    <TableCell>
                      <Stack>
                        <Typography variant="body2">{r.clientFullName || '—'}</Typography>
                        {r.clientEmail
                          ? <Typography variant="caption" color="text.secondary">{r.clientEmail}</Typography>
                          : <Chip label="Adresse manquante" size="small" color="warning" variant="outlined" />}
                      </Stack>
                    </TableCell>
                    <TableCell>{r.propertyName}</TableCell>
                    <TableCell>{formatStayDates(r.startDate)}</TableCell>
                    <TableCell>{r.templateName}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!r.clientEmail}
                        onClick={() => setSending({
                          templateId: r.templateId,
                          reservationId: r.reservationId,
                          reservationStartDate: r.startDate,
                        })}
                        sx={{ mr: 1 }}
                      >
                        Voir & envoyer
                      </Button>
                      <Button size="small" onClick={() => handleAcknowledge(r)}>
                        Ignorer
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Fermer</Button>
        </DialogActions>
      </Dialog>

      <EmailManualSendDialog
        open={!!sending}
        reservationId={sending?.reservationId}
        reservationStartDate={sending?.reservationStartDate}
        defaultTemplateId={sending?.templateId}
        onClose={() => setSending(null)}
        onSent={() => {
          setSending(null);
          reload();
          if (onChanged) onChanged();
        }}
      />
    </>
  );
}
