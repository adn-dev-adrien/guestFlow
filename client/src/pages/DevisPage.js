import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, Typography, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip,
  Stack, FormControl, InputLabel, Select, MenuItem, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import PageHeader from '../components/PageHeader';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';

const STATUS_LABELS = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  converted: 'Converti',
};

const STATUS_COLORS = {
  draft: 'default',
  sent: 'info',
  accepted: 'success',
  converted: 'secondary',
};

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function formatPrice(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(2).replace('.', ',')} €`;
}

export default function DevisPage() {
  const navigate = useNavigate();
  const { confirm, alert } = useAppDialogs();
  const [devisList, setDevisList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

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
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const data = await api.getDevis(params);
      setDevisList(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (devis) => {
    const ok = await confirm({
      title: 'Supprimer le devis',
      message: `Supprimer le devis ${devis.devisNumber} ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    await api.deleteDevis(devis.id);
    load();
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
      alert(e.message || 'Erreur lors de la conversion');
    }
  };

  const handleOpenPdf = async (devis) => {
    try {
      const res = await fetch(api.getDevisPdfUrl(devis.id));
      if (!res.ok) throw new Error('Impossible de générer le PDF.');
      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `devis-${devis.devisNumber || devis.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Impossible de télécharger le PDF du devis.' });
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <PageHeader
        title="Devis"
        subtitle="Gérez vos devis clients"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreateDevis}
          >
            Nouveau devis
          </Button>
        }
      />

      <Card variant="outlined" sx={{ bgcolor: '#fff', mt: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Statut</InputLabel>
              <Select
                value={statusFilter}
                label="Statut"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="">Tous</MenuItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <MenuItem key={k} value={k}>{v}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : devisList.length === 0 ? (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>
              Aucun devis trouvé.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell sx={{ fontWeight: 700 }}>N° Devis</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Statut</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Client</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Logement</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Arrivée</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Départ</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Montant TTC</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {devisList.map((d) => (
                    <TableRow
                      key={d.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => handleEditDevis(d)}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                          {d.devisNumber}
                        </Typography>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Chip
                          label={STATUS_LABELS[d.status] || d.status}
                          color={STATUS_COLORS[d.status] || 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {d.firstName} {d.lastName}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{d.propertyName || '—'}</Typography>
                      </TableCell>
                      <TableCell>{formatDate(d.startDate)}</TableCell>
                      <TableCell>{formatDate(d.endDate)}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatPrice(Number(d.finalPrice || 0) + Number(d.touristTaxTotal || 0))}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                        <Stack direction="row" spacing={0.5} justifyContent="center">
                          <Tooltip title="Modifier">
                            <IconButton size="small" onClick={() => handleEditDevis(d)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Télécharger le PDF">
                            <IconButton size="small" onClick={() => handleOpenPdf(d)}>
                              <PictureAsPdfIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {d.status !== 'converted' && (
                            <Tooltip title="Confirmer en réservation">
                              <IconButton size="small" color="default" onClick={() => handleConvert(d)}>
                                <CheckCircleIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Supprimer">
                            <IconButton size="small" color="error" onClick={() => handleDelete(d)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
