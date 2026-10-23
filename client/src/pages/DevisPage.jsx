import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Typography, Stack, FormControl, InputLabel, Select, MenuItem,
  IconButton, Tooltip, TableRow, TableCell,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import LanguageIcon from '@mui/icons-material/Language';
import DataPageScaffold from '../components/DataPageScaffold';
import OriginBadge from '../components/OriginBadge';
import StatusBadge from '../components/StatusBadge';
import RowActionsMenu from '../components/RowActionsMenu';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import api from '../api';
import { displayDate, formatCurrency } from '../utils/formatters';

const STATUS_LABELS = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  converted: 'Converti',
};

// Devis lifecycle → semantic StatusBadge (specs/ds-components.md §3.5; no filled/secondary chips).
const STATUS_BADGE = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  converted: 'success',
};

const TABULAR = { fontVariantNumeric: 'tabular-nums' };

// `originLabel` of a website request whose channel is not known (server: utils/attributionChannel.js).
const UNKNOWN_ORIGIN_LABEL = 'Origine inconnue';

export default function DevisPage() {
  const navigate = useNavigate();
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [devisList, setDevisList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  // Origin filter (specs/public-api.md follow-up): '' = all, 'public' = website booking requests,
  // 'internal' = operator-created devis.
  const [originFilter, setOriginFilter] = useState('');

  const handleCreateDevis = () => {
    navigate('/reservations/new?mode=devis');
  };

  const handleEditDevis = (devis) => {
    if (devis.status === 'converted' && devis.convertedReservationId) {
      navigate(`/reservations/${devis.convertedReservationId}`);
    } else {
      navigate(`/reservations/new?mode=devis&devisId=${devis.id}`);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (originFilter) params.requestOrigin = originFilter;
      const data = await api.getDevis(params);
      setDevisList(data || []);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, originFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (devis) => {
    const ok = await confirm({
      title: 'Supprimer le devis',
      message: `Supprimer le devis ${devis.devisNumber} ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteDevis(devis.id);
      showSuccess('Devis supprimé.');
      load();
    } catch (e) {
      showError(e.message || 'Impossible de supprimer le devis.');
    }
  };

  const handleConvert = async (devis) => {
    const ok = await confirm({
      title: 'Confirmer la réservation',
      message: `Convertir le devis ${devis.devisNumber} en réservation ? Les dates seront bloquées.`,
      confirmLabel: 'Confirmer',
      confirmColor: 'success',
    });
    if (!ok) return;
    try {
      const result = await api.convertDevisToReservation(devis.id);
      navigate(`/reservations/${result.reservationId}`);
    } catch (e) {
      showError(e.message || 'Erreur lors de la conversion du devis.');
    }
  };

  const handleOpenPdf = async (devis) => {
    try {
      const blob = await api.getDevisPdfBlob(devis.id);
      const fileUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `devis-${devis.devisNumber || devis.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (e) {
      showError(e.message || 'Impossible de télécharger le PDF du devis.');
    }
  };

  const devisNumberCell = (d) => (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{d.devisNumber}</Typography>
      {/* Origin badge (specs/public-api.md follow-up) — booking request from the website. */}
      {d.requestOrigin === 'public' && (
        <Tooltip title="Demande de réservation reçue depuis le site internet">
          <span><StatusBadge status="info" label="Site internet" icon={<LanguageIcon sx={{ fontSize: 14 }} />} /></span>
        </Tooltip>
      )}
      <OriginBadge label={d.originLabel} detail={d.originDetail} />
    </Stack>
  );

  const rowActions = (d) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center' }}>
      <Tooltip title="Modifier">
        <IconButton size="small" onClick={() => handleEditDevis(d)}><EditIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Tooltip title="Télécharger le PDF">
        <IconButton size="small" onClick={() => handleOpenPdf(d)}><DownloadIcon fontSize="small" /></IconButton>
      </Tooltip>
      {d.status !== 'converted' && (
        <Tooltip title="Confirmer en réservation">
          <IconButton size="small" onClick={() => handleConvert(d)}><CheckCircleIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      <Tooltip title="Supprimer">
        <IconButton size="small" color="error" onClick={() => handleDelete(d)}><DeleteIcon fontSize="small" /></IconButton>
      </Tooltip>
    </Stack>
  );

  const filters = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel>Statut</InputLabel>
        <Select value={statusFilter} label="Statut" onChange={(e) => setStatusFilter(e.target.value)}>
          <MenuItem value="">Tous</MenuItem>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <MenuItem key={k} value={k}>{v}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>Origine</InputLabel>
        <Select value={originFilter} label="Origine" onChange={(e) => setOriginFilter(e.target.value)}>
          <MenuItem value="">Toutes</MenuItem>
          <MenuItem value="public">Demandes du site internet</MenuItem>
          <MenuItem value="internal">Devis internes</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );

  const head = (
    <TableRow>
      <TableCell sx={{ fontWeight: 700 }}>N° Devis</TableCell>
      <TableCell sx={{ fontWeight: 700 }}>Statut</TableCell>
      <TableCell sx={{ fontWeight: 700 }}>Client</TableCell>
      <TableCell sx={{ fontWeight: 700 }}>Logement</TableCell>
      <TableCell sx={{ fontWeight: 700 }}>Arrivée</TableCell>
      <TableCell sx={{ fontWeight: 700 }}>Départ</TableCell>
      <TableCell sx={{ fontWeight: 700 }} align="right">Montant TTC</TableCell>
      <TableCell sx={{ fontWeight: 700 }} align="center">Actions</TableCell>
    </TableRow>
  );

  const renderRow = (d) => (
    <TableRow key={d.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleEditDevis(d)}>
      <TableCell>{devisNumberCell(d)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <StatusBadge status={STATUS_BADGE[d.status] || 'neutral'} label={STATUS_LABELS[d.status] || d.status} />
      </TableCell>
      <TableCell>{d.firstName} {d.lastName}</TableCell>
      <TableCell>{d.propertyName || '—'}</TableCell>
      <TableCell>{displayDate(d.startDate)}</TableCell>
      <TableCell>{displayDate(d.endDate)}</TableCell>
      <TableCell align="right" sx={TABULAR}>
        <Typography variant="body2" sx={{ fontWeight: 600, ...TABULAR }}>{formatCurrency(d.totalTtc)}</Typography>
      </TableCell>
      <TableCell align="center" onClick={(e) => e.stopPropagation()}>{rowActions(d)}</TableCell>
    </TableRow>
  );

  // specs/devis-list-mobile-card.md rules 1-4 — who, where, when, how much; one origin marker.
  const originMarker = (d) => {
    if (d.requestOrigin !== 'public') return null;
    const known = d.originLabel && d.originLabel !== UNKNOWN_ORIGIN_LABEL;
    return (
      <Tooltip title={d.originDetail ? `${d.originLabel} — ${d.originDetail}` : 'Demande de réservation reçue depuis le site internet'}>
        <Box component="span" sx={{ display: 'inline-flex', minWidth: 0, maxWidth: '62%', flex: '0 1 auto', '& .MuiChip-root': { maxWidth: '100%' } }}>
          <StatusBadge status="info" label={known ? d.originLabel : 'Site internet'} icon={<LanguageIcon sx={{ fontSize: 14 }} />} />
        </Box>
      </Tooltip>
    );
  };

  // The card opens on any tap (mouse/touch convenience); keyboard and screen readers get ONE button
  // around the identity lines — the PDF / « ⋯ » controls stay siblings, never nested in a button.
  const renderMobileCard = (d) => (
    <Box onClick={() => handleEditDevis(d)} sx={{ cursor: 'pointer' }}>
      <Box
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEditDevis(d); } }}
        sx={{ '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4, borderRadius: 1 } }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{`${d.firstName || ''} ${d.lastName || ''}`.trim() || '—'}</Typography>
          <StatusBadge status={STATUS_BADGE[d.status] || 'neutral'} label={STATUS_LABELS[d.status] || d.status} />
        </Stack>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>{d.propertyName || '—'}</Typography>
          {originMarker(d)}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ ...TABULAR, display: 'block' }}>{d.stayLabel || '—'}</Typography>
      </Box>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 1, mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', flex: 1, whiteSpace: 'nowrap' }}>{d.devisNumber}</Typography>
        <Typography variant="body1" sx={{ fontWeight: 700, whiteSpace: 'nowrap', ...TABULAR }}>{formatCurrency(d.totalTtc)}</Typography>
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', mr: -1 }}>
          <Tooltip title="Télécharger le PDF">
            <IconButton aria-label="Télécharger le PDF" onClick={() => handleOpenPdf(d)} sx={{ width: 44, height: 44 }}><DownloadIcon fontSize="small" /></IconButton>
          </Tooltip>
          <RowActionsMenu
            items={[
              d.status !== 'converted' && { label: 'Confirmer en réservation', icon: <CheckCircleIcon fontSize="small" />, onClick: () => handleConvert(d) },
              { label: 'Supprimer', icon: <DeleteIcon fontSize="small" />, color: 'error', onClick: () => handleDelete(d) },
            ]}
          />
        </Box>
      </Stack>
    </Box>
  );

  return (
    <DataPageScaffold
      title="Devis"
      actionLabel="Nouveau devis"
      actionIcon={<AddIcon />}
      onAction={handleCreateDevis}
      topContent={filters}
      loading={loading}
      error={loadError}
      onRetry={load}
      minWidth={900}
      head={head}
      emptyText="Aucun devis trouvé."
      items={devisList}
      getKey={(d) => d.id}
      renderRow={renderRow}
      renderMobileCard={renderMobileCard}
    />
  );
}
