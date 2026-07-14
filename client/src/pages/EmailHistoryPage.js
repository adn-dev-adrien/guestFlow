/**
 * EmailHistoryPage — paginated log of every send / failure / acknowledged-skip.
 * See specs/email-automation.md §6.5.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, TableRow, TableCell, Typography, Stack, FormControl, InputLabel,
  Select, MenuItem, Button, TextField, IconButton, Tooltip,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import DataPageScaffold from '../components/DataPageScaffold';
import StatusBadge from '../components/StatusBadge';
import EmailLogViewDialog from '../components/EmailLogViewDialog';
import api from '../api';
import { displayDateTime } from '../utils/formatters';

const PAGE_SIZE = 50;

// Maps the email-log domain status to the shared StatusBadge (specs/ds-components.md §3.5 — the
// page used to ship its own shadowing StatusBadge with a divergent outlined rendering).
function EmailStatusBadge({ status, channel }) {
  if (status === 'sent') {
    return channel === 'manual'
      ? <StatusBadge status="info" label="Envoyé manuellement" />
      : <StatusBadge status="success" label="Envoyé" />;
  }
  if (status === 'failed') return <StatusBadge status="error" label="Échec" />;
  if (status === 'acknowledged-skip') return <StatusBadge status="neutral" label="Ignoré" />;
  return <StatusBadge status="neutral" label={String(status)} />;
}

export default function EmailHistoryPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateFilter, setTemplateFilter] = useState('');
  const [reservationIdFilter, setReservationIdFilter] = useState('');
  const [viewing, setViewing] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      if (templateFilter) params.templateId = templateFilter;
      if (reservationIdFilter) params.reservationId = reservationIdFilter;
      const res = await api.getEmailHistory(params);
      setRows(res.rows || []);
      setTotal(res.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, templateFilter, reservationIdFilter]);

  useEffect(() => {
    api.getEmailTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <Box>
      <DataPageScaffold
        title="Historique des emails"
        topContent={(
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Historique des emails pour les séjours en cours et à venir. Les envois sont automatiquement
              retirés 3 jours après la date d&apos;arrivée.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Statut</InputLabel>
              <Select label="Statut" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
                <MenuItem value="">Tous</MenuItem>
                <MenuItem value="sent">Envoyé</MenuItem>
                <MenuItem value="failed">Échec</MenuItem>
                <MenuItem value="acknowledged-skip">Ignoré</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Modèle</InputLabel>
              <Select label="Modèle" value={templateFilter} onChange={(e) => { setTemplateFilter(e.target.value); setPage(0); }}>
                <MenuItem value="">Tous</MenuItem>
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Réservation #"
              value={reservationIdFilter}
              onChange={(e) => { setReservationIdFilter(e.target.value); setPage(0); }}
              sx={{ width: 140 }}
            />
            <Button startIcon={<RefreshIcon />} onClick={() => reload()} variant="outlined">
              Actualiser
            </Button>
            </Box>
          </Box>
        )}
        minWidth={920}
        head={(
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Date / heure</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Modèle</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Destinataire</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Statut</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Sujet</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
          </TableRow>
        )}
        hasItems={rows.length > 0}
        emptyColSpan={6}
        emptyText={loading ? 'Chargement…' : 'Aucun email dans l\'historique'}
      >
        {rows.map((r) => (
          <TableRow key={r.id} hover>
            <TableCell>{displayDateTime(r.sentAt)}</TableCell>
            <TableCell>
              <Stack>
                <Typography variant="body2">{r.templateName || <em>(modèle supprimé)</em>}</Typography>
                {r.clientFullName ? (
                  <Typography variant="caption" color="text.secondary">{r.clientFullName} · {r.propertyName}</Typography>
                ) : null}
              </Stack>
            </TableCell>
            <TableCell>{r.recipientEmail || '—'}</TableCell>
            <TableCell><EmailStatusBadge status={r.status} channel={r.channel} /></TableCell>
            <TableCell sx={{ maxWidth: 260, textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {r.renderedSubject}
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Voir l'email">
                <IconButton size="small" aria-label="Voir l'email" onClick={() => setViewing(r)}>
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </DataPageScaffold>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, px: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {total > 0 ? `Page ${page + 1} / ${maxPage + 1} · ${total} résultat${total > 1 ? 's' : ''}` : ''}
        </Typography>
        <Box>
          <Button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Précédent</Button>
          <Button onClick={() => setPage(Math.min(maxPage, page + 1))} disabled={page >= maxPage}>Suivant</Button>
        </Box>
      </Box>

      <EmailLogViewDialog
        open={!!viewing}
        row={viewing}
        onClose={() => setViewing(null)}
      />
    </Box>
  );
}
