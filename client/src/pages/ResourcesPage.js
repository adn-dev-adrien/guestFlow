import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, TableContainer, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../api';

const emptyResource = { name: '', quantity: 0, price: 0, propertyId: '', note: '' };

export default function ResourcesPage() {
  const [resources, setResources] = useState([]);
  const [properties, setProperties] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyResource);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    const [resData, props] = await Promise.all([api.getResources(), api.getProperties()]);
    setResources(resData);
    setProperties(props);
  };

  useEffect(() => { load(); }, []);

  const openDialog = (resource) => {
    if (resource) {
      setForm({
        ...resource,
        propertyId: resource.propertyId ?? '',
      });
      setEditId(resource.id);
    } else {
      setForm({ ...emptyResource });
      setEditId(null);
    }
    setOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: form.name,
      quantity: Number(form.quantity) || 0,
      price: Number(form.price) || 0,
      propertyId: form.propertyId || null,
      note: form.note || '',
    };
    if (editId) await api.updateResource(editId, payload);
    else await api.createResource(payload);
    setOpen(false);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette ressource ?')) return;
    await api.deleteResource(id);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Ressources</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
          Nouvelle ressource
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quantité</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Prix (€)</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {resources.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.quantity}</TableCell>
                  <TableCell>{r.price}</TableCell>
                  <TableCell>{r.propertyId ? (properties.find(p => p.id === r.propertyId)?.name || r.propertyId) : 'Tous les logements'}</TableCell>
                  <TableCell>{r.note || '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openDialog(r)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {resources.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>Aucune ressource</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editId ? 'Modifier la ressource' : 'Nouvelle ressource'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <TextField label="Quantité" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} fullWidth inputProps={{ min: 0 }} />
            <TextField label="Prix (€)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} fullWidth inputProps={{ min: 0, step: '0.01' }} />
            <FormControl fullWidth>
              <InputLabel>Logement</InputLabel>
              <Select
                value={form.propertyId}
                label="Logement"
                onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
              >
                <MenuItem value="">Tous les logements</MenuItem>
                {properties.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} fullWidth multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
