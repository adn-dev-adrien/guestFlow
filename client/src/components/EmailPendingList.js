/**
 * EmailPendingList — presentational table of the pending manual-email queue.
 *
 * Replaces the former EmailPendingDialog popup: the queue is now reviewed inline on the
 * Emails page (specs/email-automation.md §6.3 + §6.10). This component renders rows only —
 * the parent owns the data fetch, the EmailManualSendDialog, the acknowledge confirm and
 * the reservation navigation.
 *
 * Props:
 *   rows:              Array<{ templateId, reservationId, templateName, clientFullName,
 *                             clientEmail, propertyName, startDate }>
 *   onPreview:         (row) => void   — row click (only fired when the client has an email)
 *   onOpenReservation: (row) => void   — client-name click (isolated from the row click)
 *   onAcknowledge:     (row) => void   — "Ignorer" action
 *   onFixEmail:        (row) => void   — "Adresse manquante" chip click → edit the client's fiche
 */

import React from 'react';
import {
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody,
  Typography, Stack, Chip, Button, Link,
} from '@mui/material';

function formatStayDate(startDate) {
  if (!startDate) return '';
  try {
    return new Date(`${startDate}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return startDate; }
}

export default function EmailPendingList({ rows = [], onPreview, onOpenReservation, onAcknowledge, onFixEmail }) {
  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth: 760 }}>
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
              <TableRow
                key={`${r.templateId}-${r.reservationId}`}
                hover
                onClick={() => onPreview(r)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                    <Link
                      component="button"
                      type="button"
                      underline="hover"
                      onClick={(e) => { e.stopPropagation(); onOpenReservation(r); }}
                      sx={{ textAlign: 'left', fontWeight: 500 }}
                    >
                      {r.clientFullName || '—'}
                    </Link>
                    {r.clientEmail
                      ? <Typography variant="caption" color="text.secondary">{r.clientEmail}</Typography>
                      : (
                        <Chip
                          label="Adresse manquante"
                          size="small"
                          color="warning"
                          variant="outlined"
                          clickable
                          onClick={(e) => { e.stopPropagation(); if (onFixEmail) onFixEmail(r); }}
                          sx={{ cursor: 'pointer' }}
                        />
                      )}
                  </Stack>
                </TableCell>
                <TableCell>{r.propertyName}</TableCell>
                <TableCell>{formatStayDate(r.startDate)}</TableCell>
                <TableCell>{r.templateName}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={(e) => { e.stopPropagation(); onAcknowledge(r); }}
                  >
                    Ignorer
                  </Button>
                </TableCell>
              </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
