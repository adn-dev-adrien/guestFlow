/**
 * EmailPendingAlert — dashboard widget that surfaces the count of pending manual emails.
 * Self-contained: renders NOTHING when the count is 0, so it disappears as soon as the
 * operator catches up. Clicking the card opens the EmailPendingDialog (§6.2 + §6.3).
 *
 * See specs/email-automation.md §3 rule 8 + §6.2.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardActionArea, CardContent, Stack, Typography, Chip, Box,
} from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutlined';
import api from '../api';
import EmailPendingDialog from './EmailPendingDialog';

export default function EmailPendingAlert() {
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    api.getPendingEmails()
      .then((rows) => setPending(rows || []))
      .catch(() => setPending([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Render nothing while loading + when empty — disappears entirely as soon as the queue
  // clears, by spec design.
  if (!loaded) return null;
  if (pending.length === 0) return null;

  const noEmailCount = pending.filter((r) => !r.clientEmail).length;

  return (
    <>
      <Card
        sx={{
          mb: 3,
          bgcolor: 'info.lighter',
          border: '1px solid',
          borderColor: 'info.light',
        }}
      >
        <CardActionArea onClick={() => setOpen(true)}>
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Box sx={{ color: 'info.main', display: 'flex' }}>
                <MailOutlineIcon fontSize="large" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Emails à vérifier ({pending.length})
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {pending.length} message{pending.length > 1 ? 's' : ''} en attente d'envoi manuel sur les 7 derniers jours.
                  {noEmailCount > 0 ? ` ${noEmailCount} client${noEmailCount > 1 ? 's' : ''} sans adresse email.` : ''}
                </Typography>
              </Box>
              <Chip label="Voir et envoyer" color="info" />
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>

      <EmailPendingDialog
        open={open}
        onClose={() => { setOpen(false); reload(); }}
        onChanged={reload}
      />
    </>
  );
}
