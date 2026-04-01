import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Button, TextField, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, Grid
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';

const emptyForm = {
  label: '', zoneA_start: '', zoneA_end: '', zoneB_start: '', zoneB_end: '', zoneC_start: '', zoneC_end: ''
};

function displayDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export default function SchoolHolidaysPage() {
  const [holidays, setHolidays] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = async () => setHolidays(await api.getSchoolHolidays());
  useEffect(() => { load(); }, []);

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
    if (editId) await api.updateSchoolHoliday(editId, form);
    else await api.createSchoolHoliday(form);
    setDialogOpen(false);
    load();
  };

  const handleDelete = async () => {
    await api.deleteSchoolHoliday(confirmDeleteId);
    setConfirmDeleteId(null);
    load();
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Typography variant="h4">Vacances scolaires</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ width: { xs: '100%', sm: 'auto' } }}>Ajouter</Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Période</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="center">Zone A</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="center">Zone B</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="center">Zone C</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holidays.map(h => (
                  <TableRow key={h.id} hover>
                    <TableCell>{h.label}</TableCell>
                    <TableCell align="center">{displayDate(h.zoneA_start)} → {displayDate(h.zoneA_end)}</TableCell>
                    <TableCell align="center">{displayDate(h.zoneB_start)} → {displayDate(h.zoneB_end)}</TableCell>
                    <TableCell align="center">{displayDate(h.zoneC_start)} → {displayDate(h.zoneC_end)}</TableCell>
                    <TableCell align="center">
                      <IconButton size="small" onClick={() => openEdit(h)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => setConfirmDeleteId(h.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {holidays.length === 0 && (
                  <TableRow><TableCell colSpan={5} align="center"><Typography color="text.secondary">Aucune période configurée</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editId ? 'Modifier la période' : 'Ajouter une période'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Nom de la période" value={form.label} onChange={(e) => setField('label', e.target.value)} fullWidth />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Zone A</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Début" type="date" value={form.zoneA_start} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneA_start', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Fin" type="date" value={form.zoneA_end} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneA_end', e.target.value)} fullWidth />
              </Grid>
            </Grid>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Zone B</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Début" type="date" value={form.zoneB_start} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneB_start', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Fin" type="date" value={form.zoneB_end} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneB_end', e.target.value)} fullWidth />
              </Grid>
            </Grid>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Zone C</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Début" type="date" value={form.zoneC_start} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneC_start', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Fin" type="date" value={form.zoneC_end} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('zoneC_end', e.target.value)} fullWidth />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.label}>Enregistrer</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)}>
        <DialogTitle>Confirmer la suppression</DialogTitle>
        <DialogContent>
          <Typography>Supprimer cette période de vacances ?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteId(null)}>Annuler</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Supprimer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
