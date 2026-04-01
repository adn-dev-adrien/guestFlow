import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, FormControl,
  InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';

const PRICE_TYPES = [
  { value: 'per_stay', label: 'Par séjour' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par nuit' },
  { value: 'per_person_per_night', label: 'Par personne et par nuit' },
  { value: 'per_hour', label: 'Par heure' },
];

const emptyOption = { title: '', description: '', priceType: 'per_stay', price: 0, propertyIds: [] };

export default function OptionsPage() {
  const [options, setOptions] = useState([]);
  const [properties, setProperties] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyOption);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    const [opts, props] = await Promise.all([api.getOptions(), api.getProperties()]);
    setOptions(opts);
    setProperties(props);
  };
  useEffect(() => { load(); }, []);

  const handleOpen = (opt) => {
    if (opt) { setForm({ ...opt }); setEditId(opt.id); }
    else { setForm({ ...emptyOption }); setEditId(null); }
    setOpen(true);
  };

  const handleSave = async () => {
    if (editId) await api.updateOption(editId, form);
    else await api.createOption(form);
    setOpen(false);
    load();
  };

  const handleDelete = async (id) => {
    if (window.confirm('Supprimer cette option ?')) {
      await api.deleteOption(id);
      load();
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Options de séjour</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen(null)}>
          Nouvelle option
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Titre</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type de prix</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Prix (€)</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Logements</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {options.map((o) => (
                <TableRow key={o.id} hover onClick={() => handleOpen(o)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{o.title}</TableCell>
                  <TableCell>{o.description}</TableCell>
                  <TableCell>{PRICE_TYPES.find(t => t.value === o.priceType)?.label || o.priceType}</TableCell>
                  <TableCell>{o.price}€</TableCell>
                  <TableCell>
                    {(o.propertyIds || []).length > 0
                      ? o.propertyIds.map(pid => properties.find(p => p.id === pid)?.name || pid).join(', ')
                      : 'Aucun logement'}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpen(o); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(o.id); }}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {options.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>Aucune option</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editId ? 'Modifier l\'option' : 'Nouvelle option'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth required />
            <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />
            <FormControl fullWidth>
              <InputLabel>Type de prix</InputLabel>
              <Select value={form.priceType} label="Type de prix" onChange={(e) => setForm({ ...form, priceType: e.target.value })}>
                {PRICE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Prix (€)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Logements disponibles</InputLabel>
              <Select
                multiple
                value={form.propertyIds || []}
                label="Logements disponibles"
                onChange={(e) => setForm({ ...form, propertyIds: e.target.value })}
                input={<OutlinedInput label="Logements disponibles" />}
                renderValue={(selected) =>
                  selected.length === 0
                    ? 'Aucun logement'
                    : selected.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ')
                }
              >
                {properties.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    <Checkbox checked={(form.propertyIds || []).includes(p.id)} />
                    <ListItemText primary={p.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.title}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
