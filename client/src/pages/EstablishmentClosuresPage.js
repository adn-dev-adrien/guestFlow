import React, { useEffect, useState } from 'react';
import {
  Box, IconButton, TextField, TableHead, TableBody, TableRow, TableCell,
  Tooltip, MenuItem, Alert, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { frFR } from '@mui/x-date-pickers/locales';
import dayjs from 'dayjs';
import PageActionBar from '../components/PageActionBar';
import TableCard from '../components/TableCard';
import FormDialog from '../components/FormDialog';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { displayDate } from '../utils/formatters';

function isoToDayjs(iso) {
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d : null;
}
function dayjsToIso(d) {
  return d && d.isValid && d.isValid() ? d.format('YYYY-MM-DD') : '';
}

const ALL_PROPERTIES = 'ALL';

const EMPTY_FORM = {
  propertyId: ALL_PROPERTIES,
  label: 'Fermeture établissement',
  startDate: '',
  endDate: '',
};

export default function EstablishmentClosuresPage() {
  const { confirm, alert } = useAppDialogs();
  const [closures, setClosures] = useState([]);
  const [properties, setProperties] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);

  const load = async () => {
    const [closuresList, propsList] = await Promise.all([
      api.getEstablishmentClosures(),
      api.getProperties(),
    ]);
    setClosures(closuresList || []);
    setProperties(propsList || []);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogError('');
    setEndDateOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      propertyId: row.propertyId == null ? ALL_PROPERTIES : String(row.propertyId),
      label: row.label || 'Fermeture établissement',
      startDate: row.startDate || '',
      endDate: row.endDate || '',
    });
    setDialogError('');
    setEndDateOpen(false);
    setDialogOpen(true);
  };

  const submitDisabled = !form.startDate || !form.endDate || form.startDate >= form.endDate || saving;

  const handleSave = async () => {
    setSaving(true);
    setDialogError('');
    const payload = {
      propertyId: form.propertyId === ALL_PROPERTIES ? null : Number(form.propertyId),
      label: form.label,
      startDate: form.startDate,
      endDate: form.endDate,
    };
    try {
      if (editId) {
        await api.updateEstablishmentClosure(editId, payload);
      } else {
        await api.createEstablishmentClosure(payload);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setDialogError(err.error || err.message || "Impossible d'enregistrer cette fermeture.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Supprimer cette période de fermeture ?',
      confirmLabel: 'Supprimer',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.deleteEstablishmentClosure(id);
      await load();
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible de supprimer cette fermeture.' });
    }
  };

  const propertyNameById = (id) => {
    const p = properties.find((x) => Number(x.id) === Number(id));
    return p ? p.name : `#${id}`;
  };

  return (
    <Box>
      <PageActionBar
        title="Fermetures de l'établissement"
        actionsBefore={[{
          icon: <AddIcon />,
          tooltip: 'Ajouter une fermeture',
          onClick: openCreate,
          color: 'primary',
          variant: 'contained',
        }]}
      />

      <Box sx={{ maxWidth: 920, mx: 'auto', px: { xs: 0, sm: 1 } }}>
        <TableCard minWidth={760}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Libellé</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Début</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Fin</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {closures.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 3, fontStyle: 'italic' }}>
                    Aucune fermeture configurée
                  </Typography>
                </TableCell>
              </TableRow>
            ) : closures.map((row) => (
              <TableRow
                key={row.id}
                hover
                onClick={() => openEdit(row)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  {row.propertyId == null ? (
                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                      Tous les logements
                    </Typography>
                  ) : (
                    row.propertyName || propertyNameById(row.propertyId)
                  )}
                </TableCell>
                <TableCell>{row.label || 'Fermeture établissement'}</TableCell>
                <TableCell>{displayDate(row.startDate)}</TableCell>
                <TableCell>{displayDate(row.endDate)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Supprimer">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                      aria-label="Supprimer"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      </Box>

      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editId ? 'Modifier la fermeture' : 'Ajouter une fermeture'}
        onSubmit={handleSave}
        submitDisabled={submitDisabled}
        submitLabel={saving ? 'Enregistrement…' : 'Enregistrer'}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
          <TextField
            select
            label="Logement concerné"
            value={form.propertyId}
            onChange={(e) => setForm((prev) => ({ ...prev, propertyId: e.target.value }))}
            fullWidth
            helperText="Sélectionnez « Tous les logements » pour une fermeture globale."
          >
            <MenuItem value={ALL_PROPERTIES}>Tous les logements</MenuItem>
            {properties.map((p) => (
              <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Libellé"
            value={form.label}
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
            fullWidth
          />
          <LocalizationProvider
            dateAdapter={AdapterDayjs}
            adapterLocale="fr"
            localeText={frFR.components.MuiLocalizationProvider.defaultProps.localeText}
          >
            <DatePicker
              label="Début de fermeture"
              value={isoToDayjs(form.startDate)}
              onChange={(value) => setForm((prev) => ({ ...prev, startDate: dayjsToIso(value) }))}
              onAccept={(value) => {
                const iso = dayjsToIso(value);
                const nextDayIso = value && value.isValid()
                  ? value.add(1, 'day').format('YYYY-MM-DD')
                  : '';
                setForm((prev) => ({
                  ...prev,
                  startDate: iso,
                  // Pre-fill the reopening date with start+1 (= one closed day)
                  // whenever it's empty or no longer valid (≤ new start).
                  endDate: (!prev.endDate || prev.endDate <= iso) ? nextDayIso : prev.endDate,
                }));
                setEndDateOpen(true);
              }}
              format="DD/MM/YYYY"
              slotProps={{ textField: { fullWidth: true } }}
            />
            <DatePicker
              label="Réouverture"
              open={endDateOpen}
              onOpen={() => setEndDateOpen(true)}
              onClose={() => setEndDateOpen(false)}
              value={isoToDayjs(form.endDate)}
              onChange={(value) => setForm((prev) => ({ ...prev, endDate: dayjsToIso(value) }))}
              minDate={form.startDate ? dayjs(form.startDate).add(1, 'day') : undefined}
              format="DD/MM/YYYY"
              slotProps={{
                textField: {
                  fullWidth: true,
                  helperText: 'Premier jour à nouveau disponible. Ex : du 15 au 16 = un seul jour fermé (le 15).',
                },
              }}
            />
          </LocalizationProvider>
        </Box>
      </FormDialog>
    </Box>
  );
}
