import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TableRow, TableCell,
  IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { displayDate } from '../utils/formatters';
import DataPageScaffold from '../components/DataPageScaffold';
import FormDialog from '../components/FormDialog';
import SchoolHolidayFormFields from '../components/SchoolHolidayFormFields';
import { useAppDialogs } from '../components/DialogProvider';
import useCrudResource from '../hooks/useCrudResource';
import api from '../api';

const emptyForm = {
  label: '', zoneA_start: '', zoneA_end: '', zoneB_start: '', zoneB_end: '', zoneC_start: '', zoneC_end: ''
};

export default function SchoolHolidaysPage() {
  const { confirm } = useAppDialogs();
  const {
    items: holidays,
    reload,
    createItem,
    updateItem,
    removeItem,
  } = useCrudResource({
    listFn: () => api.getSchoolHolidays(),
    createFn: (payload) => api.createSchoolHoliday(payload),
    updateFn: (id, payload) => api.updateSchoolHoliday(id, payload),
    deleteFn: (id) => api.deleteSchoolHoliday(id),
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { reload(); }, [reload]);

  const openCreate = () => { setForm(emptyForm); setEditId(null); setDialogOpen(true); };
  const openEdit = (h) => {
    setForm({
      label: h.label, zoneA_start: h.zoneA_start || '', zoneA_end: h.zoneA_end || '',
      zoneB_start: h.zoneB_start || '', zoneB_end: h.zoneB_end || '',
      zoneC_start: h.zoneC_start || '', zoneC_end: h.zoneC_end || ''
    });
    setEditId(h.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (editId) await updateItem(editId, form);
    else await createItem(form);
    setDialogOpen(false);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: 'Supprimer cette période de vacances ?'
    });
    if (!ok) return;
    await removeItem(id);
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Box>
      <DataPageScaffold
        title="Vacances scolaires"
        actionLabel="Ajouter"
        actionIcon={<AddIcon />}
        onAction={openCreate}
        minWidth={760}
        head={(
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Période</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Zone A</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Zone B</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Zone C</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>
          </TableRow>
        )}
        hasItems={holidays.length > 0}
        emptyColSpan={5}
        emptyText="Aucune période configurée"
      >
        {holidays.map(h => (
          <TableRow key={h.id} hover>
            <TableCell>{h.label}</TableCell>
            <TableCell align="center">{displayDate(h.zoneA_start)} → {displayDate(h.zoneA_end)}</TableCell>
            <TableCell align="center">{displayDate(h.zoneB_start)} → {displayDate(h.zoneB_end)}</TableCell>
            <TableCell align="center">{displayDate(h.zoneC_start)} → {displayDate(h.zoneC_end)}</TableCell>
            <TableCell align="center">
              <IconButton size="small" onClick={() => openEdit(h)}><EditIcon fontSize="small" /></IconButton>
              <IconButton size="small" color="error" onClick={() => handleDelete(h.id)}><DeleteIcon fontSize="small" /></IconButton>
            </TableCell>
          </TableRow>
        ))}
      </DataPageScaffold>

      {/* Create / Edit Dialog */}
      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editId ? 'Modifier la période' : 'Ajouter une période'}
        onSubmit={handleSave}
        submitDisabled={!form.label}
        submitLabel="Enregistrer"
      >
        <SchoolHolidayFormFields form={form} setField={setField} />
      </FormDialog>

    </Box>
  );
}
