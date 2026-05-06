import React, { useEffect, useState } from 'react';
import {
  Box,
  IconButton,
  TextField,
  TableCell,
  TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DataPageScaffold from '../components/DataPageScaffold';
import FormDialog from '../components/FormDialog';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';
import { displayDate } from '../utils/formatters';

const emptyForm = {
  label: 'Fermeture établissement',
  startDate: '',
  endDate: '',
};

export default function EstablishmentClosuresPage() {
  const { confirm, alert } = useAppDialogs();
  const [closures, setClosures] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const rows = await api.getEstablishmentClosures();
    setClosures(rows || []);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      label: row.label || 'Fermeture établissement',
      startDate: row.startDate || '',
      endDate: row.endDate || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editId) {
        await api.updateEstablishmentClosure(editId, form);
      } else {
        await api.createEstablishmentClosure(form);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      await alert({ title: 'Erreur', message: err.message || 'Impossible d\'enregistrer cette fermeture.' });
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

  return (
    <Box>
      <DataPageScaffold
        title="Fermetures établissement"
        actionLabel="Ajouter une fermeture"
        actionIcon={<AddIcon />}
        onAction={openCreate}
        minWidth={760}
        head={(
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Libellé</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Début</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Fin</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
          </TableRow>
        )}
        hasItems={closures.length > 0}
        emptyColSpan={4}
        emptyText="Aucune fermeture configurée"
      >
        {closures.map((row) => (
          <TableRow key={row.id} hover>
            <TableCell>{row.label || 'Fermeture établissement'}</TableCell>
            <TableCell>{displayDate(row.startDate)}</TableCell>
            <TableCell>{displayDate(row.endDate)}</TableCell>
            <TableCell align="right">
              <IconButton size="small" onClick={() => openEdit(row)}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => handleDelete(row.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </TableCell>
          </TableRow>
        ))}
      </DataPageScaffold>

      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editId ? 'Modifier la fermeture' : 'Ajouter une fermeture'}
        onSubmit={handleSave}
        submitDisabled={!form.startDate || !form.endDate || form.startDate >= form.endDate}
        submitLabel="Enregistrer"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Libellé"
            value={form.label}
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
            fullWidth
          />
          <TextField
            label="Début fermeture"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            label="Fin fermeture"
            type="date"
            value={form.endDate}
            onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </Box>
      </FormDialog>
    </Box>
  );
}
